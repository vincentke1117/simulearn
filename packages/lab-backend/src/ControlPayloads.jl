struct ControlBlockPayload
    id::String
    type::String
    parameters::Dict{String, Float64}
end
StructTypes.StructType(::Type{ControlBlockPayload}) = StructTypes.Struct()

struct ControlEdgePayload
    id::String
    source::String
    target::String
    sourceHandle::String
    targetHandle::String
end
StructTypes.StructType(::Type{ControlEdgePayload}) = StructTypes.Struct()

struct ControlOutputPayload
    id::String
    blockId::String
    handle::String
    label::String
end
StructTypes.StructType(::Type{ControlOutputPayload}) = StructTypes.Struct()

struct ControlSimulationPayload
    kind::String
    blocks::Vector{ControlBlockPayload}
    edges::Vector{ControlEdgePayload}
    outputs::Vector{ControlOutputPayload}
    sim::SimulationSettings
end
StructTypes.StructType(::Type{ControlSimulationPayload}) = StructTypes.Struct()

const CONTROL_BLOCK_SCHEMAS = Dict(
    "control_step" => (
        inputs = String[],
        outputs = ["out"],
        params = ["amplitude", "offset", "startTime"],
        mins = Dict("startTime" => 0.0),
        dynamic = false,
        feedthrough = false,
    ),
    "control_constant" => (
        inputs = String[],
        outputs = ["out"],
        params = ["value"],
        mins = Dict{String, Float64}(),
        dynamic = false,
        feedthrough = false,
    ),
    "control_sum" => (
        inputs = ["in1", "in2"],
        outputs = ["out"],
        params = ["sign1", "sign2"],
        mins = Dict{String, Float64}(),
        dynamic = false,
        feedthrough = true,
    ),
    "control_gain" => (
        inputs = ["in"],
        outputs = ["out"],
        params = ["gain"],
        mins = Dict{String, Float64}(),
        dynamic = false,
        feedthrough = true,
    ),
    "control_integrator" => (
        inputs = ["in"],
        outputs = ["out"],
        params = ["initialValue"],
        mins = Dict{String, Float64}(),
        dynamic = true,
        feedthrough = false,
    ),
    "control_plant_1st" => (
        inputs = ["in"],
        outputs = ["out"],
        params = ["gain", "timeConstant", "initialValue"],
        mins = Dict("timeConstant" => 1e-9),
        dynamic = true,
        feedthrough = false,
    ),
    "control_pid" => (
        inputs = ["in"],
        outputs = ["out"],
        params = ["kp", "ki", "kd", "tf"],
        mins = Dict("tf" => 1e-9),
        dynamic = true,
        feedthrough = true,
    ),
    "control_scope" => (
        inputs = ["in"],
        outputs = String[],
        params = String[],
        mins = Dict{String, Float64}(),
        dynamic = false,
        feedthrough = false,
    ),
)

function control_block_schema(block_type::String)
    return get(CONTROL_BLOCK_SCHEMAS, block_type, nothing)
end

function is_dynamic_control_block(block_type::String)
    schema = control_block_schema(block_type)
    return schema !== nothing && schema.dynamic
end

function is_feedthrough_control_block(block_type::String)
    schema = control_block_schema(block_type)
    return schema !== nothing && schema.feedthrough
end
