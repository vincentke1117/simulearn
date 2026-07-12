module OPF

using PowerModels
using Ipopt
using JuMP: optimizer_with_attributes
import MathOptInterface as MOI

import ..Errors: TopologyError, ValidationError
import ..PowerFlow: build_pf_payload, default_optimizer, sorted_component_keys, finite_or_zero

export execute_opf, parse_opf_request

const SUCCESS_STATUSES = (MOI.OPTIMAL, MOI.LOCALLY_SOLVED, MOI.ALMOST_OPTIMAL, MOI.ALMOST_LOCALLY_SOLVED)
const BOUND_TOL_PU = 1e-6

"""
    parse_opf_request(request)

OPF 请求既接受裸拓扑（`{"meta":..., "nodes":..., "links":...}`），也接受
`{"topology": <拓扑>}` 包装。返回拓扑对象。
"""
function parse_opf_request(request::AbstractDict)
    if haskey(request, "topology")
        topology = request["topology"]
        topology isa AbstractDict || throw(ValidationError("topology must be an object", ["topology"]))
        return topology
    end
    haskey(request, "nodes") || throw(ValidationError("missing value", ["nodes"]))
    return request
end

"""
    execute_opf(pm_data; optimizer=default_optimizer())

AC 最优潮流（PowerModels `solve_opf` + ACPPowerModel + Ipopt），并导出母线有功
平衡约束的对偶量以得到节点边际电价 LMP。
"""
function execute_opf(pm_data::AbstractDict; optimizer=default_optimizer())
    data = Dict{String,Any}(pm_data)
    result = PowerModels.solve_opf(data, PowerModels.ACPPowerModel, optimizer;
                                   setting = Dict("output" => Dict("duals" => true)))

    termination = get(result, "termination_status", missing)
    if termination === missing || !(termination in SUCCESS_STATUSES)
        # 归到 GRID_TOPOLOGY（→422）是为了让 HTTP 码保持成 `code` 的纯函数。代价：Ipopt 因
        # 纯数值原因（病态起点、极端 r/x）而非拓扑原因失败时，也会落到这个码上 —— 所以
        # message 必须把两种可能都说清楚，不能让学生以为「一定是我的拓扑画错了」。
        throw(TopologyError("optimal power flow did not converge (Ipopt termination: " *
                            string(termination) * "). This is usually a topology/limit problem " *
                            "(infeasible generation limits, islanded section, no slack) but can " *
                            "also be a purely numerical failure on a well-formed network."))
    end

    base_mva = data["baseMVA"]
    solution = result["solution"]

    # 求解结果回灌到网络数据后重算支路潮流，复用 pf 的 payload 生成器 —— 前端拿到的
    # buses/branches 结构与 /api/grid/pf 完全一致。
    solved = deepcopy(data)
    PowerModels.update_data!(solved, solution)
    flows = PowerModels.calc_branch_flow_ac(solved)
    PowerModels.update_data!(solved, flows)
    pf_payload = build_pf_payload((pm_data=solved, result=result))

    # LMP：lam_kcl_r 是母线有功平衡等式约束的对偶量，量纲为 元/(pu·h)，且 PowerModels/JuMP
    # 的符号约定使其为负（见 opf-econ2 契约的解析对拍）。
    #   LMP[元/MWh] = -lam_kcl_r / baseMVA
    # 对拍证据（econ2，无阻塞、网损≈0）：λ_解析 = 12.285714，实测 -lam_kcl_r/baseMVA =
    # 12.2858/12.2870/12.2861（三条母线），负荷母线因边际网损略高——方向与量纲均确认。
    lmps = Dict{String,Float64}()
    for (key, bus) in solution["bus"]
        lam = get(bus, "lam_kcl_r", nothing)
        lmps[key] = (lam isa Real && isfinite(lam)) ? -Float64(lam) / base_mva : NaN
    end

    buses = Vector{Dict{String,Any}}()
    lmp_min = (Inf, "")
    lmp_max = (-Inf, "")
    for (i, key) in enumerate(sorted_component_keys(solved["bus"]))
        entry = Dict{String,Any}(pf_payload["buses"][i])
        lmp = get(lmps, key, NaN)
        entry["lmp_yuan_per_mwh"] = lmp
        if isfinite(lmp)
            lmp < lmp_min[1] && (lmp_min = (lmp, entry["id"]))
            lmp > lmp_max[1] && (lmp_max = (lmp, entry["id"]))
        end
        push!(buses, entry)
    end

    gens = Vector{Dict{String,Any}}()
    cost_total = 0.0
    gen_total_mw = 0.0
    for key in sorted_component_keys(solved["gen"])
        gen = solved["gen"][key]
        if get(gen, "gen_status", 1) != 1
            continue
        end
        pg_mw = finite_or_zero(get(gen, "pg", 0.0)) * base_mva
        qg_mvar = finite_or_zero(get(gen, "qg", 0.0)) * base_mva
        pmin_mw = finite_or_zero(get(gen, "pmin", 0.0)) * base_mva
        pmax_mw = finite_or_zero(get(gen, "pmax", 0.0)) * base_mva
        # cost 在 make_per_unit! 里被 _rescale_cost_model! 乘过 baseMVA^(ncost-i)，
        # 这里除回去，恢复用户给的 MW 量纲系数 [c2, c1, c0]。
        c2, c1, c0 = cost_coefficients(gen, base_mva)
        cost = c2 * pg_mw^2 + c1 * pg_mw + c0
        cost_total += cost
        gen_total_mw += pg_mw
        at_pmax = get(gen, "pg", 0.0) >= get(gen, "pmax", Inf) - BOUND_TOL_PU
        at_pmin = get(gen, "pg", 0.0) <= get(gen, "pmin", -Inf) + BOUND_TOL_PU
        push!(gens, Dict{String,Any}(
            "id" => string(gen["name"]),
            "bus" => string(solved["bus"][string(gen["gen_bus"])]["name"]),
            "pg_mw" => pg_mw,
            "qg_mvar" => qg_mvar,
            "pmin_mw" => pmin_mw,
            "pmax_mw" => pmax_mw,
            "cost_yuan_per_h" => cost,
            "marginal_cost_yuan_per_mwh" => 2 * c2 * pg_mw + c1,
            "cost_c2" => c2,
            "cost_c1" => c1,
            "cost_c0" => c0,
            "at_pmax" => at_pmax,
            "at_pmin" => at_pmin,
            "binding" => at_pmax || at_pmin,
        ))
    end

    load_total_mw = 0.0
    for load in values(solved["load"])
        get(load, "status", 1) == 1 || continue
        load_total_mw += finite_or_zero(get(load, "pd", 0.0)) * base_mva
    end

    summary = Dict{String,Any}(pf_payload["summary"])
    summary["gen_total_mw"] = gen_total_mw
    summary["load_total_mw"] = load_total_mw
    summary["cost_total_yuan_per_h"] = cost_total
    summary["lmp_min_yuan_per_mwh"] = isfinite(lmp_min[1]) ? lmp_min[1] : nothing
    summary["lmp_min_bus"] = lmp_min[2]
    summary["lmp_max_yuan_per_mwh"] = isfinite(lmp_max[1]) ? lmp_max[1] : nothing
    summary["lmp_max_bus"] = lmp_max[2]

    return Dict{String,Any}(
        "status" => "ok",
        "type" => "opf",
        "objective" => Dict{String,Any}(
            "cost_total_yuan_per_h" => finite_or_zero(get(result, "objective", cost_total)),
            "termination_status" => string(termination),
            "solve_time_s" => finite_or_zero(get(result, "solve_time", 0.0)),
        ),
        "gens" => gens,
        "buses" => buses,
        "branches" => pf_payload["branches"],
        "summary" => summary,
    )
end

"""恢复 MW 量纲的 [c2, c1, c0]（pm_data 里的 cost 已被 make_per_unit! 按 baseMVA 缩放）。"""
function cost_coefficients(gen::AbstractDict, base_mva::Real)
    raw = get(gen, "cost", Float64[])
    model = get(gen, "model", 2)
    if model != 2 || isempty(raw)
        return (0.0, 0.0, 0.0)
    end
    n = length(raw)
    # cost[i] (pu) = c_i (MW) * base_mva^(n-i)
    coeffs = [Float64(raw[i]) / base_mva^(n - i) for i in 1:n]
    c2 = n >= 3 ? coeffs[n-2] : 0.0
    c1 = n >= 2 ? coeffs[n-1] : 0.0
    c0 = n >= 1 ? coeffs[n] : 0.0
    return (c2, c1, c0)
end

end

using .OPF: execute_opf, parse_opf_request
