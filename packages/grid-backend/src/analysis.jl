module Analysis

using Graphs

import ..Errors: TopologyError, ValidationError
import ..PowerFlow: execute_power_flow, build_pf_payload, default_optimizer, sorted_component_keys

export execute_n1, execute_timeseries, parse_timeseries_request, parse_n1_request

const MAX_TIMESERIES_POINTS = 96

"""
    reachable_from_slack(pm_data)

Return the set of bus indices reachable from any slack bus (`bus_type == 3`)
through in-service branches (`br_status == 1`). Bus indices are assumed to be
contiguous `1..n`, which `convert_topology` guarantees.
"""
function reachable_from_slack(pm_data::AbstractDict)
    g = Graphs.SimpleGraph(length(pm_data["bus"]))
    for branch in values(pm_data["branch"])
        if get(branch, "br_status", 1) == 1
            Graphs.add_edge!(g, branch["f_bus"], branch["t_bus"])
        end
    end
    slack = Set{Int}(bus["bus_i"] for bus in values(pm_data["bus"]) if bus["bus_type"] == 3)
    reachable = Set{Int}()
    for component in Graphs.connected_components(g)
        if any(b -> b in slack, component)
            union!(reachable, component)
        end
    end
    return reachable
end

"""Total active load (MW) sitting on buses that are NOT in `reachable`."""
function lost_load_mw(pm_data::AbstractDict, reachable::Set{Int})
    base_mva = pm_data["baseMVA"]
    lost = 0.0
    for load in values(pm_data["load"])
        get(load, "status", 1) == 1 || continue
        if !(load["load_bus"] in reachable)
            # pd is per-unit after make_per_unit!; scale back to MW.
            lost += load["pd"] * base_mva
        end
    end
    return lost
end

"""Names of buses not reachable from the slack, in bus-index order."""
function islanded_bus_names(pm_data::AbstractDict, reachable::Set{Int})
    names = String[]
    for key in sorted_component_keys(pm_data["bus"])
        bus = pm_data["bus"][key]
        bus["bus_i"] in reachable || push!(names, string(bus["name"]))
    end
    return names
end

"""
    parse_n1_request(request)

N-1 请求既接受裸拓扑（历史行为），也接受 `{"topology": <拓扑>, "restore": true}`。
`restore` 在裸拓扑上也可以作为顶层键给出。返回 `(topology, restore::Bool)`。
`restore` 默认 false —— 关闭时 execute_n1 的输出与历史完全一致。

`max_ties` 曾经存在，现在被显式拒绝（ValidationError）。理由见 `attempt_restoration`
的「深度定理」：单条支路开断最多把网络切成 2 个连通分量，恢复连通当且仅当闭合一条
跨界联络开关，闭合任意多条非跨界联络开关都不改变连通性 —— 深度 ≥ 2 的组合搜索在
数学上不可能带来任何新的可恢复解。留着这个旋钮就是骗人。
"""
function parse_n1_request(request::AbstractDict)
    topology = request
    if haskey(request, "topology")
        topology = request["topology"]
        topology isa AbstractDict || throw(ValidationError("topology must be an object", ["topology"]))
    end

    raw_restore = get(request, "restore", false)
    restore = if raw_restore isa Bool
        raw_restore
    elseif raw_restore isa AbstractString
        lowercase(raw_restore) == "true"
    else
        throw(ValidationError("restore must be a boolean", ["restore"]))
    end

    haskey(request, "max_ties") && throw(ValidationError(
        "max_ties is not supported: a single branch outage splits the network into at most " *
        "two connected components, so exactly one bridging tie switch is necessary and " *
        "sufficient to restore connectivity — deeper tie combinations cannot restore anything " *
        "a single tie cannot. Use /api/grid/reconfig to optimise the restored operating point.",
        ["max_ties"]))

    return topology, restore
end

"""Closed-branch graph of `pm_data` (1-based bus indices)."""
function closed_graph(pm_data::AbstractDict)
    g = Graphs.SimpleGraph(length(pm_data["bus"]))
    for branch in values(pm_data["branch"])
        get(branch, "br_status", 1) == 1 || continue
        Graphs.add_edge!(g, branch["f_bus"], branch["t_bus"])
    end
    return g
end

"""Number of in-service branches."""
n_closed_branches(pm_data::AbstractDict) =
    count(b -> get(b, "br_status", 1) == 1, values(pm_data["branch"]))

"""
    loop_count(pm_data)

独立回路数（cyclomatic number）：`闭合支路数 − 母线数 + 连通分量数`。用**支路数**而不是
图边数，这样并联支路与自环也被正确计成回路（`closed_graph` 用 SimpleGraph 会把并联支
路去重）。树 ⇒ 0；连通单环网 ⇒ 1；断开一条桥支路不改变回路数（边 −1、分量 +1）。

转供搜索用 `loop_count(candidate) <= loop_count(base)` 作为「不许把网络搞得比原来更环」
的判据，而不是绝对的辐射状判据。旧实现用「闭合支路数 == 母线数 − 1」，在**环网/双电源
基态**（回路数 ≥ 1）上永远不可能成立 → 任何转供都被误判为不可恢复（假阴性）。
"""
function loop_count(pm_data::AbstractDict)
    g = closed_graph(pm_data)
    return n_closed_branches(pm_data) - length(pm_data["bus"]) + length(Graphs.connected_components(g))
end

"""
辐射状：闭合支路图连通且无回路（= 生成树）。仅用于**上报** `radial` 字段，不再作为
转供的准入判据（见 `loop_count`）。
"""
function is_radial(pm_data::AbstractDict)
    g = closed_graph(pm_data)
    return loop_count(pm_data) == 0 && length(Graphs.connected_components(g)) == 1
end

"""在 `pm_data` 上把 `keys` 指定的支路置为闭合（新副本）。"""
function with_ties_closed(pm_data::AbstractDict, keys)
    copyed = deepcopy(pm_data)
    for key in keys
        copyed["branch"][key]["br_status"] = 1
        copyed["branch"][key]["status"] = 1
    end
    return copyed
end

"""当前 OPEN 且 switchable 的支路键（候选联络开关），按支路序号排序。"""
function candidate_tie_keys(pm_data::AbstractDict; exclude::AbstractString="")
    keys_out = String[]
    for key in sorted_component_keys(pm_data["branch"])
        key == exclude && continue
        branch = pm_data["branch"][key]
        Bool(get(branch, "switchable", false)) || continue
        get(branch, "br_status", 1) == 0 || continue
        push!(keys_out, key)
    end
    return keys_out
end

"""不可恢复条目：与可恢复条目**同形**（键集合完全一致），恢复后才有意义的字段填 null。"""
function unrestorable_entry(contingency::AbstractDict, tie_names::Vector{String},
                            lost_before::Float64, base_loops::Int,
                            searched::Int, reason::AbstractString)
    reachable = reachable_from_slack(contingency)
    return Dict{String,Any}(
        "restorable" => false,
        "fully_restored" => false,
        "closed_ties" => String[],
        "candidate_ties" => tie_names,
        "n_candidates_evaluated" => searched,
        "search_depth" => isempty(tie_names) ? 0 : 1,
        "max_search_depth" => 1,
        "lost_load_before_mw" => lost_before,
        "lost_load_after_mw" => lost_before,
        "islanded_buses_after" => islanded_bus_names(contingency, reachable),
        "loss_mw" => nothing,
        "vmin_pu" => nothing,
        "vmin_bus" => nothing,
        "violation_buses" => String[],
        "overloaded_branches" => Any[],
        "violated" => nothing,
        "radial" => nothing,
        "n_bus" => length(contingency["bus"]),
        "n_closed_branches" => nothing,
        "n_loops_base" => base_loops,
        "n_loops_after" => nothing,
        "reason" => reason,
    )
end

"""
    attempt_restoration(contingency, outaged_key, lost_before, base_loops; optimizer)

对一条造成孤岛的开断，尝试闭合**一条**常开联络开关恢复供电。

**深度定理（为什么只搜一条，而不是「最多 N 条」的组合）**：删掉一条支路，连通分量数最
多 +1 —— 开断后的网络恰好是「带电区 A」和「孤岛 B」两块。一条联络开关只有在两端分跨
A/B 时才能把 B 接回电源；两端同在 A 或同在 B 的联络开关，闭合多少条都不改变连通性。
所以「存在一条跨界联络开关」是恢复连通的**充要条件**，深度 ≥ 2 的组合搜索不可能找到
任何单条搜索找不到的解。旧实现的 `max_ties` 参数是个空转旋钮（而且被绝对辐射状判据
`n_closed == n_bus − 1` 顺手全部否掉了），已删除。要在**恢复之后**继续优化运行点
（多开关联合调整、降损、消除越限），那是重构问题，走 `/api/grid/reconfig`。

推论：restorable ⇒ fully_restored（跨界联络开关一闭，B 整块回到 A，不存在「部分恢复」）。
`fully_restored` 字段保留在响应里，恒为 true —— 这是定理的结论，不是实现的偷懒。

每个候选（闭合一条联络开关）必须：
  ① `loop_count(candidate) <= loop_count(base)` —— 不许比基态更环。基态是树 ⇒ 恢复后仍
     必须是树（配电网辐射状硬约束）；基态是环网/双电源 ⇒ 只要不新增回路即可（旧的绝对
     辐射状判据在这里会把所有转供都误判成不可恢复）；
  ② 严格减少失电母线数，且失负荷不增加（空载孤岛同样值得复电：它上面可能挂着 DG）；
  ③ 恢复后的交流潮流收敛。
在所有可行候选里按 (剩余失负荷, 网损, 开关 id) 取最优，结果确定。
"""
function attempt_restoration(contingency::AbstractDict, outaged_key::AbstractString,
                             lost_before::Float64, base_loops::Int; optimizer=default_optimizer())
    ties = candidate_tie_keys(contingency; exclude=outaged_key)
    tie_names = [string(contingency["branch"][k]["name"]) for k in ties]
    n_bus = length(contingency["bus"])
    islanded_before = n_bus - length(reachable_from_slack(contingency))

    if isempty(ties)
        return unrestorable_entry(contingency, tie_names, lost_before, base_loops, 0,
            "no normally-open switchable tie branch exists in this topology")
    end

    best = nothing
    for key in ties
        candidate = with_ties_closed(contingency, [key])
        loops_after = loop_count(candidate)
        loops_after <= base_loops || continue
        reachable = reachable_from_slack(candidate)
        islanded_after = n_bus - length(reachable)
        islanded_after < islanded_before || continue
        lost_after = lost_load_mw(candidate, reachable)
        lost_after <= lost_before + 1e-9 || continue

        summary = try
            build_pf_payload(execute_power_flow(candidate; optimizer))["summary"]
        catch err
            err isa TopologyError || rethrow()
            continue
        end

        name = string(contingency["branch"][key]["name"])
        entry = Dict{String,Any}(
            "restorable" => true,
            "fully_restored" => islanded_after == 0,
            "closed_ties" => String[name],
            "candidate_ties" => tie_names,
            "n_candidates_evaluated" => length(ties),
            "search_depth" => 1,
            "max_search_depth" => 1,
            "lost_load_before_mw" => lost_before,
            "lost_load_after_mw" => lost_after,
            "islanded_buses_after" => islanded_bus_names(candidate, reachable),
            "loss_mw" => summary["loss_mw"],
            "vmin_pu" => summary["vmin_pu"],
            "vmin_bus" => summary["vmin_bus"],
            "violation_buses" => summary["violation_buses"],
            "overloaded_branches" => summary["overloaded_branches"],
            "violated" => !isempty(summary["violation_buses"]) || !isempty(summary["overloaded_branches"]),
            "radial" => is_radial(candidate),
            "n_bus" => n_bus,
            "n_closed_branches" => n_closed_branches(candidate),
            "n_loops_base" => base_loops,
            "n_loops_after" => loops_after,
            "reason" => nothing,
        )
        rank = (lost_after, summary["loss_mw"], name)
        if best === nothing || rank < best[1]
            best = (rank, entry)
        end
    end
    best === nothing || return best[2]

    # 诊断：一条联络开关只有在「一端带电、一端在孤岛」时才可能转供。电源出线
    # （如 ieee33 的 br-1）开断后所有联络开关的两端都落在孤岛里，永远接不回电源。
    energized = reachable_from_slack(contingency)
    bridging = any(ties) do key
        branch = contingency["branch"][key]
        (branch["f_bus"] in energized) != (branch["t_bus"] in energized)
    end
    reason = bridging ?
        "a tie switch bridges the island but closing it either adds a loop the base network does not have, or the restored power flow does not converge" :
        "no tie switch bridges the energized network and the islanded section (every tie has both ends inside the island — the outage isolates the source feeder)"

    return unrestorable_entry(contingency, tie_names, lost_before, base_loops, length(ties), reason)
end

"""
    execute_n1(pm_data; optimizer=default_optimizer(), restore=false)

N-1 single-branch outage screening. For every in-service branch the branch is
opened on a deep copy of `pm_data`; if the outage islands part of the network
the contingency is classified as `islanding` (no power flow attempted),
otherwise an AC power flow is solved and the contingency is `ok` or
`diverged` depending on convergence.

With `restore=true` every islanding contingency additionally goes through a
tie-switch restoration search (see `attempt_restoration`); the outcome is
reported in the extra `restoration` block and the `n_restorable` /
`n_unrestorable` summary fields. With `restore=false` (the default) the payload
is byte-for-byte the historical one.
"""
function execute_n1(pm_data::AbstractDict; optimizer=default_optimizer(), restore::Bool=false)
    results = Vector{Dict{String,Any}}()
    restoration = Vector{Dict{String,Any}}()
    base_loops = loop_count(pm_data)
    max_searched_depth = 0
    n_islanding = 0
    n_ok = 0
    n_diverged = 0
    n_restorable = 0
    n_unrestorable = 0
    max_lost = 0.0
    worst_branch = nothing

    for key in sorted_component_keys(pm_data["branch"])
        get(pm_data["branch"][key], "br_status", 1) == 1 || continue
        # Each contingency works on its own deep copy; the base case is never mutated.
        contingency = deepcopy(pm_data)
        branch = contingency["branch"][key]
        # PowerModels only reads br_status, but this repo keeps both keys in sync.
        branch["br_status"] = 0
        branch["status"] = 0
        name = string(branch["name"])

        reachable = reachable_from_slack(contingency)
        if length(reachable) < length(contingency["bus"])
            lost = lost_load_mw(contingency, reachable)
            n_islanding += 1
            if worst_branch === nothing || lost > max_lost
                max_lost = lost
                worst_branch = name
            end
            push!(results, Dict{String,Any}(
                "branch" => name,
                "outcome" => "islanding",
                "islanded_buses" => islanded_bus_names(contingency, reachable),
                "lost_load_mw" => lost,
            ))
            if restore
                entry = attempt_restoration(contingency, key, lost, base_loops; optimizer)
                entry["branch"] = name
                entry["islanded_buses"] = islanded_bus_names(contingency, reachable)
                entry["restorable"] ? (n_restorable += 1) : (n_unrestorable += 1)
                max_searched_depth = max(max_searched_depth, entry["search_depth"])
                push!(restoration, entry)
            end
            continue
        end

        entry = try
            solved = execute_power_flow(contingency; optimizer)
            summary = build_pf_payload(solved)["summary"]
            n_ok += 1
            Dict{String,Any}(
                "branch" => name,
                "outcome" => "ok",
                "loss_mw" => summary["loss_mw"],
                "vmin_pu" => summary["vmin_pu"],
                "vmin_bus" => summary["vmin_bus"],
                "violation_buses" => summary["violation_buses"],
            )
        catch err
            err isa TopologyError || rethrow()
            n_diverged += 1
            Dict{String,Any}("branch" => name, "outcome" => "diverged")
        end
        push!(results, entry)
    end

    summary = Dict{String,Any}(
        "n_branches" => length(results),
        "n_islanding" => n_islanding,
        "n_ok" => n_ok,
        "n_diverged" => n_diverged,
        "max_lost_load_mw" => max_lost,
        "worst_branch" => worst_branch,
    )
    payload = Dict{String,Any}(
        "type" => "n1_analysis",
        "results" => results,
        "summary" => summary,
    )
    if restore
        summary["n_restorable"] = n_restorable
        summary["n_unrestorable"] = n_unrestorable
        # 实际搜过的最大深度（= 1 只要有联络开关可试，0 表示压根没有候选联络开关）。
        # 内核只做单联络开关转供，见 attempt_restoration 的深度定理。
        summary["max_search_depth"] = max_searched_depth
        summary["n_loops_base"] = base_loops
        payload["restoration"] = restoration
    end
    return payload
end

"""
    parse_timeseries_request(request)

Validate a timeseries request `{"topology": ..., "load_scale": [...]}` and
return `(topology, scales::Vector{Float64})`. Raises `ValidationError` on a
missing topology or an empty/oversized/non-positive `load_scale`.
"""
function parse_timeseries_request(request::AbstractDict)
    haskey(request, "topology") || throw(ValidationError("missing value", ["topology"]))
    topology = request["topology"]
    topology isa AbstractDict || throw(ValidationError("topology must be an object", ["topology"]))

    haskey(request, "load_scale") || throw(ValidationError("missing value", ["load_scale"]))
    raw = request["load_scale"]
    raw isa AbstractVector || throw(ValidationError("load_scale must be an array", ["load_scale"]))
    isempty(raw) && throw(ValidationError("load_scale must not be empty", ["load_scale"]))
    length(raw) > MAX_TIMESERIES_POINTS &&
        throw(ValidationError("load_scale supports at most $(MAX_TIMESERIES_POINTS) points", ["load_scale"]))

    scales = Vector{Float64}(undef, length(raw))
    for (i, value) in enumerate(raw)
        (value isa Real && isfinite(value) && value > 0) ||
            throw(ValidationError("load_scale entries must be positive numbers", ["load_scale", string(i)]))
        scales[i] = Float64(value)
    end
    return topology, scales
end

"""
    execute_timeseries(pm_data, scales; optimizer=default_optimizer())

Sequential power flows with all loads uniformly scaled by each factor in
`scales`. Every point solves on its own deep copy of `pm_data`; a diverged
point is recorded as `{"scale", "outcome": "diverged"}` and the run continues.
"""
function execute_timeseries(pm_data::AbstractDict, scales::AbstractVector{Float64}; optimizer=default_optimizer())
    points = Vector{Dict{String,Any}}()
    n_converged = 0
    max_loss = -Inf
    min_vmin = Inf

    for scale in scales
        scaled = deepcopy(pm_data)
        for load in values(scaled["load"])
            load["pd"] *= scale
            load["qd"] *= scale
        end

        entry = try
            solved = execute_power_flow(scaled; optimizer)
            summary = build_pf_payload(solved)["summary"]
            n_converged += 1
            max_loss = max(max_loss, summary["loss_mw"])
            min_vmin = min(min_vmin, summary["vmin_pu"])
            Dict{String,Any}(
                "scale" => scale,
                "outcome" => "ok",
                "loss_mw" => summary["loss_mw"],
                "vmin_pu" => summary["vmin_pu"],
                "vmin_bus" => summary["vmin_bus"],
                "violation_count" => length(summary["violation_buses"]),
            )
        catch err
            err isa TopologyError || rethrow()
            Dict{String,Any}("scale" => scale, "outcome" => "diverged")
        end
        push!(points, entry)
    end

    return Dict{String,Any}(
        "type" => "timeseries_pf",
        "points" => points,
        "summary" => Dict{String,Any}(
            "n_points" => length(points),
            "max_loss_mw" => n_converged > 0 ? max_loss : nothing,
            "min_vmin_pu" => n_converged > 0 ? min_vmin : nothing,
        ),
    )
end

end

using .Analysis: execute_n1, execute_timeseries, parse_timeseries_request, parse_n1_request
