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

"""
    transformer_branch(link, hv_base_kv, lv_base_kv, r_ohm, x_ohm, base_mva) -> (r_pu, x_pu, tap)

双绕组变压器（教材调压实验的约定）：`from` 为高压侧母线、`to` 为低压侧母线；`r_ohm` / `x_ohm`
归算到高压侧；高压侧额定电压 `hv_kv` 即分接头中心，挡位 `tap_pos`（−`tap_steps`…+`tap_steps`）、
每挡 `tap_step_pct`%，分接头电压 U_tap = hv_kv·(1 + tap_pos·tap_step_pct/100)，低压侧额定 `lv_kv`。

PowerModels / MATPOWER 的支路把理想变压器放在 from 端（V_from = τ·V_内），串联阻抗在 to 侧：
- τ = (U_tap / U_高压基准) / (U_2N / U_低压基准)
- 把高压侧阻抗跨理想变压器归算到低压侧：Z_低 = Z_高·(U_2N / U_tap)²，再按低压侧基准折成标幺值。
与教材「阻抗在高压侧、理想变压器在低压侧」的等值电路在数学上完全等价；由两母线闭式解测试守着。
"""
function transformer_branch(link::Link, hv_base_kv::Real, lv_base_kv::Real, r_ohm::Real, x_ohm::Real, base_mva::Real)
    hv_kv = parse_float(link.data, "hv_kv"; path=[link.id])
    lv_kv = parse_float(link.data, "lv_kv"; path=[link.id])
    step_pct = parse_float(link.data, "tap_step_pct"; default=0.0, path=[link.id])
    steps = parse_float(link.data, "tap_steps"; default=0.0, path=[link.id])
    pos = parse_float(link.data, "tap_pos"; default=0.0, path=[link.id])
    (hv_kv > 0 && lv_kv > 0) || throw(ValidationError("transformer rated voltages must be positive", [link.id]))
    hv_base_kv >= lv_base_kv ||
        throw(ValidationError("transformer 'from' must be the high-voltage bus", [link.id]))
    (isinteger(steps) && steps >= 0 && step_pct >= 0) ||
        throw(ValidationError("tap_steps must be a non-negative integer and tap_step_pct non-negative", [link.id]))
    (isinteger(pos) && abs(pos) <= steps) ||
        throw(ValidationError("tap position out of range", [link.id, "tap_pos"]))
    u_tap = hv_kv * (1 + pos * step_pct / 100)
    tap = (u_tap / hv_base_kv) / (lv_kv / lv_base_kv)
    referral = (lv_kv / u_tap)^2
    z_base = base_impedance(lv_base_kv, base_mva)
    return r_ohm * referral / z_base, x_ohm * referral / z_base, tap
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
            # 二次成本曲线（MATPOWER 约定）：model=2 多项式、ncost=3 项、cost=[c2, c1, c0]，
            # Cost(P) = c2·P² + c1·P + c0，**P 的单位是 MW**（不是 pu）。
            # make_per_unit! 会调 _rescale_cost_model!(gen, baseMVA)，把 cost[i] 乘以
            # baseMVA^(ncost-i)，于是内部以 pu 求解时目标函数值仍是 元/h。
            # 默认 [0, 1, 0] = 1 元/MWh 线性成本：pf/reconfig/n1/transient/shortcircuit
            # 都不读 cost 键，故此默认对既有行为零影响。
            c2 = parse_float(node.data, "cost_c2"; default=0.0, path=[node.id])
            c1 = parse_float(node.data, "cost_c1"; default=1.0, path=[node.id])
            c0 = parse_float(node.data, "cost_c0"; default=0.0, path=[node.id])
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
                "model" => 2,
                "ncost" => 3,
                "cost" => [c2, c1, c0],
            )
            # 机电暂态动态参数（可选，系统基准，直接透传）：h_s 惯性常数 [s]、
            # xd1_pu 暂态电抗 X'd [pu]、d_pu 阻尼系数。仅在节点携带时新增键，
            # make_per_unit! 不识别这些键因此原样保留；绝不改动任何既有字段语义。
            for dyn_key in ("h_s", "xd1_pu", "d_pu")
                if haskey(node.data, dyn_key)
                    gens[string(gen_idx)][dyn_key] = parse_float(node.data, dyn_key; path=[node.id])
                end
            end
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
        elseif ltype == "capacitor"
            # 并联电容组（教材调压实验）：每组额定容量 q_unit_kvar（在母线额定电压下），共 groups 组，
            # 投入 in_service 组。电纳不随电压变：实际补偿无功 = 投入容量 × (U/U_N)²。
            # PowerModels 约定 bs > 0 为容性（向系统注入无功），单位 MVar（v = 1 pu 时），make_per_unit! 再折成 pu。
            bus_idx = find_bus_for(node, node_lookup, topo.links, bus_map)
            q_unit = parse_float(node.data, "q_unit_kvar"; path=[node.id])
            groups = parse_float(node.data, "groups"; path=[node.id])
            in_service = parse_float(node.data, "in_service"; default=0.0, path=[node.id])
            q_unit >= 0 || throw(ValidationError("capacitor group size must be non-negative", [node.id, "q_unit_kvar"]))
            (isinteger(groups) && groups >= 0) || throw(ValidationError("capacitor group count must be a non-negative integer", [node.id, "groups"]))
            (isinteger(in_service) && 0 <= in_service <= groups) ||
                throw(ValidationError("capacitor groups in service must be an integer between 0 and groups", [node.id, "in_service"]))
            shunt_idx = length(shunts) + 1
            shunts[string(shunt_idx)] = Dict(
                "index" => shunt_idx,
                "shunt_bus" => bus_idx,
                "gs" => 0.0,
                "bs" => in_service * q_unit / 1000,
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
        to_kv = buses[string(to_bus)]["base_kv"]
        device_type = lowercase(link.type)
        rate_mva = to_float(get(link.data, "rate_mva", base_mva))
        shift = to_float(get(link.data, "shift_deg", 0.0))
        is_transformer = device_type == "transformer"
        if is_transformer
            r, x, tap = transformer_branch(link, from_kv, to_kv, r_ohm, x_ohm, base_mva)
            b = 0.0  # 励磁支路忽略（教材调压计算同样忽略）
        else
            # 线路阻抗按起点母线的电压等级折算：两端等级不同时这样算是错的，必须用变压器连接
            abs(from_kv - to_kv) <= 1e-6 * max(from_kv, to_kv) ||
                throw(ValidationError("line connects buses with different nominal voltages; use a Transformer", [link.id]))
            z_base = base_impedance(from_kv, base_mva)
            r = r_ohm / z_base
            x = x_ohm / z_base
            tap = to_float(get(link.data, "tap", 1.0))
            b = to_float(get(link.data, "b_siemens", 0.0)) * z_base
        end
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
            "transformer" => is_transformer,
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
