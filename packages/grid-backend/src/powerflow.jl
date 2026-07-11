module PowerFlow

using JSON3
using PowerModels
using Ipopt
using JuMP: optimizer_with_attributes
import MathOptInterface as MOI

import ..Errors: TopologyError, ValidationError

export execute_power_flow, build_pf_payload, default_optimizer

function default_optimizer()
    return optimizer_with_attributes(Ipopt.Optimizer, "print_level" => 0)
end

function execute_power_flow(pm_data::Dict; optimizer=default_optimizer())
    result = PowerModels.solve_ac_pf(pm_data, optimizer)
    if !power_flow_succeeded(result)
        throw(TopologyError("power flow failed: " * power_flow_status(result)))
    end
    # solve_ac_pf's solution only carries bus voltages and gen injections — no branch
    # flows. Merge the solution back into a copy of the data and recompute branch flows
    # from the solved voltages; update_data! then attaches pf/qf/pt/qt to each branch.
    solved = deepcopy(pm_data)
    PowerModels.update_data!(solved, result["solution"])
    flows = PowerModels.calc_branch_flow_ac(solved)
    PowerModels.update_data!(solved, flows)
    return (pm_data=solved, result=result)
end

function power_flow_succeeded(result::AbstractDict)
    termination = get(result, "termination_status", missing)
    if termination !== missing
        return termination in (MOI.OPTIMAL, MOI.LOCALLY_SOLVED, MOI.ALMOST_OPTIMAL, MOI.ALMOST_LOCALLY_SOLVED)
    end

    status = normalize_power_flow_status(get(result, "status", missing))
    valid_statuses = Set([:local_optimum, :solved, :optimal, :feasible, :locally_optimal, :optimal_feasible])
    return status ∈ valid_statuses
end

function power_flow_status(result::AbstractDict)
    termination = get(result, "termination_status", missing)
    if termination !== missing
        return string(termination)
    end

    status = get(result, "status", missing)
    return status === missing ? "error" : string(status)
end

normalize_power_flow_status(status::Missing) = :error
normalize_power_flow_status(status::Symbol) = Symbol(lowercase(String(status)))
normalize_power_flow_status(status) = Symbol(lowercase(string(status)))

finite_or_zero(x) = (x isa Real && isfinite(x)) ? Float64(x) : 0.0

sorted_component_keys(components) = string.(sort(parse.(Int, collect(keys(components)))))

function build_pf_payload(data)
    pm = data.pm_data
    result = data.result
    base_mva = pm["baseMVA"]

    buses = Vector{Dict{String,Any}}()
    violations = Vector{String}()
    vmin_seen = (Inf, "")
    for key in sorted_component_keys(pm["bus"])
        bus = pm["bus"][key]
        vm = finite_or_zero(get(bus, "vm", 1.0))
        vmin = finite_or_zero(get(bus, "vmin", 0.0))
        vmax = get(bus, "vmax", nothing)
        vmax = vmax isa Real && isfinite(vmax) ? Float64(vmax) : nothing
        violation = if vm < vmin - 1e-6
            "low"
        elseif vmax !== nothing && vm > vmax + 1e-6
            "high"
        else
            nothing
        end
        violation !== nothing && push!(violations, bus["name"])
        vm < vmin_seen[1] && (vmin_seen = (vm, bus["name"]))
        push!(buses, Dict(
            "id" => bus["name"],
            "vm_pu" => vm,
            "va_deg" => rad2deg(finite_or_zero(get(bus, "va", 0.0))),
            "vmin_pu" => vmin,
            "vmax_pu" => vmax,
            "violation" => violation,
        ))
    end

    branches = Vector{Dict{String,Any}}()
    overloads = Vector{String}()
    loss_total = 0.0
    for key in sorted_component_keys(pm["branch"])
        branch = pm["branch"][key]
        active = get(branch, "br_status", 1) == 1
        pf = active ? finite_or_zero(get(branch, "pf", 0.0)) : 0.0
        qf = active ? finite_or_zero(get(branch, "qf", 0.0)) : 0.0
        pt = active ? finite_or_zero(get(branch, "pt", 0.0)) : 0.0
        qt = active ? finite_or_zero(get(branch, "qt", 0.0)) : 0.0
        loss = active ? pf + pt : 0.0
        loss_total += loss
        rate = finite_or_zero(get(branch, "rate_a", 0.0))
        loading = (active && rate > 0) ? sqrt(pf^2 + qf^2) / rate * 100 : 0.0
        loading > 100 && push!(overloads, branch["name"])
        push!(branches, Dict(
            "id" => branch["name"],
            "p_mw" => pf * base_mva,
            "q_mvar" => qf * base_mva,
            "p_to_mw" => pt * base_mva,
            "q_to_mvar" => qt * base_mva,
            "loss_mw" => loss * base_mva,
            "loading_pct" => loading,
            "status" => active ? "CLOSED" : "OPEN",
            "overloaded" => loading > 100,
        ))
    end

    return Dict(
        "status" => "ok",
        "type" => "ac_pf",
        "buses" => buses,
        "branches" => branches,
        "summary" => Dict(
            "loss_mw" => loss_total * base_mva,
            "vmin_pu" => vmin_seen[1],
            "vmin_bus" => vmin_seen[2],
            "violation_buses" => violations,
            "overloaded_branches" => overloads,
            "solve_time_s" => finite_or_zero(get(result, "solve_time", 0.0)),
            "termination_status" => power_flow_status(result),
        ),
    )
end

end

using .PowerFlow: execute_power_flow, build_pf_payload
