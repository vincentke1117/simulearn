# 参考点（电位零点）的自动选取。
#
# 节点电位只有相对某个参考点才有意义，求解器（手写 MNA 与 MTK）都要求有一个电位为 0 的节点；
# 但不接地的电路照样有确定的元件电压和支路电流，与参考点选在哪无关。学生没放地线时，
# 这里替他选一个参考点——相当于在那个节点上补了一个地线符号——各个求解器一行不改。
#
# 互不导通的几块电路（比如只靠 VCVS / VCCS 控制口耦合的两侧）各自都要一个参考点，否则方程奇异。
# 把这几个参考点并成同一个节点是安全的：几块之间只多了这一个公共点，KCL 决定了它上面没有电流，
# 任何元件电压、支路电流都不变。SPICE 要求「每块电路都接地」也是这个道理。
#
# 做法是改写 payload：选中的参考网络（和学生自己的地线网络）统一改名为 gnd，没有地线元件就补一个；
# 求解完再把结果里的网络名改回学生的原名，前端画布按原名取电压。

const REFERENCE_NET = "gnd"

"""
    ReferencePlan

`assign_reference` 改写 payload 的记录，求解后 `restore_reference!` 按它把网络名改回去。
- renamed：原名被改成 `REFERENCE_NET` 的网络；
- had_reference_net：原 payload 里本来就有名为 gnd 的网络（结果里的 gnd 要保留）；
- points：自动选的参考点，每块未接地的电路一个（net / component / terminal，后两者可能为 nothing）。
"""
struct ReferencePlan
    renamed::Vector{String}
    had_reference_net::Bool
    points::Vector{Dict{String, Any}}
end

# 电流能从一端流到另一端的端子对。VCVS / VCCS 的控制口是理想电压表（开路），不导通；
# CCVS / CCCS 的控制口是理想电流表（短路），导通。地线、电压探针只有一个端子。
function conductive_pairs(component::ComponentPayload)
    type = component.type
    type in ("ground", "voltage_probe") && return Tuple{String, String}[]
    type in ("vcvs", "vccs") && return [("pos", "neg")]
    type in ("ccvs", "cccs") && return [("pos", "neg"), ("ctrl_p", "ctrl_n")]
    return haskey(component.connections, "pos") ? [("pos", "neg")] : [("p", "n")]
end

function _root!(parent::Dict{String, String}, net::String)
    while parent[net] != net
        parent[net] = parent[parent[net]]
        net = parent[net]
    end
    return net
end

# 选参考点的优先级：独立电压源的负极 → 独立电流源的负极 → 受控源输出的负极（教材上通常就这么取），
# 都没有就取名字最小的网络。按元件在 payload 里的顺序找，结果是确定的，契约才钉得住。
const _REFERENCE_PREFERENCE = (
    ("vsource_dc", "vsource_ac"),
    ("isource_dc", "isource_ac"),
    ("vcvs", "ccvs", "vccs", "cccs"),
)

function _pick_reference(payload::SimulationPayload, parent::Dict{String, String}, root::String, island::Vector{String})
    for types in _REFERENCE_PREFERENCE
        for component in payload.components
            component.type in types || continue
            net = get(component.connections, "neg", nothing)
            (net !== nothing && _root!(parent, net) == root) || continue
            return Dict{String, Any}("net" => net, "component" => component.id, "terminal" => "neg")
        end
    end
    return Dict{String, Any}("net" => minimum(island), "component" => nothing, "terminal" => nothing)
end

"""
    assign_reference(payload) -> (payload, plan)

每块导通的电路都已接地时原样返回、plan 为 nothing；否则给没接地的每块选一个参考点，
连同学生自己的地线网络一起并成 `REFERENCE_NET`，返回改写后的 payload 与 `ReferencePlan`。
"""
function assign_reference(payload::SimulationPayload)
    parent = Dict{String, String}()
    for net in payload.nets
        parent[net.name] = net.name
    end
    for component in payload.components, net in values(component.connections)
        parent[net] = net
    end
    isempty(parent) && return payload, nothing
    for component in payload.components, (a, b) in conductive_pairs(component)
        p = get(component.connections, a, nothing)
        q = get(component.connections, b, nothing)
        (p === nothing || q === nothing) && continue
        parent[_root!(parent, p)] = _root!(parent, q)
    end

    ground_nets = Set{String}()
    haskey(parent, REFERENCE_NET) && push!(ground_nets, REFERENCE_NET)
    for component in payload.components
        component.type == "ground" || continue
        net = get(component.connections, "gnd", nothing)
        net === nothing || push!(ground_nets, net)
    end
    grounded = Set(_root!(parent, net) for net in ground_nets)

    islands = Dict{String, Vector{String}}()
    for net in sort(collect(keys(parent)))
        push!(get!(islands, _root!(parent, net), String[]), net)
    end
    points = Dict{String, Any}[]
    for (root, island) in sort(collect(islands); by = entry -> first(entry.second))
        root in grounded && continue
        push!(points, _pick_reference(payload, parent, root, island))
    end
    isempty(points) && return payload, nothing

    # 学生的地线网络若不叫 gnd，也一起改名，否则求解器会把它当普通节点
    renamed = unique(vcat([String(point["net"]) for point in points], sort([net for net in ground_nets if net != REFERENCE_NET])))
    rename(net) = net in renamed ? REFERENCE_NET : net

    components = [
        ComponentPayload(c.id, c.type, c.parameters, Dict{String, String}(handle => rename(net) for (handle, net) in c.connections))
        for c in payload.components
    ]
    merged = Dict{String, Vector{Vector{String}}}()
    order = String[]
    for net in payload.nets
        name = rename(net.name)
        haskey(merged, name) || push!(order, name)
        append!(get!(merged, name, Vector{String}[]), net.nodes)
    end
    haskey(merged, REFERENCE_NET) || (push!(order, REFERENCE_NET); merged[REFERENCE_NET] = Vector{String}[])
    # MTK 瞬态要一个真正接上的 Ground 元件来钉住电位；节点电压法也认 ground 元件
    if !any(c.type == "ground" && haskey(c.connections, "gnd") for c in payload.components)
        id = "_ref"
        while any(c.id == id for c in payload.components)
            id *= "_"
        end
        push!(components, ComponentPayload(id, "ground", Dict{String, Float64}(), Dict("gnd" => REFERENCE_NET)))
        push!(merged[REFERENCE_NET], [id, "gnd"])
    end
    nets = [NetPayload(name, merged[name]) for name in order]

    port = payload.thevenin_port === nothing ? nothing :
        Dict{String, String}(key => rename(net) for (key, net) in payload.thevenin_port)
    rewritten = SimulationPayload(components, nets, payload.sim, payload.method, port, payload.teaching_mode, payload.sweep)
    return rewritten, ReferencePlan(renamed, any(net.name == REFERENCE_NET for net in payload.nets), points)
end

"""
    restore_reference!(data, plan, thevenin_port)

把求解结果里按 `REFERENCE_NET` 记的电位改回学生的原网络名（都是 0），去掉学生没画过的 gnd，
戴维南端口还原成原名，并附上 `reference`（自动选的参考点），前端据此提示学生。
"""
function restore_reference!(data, plan::ReferencePlan, thevenin_port)
    data isa AbstractDict || return data
    for key in ("node_voltages", "node_phases_deg")
        values = get(data, key, nothing)
        values isa AbstractDict || continue
        zero = get(values, REFERENCE_NET, 0.0)
        for net in plan.renamed
            values[net] = zero
        end
        plan.had_reference_net || delete!(values, REFERENCE_NET)
    end
    if thevenin_port !== nothing && get(data, "port", nothing) isa AbstractDict
        data["port"] = Dict("positive" => thevenin_port["positive"], "negative" => thevenin_port["negative"])
    end
    data["reference"] = plan.points
    return data
end
