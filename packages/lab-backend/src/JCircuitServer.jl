module JCircuitServer

using HTTP
using JSON3
using StructTypes
using ModelingToolkit
using ModelingToolkit: @independent_variables
using ModelingToolkitStandardLibrary.Electrical
using ModelingToolkitStandardLibrary.Blocks
using DifferentialEquations
using LinearAlgebra
using SHA

const EPS_RESISTANCE = 1e-9
const _SIMPLIFY_CACHE = Dict{String, Any}()
# HTTP.jl 每请求一个 task：全局缓存/指标必须持锁访问；LRU 上限防长期运行内存无界增长
const _SIMPLIFY_CACHE_ORDER = String[]
const _SIMPLIFY_CACHE_LIMIT = 32
const _STATE_LOCK = ReentrantLock()
const _METRICS = Dict{String, Int}("simulate_calls" => 0, "simplify_hits" => 0, "simplify_misses" => 0)

export bootstrap, run_simulation, SimulationPayload, ComponentPayload, NetPayload, SimulationSettings, ControlBlockPayload, ControlEdgePayload, ControlOutputPayload, ControlSimulationPayload, MixedBridgeBindingPayload, MixedCircuitPayload, MixedSimulationPayload

struct SimulationSettings
    t_stop::Float64
    n_samples::Int
end
StructTypes.StructType(::Type{SimulationSettings}) = StructTypes.Struct()

include("ControlPayloads.jl")

struct ComponentPayload
    id::String
    type::String
    parameters::Dict{String, Float64}
    connections::Dict{String, String}
end
StructTypes.StructType(::Type{ComponentPayload}) = StructTypes.Struct()

struct NetPayload
    name::String
    nodes::Vector{Vector{String}}
end
StructTypes.StructType(::Type{NetPayload}) = StructTypes.Struct()

struct SimulationPayload
    components::Vector{ComponentPayload}
    nets::Vector{NetPayload}
    sim::SimulationSettings
    method::Union{String, Nothing}
    thevenin_port::Union{Dict{String, String}, Nothing}  # 戴维南端口配置: {"positive" => 节点名, "negative" => 节点名}
    teaching_mode::Union{Bool, Nothing}  # 教学模式：是否返回求解步骤
end
StructTypes.StructType(::Type{SimulationPayload}) = StructTypes.Struct()
StructTypes.omitempties(::Type{SimulationPayload}) = (:method, :thevenin_port, :teaching_mode)

SimulationPayload(
    components::Vector{ComponentPayload},
    nets::Vector{NetPayload},
    sim::SimulationSettings,
) = SimulationPayload(components, nets, sim, nothing, nothing, nothing)

SimulationPayload(
    components::Vector{ComponentPayload},
    nets::Vector{NetPayload},
    sim::SimulationSettings,
    method::Union{String, Nothing},
) = SimulationPayload(components, nets, sim, method, nothing, nothing)

include("MixedPayloads.jl")

struct ValidationError <: Exception
    message::String
    data::Dict{String, Any}
end
Base.showerror(io::IO, err::ValidationError) = print(io, err.message)

include("ControlSimulation.jl")
include("MixedSimulation.jl")

const COMPONENT_SCHEMAS = Dict(
    "resistor" => (; handles = ["p", "n"], params = ["value"]),
    "capacitor" => (; handles = ["p", "n"], params = ["value"]),
    "inductor" => (; handles = ["p", "n"], params = ["value"]),
    "vsource_dc" => (; handles = ["pos", "neg"], params = ["dc"]),
    "vsource_ac" => (; handles = ["pos", "neg"], params = ["amplitude", "frequency"]),
    "isource_dc" => (; handles = ["pos", "neg"], params = ["dc"]),
    "isource_ac" => (; handles = ["pos", "neg"], params = ["amplitude", "frequency"]),
    "vcvs" => (; handles = ["pos", "neg", "ctrl_p", "ctrl_n"], params = ["gain"]),
    "ccvs" => (; handles = ["pos", "neg", "ctrl_p", "ctrl_n"], params = ["gain"]),
    "vccs" => (; handles = ["pos", "neg", "ctrl_p", "ctrl_n"], params = ["gain"]),
    "cccs" => (; handles = ["pos", "neg", "ctrl_p", "ctrl_n"], params = ["gain"]),
    "ground" => (; handles = ["gnd"], params = String[]),
    "voltage_probe" => (; handles = ["node"], params = String[]),
    "current_probe" => (; handles = ["p", "n"], params = String[]),
)

const RESPONSE_HEADERS = Dict(
    "Content-Type" => "application/json",
    "Access-Control-Allow-Origin" => "*",
    "Access-Control-Allow-Headers" => "Content-Type",
    "Access-Control-Allow-Methods" => "POST, OPTIONS",
)

# 在不同版本的标准库中，Blocks 的输入/输出端口与 Electrical 的信号端口可能是
# 连接器(ODESystem)或符号量(Symbolics.Num)。为了兼容，提供一个安全连接助手：
# - 当两端都是连接器时使用 ModelingToolkit.connect
# - 否则退化为等式约束 lhs ~ rhs
function push_connection_or_equation!(eqs::Vector{Equation}, lhs, rhs)
    if lhs isa ModelingToolkit.ODESystem && rhs isa ModelingToolkit.ODESystem
        connection_eqs = ModelingToolkit.connect(lhs, rhs)
        if connection_eqs isa AbstractArray
            append!(eqs, connection_eqs)
        else
            push!(eqs, connection_eqs)
        end
    else
        push!(eqs, lhs ~ rhs)
    end
end

function require_parameter(component::ComponentPayload, key::String)
    haskey(component.parameters, key) ||
        throw(ValidationError("缺少元件参数 $(key)", Dict("component" => component.id, "parameter" => key)))
    return Float64(component.parameters[key])
end

function require_connections(component::ComponentPayload, handles::Vector{String})
    for handle in handles
        haskey(component.connections, handle) ||
            throw(ValidationError("端子未连接", Dict("component" => component.id, "handle" => handle)))
    end
end

# 优雅地查找受控源的控制端子（不同库版本可能使用不同字段名）
# 返回一对控制端子连接器 (ctrl_p, ctrl_n)
function find_control_connectors(system)
    candidates = [
        (:pc, :nc),            # 常见：控制电压端子 pc/nc
        (:p_sense, :n_sense),  # 备选：控制电流感测端子 p_sense/n_sense
        (:p2, :n2),            # 某些组件可能使用第二对端子 p2/n2
        (:p_ctrl, :n_ctrl)     # 其他可能的命名
    ]
    for (pname, nname) in candidates
        if hasproperty(system, pname) && hasproperty(system, nname)
            pfield = getproperty(system, pname)
            nfield = getproperty(system, nname)
            # 仅当两端都是连接器(ODESystem)时才作为控制端返回
            if pfield isa ModelingToolkit.ODESystem && nfield isa ModelingToolkit.ODESystem
                return (pfield, nfield)
            end
        end
    end
    fields = fieldnames(typeof(system))
    throw(ValidationError(
        "受控源不支持的控制端子",
        Dict("fields" => [String(f) for f in fields])
    ))
end

# 非抛错版本：若未找到控制端子则返回 nothing
function try_find_control_connectors(system)
    candidates = [
        (:pc, :nc),
        (:p_sense, :n_sense),
        (:p2, :n2),
        (:p_ctrl, :n_ctrl)
    ]
    for (pname, nname) in candidates
        if hasproperty(system, pname) && hasproperty(system, nname)
            pfield = getproperty(system, pname)
            nfield = getproperty(system, nname)
            if pfield isa ModelingToolkit.ODESystem && nfield isa ModelingToolkit.ODESystem
                return (pfield, nfield)
            end
        end
    end
    return nothing
end

# 传感器端子查找：仅匹配 p/n，用于组合式受控源中的传感器
function find_sensor_connectors(system)
    # 兼容不同库版本的传感器端子命名，优先尝试常见的 p/n
    candidates = [
        (:pc, :nc),
        (:p, :n),
        (:p1, :n1),
        (:pin_p, :pin_n),
        (:port_p, :port_n)
    ]
    for (pname, nname) in candidates
        pfield = nothing
        nfield = nothing
        try
            pfield = getproperty(system, pname)
            nfield = getproperty(system, nname)
        catch
            # 若属性不存在，尝试下一组候选名
            continue
        end
        if pfield isa ModelingToolkit.ODESystem && nfield isa ModelingToolkit.ODESystem
            return (pfield, nfield)
        end
    end
    fields = fieldnames(typeof(system))
    throw(ValidationError(
        "受控源传感器不支持的端子",
        Dict("fields" => [String(f) for f in fields])
    ))
end

function parse_net_nodes(net::NetPayload)
    nodes = Tuple{String, String}[]
    for pair in net.nodes
        length(pair) == 2 ||
            throw(ValidationError("网络节点必须包含元件与端子", Dict("net" => net.name)))
        push!(nodes, (pair[1], pair[2]))
    end
    return nodes
end

function instantiate_component(component::ComponentPayload)
    name = Symbol(component.id)
    handles = Dict{String, Any}()
    extra_systems = ODESystem[]
    extra_equations = Equation[]
    measurement = nothing

    schema = get(COMPONENT_SCHEMAS, component.type, nothing)
    schema === nothing &&
        throw(ValidationError("暂不支持的元件类型", Dict("component" => component.id, "type" => component.type)))

    require_connections(component, schema.handles)

    system = begin
        if component.type == "resistor"
            R = require_parameter(component, "value")
            Electrical.Resistor(; name, R = R)
        elseif component.type == "capacitor"
            C = require_parameter(component, "value")
            Electrical.Capacitor(; name, C = C)
        elseif component.type == "inductor"
            L = require_parameter(component, "value")
            Electrical.Inductor(; name, L = L)
        elseif component.type == "vsource_dc"
            dc = require_parameter(component, "dc")
            driver = Blocks.Constant(; name = Symbol(component.id * "_drv"), k = dc)
            push!(extra_systems, driver)
            if isdefined(Electrical, :SignalVoltage)
                voltage = Electrical.SignalVoltage(; name)
                push_connection_or_equation!(extra_equations, driver.output, voltage.v)
            else
                voltage = Electrical.Voltage(; name)
                # 使用连接/等式助手以兼容不同端口类型（连接器或符号量）
                push_connection_or_equation!(extra_equations, driver.output, voltage.V)
            end
            voltage
        elseif component.type == "vsource_ac"
            amplitude = require_parameter(component, "amplitude")
            frequency = require_parameter(component, "frequency")
            driver = Blocks.Sine(; name = Symbol(component.id * "_drv"), amplitude = amplitude, frequency = frequency)
            push!(extra_systems, driver)
            if isdefined(Electrical, :SignalVoltage)
                voltage = Electrical.SignalVoltage(; name)
                push_connection_or_equation!(extra_equations, driver.output, voltage.v)
            else
                voltage = Electrical.Voltage(; name)
                # 使用连接/等式助手以兼容不同端口类型（连接器或符号量）
                push_connection_or_equation!(extra_equations, driver.output, voltage.V)
            end
            voltage
        elseif component.type == "ground"
            Electrical.Ground(; name)
        elseif component.type == "voltage_probe"
            sensor = Electrical.PotentialSensor(; name)
            net = component.connections["node"]
            measurement = (id = component.id, label = "Voltage at $(net)", expr = sensor.phi)
            sensor
        elseif component.type == "current_probe"
            sensor = Electrical.CurrentSensor(; name)
            measurement = (id = component.id, label = "Current through $(component.id)", expr = sensor.i)
            sensor
        elseif component.type == "isource_dc"
            dc = require_parameter(component, "dc")
            driver = Blocks.Constant(; name = Symbol(component.id * "_drv"), k = dc)
            push!(extra_systems, driver)
            if isdefined(Electrical, :SignalCurrent)
                current = Electrical.SignalCurrent(; name)
                push_connection_or_equation!(extra_equations, driver.output, current.i)
            else
                current = Electrical.Current(; name)
                push!(extra_equations, current.I ~ driver.output)
            end
            current
        elseif component.type == "isource_ac"
            amplitude = require_parameter(component, "amplitude")
            frequency = require_parameter(component, "frequency")
            driver = Blocks.Sine(; name = Symbol(component.id * "_drv"), amplitude = amplitude, frequency = frequency)
            push!(extra_systems, driver)
            if isdefined(Electrical, :SignalCurrent)
                current = Electrical.SignalCurrent(; name)
                push_connection_or_equation!(extra_equations, driver.output, current.i)
            else
                current = Electrical.Current(; name)
                push!(extra_equations, current.I ~ driver.output)
            end
            current
        elseif component.type == "vcvs"
            gain = require_parameter(component, "gain")
            if isdefined(Electrical, :VCVS)
                sys_candidate = Electrical.VCVS(; name, gain = gain)
                ctrl_pair = try_find_control_connectors(sys_candidate)
                if ctrl_pair === nothing
                    # 回退：双电压传感器 + 增益 + 信号电压源/普通电压源
                    sensor_p = Electrical.PotentialSensor(; name = Symbol(component.id * "_sense_p"))
                    sensor_n = Electrical.PotentialSensor(; name = Symbol(component.id * "_sense_n"))
                    driver = Blocks.Gain(; name = Symbol(component.id * "_drv"), k = gain)
                    push!(extra_systems, sensor_p)
                    push!(extra_systems, sensor_n)
                    push!(extra_systems, driver)

                    # 驱动输入为两传感器电压差（直接约束内部变量 u）
                    push!(extra_equations, driver.u ~ (sensor_p.phi - sensor_n.phi))

                    if isdefined(Electrical, :SignalVoltage)
                        voltage = Electrical.SignalVoltage(; name)
                        push_connection_or_equation!(extra_equations, driver.output, voltage.v)
                    else
                        voltage = Electrical.Voltage(; name)
                        push_connection_or_equation!(extra_equations, driver.output, voltage.V)
                    end

                    # 保存控制端子，分别对应两传感器单端口
                    handles["ctrl_p"] = getproperty(sensor_p, :p)
                    handles["ctrl_n"] = getproperty(sensor_n, :p)
                    voltage
                else
                    # 内置受控源且具备控制端子
                    handles["ctrl_p"] = ctrl_pair[1]
                    handles["ctrl_n"] = ctrl_pair[2]
                    sys_candidate
                end
            else
                # 组合式实现：双电压传感器 + 增益 + 信号电压源/普通电压源
                sensor_p = Electrical.PotentialSensor(; name = Symbol(component.id * "_sense_p"))
                sensor_n = Electrical.PotentialSensor(; name = Symbol(component.id * "_sense_n"))
                driver = Blocks.Gain(; name = Symbol(component.id * "_drv"), k = gain)
                push!(extra_systems, sensor_p)
                push!(extra_systems, sensor_n)
                push!(extra_systems, driver)

                # 驱动输入为两传感器电压差（直接约束内部变量 u）
                push!(extra_equations, driver.u ~ (sensor_p.phi - sensor_n.phi))

                if isdefined(Electrical, :SignalVoltage)
                    voltage = Electrical.SignalVoltage(; name)
                    push_connection_or_equation!(extra_equations, driver.output, voltage.v)
                else
                    voltage = Electrical.Voltage(; name)
                    push_connection_or_equation!(extra_equations, driver.output, voltage.V)
                end

                # 保存控制端子，分别对应两传感器单端口
                handles["ctrl_p"] = getproperty(sensor_p, :p)
                handles["ctrl_n"] = getproperty(sensor_n, :p)
                voltage
            end
        elseif component.type == "vccs"
            gain = require_parameter(component, "gain")
            if isdefined(Electrical, :VCCS)
                sys_candidate = Electrical.VCCS(; name, gain = gain)
                ctrl_pair = try_find_control_connectors(sys_candidate)
                if ctrl_pair === nothing
                    # 组合式实现：双电压传感器 + 增益 + 信号电流源/普通电流源
                    sensor_p = Electrical.PotentialSensor(; name = Symbol(component.id * "_sense_p"))
                    sensor_n = Electrical.PotentialSensor(; name = Symbol(component.id * "_sense_n"))
                    driver = Blocks.Gain(; name = Symbol(component.id * "_drv"), k = gain)
                    push!(extra_systems, sensor_p)
                    push!(extra_systems, sensor_n)
                    push!(extra_systems, driver)

                    # 驱动输入为两传感器电压差（直接约束内部变量 u）
                    push!(extra_equations, driver.u ~ (sensor_p.phi - sensor_n.phi))

                    if isdefined(Electrical, :SignalCurrent)
                        current = Electrical.SignalCurrent(; name)
                        push_connection_or_equation!(extra_equations, driver.output, current.i)
                    else
                        current = Electrical.Current(; name)
                        push_connection_or_equation!(extra_equations, driver.output, current.I)
                    end

                    handles["ctrl_p"] = getproperty(sensor_p, :p)
                    handles["ctrl_n"] = getproperty(sensor_n, :p)
                    current
                else
                    handles["ctrl_p"] = ctrl_pair[1]
                    handles["ctrl_n"] = ctrl_pair[2]
                    sys_candidate
                end
            else
                # 组合式实现：双电压传感器 + 增益 + 信号电流源/普通电流源
                sensor_p = Electrical.PotentialSensor(; name = Symbol(component.id * "_sense_p"))
                sensor_n = Electrical.PotentialSensor(; name = Symbol(component.id * "_sense_n"))
                driver = Blocks.Gain(; name = Symbol(component.id * "_drv"), k = gain)
                push!(extra_systems, sensor_p)
                push!(extra_systems, sensor_n)
                push!(extra_systems, driver)

                # 驱动输入为两传感器电压差（直接约束内部变量 u）
                push!(extra_equations, driver.u ~ (sensor_p.phi - sensor_n.phi))

                if isdefined(Electrical, :SignalCurrent)
                    current = Electrical.SignalCurrent(; name)
                    push_connection_or_equation!(extra_equations, driver.output, current.i)
                else
                    current = Electrical.Current(; name)
                    push_connection_or_equation!(extra_equations, driver.output, current.I)
                end

                handles["ctrl_p"] = getproperty(sensor_p, :p)
                handles["ctrl_n"] = getproperty(sensor_n, :p)
                current
            end
        elseif component.type == "ccvs"
            gain = require_parameter(component, "gain")
            if isdefined(Electrical, :CCVS)
                sys_candidate = Electrical.CCVS(; name, gain = gain)
                ctrl_pair = try_find_control_connectors(sys_candidate)
                if ctrl_pair === nothing
                    sensor = Electrical.CurrentSensor(; name = Symbol(component.id * "_sense"))
                    driver = Blocks.Gain(; name = Symbol(component.id * "_drv"), k = gain)
                    push!(extra_systems, sensor)
                    push!(extra_systems, driver)

                    push_connection_or_equation!(extra_equations, sensor.i, driver.input)

                    if isdefined(Electrical, :SignalVoltage)
                        voltage = Electrical.SignalVoltage(; name)
                        push_connection_or_equation!(extra_equations, driver.output, voltage.v)
                    else
                        voltage = Electrical.Voltage(; name)
                        # 使用连接/等式助手以兼容不同端口类型（连接器或符号量）
                        push_connection_or_equation!(extra_equations, driver.output, voltage.V)
                    end

                    begin
                        ctrl_p, ctrl_n = find_sensor_connectors(sensor)
                        handles["ctrl_p"] = ctrl_p
                        handles["ctrl_n"] = ctrl_n
                    end
                    voltage
                else
                    handles["ctrl_p"] = ctrl_pair[1]
                    handles["ctrl_n"] = ctrl_pair[2]
                    sys_candidate
                end
            else
                sensor = Electrical.CurrentSensor(; name = Symbol(component.id * "_sense"))
                driver = Blocks.Gain(; name = Symbol(component.id * "_drv"), k = gain)
                push!(extra_systems, sensor)
                push!(extra_systems, driver)

                push_connection_or_equation!(extra_equations, sensor.i, driver.input)

                if isdefined(Electrical, :SignalVoltage)
                    voltage = Electrical.SignalVoltage(; name)
                    push_connection_or_equation!(extra_equations, driver.output, voltage.v)
                else
                    voltage = Electrical.Voltage(; name)
                    # 使用连接/等式助手以兼容不同端口类型（连接器或符号量）
                    push_connection_or_equation!(extra_equations, driver.output, voltage.V)
                end

                begin
                    ctrl_p, ctrl_n = find_sensor_connectors(sensor)
                    handles["ctrl_p"] = ctrl_p
                    handles["ctrl_n"] = ctrl_n
                end
                voltage
            end
        elseif component.type == "cccs"
            gain = require_parameter(component, "gain")
            if isdefined(Electrical, :CCCS)
                sys_candidate = Electrical.CCCS(; name, gain = gain)
                ctrl_pair = try_find_control_connectors(sys_candidate)
                if ctrl_pair === nothing
                    sensor = Electrical.CurrentSensor(; name = Symbol(component.id * "_sense"))
                    driver = Blocks.Gain(; name = Symbol(component.id * "_drv"), k = gain)
                    push!(extra_systems, sensor)
                    push!(extra_systems, driver)

                    push_connection_or_equation!(extra_equations, sensor.i, driver.input)

                    if isdefined(Electrical, :SignalCurrent)
                        current = Electrical.SignalCurrent(; name)
                        push_connection_or_equation!(extra_equations, driver.output, current.i)
                    else
                        current = Electrical.Current(; name)
                        push!(extra_equations, current.I ~ driver.output)
                    end

                    handles["ctrl_p"] = getproperty(sensor, :p)
                    handles["ctrl_n"] = getproperty(sensor, :n)
                    current
                else
                    handles["ctrl_p"] = ctrl_pair[1]
                    handles["ctrl_n"] = ctrl_pair[2]
                    sys_candidate
                end
            else
                sensor = Electrical.CurrentSensor(; name = Symbol(component.id * "_sense"))
                driver = Blocks.Gain(; name = Symbol(component.id * "_drv"), k = gain)
                push!(extra_systems, sensor)
                push!(extra_systems, driver)

                push_connection_or_equation!(extra_equations, sensor.i, driver.input)

                if isdefined(Electrical, :SignalCurrent)
                    current = Electrical.SignalCurrent(; name)
                    push_connection_or_equation!(extra_equations, driver.output, current.i)
                else
                    current = Electrical.Current(; name)
                    # 使用连接/等式助手以兼容不同端口类型（连接器或符号量）
                    push_connection_or_equation!(extra_equations, driver.output, current.I)
                end

                begin
                    handles["ctrl_p"] = getproperty(sensor, :p)
                    handles["ctrl_n"] = getproperty(sensor, :n)
                end
                current
            end
        else
            throw(ValidationError("暂不支持的元件类型", Dict("component" => component.id, "type" => component.type)))
        end
    end

    if component.type == "ground"
        handles["gnd"] = system.g
    elseif component.type == "voltage_probe"
        handles["node"] = system.p
    elseif component.type == "current_probe"
        handles["p"] = system.p
        handles["n"] = system.n
    elseif component.type in ("vcvs", "vccs", "ccvs", "cccs")
        # 受控源有四个端口：输出正负端 + 控制正负端
        handles["pos"] = getproperty(system, :p)
        handles["neg"] = getproperty(system, :n)
        # 若前面已通过组合方式创建了传感器，则 ctrl_p/ctrl_n 已填充
        if !(haskey(handles, "ctrl_p") && haskey(handles, "ctrl_n"))
            ctrl_p, ctrl_n = find_control_connectors(system)
            handles["ctrl_p"] = ctrl_p
            handles["ctrl_n"] = ctrl_n
        end
    else
        handles["p"] = getproperty(system, :p)
        handles["n"] = getproperty(system, :n)
        if component.type in ("vsource_dc", "vsource_ac", "isource_dc", "isource_ac")
            handles["pos"] = getproperty(system, :p)
            handles["neg"] = getproperty(system, :n)
        end
    end

    return (; system, handles, extra_systems, extra_equations, measurement)
end

"""
    is_resistive_circuit(payload::SimulationPayload)

检测是否为纯电阻电路（只包含电阻、直流电源、地、探针）
纯电阻电路可以使用节点电压法等直流分析方法
"""
function is_resistive_circuit(payload::SimulationPayload)
    resistive_types = Set(["resistor", "vsource_dc", "isource_dc", "ground", "voltage_probe", "current_probe", "vccs", "vcvs", "ccvs", "cccs"])
    return all(comp.type in resistive_types for comp in payload.components)
end

""" solve_by_node_voltage(payload::SimulationPayload)

使用修改节点分析（MNA）求解纯电阻直流电路。
- 未知量：所有非地节点电压 + 每个直流电压源的支路电流
- 更稳健：同时支持接地与非接地电压源（超节点）
"""
function solve_by_node_voltage(payload::SimulationPayload)
    # 验证是否为纯电阻电路
    is_resistive_circuit(payload) ||
        throw(ValidationError("节点电压法仅适用于纯电阻电路", Dict()))

    # 1) 识别地线网络名称（优先使用名为 "gnd" 的网络；否则从 ground 元件的连接中推断）
    ground_nets = Set{String}()
    for comp in payload.components
        if comp.type == "ground" && haskey(comp.connections, "gnd")
            push!(ground_nets, comp.connections["gnd"])
        end
    end
    # 若 nets 中已存在名为 gnd 的网络，优先使用它
    declared_gnd = any(net.name == "gnd" for net in payload.nets)
    ground_name = declared_gnd ? "gnd" : (isempty(ground_nets) ? nothing : first(ground_nets))
    if ground_name === nothing
        throw(ValidationError("缺少地线节点", Dict()))
    end
    # 如果存在多个 ground 元件且连接到不同网络，给出明确错误
    if length(ground_nets) > 1 && !declared_gnd
        throw(ValidationError("存在多个地线且连接到不同网络", Dict("ground_nets" => collect(ground_nets))))
    end

    # 收集非地节点
    all_nodes = Set{String}()
    for net in payload.nets
        if net.name != ground_name
            push!(all_nodes, net.name)
        end
    end

    nodes = sort(collect(all_nodes))
    n = length(nodes)
    node_index = Dict(node => i for (i, node) in enumerate(nodes))

    # 2) 分类元件
    resistors = [c for c in payload.components if c.type == "resistor"]
    vs_ind = [c for c in payload.components if c.type == "vsource_dc"]
    vccs_list = [c for c in payload.components if c.type == "vccs"]
    vcvs_list = [c for c in payload.components if c.type == "vcvs"]
    ccvs_list = [c for c in payload.components if c.type == "ccvs"]
    cccs_list = [c for c in payload.components if c.type == "cccs"]
    isources = [c for c in payload.components if c.type == "isource_dc"]

    vsrc_candidates = vcat(vs_ind, vcvs_list, ccvs_list)

    function find_vsrc_between(cp::String, cn::String)
        for v in vsrc_candidates
            p = v.connections["pos"]; q = v.connections["neg"]
            if p == cp && q == cn
                return (v.id, 1.0)
            elseif p == cn && q == cp
                return (v.id, -1.0)
            end
        end
        return (nothing, 0.0)
    end

    function vsrc_stats_between(cp::String, cn::String)
        cnt = 0
        has_ind = false
        for v in vsrc_candidates
            p = v.connections["pos"]; q = v.connections["neg"]
            if (p == cp && q == cn) || (p == cn && q == cp)
                cnt += 1
                if v.type == "vsource_dc"
                    has_ind = true
                end
            end
        end
        return cnt, has_ind
    end

    sense_ccvs_vsrc = ComponentPayload[]
    for c in ccvs_list
        cp = c.connections["ctrl_p"]; cn = c.connections["ctrl_n"]
        cnt, has_ind = vsrc_stats_between(cp, cn)
        if cnt == 0 || (has_ind && cnt > 1)
            push!(sense_ccvs_vsrc, ComponentPayload("_sense_ccvs_" * c.id, "vsource_dc", Dict("dc" => 0.0), Dict("pos" => cp, "neg" => cn)) )
        end
    end

    sense_cccs_vsrc = ComponentPayload[]
    for c in cccs_list
        cp = c.connections["ctrl_p"]; cn = c.connections["ctrl_n"]
        cnt, has_ind = vsrc_stats_between(cp, cn)
        if cnt == 0 || (has_ind && cnt > 1)
            push!(sense_cccs_vsrc, ComponentPayload("_sense_cccs_" * c.id, "vsource_dc", Dict("dc" => 0.0), Dict("pos" => cp, "neg" => cn)) )
        end
    end

    # 电流探针：与瞬态路径 CurrentSensor 统一为「串联理想电流表」= 0V 电压源，
    # 其支路电流即 MNA 扩展变量，方向 p→n（与前端元件文档一致）
    probe_vsrc = ComponentPayload[]
    for c in payload.components
        if c.type == "current_probe"
            push!(probe_vsrc, ComponentPayload(c.id, "vsource_dc", Dict("dc" => 0.0), Dict("pos" => c.connections["p"], "neg" => c.connections["n"])))
        end
    end
    vsrc_rows = vcat(vs_ind, vcvs_list, ccvs_list, sense_ccvs_vsrc, sense_cccs_vsrc, probe_vsrc)
    vsrc_index = Dict{String, Int}()
    for (i, v) in enumerate(vsrc_rows)
        vsrc_index[v.id] = i
    end
    m = length(vsrc_rows)

    # 3) 构建 MNA 矩阵 A 与向量 b
    A = zeros(Float64, n + m, n + m)
    b = zeros(Float64, n + m)

    # 电阻贡献：标准导纳填充
    for r in resistors
        R = r.parameters["value"]
        g = 1.0 / R
        p = r.connections["p"]
        q = r.connections["n"]
        if p != ground_name
            ip = node_index[p]
            A[ip, ip] += g
        end
        if q != ground_name
            iq = node_index[q]
            A[iq, iq] += g
        end
        if p != ground_name && q != ground_name
            ip = node_index[p]; iq = node_index[q]
            A[ip, iq] -= g
            A[iq, ip] -= g
        end
    end

    # 电流源贡献：按约定电流方向 pos → neg
    # KCL采用“流出为正”的系数写法，因此：
    # 在 pos 节点，电流源使 b[pos] -= I（电流流出pos）；在 neg 节点，b[neg] += I（电流流入neg）
    for s in isources
        Ival = s.parameters["dc"]
        p = s.connections["pos"]
        q = s.connections["neg"]
        if p != ground_name
            b[node_index[p]] -= Ival
        end
        if q != ground_name
            b[node_index[q]] += Ival
        end
    end

    # 电压源贡献：为每个电压源引入一个未知电流 Iv
    # - 对应的KCL：在 pos 行 +Iv，在 neg 行 -Iv
    # - 约束行：V(pos) - V(neg) = V
    for (k, vsrc) in enumerate(vsrc_rows)
        p = vsrc.connections["pos"]
        q = vsrc.connections["neg"]
        row = n + k
        if p != ground_name
            A[node_index[p], n + k] += 1.0
            A[row, node_index[p]] += 1.0
        end
        if q != ground_name
            A[node_index[q], n + k] -= 1.0
            A[row, node_index[q]] -= 1.0
        end
        if vsrc.type == "vsource_dc"
            b[row] = vsrc.parameters["dc"]
        elseif vsrc.type == "vcvs"
            g = Float64(vsrc.parameters["gain"]) 
            cp = vsrc.connections["ctrl_p"]
            cn = vsrc.connections["ctrl_n"]
            if cp != ground_name
                A[row, node_index[cp]] -= g
            end
            if cn != ground_name
                A[row, node_index[cn]] += g
            end
        elseif vsrc.type == "ccvs"
            r = Float64(vsrc.parameters["gain"]) 
            cp = vsrc.connections["ctrl_p"]; cn = vsrc.connections["ctrl_n"]
            sense_id = "_sense_ccvs_" * vsrc.id
            cnt, has_ind = vsrc_stats_between(cp, cn)
            vid, sign = find_vsrc_between(cp, cn)
            if vid !== nothing && !(has_ind && cnt > 1)
                j = vsrc_index[vid]
                A[row, n + j] -= r * sign
            elseif haskey(vsrc_index, sense_id)
                j = vsrc_index[sense_id]
                A[row, n + j] -= r
            end
        end
    end
    
    for f in cccs_list
        g = Float64(f.parameters["gain"]) 
        pos = f.connections["pos"]
        neg = f.connections["neg"]
        cp = f.connections["ctrl_p"]; cn = f.connections["ctrl_n"]
        sense_id = "_sense_cccs_" * f.id
        cnt, has_ind = vsrc_stats_between(cp, cn)
        vid, sign = find_vsrc_between(cp, cn)
        if vid !== nothing && !(has_ind && cnt > 1)
            j = vsrc_index[vid]
            if pos != ground_name
                A[node_index[pos], n + j] += g * sign
            end
            if neg != ground_name
                A[node_index[neg], n + j] -= g * sign
            end
        elseif haskey(vsrc_index, sense_id)
            j = vsrc_index[sense_id]
            if pos != ground_name
                A[node_index[pos], n + j] += g
            end
            if neg != ground_name
                A[node_index[neg], n + j] -= g
            end
        end
    end
    # VCCS 贡献（受控电流源）：i_out = g * (V(ctrl_p) - V(ctrl_n))，方向 pos → neg
    # MNA/节点电压法标准“跨导”戳记：
    #   A[pos, ctrl_p] += g
    #   A[pos, ctrl_n] -= g
    #   A[neg, ctrl_p] -= g
    #   A[neg, ctrl_n] += g
    for gcs in vccs_list
        g = Float64(gcs.parameters["gain"])
        pos = gcs.connections["pos"]
        neg = gcs.connections["neg"]
        cp = gcs.connections["ctrl_p"]
        cn = gcs.connections["ctrl_n"]

        if pos != ground_name
            ip = node_index[pos]
            if cp != ground_name
                A[ip, node_index[cp]] += g
            end
            if cn != ground_name
                A[ip, node_index[cn]] -= g
            end
        end
        if neg != ground_name
            ineg = node_index[neg]
            if cp != ground_name
                A[ineg, node_index[cp]] -= g
            end
            if cn != ground_name
                A[ineg, node_index[cn]] += g
            end
        end
    end

    
    
    pair_map = Dict{Tuple{String,String}, Vector{Int}}()
    for (k, vsrc) in enumerate(vsrc_rows)
        p = vsrc.connections["pos"]
        q = vsrc.connections["neg"]
        key = p < q ? (p, q) : (q, p)
        rows = get(pair_map, key, Int[])
        push!(rows, n + k)
        pair_map[key] = rows
    end
    for (_, rows) in pair_map
        if length(rows) > 1
            for idx in 2:length(rows)
                rr = rows[idx]
                A[rr, rr] += 1e-12
            end
        end
    end

    
    
    x = nothing
    solved = false
    try
        x = A \ b
        solved = true
    catch err
        if err isa LinearAlgebra.SingularException
            for i in 1:n
                A[i, i] += 1e-12
            end
            for j in 1:m
                A[n + j, n + j] += 1e-12
            end
            try
                x = A \ b
                solved = true
            catch err2
                if err2 isa LinearAlgebra.SingularException
                    x = pinv(A) * b
                    solved = true
                else
                    rethrow(err2)
                end
            end
        else
            rethrow(err)
        end
    end

    # 5) 整理结果
    node_voltages = Dict("gnd" => 0.0)
    # 若实际地线网络名不是 "gnd"，同时填充原名的电压为 0.0，便于前端映射
    if ground_name != "gnd"
        node_voltages[ground_name] = 0.0
    end
    for (i, node) in enumerate(nodes)
        node_voltages[node] = x[i]
    end

    branch_currents = Dict{String, Float64}()
    # 电阻电流（p → n）
    for r in resistors
        R = r.parameters["value"]
        vp = get(node_voltages, r.connections["p"], 0.0)
        vq = get(node_voltages, r.connections["n"], 0.0)
        branch_currents[r.id] = (vp - vq) / R
    end
    # 电压源电流（定义为 pos → neg 的电流）
    for (k, vsrc) in enumerate(vsrc_rows)
        if vsrc.type == "vsource_dc" || vsrc.type == "vcvs" || vsrc.type == "ccvs"
            if !startswith(vsrc.id, "_sense_ccvs_") && !startswith(vsrc.id, "_sense_cccs_")
                branch_currents[vsrc.id] = x[n + k]
            end
        end
    end
    for f in cccs_list
        cp = f.connections["ctrl_p"]; cn = f.connections["ctrl_n"]
        sense_id = "_sense_cccs_" * f.id
        vid, sign = find_vsrc_between(cp, cn)
        if vid !== nothing
            j = vsrc_index[vid]
            g = Float64(f.parameters["gain"]) 
            branch_currents[f.id] = g * sign * x[n + j]
        elseif haskey(vsrc_index, sense_id)
            j = vsrc_index[sense_id]
            g = Float64(f.parameters["gain"]) 
            branch_currents[f.id] = g * x[n + j]
        end
    end
    # 电流源电流（约定方向 pos → neg）
    for s in isources
        branch_currents[s.id] = s.parameters["dc"]
    end

    # 6) 教学模式
    steps = String[]
    matrices = Dict{String, Any}()
    if payload.teaching_mode === true
        push!(steps, "Step 1: 识别非地节点并建立索引")
        push!(steps, "  非地节点: $(join(nodes, ", "))")
        push!(steps, "Step 2: 构建MNA矩阵 A 与向量 b")
        push!(steps, "  未知量 = 节点电压($(n)) + 电压源支路电流($(m))")
        A_disp = [[round(A[i,j], digits=6) for j in 1:(n+m)] for i in 1:(n+m)]
        b_disp = [round(b[i], digits=6) for i in 1:(n+m)]
        matrices["A"] = A_disp
        matrices["b"] = b_disp
        push!(steps, "Step 3: 求解 A x = b，得到节点电压与电压源电流")
        V_disp = [round(x[i], digits=6) for i in 1:n]
        Iv_disp = [round(x[n+i], digits=6) for i in 1:m]
        matrices["V"] = V_disp
        matrices["Iv"] = Iv_disp
        push!(steps, "Step 4: 计算支路电流（电阻: (V_p - V_n)/R，电压源: Iv，电流源: 额定值）")
    end

    result = Dict{String, Any}(
        "node_voltages" => node_voltages,
        "branch_currents" => branch_currents,
    )
    if payload.teaching_mode === true
        result["steps"] = steps
        result["matrices"] = matrices
    end
    return result
end

"""
    transform_payload_for_dc_op(payload::SimulationPayload)

直流工作点（DC OP）的 payload 变换：
- 电容开路：直接从元件列表移除；
- 电感短路：替换为同 id 的 0V 直流电压源，其支路电流即电感直流电流
  （经 MNA 扩展变量自然出现在 branch_currents[原id]，方向 p→n）；
- 交流源置于直流分量：vsource_ac → vsource_dc（dc = 可选参数 offset，缺省 0），
  isource_ac → isource_dc 同理；
- 其余元件（电阻/直流源/受控源/探针/地）原样保留（受控源是线性的，MNA 已支持）。
变换后的 payload 可直接交给 solve_by_node_voltage 求解。
"""
function transform_payload_for_dc_op(payload::SimulationPayload)
    dc_supported = Set([
        "resistor", "vsource_dc", "isource_dc", "ground", "voltage_probe", "current_probe",
        "vccs", "vcvs", "ccvs", "cccs", "capacitor", "inductor", "vsource_ac", "isource_ac",
    ])
    for comp in payload.components
        comp.type in dc_supported ||
            throw(ValidationError("直流工作点分析暂不支持元件类型: $(comp.type)", Dict("component" => comp.id, "type" => comp.type)))
    end

    transformed = ComponentPayload[]
    for comp in payload.components
        if comp.type == "capacitor"
            require_connections(comp, ["p", "n"])
            continue  # 电容开路：移除
        elseif comp.type == "inductor"
            require_connections(comp, ["p", "n"])
            push!(transformed, ComponentPayload(
                comp.id, "vsource_dc", Dict("dc" => 0.0),
                Dict("pos" => comp.connections["p"], "neg" => comp.connections["n"]),
            ))
        elseif comp.type == "vsource_ac"
            require_connections(comp, ["pos", "neg"])
            dc = Float64(get(comp.parameters, "offset", 0.0))
            push!(transformed, ComponentPayload(comp.id, "vsource_dc", Dict("dc" => dc), copy(comp.connections)))
        elseif comp.type == "isource_ac"
            require_connections(comp, ["pos", "neg"])
            dc = Float64(get(comp.parameters, "offset", 0.0))
            push!(transformed, ComponentPayload(comp.id, "isource_dc", Dict("dc" => dc), copy(comp.connections)))
        else
            push!(transformed, comp)
        end
    end
    return SimulationPayload(transformed, payload.nets, payload.sim, "node_voltage", payload.thevenin_port, payload.teaching_mode)
end

"""
    solve_by_dc_op(payload::SimulationPayload)

直流工作点分析：电容开路、电感短路、交流源置于其直流分量后，
复用节点电压法（MNA）求解。响应形状与 node_voltage 完全一致。
"""
function solve_by_dc_op(payload::SimulationPayload)
    return solve_by_node_voltage(transform_payload_for_dc_op(payload))
end

"""
    solve_by_ac_phasor(payload::SimulationPayload)

单频正弦稳态相量分析（独立的复数 MNA，不复用/不修改 solve_by_node_voltage）：
- 导纳：R → 1/R，C → jωC，L → 1/(jωL)；
- vsource_ac 相量 = amplitude∠phase（可选参数 phase，单位为度，缺省 0）；isource_ac 同理；
- 直流源按叠加原理置零：vsource_dc → 0V 短路（保留支路电流扩展变量），isource_dc → 开路；
- 电压探针不改变电路；电流探针 = 0V 复数电压源（支路电流为 MNA 扩展变量，方向 p→n）；
- 所有交流源频率必须一致；受控源（vcvs/vccs/ccvs/cccs）暂不支持；
- 输出：节点电压/支路电流的幅值（node_voltages/branch_currents）与相角（度，
  node_phases_deg/branch_phases_deg），外加 frequency_hz。
"""
function solve_by_ac_phasor(payload::SimulationPayload)
    for comp in payload.components
        if comp.type in ("vcvs", "vccs", "ccvs", "cccs")
            throw(ValidationError("AC 相量分析暂不支持受控源", Dict("component" => comp.id, "type" => comp.type)))
        end
    end
    supported = Set([
        "resistor", "capacitor", "inductor", "vsource_dc", "isource_dc",
        "vsource_ac", "isource_ac", "ground", "voltage_probe", "current_probe",
    ])
    for comp in payload.components
        comp.type in supported ||
            throw(ValidationError("AC 相量分析暂不支持元件类型: $(comp.type)", Dict("component" => comp.id, "type" => comp.type)))
        schema = COMPONENT_SCHEMAS[comp.type]
        require_connections(comp, schema.handles)
    end

    # 频率校验：至少一个交流源，且全部频率一致
    ac_sources = [c for c in payload.components if c.type in ("vsource_ac", "isource_ac")]
    isempty(ac_sources) &&
        throw(ValidationError("AC 相量分析需要至少一个交流源（vsource_ac / isource_ac）", Dict()))
    freqs = [require_parameter(c, "frequency") for c in ac_sources]
    f = freqs[1]
    all(x -> x == f, freqs) ||
        throw(ValidationError("交流源频率不一致：AC 相量分析要求所有交流源频率相同", Dict("frequencies" => freqs)))
    f > 0.0 ||
        throw(ValidationError("交流源频率必须大于 0", Dict("frequency" => f)))
    omega = 2.0 * pi * f

    # 地节点识别（与 solve_by_node_voltage 保持一致的规则）
    ground_nets = Set{String}()
    for comp in payload.components
        if comp.type == "ground" && haskey(comp.connections, "gnd")
            push!(ground_nets, comp.connections["gnd"])
        end
    end
    declared_gnd = any(net.name == "gnd" for net in payload.nets)
    ground_name = declared_gnd ? "gnd" : (isempty(ground_nets) ? nothing : first(ground_nets))
    if ground_name === nothing
        throw(ValidationError("缺少地线节点", Dict()))
    end
    if length(ground_nets) > 1 && !declared_gnd
        throw(ValidationError("存在多个地线且连接到不同网络", Dict("ground_nets" => collect(ground_nets))))
    end

    all_nodes = Set{String}()
    for net in payload.nets
        net.name != ground_name && push!(all_nodes, net.name)
    end
    nodes = sort(collect(all_nodes))
    n = length(nodes)
    node_index = Dict(node => i for (i, node) in enumerate(nodes))

    # 交流源相量：amplitude∠phase（phase 单位为度，缺省 0）
    function ac_source_phasor(comp::ComponentPayload)
        amplitude = require_parameter(comp, "amplitude")
        phase_deg = Float64(get(comp.parameters, "phase", 0.0))
        return amplitude * cis(deg2rad(phase_deg))
    end

    # R/C/L 复导纳
    function rcl_admittance(comp::ComponentPayload)
        value = require_parameter(comp, "value")
        if comp.type == "resistor"
            return ComplexF64(1.0 / value)
        elseif comp.type == "capacitor"
            return im * omega * value
        else  # inductor
            return 1.0 / (im * omega * value)
        end
    end

    # 电压源行：vsource_ac（相量值）、vsource_dc（置零 → 0V 短路）、current_probe（0V 理想电流表）
    vsrc_rows = Tuple{String, String, String, ComplexF64}[]
    for comp in payload.components
        if comp.type == "vsource_ac"
            push!(vsrc_rows, (comp.id, comp.connections["pos"], comp.connections["neg"], ac_source_phasor(comp)))
        elseif comp.type == "vsource_dc"
            push!(vsrc_rows, (comp.id, comp.connections["pos"], comp.connections["neg"], ComplexF64(0.0)))
        elseif comp.type == "current_probe"
            push!(vsrc_rows, (comp.id, comp.connections["p"], comp.connections["n"], ComplexF64(0.0)))
        end
    end
    m = length(vsrc_rows)

    A = zeros(ComplexF64, n + m, n + m)
    b = zeros(ComplexF64, n + m)

    # R/C/L 导纳戳记
    for comp in payload.components
        comp.type in ("resistor", "capacitor", "inductor") || continue
        y = rcl_admittance(comp)
        p = comp.connections["p"]
        q = comp.connections["n"]
        if p != ground_name
            A[node_index[p], node_index[p]] += y
        end
        if q != ground_name
            A[node_index[q], node_index[q]] += y
        end
        if p != ground_name && q != ground_name
            A[node_index[p], node_index[q]] -= y
            A[node_index[q], node_index[p]] -= y
        end
    end

    # 交流电流源：方向 pos → neg（isource_dc 置零 → 开路，不参与）
    for comp in payload.components
        comp.type == "isource_ac" || continue
        Iph = ac_source_phasor(comp)
        p = comp.connections["pos"]
        q = comp.connections["neg"]
        p != ground_name && (b[node_index[p]] -= Iph)
        q != ground_name && (b[node_index[q]] += Iph)
    end

    # 电压源扩展变量：KCL 中 pos 行 +Iv、neg 行 -Iv；约束行 V(pos) - V(neg) = 相量值
    for (k, (_, p, q, value)) in enumerate(vsrc_rows)
        row = n + k
        if p != ground_name
            A[node_index[p], row] += 1.0
            A[row, node_index[p]] += 1.0
        end
        if q != ground_name
            A[node_index[q], row] -= 1.0
            A[row, node_index[q]] -= 1.0
        end
        b[row] = value
    end

    x = try
        A \ b
    catch err
        throw(ValidationError(
            "交流相量分析求解失败（电路矩阵奇异或病态）",
            Dict("code" => "LAB_SIM_FAILED", "error" => string(err)),
        ))
    end
    all(isfinite, x) ||
        throw(ValidationError("交流相量分析求解失败（结果包含 NaN/Inf）", Dict("code" => "LAB_SIM_FAILED")))

    # 整理结果：节点电压相量
    voltage_phasors = Dict{String, ComplexF64}("gnd" => 0.0)
    if ground_name != "gnd"
        voltage_phasors[ground_name] = 0.0
    end
    for (i, node) in enumerate(nodes)
        voltage_phasors[node] = x[i]
    end

    # 支路电流相量（方向约定与 DC 路径一致：R/C/L 为 p→n，源为 pos→neg）
    current_phasors = Dict{String, ComplexF64}()
    for comp in payload.components
        if comp.type in ("resistor", "capacitor", "inductor")
            vp = get(voltage_phasors, comp.connections["p"], ComplexF64(0.0))
            vq = get(voltage_phasors, comp.connections["n"], ComplexF64(0.0))
            current_phasors[comp.id] = (vp - vq) * rcl_admittance(comp)
        elseif comp.type == "isource_ac"
            current_phasors[comp.id] = ac_source_phasor(comp)
        elseif comp.type == "isource_dc"
            current_phasors[comp.id] = ComplexF64(0.0)
        end
    end
    for (k, (id, _, _, _)) in enumerate(vsrc_rows)
        current_phasors[id] = x[n + k]
    end

    node_voltages = Dict{String, Float64}(node => abs(v) for (node, v) in voltage_phasors)
    node_phases = Dict{String, Float64}(node => rad2deg(angle(v)) for (node, v) in voltage_phasors)
    branch_currents = Dict{String, Float64}(id => abs(i) for (id, i) in current_phasors)
    branch_phases = Dict{String, Float64}(id => rad2deg(angle(i)) for (id, i) in current_phasors)

    return Dict{String, Any}(
        "frequency_hz" => f,
        "node_voltages" => node_voltages,
        "branch_currents" => branch_currents,
        "node_phases_deg" => node_phases,
        "branch_phases_deg" => branch_phases,
    )
end

"""
    compute_thevenin_equivalent(payload::SimulationPayload, port_pos::String, port_neg::String)

计算戴维南等效电路
- port_pos: 正端节点名称
- port_neg: 负端节点名称（通常是"gnd"）

返回：
- vth: 戴维南电压（开路电压）
- rth: 戴维南电阻（等效电阻）
"""
function compute_thevenin_equivalent(payload::SimulationPayload, port_pos::String, port_neg::String)
    # 验证是否为纯电阻电路
    is_resistive_circuit(payload) ||
        throw(ValidationError("戴维南等效仅适用于纯电阻电路", Dict()))
    
    # 步骤1：计算开路电压 Vth（使用节点电压法）
    result = solve_by_node_voltage(payload)
    node_voltages = result["node_voltages"]
    
    # 开路电压 = V_pos - V_neg
    v_pos = get(node_voltages, port_pos, 0.0)
    v_neg = get(node_voltages, port_neg, 0.0)
    vth = v_pos - v_neg
    
    # 步骤2：计算等效电阻 Rth（短路电流法）
    # 在端口处添加一个短路（电阻值很小），计算短路电流
    # Rth = Vth / Isc
    
    # 创建修改后的payload（在端口间添加短路电阻）
    modified_components = copy(payload.components)
    short_circuit_id = "_thevenin_short"
    short_resistor = ComponentPayload(
        short_circuit_id,
        "resistor",
        Dict("value" => 1e-6),  # 很小的电阻模拟短路
        Dict("p" => port_pos, "n" => port_neg)
    )
    push!(modified_components, short_resistor)
    
    modified_payload = SimulationPayload(
        modified_components,
        payload.nets,
        payload.sim,
        "node_voltage",
        nothing,  # thevenin_port 在短路测试时不需要
        nothing   # teaching_mode
    )
    
    # 计算短路情况下的电流
    short_result = solve_by_node_voltage(modified_payload)
    isc = get(short_result["branch_currents"], short_circuit_id, 0.0)
    
    # 计算等效电阻
    rth = if abs(isc) > 1e-12
        vth / isc
    else
        # 如果短路电流为0，说明是开路，电阻为无穷大
        1e12
    end
    
    return Dict(
        "vth" => vth,
        "rth" => rth,
        "port" => Dict("positive" => port_pos, "negative" => port_neg)
    )
end

"""
    solve_by_branch_current(payload::SimulationPayload)

使用支路电流法求解纯电阻直流电路
支路电流法：实际上就是节点电压法的另一种形式
为了简化实现，这里直接复用节点电压法，但返回格式符合支路电流法
"""
function solve_by_branch_current(payload::SimulationPayload)
    # 验证是否为纯电阻电路
    is_resistive_circuit(payload) ||
        throw(ValidationError("支路电流法仅适用于纯电阻电路", Dict()))
    
    resistors = [c for c in payload.components if c.type == "resistor"]
    voltage_sources = [c for c in payload.components if c.type == "vsource_dc"]
    current_sources = [c for c in payload.components if c.type == "isource_dc"]
    
    # 获取所有节点（除了地线）
    all_nodes = Set{String}(["gnd"])
    for net in payload.nets
        push!(all_nodes, net.name)
    end
    delete!(all_nodes, "gnd")
    nodes = sort(collect(all_nodes))
    n_nodes = length(nodes)
    
    # 定义所有支路
    branches = vcat(resistors, voltage_sources, current_sources)
    n_branches = length(branches)
    
    # 教学模式：生成求解步骤
    steps = String[]
    matrices_data = Dict{String, Any}()
    
    if !isnothing(payload.teaching_mode) && payload.teaching_mode === true
        push!(steps, "Step 1: 识别电路中的支路和节点")
        push!(steps, "  非地节点: $(join(nodes, ", "))")
        push!(steps, "  节点数量: $n_nodes")
        push!(steps, "  支路数量: $n_branches")
        push!(steps, "")
        
        push!(steps, "Step 2: 为每条支路定义电流变量（参考方向）")
        for (i, branch) in enumerate(branches)
            if branch.type == "resistor"
                push!(steps, "  I$i ($(branch.id)): R=$(branch.parameters["value"])Ω, 方向从p到n")
            elseif branch.type == "vsource_dc"
                push!(steps, "  I$i ($(branch.id)): V=$(branch.parameters["dc"])V, 方向从pos到neg")
            elseif branch.type == "isource_dc"
                push!(steps, "  I$i ($(branch.id)): I=$(branch.parameters["dc"])A (已知值)")
            end
        end
        push!(steps, "")
        
        push!(steps, "Step 3: 对每个节点应用KCL（流入=流出）")
    end
    
    # 构建方程组: A * I = B
    # 其中 I 是支路电流向量
    A = zeros(Float64, n_branches, n_branches)
    B = zeros(Float64, n_branches)
    eq_idx = 0
    
    # 构建完整的支路电流法方程组
    # 1. KCL方程：对每个非地节点
    # 2. KVL方程：对每个独立回路
    
    # 初始化系数矩阵A和右侧向量B
    # 方程组形式：A * I = B
    # 其中I是支路电流向量
    A = zeros(Float64, n_branches, n_branches)
    B = zeros(Float64, n_branches)
    
    # KCL方程：对每个非地节点
    # 构建方程组字符串用于教学展示
    equation_strings = Dict{String, String}()
    kcl_equations_count = 0
    
    for node in nodes
        kcl_equations_count += 1
        eq_idx = kcl_equations_count
        
        if eq_idx > n_branches
            break
        end
        
        # 为每个节点构建KCL方程字符串
        terms = String[]
        
        if !isnothing(payload.teaching_mode) && payload.teaching_mode === true
            push!(steps, "  节点 $node 的KCL方程:")
        end
        
        # 找出连接到这个节点的所有支路
        for (i, branch) in enumerate(branches)
            connects = false
            sign = 0.0  # +1: 流入节点, -1: 流出节点
            
            if branch.type in ["resistor"]
                # 检查p端
                for net in payload.nets
                    if net.name == node
                        for (comp_id, handle) in parse_net_nodes(net)
                            if comp_id == branch.id && handle == "p"
                                connects = true
                                sign = -1.0  # 电流从p流出
                            elseif comp_id == branch.id && handle == "n"
                                connects = true
                                sign = 1.0   # 电流流入n
                            end
                        end
                    end
                end
            elseif branch.type == "vsource_dc"
                for net in payload.nets
                    if net.name == node
                        for (comp_id, handle) in parse_net_nodes(net)
                            if comp_id == branch.id && handle == "pos"
                                connects = true
                                sign = -1.0  # 电流从pos流出
                            elseif comp_id == branch.id && handle == "neg"
                                connects = true
                                sign = 1.0   # 电流流入neg
                            end
                        end
                    end
                end
            elseif branch.type == "isource_dc"
                for net in payload.nets
                    if net.name == node
                        for (comp_id, handle) in parse_net_nodes(net)
                            if comp_id == branch.id && handle == "pos"
                                connects = true
                                sign = -1.0
                            elseif comp_id == branch.id && handle == "neg"
                                connects = true
                                sign = 1.0
                            end
                        end
                    end
                end
            end
            
            if connects
                A[eq_idx, i] = sign
                if !isnothing(payload.teaching_mode) && payload.teaching_mode === true
                    dir = sign > 0 ? "流入" : "流出"
                    push!(steps, "    I$i ($dir, 系数$(sign))")
                end
                
                # 构建方程项
                if sign == 1.0
                    push!(terms, "+I$i")
                elseif sign == -1.0
                    push!(terms, "-I$i")
                end
            end
        end
        
        # 保存方程字符串
        if !isempty(terms)
            equation_strings[node] = join(terms, " ") * " = 0"
        end
    end
    
    # 在教学模式下显示完整的KCL方程组
    if !isnothing(payload.teaching_mode) && payload.teaching_mode === true && !isempty(equation_strings)
        push!(steps, "")
        push!(steps, "  完整的KCL方程组:")
        for (node, equation) in equation_strings
            push!(steps, "    节点 $node: $equation")
        end
    end
    
    # KVL方程：对独立回路（简化处理，使用节点电压法辅助）
    if !isnothing(payload.teaching_mode) && payload.teaching_mode === true
        push!(steps, "")
        push!(steps, "Step 4: 对独立回路应用KVL（电压降之和=0）")
        push!(steps, "  说明：完整实现需要图论算法识别独立回路")
        push!(steps, "  简化：使用节点电压法结果构建KVL方程")
    end
    
    # 使用节点电压法获取辅助结果，然后构建完整的支路电流
    # 在实际完整实现中，这里应该：
    # 1. 识别独立回路
    # 2. 对每个回路应用KVL构建方程
    # 3. 与KCL方程组合成完整方程组
    # 4. 求解方程组得到支路电流
    node_result = solve_by_node_voltage(payload)
    node_voltages = node_result["node_voltages"]
    # 直接继承 MNA 全部支路电流（含电压源/受控源/电流探针），下方循环仅按公式覆写电阻与电流源
    branch_currents = copy(node_result["branch_currents"])
    
    # 继承节点电压法的矩阵数据
    if !isnothing(payload.teaching_mode) && payload.teaching_mode === true && haskey(node_result, "matrices")
        matrices_data = node_result["matrices"]
    end
    
    # 计算每条支路的电流（基于节点电压法结果）
    for branch in branches
        if branch.type == "resistor"
            # 找到支路两端的节点
            node_p = ""
            node_n = ""
            for net in payload.nets
                for (comp_id, handle) in parse_net_nodes(net)
                    if comp_id == branch.id
                        if handle == "p"
                            node_p = net.name
                        elseif handle == "n"
                            node_n = net.name
                        end
                    end
                end
            end
            
            R = branch.parameters["value"]
            v_p = get(node_voltages, node_p, 0.0)
            v_n = get(node_voltages, node_n, 0.0)
            i = (v_p - v_n) / R
            branch_currents[branch.id] = i
        elseif branch.type == "vsource_dc"
            # 电压源支路电流来自 MNA 扩展变量（solve_by_node_voltage 已算出），不可硬编码为 0
            branch_currents[branch.id] = get(node_result["branch_currents"], branch.id, 0.0)
        elseif branch.type == "isource_dc"
            branch_currents[branch.id] = branch.parameters["dc"]
        end
    end
    
    # 计算每条支路的电流
    for branch in branches
        if branch.type == "resistor"
            # 找到支路两端的节点
            node_p = ""
            node_n = ""
            for net in payload.nets
                for (comp_id, handle) in parse_net_nodes(net)
                    if comp_id == branch.id
                        if handle == "p"
                            node_p = net.name
                        elseif handle == "n"
                            node_n = net.name
                        end
                    end
                end
            end
            
            R = branch.parameters["value"]
            v_p = get(node_voltages, node_p, 0.0)
            v_n = get(node_voltages, node_n, 0.0)
            i = (v_p - v_n) / R
            branch_currents[branch.id] = i
        elseif branch.type == "vsource_dc"
            # 电压源支路电流来自 MNA 扩展变量（solve_by_node_voltage 已算出），不可硬编码为 0
            branch_currents[branch.id] = get(node_result["branch_currents"], branch.id, 0.0)
        elseif branch.type == "isource_dc"
            branch_currents[branch.id] = branch.parameters["dc"]
        end
    end
    
    if !isnothing(payload.teaching_mode) && payload.teaching_mode === true
        push!(steps, "")
        push!(steps, "Step 5: 求解方程组得到支路电流")
        for (branch_id, current) in sort(collect(branch_currents))
            push!(steps, "  $(branch_id): $(round(current, digits=6))A")
        end
    end
    
    result = Dict{String, Any}(
        "branch_currents" => branch_currents,
        "node_voltages" => node_voltages
    )
    
    if length(steps) > 0
        result["steps"] = steps
    end
    
    # 添加矩阵数据（如果存在）
    if !isempty(matrices_data)
        result["matrices"] = matrices_data
    end
    
    return result
end

"""
    solve_by_mesh_current(payload::SimulationPayload)

使用网孔电流法求解纯电阻直流电路
网孔电流法步骤：
1. 识别所有独立网孔（平面图）
2. 为每个网孔设置电流变量
3. 对每个网孔列写KVL方程
4. 求解网孔电流
5. 从网孔电流计算支路电流和节点电压

注意：网孔电流法的完整实现需要图论算法识别独立网孔。
为简化实现，这里采用与支路电流法相同的策略，使用节点电压法求解。
在教学场景中，可以手动指定网孔并验证结果。
"""
function solve_by_mesh_current(payload::SimulationPayload)
    # 验证是否为纯电阻电路
    is_resistive_circuit(payload) ||
        throw(ValidationError("网孔电流法仅适用于纯电阻电路", Dict()))
    
    resistors = [c for c in payload.components if c.type == "resistor"]
    voltage_sources = [c for c in payload.components if c.type == "vsource_dc"]
    current_sources = [c for c in payload.components if c.type == "isource_dc"]
    
    # 获取所有节点（除了地线）
    all_nodes = Set{String}(["gnd"])
    for net in payload.nets
        push!(all_nodes, net.name)
    end
    delete!(all_nodes, "gnd")
    nodes = sort(collect(all_nodes))
    n_nodes = length(nodes)
    
    # 定义所有支路
    branches = vcat(resistors, voltage_sources, current_sources)
    n_branches = length(branches)
    
    # 教学模式：生成求解步骤
    steps = String[]
    matrices_data = Dict{String, Any}()
    
    if !isnothing(payload.teaching_mode) && payload.teaching_mode === true
        push!(steps, "Step 1: 识别电路拓扑结构")
        push!(steps, "  非地节点: $(join(nodes, ", "))")
        push!(steps, "  节点数量: $n_nodes")
        push!(steps, "  支路数量: $n_branches")
        push!(steps, "")
        
        # 根据欧拉公式: 网孔数 = 支路数 - 节点数 + 1
        n_meshes = n_branches - n_nodes
        push!(steps, "Step 2: 计算网孔数量（使用欧拉公式）")
        push!(steps, "  网孔数 = 支路数 - 节点数 + 1")
        push!(steps, "  网孔数 = $n_branches - $n_nodes + 1 = $(n_meshes + 1)")
        push!(steps, "")
        
        push!(steps, "Step 3: 定义网孔电流（顺时针方向）")
        for i in 1:(n_meshes + 1)
            push!(steps, "  网孔 $i: Im$i")
        end
        push!(steps, "")
        
        push!(steps, "Step 4: 对每个网孔应用KVL（电压降之和 = 电压升之和）")
        push!(steps, "  说明：完整实现需要图论算法识别独立网孔")
        push!(steps, "  简化：使用节点电压法结果构建KVL方程")
        push!(steps, "  KVL方程组示例（基于网孔电流方向）:")
        for i in 1:(n_meshes + 1)
            push!(steps, "    网孔 $i: Σ(电阻×网孔电流) = Σ电压源")
        end
        push!(steps, "")
    end
    
    # 完整的网孔电流法需要：
    # 1. 构建电路图的邻接表
    # 2. 识别所有基本回路（使用DFS找环）
    # 3. 构建网孔阻抗矩阵 R_mesh
    # 4. 构建网孔电压向量 V_mesh
    # 5. 求解: R_mesh * I_mesh = V_mesh
    # 6. 从网孔电流计算支路电流
    # 
    # 在实际完整实现中，这里应该：
    # 1. 识别所有网孔（独立回路）
    # 2. 对每个网孔应用KVL构建方程
    # 3. 求解方程组得到网孔电流
    # 4. 从网孔电流计算支路电流
    
    # 由于完整的网孔识别算法复杂，这里使用节点电压法结果
    node_result = solve_by_node_voltage(payload)
    node_voltages = node_result["node_voltages"]
    # 直接继承 MNA 全部支路电流（含电压源/受控源/电流探针），下方循环仅按公式覆写电阻与电流源
    branch_currents = copy(node_result["branch_currents"])
    
    # 继承节点电压法的矩阵数据
    if !isnothing(payload.teaching_mode) && payload.teaching_mode === true && haskey(node_result, "matrices")
        matrices_data = node_result["matrices"]
    end
    
    # 计算每条支路的电流
    for branch in branches
        if branch.type == "resistor"
            # 找到支路两端的节点
            node_p = ""
            node_n = ""
            for net in payload.nets
                for (comp_id, handle) in parse_net_nodes(net)
                    if comp_id == branch.id
                        if handle == "p"
                            node_p = net.name
                        elseif handle == "n"
                            node_n = net.name
                        end
                    end
                end
            end
            
            R = branch.parameters["value"]
            v_p = get(node_voltages, node_p, 0.0)
            v_n = get(node_voltages, node_n, 0.0)
            i = (v_p - v_n) / R
            branch_currents[branch.id] = i
        elseif branch.type == "vsource_dc"
            # 电压源支路电流来自 MNA 扩展变量（solve_by_node_voltage 已算出），不可硬编码为 0
            branch_currents[branch.id] = get(node_result["branch_currents"], branch.id, 0.0)
        elseif branch.type == "isource_dc"
            branch_currents[branch.id] = branch.parameters["dc"]
        end
    end
    
    if !isnothing(payload.teaching_mode) && payload.teaching_mode === true
        push!(steps, "Step 5: 求解得到支路电流")
        for (branch_id, current) in sort(collect(branch_currents))
            push!(steps, "  $(branch_id): $(round(current, digits=6))A")
        end
    end
    
    result = Dict{String, Any}(
        "branch_currents" => branch_currents,
        "node_voltages" => node_voltages
    )
    
    if length(steps) > 0
        result["steps"] = steps
    end
    
    # 添加矩阵数据（如果存在）
    if !isempty(matrices_data)
        result["matrices"] = matrices_data
    end
    
    return result
end

function simulate_payload(payload::SimulationPayload)
    payload.sim.t_stop > 0 ||
        throw(ValidationError("仿真时长必须大于 0", Dict()))
    payload.sim.n_samples > 1 ||
        throw(ValidationError("采样点数至少为 2", Dict()))
    !isempty(payload.components) ||
        throw(ValidationError("电路为空", Dict()))

    has_ground = any(component.type == "ground" for component in payload.components)
    # 独立源应包含电压源与电流源（直流/交流）
    has_source = any(component.type in ("vsource_dc", "vsource_ac", "isource_dc", "isource_ac") for component in payload.components)
    has_ground || throw(ValidationError("circuit has no ground", Dict("missing" => ["ground"])))
    has_source || throw(ValidationError("circuit has no source", Dict("missing" => ["source"])))

    systems = ODESystem[]
    connections = Equation[]
    handle_lookup = Dict{Tuple{String, String}, Any}()
    measurements = Vector{NamedTuple{(:id, :label, :expr), Tuple{String, String, Any}}}()

    for component in payload.components
        instance = instantiate_component(component)
        push!(systems, instance.system)
        append!(systems, instance.extra_systems)
        append!(connections, instance.extra_equations)
        for (handle, connector) in instance.handles
            handle_lookup[(component.id, handle)] = connector
        end
        if instance.measurement !== nothing
            push!(measurements, instance.measurement)
        end
    end

    isempty(payload.nets) && throw(ValidationError("未提供任何网络连接", Dict()))

    for net in payload.nets
        nodes = parse_net_nodes(net)
        length(nodes) >= 2 ||
            throw(ValidationError("网络端子数量不足", Dict("net" => net.name)))
        first_node = nodes[1]
        base = get(handle_lookup, first_node, nothing)
        base === nothing &&
            throw(ValidationError("找不到端子", Dict("component" => first_node[1], "handle" => first_node[2])))
        for idx in 2:lastindex(nodes)
            node = nodes[idx]
            connector = get(handle_lookup, node, nothing)
            connector === nothing &&
                throw(ValidationError("找不到端子", Dict("component" => node[1], "handle" => node[2])))
            # 仅允许连接器(ODESystem)参与网络连接，避免 Symbolics 内部异常
            if !(base isa ModelingToolkit.ODESystem && connector isa ModelingToolkit.ODESystem)
                throw(ValidationError(
                    "网络连接包含非连接器端子",
                    Dict(
                        "base_component" => first_node[1],
                        "base_handle" => first_node[2],
                        "base_type" => string(typeof(base)),
                        "node_component" => node[1],
                        "node_handle" => node[2],
                        "node_type" => string(typeof(connector))
                    )
                ))
            end
            connection_eqs = ModelingToolkit.connect(base, connector)
            if connection_eqs isa AbstractArray
                append!(connections, connection_eqs)
            else
                push!(connections, connection_eqs)
            end
        end
    end

    isempty(connections) && throw(ValidationError("电路没有任何有效连接", Dict()))

    @independent_variables t
    @named circuit = ODESystem(connections, t, [], []; systems = systems)
    # 基于拓扑构建缓存键（组件类型与网络连接）
    topo_str = JSON3.write(Dict(
        "components" => [Dict("id"=>c.id,"type"=>c.type,"conn"=>c.connections) for c in payload.components],
        "nets" => [Dict("name"=>n.name, "nodes"=>n.nodes) for n in payload.nets],
    ))
    topo_key = String(bytes2hex(sha1(topo_str)))
    simplified = lock(_STATE_LOCK) do
        cached = get(_SIMPLIFY_CACHE, topo_key, nothing)
        if cached !== nothing
            filter!(!=(topo_key), _SIMPLIFY_CACHE_ORDER)
            push!(_SIMPLIFY_CACHE_ORDER, topo_key)
            _METRICS["simplify_hits"] = get(_METRICS, "simplify_hits", 0) + 1
        end
        cached
    end
    if simplified === nothing
        # structural_simplify 昂贵（秒~分钟级），绝不能在锁内执行；并发下同 key 重复计算是可接受的幂等浪费
        simplified = structural_simplify(circuit)
        lock(_STATE_LOCK) do
            if !haskey(_SIMPLIFY_CACHE, topo_key)
                _SIMPLIFY_CACHE[topo_key] = simplified
                push!(_SIMPLIFY_CACHE_ORDER, topo_key)
                while length(_SIMPLIFY_CACHE_ORDER) > _SIMPLIFY_CACHE_LIMIT
                    evicted = popfirst!(_SIMPLIFY_CACHE_ORDER)
                    delete!(_SIMPLIFY_CACHE, evicted)
                end
            end
            _METRICS["simplify_misses"] = get(_METRICS, "simplify_misses", 0) + 1
        end
    end

    # 为所有未知数和参数提供明确的初始值，避免循环依赖
    defs = ModelingToolkit.defaults(simplified)
    
    # 获取所有未知数和参数
    unknowns_list = ModelingToolkit.unknowns(simplified)
    params_list = ModelingToolkit.parameters(simplified)
    
    # 构建初始值映射：所有未知数初始化为0.0
    u0_map = Dict()
    for unknown in unknowns_list
        # 如果defaults中有值则使用，否则用0.0
        u0_map[unknown] = get(defs, unknown, 0.0)
    end
    
    # 构建参数映射：使用defaults中的值
    p_map = Dict()
    for param in params_list
        if haskey(defs, param)
            p_map[param] = defs[param]
        end
    end
    
    tspan = (0.0, payload.sim.t_stop)
    saveat = range(tspan[1], tspan[2], length = payload.sim.n_samples)

    # 创建ODEProblem，明确禁用循环依赖检查
    prob = ODEProblem(simplified, u0_map, tspan, p_map; warn_initialize_determined = false)
    sol = solve(prob, Rodas5(); saveat)

    # 检查求解状态（SciMLBase.ReturnCode是枚举类型）
    if !SciMLBase.successful_retcode(sol)
        throw(ValidationError("仿真求解失败", Dict("code" => "LAB_SIM_FAILED", "retcode" => string(sol.retcode))))
    end

    time = collect(sol.t)
    signals = Vector{Dict{String, Any}}()
    for measurement in measurements
        values = collect(sol[measurement.expr])
        push!(signals, Dict("id" => measurement.id, "label" => measurement.label, "values" => values))
    end

    return Dict("time" => time, "signals" => signals)
end

"""
    modia_available()

检查当前环境是否已安装 Modia 相关包。
返回 true/false。
"""
function modia_available()
    try
        # 仅检测 Modia，ModiaMath 在部分版本与依赖存在约束冲突，后续按需引入
        return Base.find_package("Modia") !== nothing
    catch
        return false
    end
end

"""
    simulate_payload_modia(payload::SimulationPayload)

使用 Modia 进行瞬态分析的占位实现：
- 若检测到未安装 Modia/ModiaMath，则抛出 ValidationError 友好提示安装。
- 若检测到已安装，则尝试加载包，并暂时复用现有瞬态求解（后续迭代替换为 Modia 模型）。
"""
function simulate_payload_modia(payload::SimulationPayload)
    # 先做参数校验以给出一致错误
    payload.sim.t_stop > 0 || throw(ValidationError("仿真时长必须大于 0", Dict()))
    payload.sim.n_samples > 1 || throw(ValidationError("采样点数至少为 2", Dict()))
    !isempty(payload.components) || throw(ValidationError("电路为空", Dict()))

    # 检查依赖
    if !modia_available()
        throw(ValidationError(
            "Modia 未安装：请在 server 环境安装 Modia",
            Dict("missing" => ["Modia"]) 
        ))
    end

    # 尝试加载依赖（若加载失败则抛错）
    try
        # 动态加载 Modia，避免顶层 import/using 的限制
        Base.require(Main, :Modia)
        @info "Modia package loaded"
    catch err
        throw(ValidationError("加载 Modia 失败", Dict("error" => string(err))))
    end

    # 占位：暂时复用 ModelingToolkit/DifferentialEquations 的瞬态求解，保持数据结构一致
    # 后续迭代将以 Modia 构建模型并求解。
    return simulate_payload(payload)
end

function run_simulation(payload::SimulationPayload)
    try
        # 确定分析方法
        method = payload.method
        @info "Received simulation request" method=method is_resistive=is_resistive_circuit(payload)
        
        if method === nothing
            # 自动检测：如果是纯电阻电路则使用节点电压法，否则使用瞬态分析
            method = is_resistive_circuit(payload) ? "node_voltage" : "transient"
            @info "Auto-detected method" method=method
        end
        
        # 根据方法选择不同的求解器
        if method == "node_voltage"
            data = solve_by_node_voltage(payload)
            return Dict(
                "status" => "ok",
                "message" => "节点电压法分析完成",
                "method" => method,
                "data" => data
            )
        elseif method == "branch_current"
            data = solve_by_branch_current(payload)
            return Dict(
                "status" => "ok",
                "message" => "支路电流法分析完成",
                "method" => method,
                "data" => data
            )
        elseif method == "mesh_current"
            data = solve_by_mesh_current(payload)
            return Dict(
                "status" => "ok",
                "message" => "网孔电流法分析完成",
                "method" => method,
                "data" => data
            )
        elseif method == "thevenin"
            # 戴维南等效分析
            if payload.thevenin_port === nothing
                throw(ValidationError("戴维南分析需要指定端口节点", Dict()))
            end
            port_pos = payload.thevenin_port["positive"]
            port_neg = payload.thevenin_port["negative"]
            data = compute_thevenin_equivalent(payload, port_pos, port_neg)
            return Dict(
                "status" => "ok",
                "message" => "戴维南等效分析完成",
                "method" => method,
                "data" => data
            )
        elseif method == "dc_op"
            data = solve_by_dc_op(payload)
            return Dict(
                "status" => "ok",
                "message" => "直流工作点分析完成",
                "method" => method,
                "data" => data
            )
        elseif method == "ac_phasor"
            data = solve_by_ac_phasor(payload)
            return Dict(
                "status" => "ok",
                "message" => "交流相量分析完成",
                "method" => method,
                "data" => data
            )
        elseif method == "transient"
            data = simulate_payload(payload)
            return Dict(
                "status" => "ok",
                "message" => "瞬态分析完成",
                "method" => method,
                "data" => data
            )
        elseif method == "transient_modia"
            # Modia 集成占位：若依赖齐全则加载 Modia；否则给出清晰错误。
            data = simulate_payload_modia(payload)
            return Dict(
                "status" => "ok",
                "message" => "瞬态分析（Modia）完成",
                "method" => method,
                "data" => data
            )
        else
            throw(ValidationError("不支持的分析方法: $(method)", Dict("method" => method)))
        end
    catch err
        if err isa ValidationError
            return Dict("status" => "error", "code" => get(err.data, "code", "LAB_VALIDATION"), "message" => err.message, "data" => err.data)
        else
            @error "simulation failed" exception = (err, catch_backtrace())
            # 调试增强：返回简化的错误字符串，便于定位问题
            return Dict("status" => "error", "code" => "LAB_INTERNAL", "message" => "internal error", "data" => Dict("error" => string(err)))
        end
    end
end

function extract_payload_kind(raw_body::String)
    parsed = JSON3.read(raw_body)
    if haskey(parsed, :kind) || haskey(parsed, "kind")
        kind = haskey(parsed, :kind) ? parsed[:kind] : parsed["kind"]
        kind === nothing && return "circuit"
        return String(kind)
    end
    return "circuit"
end

function handle_simulate(req::HTTP.Request)
    # simulate_calls 统计所有 /simulate 调用（此前只在瞬态路径递增，计数失真）
    lock(_STATE_LOCK) do
        _METRICS["simulate_calls"] = get(_METRICS, "simulate_calls", 0) + 1
    end
    raw_body = String(req.body)
    kind = extract_payload_kind(raw_body)

    response = if kind == "control"
        payload = JSON3.read(raw_body, ControlSimulationPayload)
        run_simulation(payload)
    elseif kind == "mixed"
        payload = JSON3.read(raw_body, MixedSimulationPayload)
        run_simulation(payload)
    elseif kind == "circuit" || isempty(kind)
        payload = JSON3.read(raw_body, SimulationPayload)
        run_simulation(payload)
    else
        Dict(
            "status" => "error",
            "code" => "LAB_VALIDATION",
            "message" => "不支持的仿真类型: $(kind)",
            "data" => Dict("kind" => kind),
        )
    end

    http_status = if get(response, "status", "ok") == "error"
        get(response, "code", "LAB_INTERNAL") == "LAB_VALIDATION" ? 422 : 500
    else
        200
    end
    return HTTP.Response(http_status, collect(RESPONSE_HEADERS), JSON3.write(response))
end

function bootstrap(; host::AbstractString = "127.0.0.1", port::Integer = 8080, start::Bool = true)
    router = HTTP.Router()
    HTTP.register!(router, "GET", "/health", _ -> begin
        body = JSON3.write(Dict("status" => "ok"))
        HTTP.Response(200, collect(RESPONSE_HEADERS), body)
    end)
    HTTP.register!(router, "GET", "/metrics", _ -> begin
        body = JSON3.write(lock(() -> copy(_METRICS), _STATE_LOCK))
        HTTP.Response(200, collect(RESPONSE_HEADERS), body)
    end)
    HTTP.register!(router, "GET", "/version", _ -> begin
        body = JSON3.write(Dict(
            "server" => "JCircuitServer",
            "julia" => string(VERSION),
        ))
        HTTP.Response(200, collect(RESPONSE_HEADERS), body)
    end)
    HTTP.register!(router, "POST", "/simulate", req -> begin
        try
            handle_simulate(req)
        catch err
            @error "请求处理失败" exception = (err, catch_backtrace())
            body = JSON3.write(Dict("status" => "error", "code" => "LAB_VALIDATION", "message" => "invalid request", "data" => Dict()))
            HTTP.Response(400, collect(RESPONSE_HEADERS), body)
        end
    end)
    HTTP.register!(router, "OPTIONS", "/simulate", _ -> HTTP.Response(200, collect(RESPONSE_HEADERS), ""))
    server = nothing
    if start
        server = HTTP.serve!(router, host, port; verbose = false)
        @info "JCircuitServer started" host port
    end
    return (; host, port, router, server)
end

end # module
