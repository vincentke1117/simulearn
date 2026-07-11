module Topology

using JSON3
using Graphs
import PowerModels

import ..Errors: TopologyError, ValidationError
import ..Types: TopologyData, Node, Link, SWITCH_OPEN, SWITCH_CLOSED, as_switch_status

export convert_topology

const DEFAULT_VMAX = 1.05
const DEFAULT_VMIN = 0.95

"""Compute the base impedance for the given voltage and base MVA."""
base_impedance(kv::Real, base_mva::Real) = (kv^2) / base_mva

function parse_float(data::Dict{String,Any}, key::AbstractString; default=nothing, path=String[])
    if haskey(data, key)
        value = data[key]
        if value === nothing
            throw(ValidationError("missing value", [path... , String(key)]))
        end
        try
            return to_float(value)
        catch
            throw(ValidationError("expected numeric value", [path... , String(key)]))
        end
    elseif default !== nothing
        return to_float(default)
    end
    throw(ValidationError("missing value", [path... , String(key)]))
end

function to_float(value)
    value isa Real && return Float64(value)
    value isa AbstractString && return parse(Float64, value)
    throw(ArgumentError("cannot convert to float"))
end

function collect_bus_nodes(nodes)
    filter(n -> lowercase(n.type) in ("bus", "substation", "source"), nodes)
end

function find_bus_for(node::Node, node_lookup, links, bus_ids)
    if haskey(node.data, "bus")
        bus_id = String(node.data["bus"])
        haskey(bus_ids, bus_id) || throw(ValidationError("referenced bus not found", [node.id, "bus"]))
        return bus_ids[bus_id]
    end
    connected = Set{String}()
    bus_keys = collect(keys(bus_ids))
    for link in links
        if link.from == node.id && link.to in bus_keys
            push!(connected, link.to)
        elseif link.to == node.id && link.from in bus_keys
            push!(connected, link.from)
        end
    end
    if length(connected) == 1
        return bus_ids[first(connected)]
    elseif isempty(connected)
        throw(ValidationError("device is not attached to a bus", [node.id]))
    else
        throw(ValidationError("ambiguous bus connection", [node.id]))
    end
end

function ensure_slack(buses)
    slack_indices = [bus["bus_i"] for bus in values(buses) if bus["type"] == 3]
    isempty(slack_indices) && throw(TopologyError("topology does not contain a slack/source bus"))
    return slack_indices
end

function ensure_connectivity(buses, branches, slack_indices)
    g = Graphs.SimpleGraph(length(buses))
    for branch in values(branches)
        if branch["status"] == 1
            add_edge!(g, branch["f_bus"], branch["t_bus"])
        end
    end
    components = Graphs.connected_components(g)
    slack_component = nothing
    for comp in components
        if any(x -> x in slack_indices, comp)
            slack_component = comp
            break
        end
    end
    slack_component === nothing && throw(TopologyError("slack bus is isolated"))
    if length(slack_component) != length(buses)
        missing = setdiff(Set(1:length(buses)), Set(slack_component))
        throw(TopologyError("network contains isolated buses: " * join(sort(collect(missing)), ", ")))
    end
end

function convert_topology(obj::AbstractDict)
    topo = TopologyData(obj)
    base_mva = parse_float(topo.meta, "baseMVA"; path=["meta"])

    node_lookup = Dict(node.id => node for node in topo.nodes)
    bus_nodes = collect_bus_nodes(topo.nodes)
    isempty(bus_nodes) && throw(TopologyError("topology does not contain any bus nodes"))

    buses = Dict{String,Dict{String,Any}}()
    bus_map = Dict{String,Int}()
    for (idx, node) in enumerate(bus_nodes)
        kv = parse_float(node.data, "kv"; path=[node.id])
        vm = to_float(get(node.data, "vm_pu", 1.0))
        va = to_float(get(node.data, "va_deg", 0.0))
        vmax = to_float(get(node.data, "vmax_pu", DEFAULT_VMAX))
        vmin = to_float(get(node.data, "vmin_pu", DEFAULT_VMIN))
        bus_type = 1
        if get(node.data, "is_slack", false)
            bus_type = 3
        elseif lowercase(node.type) == "source"
            bus_type = 3
        elseif get(node.data, "is_pv", false)
            bus_type = 2
        end
        bus = Dict(
            "index" => idx,
            "bus_i" => idx,
            "name" => node.id,
            "vm" => vm,
            "va" => va,
            "base_kv" => kv,
            "bus_type" => bus_type,
            "type" => bus_type,
            "vmax" => vmax,
            "vmin" => vmin,
        )
        buses[string(idx)] = bus
        bus_map[node.id] = idx
    end

    loads = Dict{String,Dict{String,Any}}()
    gens = Dict{String,Dict{String,Any}}()
    shunts = Dict{String,Dict{String,Any}}()

    for node in topo.nodes
        ltype = lowercase(node.type)
        if ltype == "load"
            bus_idx = find_bus_for(node, node_lookup, topo.links, bus_map)
            load_idx = length(loads) + 1
            pd = parse_float(node.data, "p_kw"; path=[node.id]) / 1000
            qd = parse_float(node.data, "q_kvar"; path=[node.id]) / 1000
            loads[string(load_idx)] = Dict(
                "index" => load_idx,
                "load_bus" => bus_idx,
                "pd" => pd,
                "qd" => qd,
                "status" => 1,
                "name" => node.id,
                "model" => 1,
            )
        elseif ltype in ("gen", "dg")
            bus_idx = find_bus_for(node, node_lookup, topo.links, bus_map)
            gen_idx = length(gens) + 1
            base_kw = parse_float(node.data, "p_kw"; default=0.0, path=[node.id])
            pmax = parse_float(node.data, "p_max_kw"; default=base_kw, path=[node.id]) / 1000
            pmin = parse_float(node.data, "p_min_kw"; default=0.0, path=[node.id]) / 1000
            pg = base_kw / 1000
            qg_kvar = parse_float(node.data, "q_kvar"; default=0.0, path=[node.id])
            qg = qg_kvar / 1000
            qmax_kvar = parse_float(node.data, "q_max_kvar"; default=abs(qg_kvar), path=[node.id])
            qmax = qmax_kvar / 1000
            qmin = parse_float(node.data, "q_min_kvar"; default=-qmax_kvar, path=[node.id]) / 1000
            status = get(node.data, "status", 1)
            gens[string(gen_idx)] = Dict(
                "index" => gen_idx,
                "gen_bus" => bus_idx,
                "pg" => pg,
                "qg" => qg,
                "qmax" => qmax,
                "qmin" => qmin,
                "pmax" => pmax,
                "pmin" => pmin,
                "gen_status" => status,
                "status" => status,
                "name" => node.id,
                "cost" => [0.0, 1.0],
            )
        elseif ltype == "shunt"
            bus_idx = find_bus_for(node, node_lookup, topo.links, bus_map)
            shunt_idx = length(shunts) + 1
            # PowerModels expects shunt gs/bs as MW/MVar consumed at v=1 pu; P = V²·G with V in kV and G in S gives MW.
            shunt_kv = buses[string(bus_idx)]["base_kv"]
            gs = parse_float(node.data, "g_siemens"; default=0.0, path=[node.id]) * shunt_kv^2
            bs = parse_float(node.data, "b_siemens"; default=0.0, path=[node.id]) * shunt_kv^2
            shunts[string(shunt_idx)] = Dict(
                "index" => shunt_idx,
                "shunt_bus" => bus_idx,
                "gs" => gs,
                "bs" => bs,
                "status" => 1,
                "name" => node.id,
            )
        end
    end

    for gen in values(gens)
        bus = buses[string(gen["gen_bus"])]
        if gen["gen_status"] != 0 && bus["bus_type"] != 3
            bus["bus_type"] = 2
            bus["type"] = 2
        end
    end

    branches = Dict{String,Dict{String,Any}}()
    for link in topo.links
        status = get(link.data, "status", "CLOSED")
        sw_status = as_switch_status(status)
        status_value = sw_status == SWITCH_CLOSED ? 1 : 0
        branch_idx = length(branches) + 1
        from_bus = get(bus_map, link.from, nothing)
        to_bus = get(bus_map, link.to, nothing)
        if from_bus === nothing || to_bus === nothing
            if haskey(node_lookup, link.from) && haskey(node_lookup, link.to)
                from_bus = find_bus_for(node_lookup[link.from], node_lookup, topo.links, bus_map)
                to_bus = find_bus_for(node_lookup[link.to], node_lookup, topo.links, bus_map)
            else
                throw(ValidationError("branch endpoints must connect to buses", [link.id]))
            end
        end
        r_ohm = parse_float(link.data, "r_ohm"; default=0.0, path=[link.id])
        x_ohm = parse_float(link.data, "x_ohm"; default=0.0, path=[link.id])
        from_kv = buses[string(from_bus)]["base_kv"]
        z_base = base_impedance(from_kv, base_mva)
        r = r_ohm / z_base
        x = x_ohm / z_base
        b = to_float(get(link.data, "b_siemens", 0.0)) * z_base
        rate_mva = to_float(get(link.data, "rate_mva", base_mva))
        tap = to_float(get(link.data, "tap", 1.0))
        shift = to_float(get(link.data, "shift_deg", 0.0))
        device_type = lowercase(link.type)
        switchable_raw = get(link.data, "switchable", occursin("switch", device_type))
        switchable = switchable_raw isa Bool ? switchable_raw : parse(Bool, lowercase(string(switchable_raw)))
        branches[string(branch_idx)] = Dict(
            "index" => branch_idx,
            "f_bus" => from_bus,
            "t_bus" => to_bus,
            "br_r" => r,
            "br_x" => x,
            "br_b" => b,
            "g_fr" => 0.0,
            "g_to" => 0.0,
            "b_fr" => b / 2,
            "b_to" => b / 2,
            "rate_a" => rate_mva,
            "tap" => tap,
            "shift" => shift,
            "br_status" => status_value,
            "status" => status_value,
            "name" => link.id,
            "device_type" => device_type,
            "switchable" => switchable,
            "angmin" => -60.0,
            "angmax" => 60.0,
        )
    end

    slack_indices = ensure_slack(buses)
    ensure_connectivity(buses, branches, slack_indices)

    # Everything above is assembled in MATPOWER-style mixed units (MW/MVar/MVA, degrees,
    # pu impedances). make_per_unit! only converts when per_unit=false, so the flag must
    # be false here; afterwards the dict is fully per-unit, which is what PowerModels solves in.
    data = Dict(
        "baseMVA" => base_mva,
        "per_unit" => false,
        "bus" => buses,
        "load" => loads,
        "gen" => gens,
        "shunt" => shunts,
        "storage" => Dict{String,Dict{String,Any}}(),
        "switch" => Dict{String,Dict{String,Any}}(),
        "branch" => branches,
        "dcline" => Dict{String,Dict{String,Any}}(),
    )
    PowerModels.make_per_unit!(data)
    return data
end

end

using .Topology: convert_topology
