module Analysis

using Graphs

import ..Errors: TopologyError, ValidationError
import ..PowerFlow: execute_power_flow, build_pf_payload, default_optimizer, sorted_component_keys

export execute_n1, execute_timeseries, parse_timeseries_request

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
    execute_n1(pm_data; optimizer=default_optimizer())

N-1 single-branch outage screening. For every in-service branch the branch is
opened on a deep copy of `pm_data`; if the outage islands part of the network
the contingency is classified as `islanding` (no power flow attempted),
otherwise an AC power flow is solved and the contingency is `ok` or
`diverged` depending on convergence.
"""
function execute_n1(pm_data::AbstractDict; optimizer=default_optimizer())
    results = Vector{Dict{String,Any}}()
    n_islanding = 0
    n_ok = 0
    n_diverged = 0
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

    return Dict{String,Any}(
        "type" => "n1_analysis",
        "results" => results,
        "summary" => Dict{String,Any}(
            "n_branches" => length(results),
            "n_islanding" => n_islanding,
            "n_ok" => n_ok,
            "n_diverged" => n_diverged,
            "max_lost_load_mw" => max_lost,
            "worst_branch" => worst_branch,
        ),
    )
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

using .Analysis: execute_n1, execute_timeseries, parse_timeseries_request
