module Types

using JSON3
import ..Errors: ValidationError

export Node, Link, TopologyData, SwitchStatus, as_switch_status

@enum SwitchStatus begin
    SWITCH_OPEN
    SWITCH_CLOSED
end

struct Node
    id::String
    type::String
    data::Dict{String,Any}
end

struct Link
    id::String
    from::String
    to::String
    type::String
    data::Dict{String,Any}
end

struct TopologyData
    meta::Dict{String,Any}
    nodes::Vector{Node}
    links::Vector{Link}
end

function as_switch_status(value)
    if value isa SwitchStatus
        return value
    elseif value isa AbstractString
        upper = uppercase(strip(value))
        if upper == "OPEN"
            return SWITCH_OPEN
        elseif upper == "CLOSED"
            return SWITCH_CLOSED
        end
    elseif value isa Bool
        return value ? SWITCH_CLOSED : SWITCH_OPEN
    end
    throw(ValidationError("invalid switch status"))
end

function Node(obj)
    id = String(obj["id"])
    type = String(get(obj, "type", "Bus"))
    data = Dict{String,Any}(
        String(pair.first) => pair.second
        for pair in pairs(obj)
        if String(pair.first) != "id" && String(pair.first) != "type"
    )
    return Node(id, type, data)
end

function Link(obj)
    id = String(obj["id"])
    from = String(obj["from"])
    to = String(obj["to"])
    type = String(get(obj, "type", "Line"))
    data = Dict{String,Any}(
        String(pair.first) => pair.second
        for pair in pairs(obj)
        if !(String(pair.first) in ("id", "from", "to", "type"))
    )
    return Link(id, from, to, type, data)
end

function TopologyData(obj)
    meta = Dict{String,Any}(String(pair.first) => pair.second for pair in pairs(get(obj, "meta", Dict{String,Any}())))
    nodes = [Node(node) for node in get(obj, "nodes", Any[])]
    links = [Link(link) for link in get(obj, "links", Any[])]
    return TopologyData(meta, nodes, links)
end

end

using .Types: Node, Link, TopologyData, SwitchStatus, SWITCH_OPEN, SWITCH_CLOSED, as_switch_status
