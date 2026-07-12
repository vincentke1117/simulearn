module JGDO

export run_pf, run_reconfiguration_dg, run_n1, run_timeseries, topology_to_powermodels, write_run_snapshot, default_optimizer, default_reconfiguration_optimizer
export run_transient, run_shortcircuit, run_opf, http_status

using JSON3
using Dates
using Logging

include("errors.jl")
include("types.jl")
include("topology.jl")
include("powerflow.jl")
include("opf.jl")
include("optimization.jl")
include("analysis.jl")
include("dynamics.jl")
include("shortcircuit.jl")

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
    run_n1(topo_json::AbstractString; optimizer=default_optimizer())

Runs an N-1 single-branch outage screening over every in-service branch of the
provided topology JSON payload. Returns a JSON string with the unified response
envelope: islanding contingencies report the islanded buses and lost load,
connected contingencies report the AC power flow outcome (`ok`/`diverged`).

The request body is either the bare topology (backwards compatible) or
`{"topology": <topology>, "restore": true}`; `restore` (also accepted as a
top-level key on the bare topology) additionally attempts service restoration of
every islanded contingency by closing one normally-open tie switch, subject to
the network not gaining any loop it did not already have. A `max_ties` key is
rejected with GRID_VALIDATION — see `Analysis.attempt_restoration` for why a
single tie switch is necessary *and sufficient*.
"""
function run_n1(topo_json::AbstractString; optimizer=default_optimizer())
    try
        request = JSON3.read(topo_json, Dict{String,Any})
        topology, restore = parse_n1_request(request)
        pm_data = topology_to_powermodels(topology)
        payload = execute_n1(pm_data; optimizer, restore)
        return wrap_success("n1_analysis", payload)
    catch err
        return wrap_error(err)
    end
end

"""
    run_opf(json::AbstractString; optimizer=default_optimizer())

Runs an AC optimal power flow (economic dispatch) on the provided topology.
The request body is either the bare topology or `{"topology": <topology>}`.
Returns the unified envelope; `data` carries the objective (元/h), the
per-generator dispatch with binding limits, per-bus voltages and LMPs
(元/MWh), branch flows and a summary.
"""
function run_opf(json::AbstractString; optimizer=default_optimizer())
    try
        request = JSON3.read(json, Dict{String,Any})
        topology = parse_opf_request(request)
        pm_data = topology_to_powermodels(topology)
        payload = execute_opf(pm_data; optimizer)
        return wrap_success("optimal_power_flow", payload)
    catch err
        return wrap_error(err)
    end
end

"""
    run_timeseries(json::AbstractString; optimizer=default_optimizer())

Runs sequential power flows for `{"topology": ..., "load_scale": [...]}` where
every scale factor uniformly multiplies all loads. Returns a JSON string with
one point per scale factor plus an aggregate summary.
"""
function run_timeseries(json::AbstractString; optimizer=default_optimizer())
    try
        request = JSON3.read(json, Dict{String,Any})
        topology, scales = parse_timeseries_request(request)
        pm_data = topology_to_powermodels(topology)
        payload = execute_timeseries(pm_data, scales; optimizer)
        return wrap_success("timeseries_pf", payload)
    catch err
        return wrap_error(err)
    end
end

"""
    run_transient(json::AbstractString; optimizer=default_optimizer())

Runs a classical-model electromechanical transient stability simulation for
`{"topology": ..., "fault": {...}, "sim": {...}, "f_hz": 50, "find_cct": false}`.
Returns a JSON string with the unified response envelope.
"""
function run_transient(json::AbstractString; optimizer=default_optimizer())
    try
        request = JSON3.read(json, Dict{String,Any})
        topology, fault, sim, f_hz, find_cct = parse_transient_request(request)
        pm_data = topology_to_powermodels(topology)
        payload = execute_transient(pm_data, fault, sim, f_hz, find_cct; optimizer)
        return wrap_success("transient_stability", payload)
    catch err
        return wrap_error(err)
    end
end

"""
    run_shortcircuit(json::AbstractString; optimizer=default_optimizer())

Runs a balanced three-phase short-circuit study for
`{"topology": ..., "fault_bus": "bus-5"|null, "zf_pu": 0.0}`. A `null`
`fault_bus` scans every bus. Returns a JSON string with the unified envelope.
"""
function run_shortcircuit(json::AbstractString; optimizer=default_optimizer())
    try
        request = JSON3.read(json, Dict{String,Any})
        topology, fault_bus, zf = parse_shortcircuit_request(request)
        pm_data = topology_to_powermodels(topology)
        payload = execute_shortcircuit(pm_data, fault_bus, zf; optimizer)
        return wrap_success("short_circuit", payload)
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
