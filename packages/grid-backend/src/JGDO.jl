module JGDO

export run_pf, run_reconfiguration_dg, topology_to_powermodels, write_run_snapshot, default_optimizer, default_reconfiguration_optimizer

using JSON3
using Dates
using Logging

include("errors.jl")
include("types.jl")
include("topology.jl")
include("powerflow.jl")
include("optimization.jl")

const DEFAULT_RUNS_DIR = joinpath(@__DIR__, "..", "runs")

"""
    run_pf(topo_json::AbstractString; optimizer=default_optimizer())

Runs an AC power flow using the provided topology JSON payload. Returns a JSON string
that matches the front-end contract specified in the PRD.
"""
function run_pf(topo_json::AbstractString; optimizer=default_optimizer())
    try
        request = JSON3.read(topo_json, Dict{String,Any})
        pm_data = topology_to_powermodels(request)
        result = execute_power_flow(pm_data; optimizer)
        payload = build_pf_payload(result)
        return wrap_success("AC power flow completed", payload)
    catch err
        return wrap_error(err)
    end
end

"""
    run_reconfiguration_dg(topo_json::AbstractString; optimizer=default_reconfiguration_optimizer(), pf_optimizer=default_optimizer())

Runs the reconfiguration + DG optimization workflow defined in the PRD. Returns a JSON
string that conforms to the unified front-end response schema.
"""
function run_reconfiguration_dg(topo_json::AbstractString; optimizer=default_reconfiguration_optimizer(), pf_optimizer=default_optimizer())
    try
        request = JSON3.read(topo_json, Dict{String,Any})
        pm_data = topology_to_powermodels(request)
        payload = execute_reconfiguration(pm_data; optimizer=optimizer, pf_optimizer=pf_optimizer)
        return wrap_success("Topology reconfiguration completed", payload)
    catch err
        return wrap_error(err)
    end
end

"""
    topology_to_powermodels(request::AbstractDict)

Convert the front-end topology JSON into a PowerModels-compatible dictionary.
"""
topology_to_powermodels(request::AbstractDict) = convert_topology(request)

default_optimizer() = PowerFlow.default_optimizer()

default_reconfiguration_optimizer() = Optimization.default_reconfiguration_optimizer()

"""
    write_run_snapshot(data::AbstractDict; runs_dir=DEFAULT_RUNS_DIR)

Persist a run snapshot into the `runs/` directory using the timestamp defined in the PRD.
"""
function write_run_snapshot(data::AbstractDict; runs_dir=DEFAULT_RUNS_DIR)
    try
        mkpath(runs_dir)
    catch err
        throw(SnapshotError("failed to create runs directory"; path=runs_dir, cause=err))
    end

    timestamp = Dates.format(Dates.now(), "yyyymmdd-HHMMSS")
    path = joinpath(runs_dir, "$(timestamp).json")

    try
        open(path, "w") do io
            JSON3.write(io, data)
        end
    catch err
        throw(SnapshotError("failed to write snapshot"; path=path, cause=err))
    end

    return path
end

end # module
