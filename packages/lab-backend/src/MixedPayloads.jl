struct MixedBridgeBindingPayload
    blockId::String
    positiveNet::String
    negativeNet::String
end
StructTypes.StructType(::Type{MixedBridgeBindingPayload}) = StructTypes.Struct()

struct MixedCircuitPayload
    components::Vector{ComponentPayload}
    nets::Vector{NetPayload}
end
StructTypes.StructType(::Type{MixedCircuitPayload}) = StructTypes.Struct()

struct MixedSimulationPayload
    kind::String
    blocks::Vector{ControlBlockPayload}
    edges::Vector{ControlEdgePayload}
    outputs::Vector{ControlOutputPayload}
    bridges::Vector{MixedBridgeBindingPayload}
    circuit::MixedCircuitPayload
    sim::SimulationSettings
end
StructTypes.StructType(::Type{MixedSimulationPayload}) = StructTypes.Struct()

const MIXED_SIGNAL_BLOCK_SCHEMAS = Dict(
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
    "voltage_sensor" => (
        inputs = String[],
        outputs = ["out"],
        params = String[],
        mins = Dict{String, Float64}(),
        dynamic = false,
        feedthrough = false,
    ),
    "current_sensor" => (
        inputs = String[],
        outputs = ["out"],
        params = String[],
        mins = Dict{String, Float64}(),
        dynamic = false,
        feedthrough = false,
    ),
    "controlled_voltage_source" => (
        inputs = ["in"],
        outputs = String[],
        params = ["gain"],
        mins = Dict{String, Float64}(),
        dynamic = false,
        feedthrough = false,
    ),
    "controlled_current_source" => (
        inputs = ["in"],
        outputs = String[],
        params = ["gain"],
        mins = Dict{String, Float64}(),
        dynamic = false,
        feedthrough = false,
    ),
)

function mixed_block_schema(block_type::String)
    return get(MIXED_SIGNAL_BLOCK_SCHEMAS, block_type, nothing)
end

function is_mixed_dynamic_block(block_type::String)
    schema = mixed_block_schema(block_type)
    return schema !== nothing && schema.dynamic
end

function is_mixed_feedthrough_block(block_type::String)
    schema = mixed_block_schema(block_type)
    return schema !== nothing && schema.feedthrough
end

function is_bridge_sensor_block(block_type::String)
    return block_type == "voltage_sensor" || block_type == "current_sensor"
end

function is_bridge_actuator_block(block_type::String)
    return block_type == "controlled_voltage_source" || block_type == "controlled_current_source"
end
