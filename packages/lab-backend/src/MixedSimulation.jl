struct MixedCompiledSystem
    block_order::Vector{String}
    blocks_by_id::Dict{String, ControlBlockPayload}
    incoming_source::Dict{Tuple{String, String}, String}
    feedthrough_ids::Vector{String}
    state_ranges::Dict{String, UnitRange{Int}}
    initial_state::Vector{Float64}
    output_specs::Vector{NamedTuple{(:id, :label, :source), Tuple{String, String, String}}}
    bridge_by_block::Dict{String, MixedBridgeBindingPayload}
    sensor_ids::Vector{String}
    actuator_ids::Vector{String}
    circuit_components::Vector{ComponentPayload}
    circuit_nets::Vector{NetPayload}
    voltage_probe_specs::Vector{NamedTuple{(:id, :label, :net), Tuple{String, String, String}}}
    current_probe_specs::Vector{NamedTuple{(:id, :label, :alias), Tuple{String, String, String}}}
    current_sensor_alias::Dict{String, String}
    snapshot_settings::SimulationSettings
end

function require_mixed_parameter(block::ControlBlockPayload, key::String)
    haskey(block.parameters, key) ||
        throw(ValidationError("混合信号块缺少参数", Dict("block" => block.id, "parameter" => key)))
    value = Float64(block.parameters[key])
    isfinite(value) ||
        throw(ValidationError("混合信号块参数必须为有限数值", Dict("block" => block.id, "parameter" => key)))
    return value
end

function validate_mixed_block(block::ControlBlockPayload)
    schema = mixed_block_schema(block.type)
    schema !== nothing ||
        throw(ValidationError("不支持的混合信号块类型", Dict("block" => block.id, "type" => block.type)))

    for required_key in schema.params
        value = require_mixed_parameter(block, required_key)
        minimum = get(schema.mins, required_key, nothing)
        if minimum !== nothing && value < minimum
            throw(ValidationError(
                "混合信号块参数不合法",
                Dict("block" => block.id, "parameter" => required_key, "min" => minimum, "value" => value),
            ))
        end
    end

    for (key, raw_value) in block.parameters
        value = Float64(raw_value)
        isfinite(value) ||
            throw(ValidationError("混合信号块参数必须为有限数值", Dict("block" => block.id, "parameter" => key)))
    end
end

function validate_mixed_signal_loops!(
    block_order::Vector{String},
    blocks_by_id::Dict{String, ControlBlockPayload},
    adjacency::Dict{String, Vector{String}},
)
    components = strongly_connected_components(block_order, adjacency)
    for component in components
        has_self_cycle = false
        if length(component) == 1
            node = component[1]
            has_self_cycle = node in get(adjacency, node, String[])
        end
        is_cycle = length(component) > 1 || has_self_cycle
        if !is_cycle
            continue
        end

        has_dynamic = any(is_mixed_dynamic_block(blocks_by_id[node_id].type) for node_id in component)
        if !has_dynamic
            cycle_desc = join(sort(component), " -> ")
            throw(ValidationError("检测到纯代数环", Dict("cycle" => cycle_desc)))
        end
    end
end

function to_float_dict(value, field_name::String)
    value isa AbstractDict ||
        throw(ValidationError("混合仿真结果格式错误", Dict("field" => field_name)))
    result = Dict{String, Float64}()
    for (raw_key, raw_value) in value
        key = String(raw_key)
        number = try
            Float64(raw_value)
        catch
            throw(ValidationError("混合仿真结果包含非数值", Dict("field" => field_name, "key" => key)))
        end
        result[key] = number
    end
    return result
end

function compile_mixed_payload(payload::MixedSimulationPayload)
    payload.kind == "mixed" ||
        throw(ValidationError("混合仿真 payload.kind 必须为 mixed", Dict("kind" => payload.kind)))
    payload.sim.t_stop > 0 ||
        throw(ValidationError("仿真时长必须大于 0", Dict()))
    payload.sim.n_samples > 1 ||
        throw(ValidationError("采样点数至少为 2", Dict()))
    !isempty(payload.blocks) ||
        throw(ValidationError("混合图缺少信号块", Dict()))
    !isempty(payload.bridges) ||
        throw(ValidationError("混合图缺少桥接绑定", Dict()))

    block_order = String[]
    blocks_by_id = Dict{String, ControlBlockPayload}()
    for block in payload.blocks
        isempty(strip(block.id)) && throw(ValidationError("信号块 id 不能为空", Dict()))
        if haskey(blocks_by_id, block.id)
            throw(ValidationError("信号块 id 重复", Dict("block" => block.id)))
        end
        validate_mixed_block(block)
        push!(block_order, block.id)
        blocks_by_id[block.id] = block
    end

    if !any(control_block.type == "control_scope" for control_block in values(blocks_by_id))
        has_probe = any(component.type == "voltage_probe" || component.type == "current_probe" for component in payload.circuit.components)
        has_probe || throw(ValidationError("请至少提供一个 control_scope 或电气探针输出", Dict()))
    end

    net_names = Set{String}(net.name for net in payload.circuit.nets)
    bridge_by_block = Dict{String, MixedBridgeBindingPayload}()
    for bridge in payload.bridges
        block = get(blocks_by_id, bridge.blockId, nothing)
        block !== nothing ||
            throw(ValidationError("桥接绑定引用了不存在的块", Dict("blockId" => bridge.blockId)))
        is_bridge_sensor_block(block.type) || is_bridge_actuator_block(block.type) ||
            throw(ValidationError("桥接绑定只能作用于桥接元件", Dict("blockId" => bridge.blockId, "type" => block.type)))
        haskey(bridge_by_block, bridge.blockId) &&
            throw(ValidationError("桥接绑定重复", Dict("blockId" => bridge.blockId)))

        bridge.positiveNet in net_names ||
            throw(ValidationError("桥接绑定正端网络不存在", Dict("blockId" => bridge.blockId, "net" => bridge.positiveNet)))
        bridge.negativeNet in net_names ||
            throw(ValidationError("桥接绑定负端网络不存在", Dict("blockId" => bridge.blockId, "net" => bridge.negativeNet)))

        bridge_by_block[bridge.blockId] = bridge
    end

    incoming_source = Dict{Tuple{String, String}, String}()
    adjacency = Dict{String, Vector{String}}(block_id => String[] for block_id in block_order)
    for edge in payload.edges
        source_block = get(blocks_by_id, edge.source, nothing)
        source_block !== nothing ||
            throw(ValidationError("信号线引用了不存在的 source 块", Dict("edge" => edge.id, "source" => edge.source)))
        target_block = get(blocks_by_id, edge.target, nothing)
        target_block !== nothing ||
            throw(ValidationError("信号线引用了不存在的 target 块", Dict("edge" => edge.id, "target" => edge.target)))

        source_schema = mixed_block_schema(source_block.type)
        target_schema = mixed_block_schema(target_block.type)
        edge.sourceHandle in source_schema.outputs ||
            throw(ValidationError(
                "信号线 sourceHandle 不合法",
                Dict("edge" => edge.id, "source" => edge.source, "sourceHandle" => edge.sourceHandle),
            ))
        edge.targetHandle in target_schema.inputs ||
            throw(ValidationError(
                "信号线 targetHandle 不合法",
                Dict("edge" => edge.id, "target" => edge.target, "targetHandle" => edge.targetHandle),
            ))

        input_key = (edge.target, edge.targetHandle)
        if haskey(incoming_source, input_key)
            throw(ValidationError("信号输入端口只能有一条输入线", Dict("target" => edge.target, "handle" => edge.targetHandle)))
        end
        incoming_source[input_key] = edge.source
        push!(adjacency[edge.source], edge.target)
    end

    for block_id in block_order
        block = blocks_by_id[block_id]
        schema = mixed_block_schema(block.type)
        for input_handle in schema.inputs
            input_key = (block_id, input_handle)
            if !haskey(incoming_source, input_key)
                throw(ValidationError("信号块输入端子未连接", Dict("block" => block_id, "handle" => input_handle)))
            end
        end
    end

    output_specs = Vector{NamedTuple{(:id, :label, :source), Tuple{String, String, String}}}()
    seen_outputs = Set{String}()
    for output in payload.outputs
        block = get(blocks_by_id, output.blockId, nothing)
        block !== nothing ||
            throw(ValidationError("输出引用了不存在的信号块", Dict("output" => output.id, "block" => output.blockId)))
        block.type == "control_scope" ||
            throw(ValidationError("输出必须来自 control_scope", Dict("output" => output.id, "block" => output.blockId)))
        output.handle == "in" ||
            throw(ValidationError("control_scope 仅支持 in 句柄输出", Dict("output" => output.id, "handle" => output.handle)))

        source_block_id = get(incoming_source, (output.blockId, output.handle), nothing)
        source_block_id !== nothing ||
            throw(ValidationError("scope 输入端子未连接", Dict("output" => output.id, "block" => output.blockId)))

        normalized_id = isempty(strip(output.id)) ? "$(output.blockId):$(output.handle)" : output.id
        normalized_id in seen_outputs &&
            throw(ValidationError("输出 id 重复", Dict("output" => normalized_id)))
        push!(seen_outputs, normalized_id)

        normalized_label = isempty(strip(output.label)) ? "Scope $(output.blockId)" : output.label
        push!(output_specs, (id = normalized_id, label = normalized_label, source = source_block_id))
    end

    validate_mixed_signal_loops!(block_order, blocks_by_id, adjacency)

    state_ranges = Dict{String, UnitRange{Int}}()
    initial_state = Float64[]
    next_index = 1
    for block_id in block_order
        block = blocks_by_id[block_id]
        if block.type == "control_integrator"
            state_ranges[block_id] = next_index:next_index
            push!(initial_state, block.parameters["initialValue"])
            next_index += 1
        elseif block.type == "control_plant_1st"
            state_ranges[block_id] = next_index:next_index
            push!(initial_state, block.parameters["initialValue"])
            next_index += 1
        elseif block.type == "control_pid"
            state_ranges[block_id] = next_index:(next_index + 1)
            push!(initial_state, 0.0) # i_state
            push!(initial_state, 0.0) # d_state
            next_index += 2
        end
    end

    feedthrough_ids = String[]
    sensor_ids = String[]
    actuator_ids = String[]
    for block_id in block_order
        block = blocks_by_id[block_id]
        is_mixed_feedthrough_block(block.type) && push!(feedthrough_ids, block_id)
        is_bridge_sensor_block(block.type) && push!(sensor_ids, block_id)
        is_bridge_actuator_block(block.type) && push!(actuator_ids, block_id)
    end

    !isempty(sensor_ids) || throw(ValidationError("混合仿真需要至少一个传感器桥接块", Dict()))
    !isempty(actuator_ids) || throw(ValidationError("混合仿真需要至少一个受控源桥接块", Dict()))

    allowed_circuit_types = Set(["resistor", "vsource_dc", "isource_dc", "vcvs", "ccvs", "vccs", "cccs", "ground", "voltage_probe", "current_probe"])
    has_ground = false
    has_source = false
    circuit_components = ComponentPayload[]
    voltage_probe_specs = Vector{NamedTuple{(:id, :label, :net), Tuple{String, String, String}}}()
    current_probe_specs = Vector{NamedTuple{(:id, :label, :alias), Tuple{String, String, String}}}()
    current_sensor_alias = Dict{String, String}()

    for component in payload.circuit.components
        component.type in allowed_circuit_types ||
            throw(ValidationError("混合仿真暂不支持该电气元件类型", Dict("component" => component.id, "type" => component.type)))

        schema = get(COMPONENT_SCHEMAS, component.type, nothing)
        schema !== nothing ||
            throw(ValidationError("电气元件 schema 未定义", Dict("component" => component.id, "type" => component.type)))
        require_connections(component, schema.handles)
        for required_param in schema.params
            require_parameter(component, required_param)
        end
        for (key, value) in component.parameters
            isfinite(Float64(value)) ||
                throw(ValidationError("电气元件参数必须为有限数值", Dict("component" => component.id, "parameter" => key)))
        end

        if component.type == "ground"
            has_ground = true
        end
        if component.type in ("vsource_dc", "isource_dc", "vcvs", "ccvs", "vccs", "cccs")
            has_source = true
        end

        if component.type == "voltage_probe"
            probe_net = component.connections["node"]
            probe_net in net_names ||
                throw(ValidationError("电压探针连接到不存在的网络", Dict("component" => component.id, "net" => probe_net)))
            push!(voltage_probe_specs, (id = component.id, label = "Voltage at $(probe_net)", net = probe_net))
            continue
        end
        if component.type == "current_probe"
            alias = "__mixed_probe_current__" * component.id
            pos_net = component.connections["p"]
            neg_net = component.connections["n"]
            pos_net in net_names || throw(ValidationError("电流探针连接到不存在的网络", Dict("component" => component.id, "net" => pos_net)))
            neg_net in net_names || throw(ValidationError("电流探针连接到不存在的网络", Dict("component" => component.id, "net" => neg_net)))
            push!(circuit_components, ComponentPayload(alias, "vsource_dc", Dict("dc" => 0.0), Dict("pos" => pos_net, "neg" => neg_net)))
            push!(current_probe_specs, (id = component.id, label = "Current through $(component.id)", alias = alias))
            continue
        end

        push!(circuit_components, component)
    end

    for sensor_id in sensor_ids
        binding = get(bridge_by_block, sensor_id, nothing)
        binding !== nothing || throw(ValidationError("传感器桥接块缺少绑定", Dict("block" => sensor_id)))
        block = blocks_by_id[sensor_id]
        if block.type == "current_sensor"
            alias = "__mixed_sensor_current__" * sensor_id
            push!(circuit_components, ComponentPayload(alias, "vsource_dc", Dict("dc" => 0.0), Dict("pos" => binding.positiveNet, "neg" => binding.negativeNet)))
            current_sensor_alias[sensor_id] = alias
        end
    end

    for actuator_id in actuator_ids
        haskey(bridge_by_block, actuator_id) ||
            throw(ValidationError("受控源桥接块缺少绑定", Dict("block" => actuator_id)))
    end

    has_ground || throw(ValidationError("混合电路侧缺少地线", Dict("missing" => ["ground"])))
    if !(has_source || !isempty(actuator_ids))
        throw(ValidationError("混合电路侧缺少激励源", Dict("missing" => ["source"])))
    end

    snapshot_settings = SimulationSettings(max(payload.sim.t_stop, 1.0), max(payload.sim.n_samples, 2))

    return MixedCompiledSystem(
        block_order,
        blocks_by_id,
        incoming_source,
        feedthrough_ids,
        state_ranges,
        initial_state,
        output_specs,
        bridge_by_block,
        sensor_ids,
        actuator_ids,
        circuit_components,
        payload.circuit.nets,
        voltage_probe_specs,
        current_probe_specs,
        current_sensor_alias,
        snapshot_settings,
    )
end

function evaluate_mixed_signal_outputs(
    t::Float64,
    state::AbstractVector{<:Real},
    compiled::MixedCompiledSystem,
    sensor_values::Dict{String, Float64},
)
    known = Dict{String, Float64}()

    for sensor_id in compiled.sensor_ids
        known[sensor_id] = get(sensor_values, sensor_id, 0.0)
    end

    for block_id in compiled.block_order
        block = compiled.blocks_by_id[block_id]
        if block.type == "control_step"
            amplitude = block.parameters["amplitude"]
            offset = block.parameters["offset"]
            start_time = block.parameters["startTime"]
            known[block_id] = offset + (t >= start_time ? amplitude : 0.0)
        elseif block.type == "control_constant"
            known[block_id] = block.parameters["value"]
        elseif block.type == "control_integrator"
            state_index = first(compiled.state_ranges[block_id])
            known[block_id] = Float64(state[state_index])
        elseif block.type == "control_plant_1st"
            state_index = first(compiled.state_ranges[block_id])
            known[block_id] = Float64(state[state_index])
        end
    end

    if !isempty(compiled.feedthrough_ids)
        feedthrough_index = Dict{String, Int}()
        for (idx, block_id) in enumerate(compiled.feedthrough_ids)
            feedthrough_index[block_id] = idx
        end

        size_hint = length(compiled.feedthrough_ids)
        matrix = Matrix{Float64}(I, size_hint, size_hint)
        rhs = zeros(Float64, size_hint)

        for block_id in compiled.feedthrough_ids
            row = feedthrough_index[block_id]
            block = compiled.blocks_by_id[block_id]
            constant_term = 0.0
            source_terms = Vector{Tuple{String, Float64}}()

            if block.type == "control_sum"
                source1 = compiled.incoming_source[(block_id, "in1")]
                source2 = compiled.incoming_source[(block_id, "in2")]
                push!(source_terms, (source1, block.parameters["sign1"]))
                push!(source_terms, (source2, block.parameters["sign2"]))
            elseif block.type == "control_gain"
                source = compiled.incoming_source[(block_id, "in")]
                push!(source_terms, (source, block.parameters["gain"]))
            elseif block.type == "control_pid"
                source = compiled.incoming_source[(block_id, "in")]
                state_range = compiled.state_ranges[block_id]
                i_index = first(state_range)
                d_index = last(state_range)
                kp = block.parameters["kp"]
                ki = block.parameters["ki"]
                kd = block.parameters["kd"]
                tf = block.parameters["tf"]

                gain = kp + kd / tf
                constant_term = ki * Float64(state[i_index]) - kd / tf * Float64(state[d_index])
                push!(source_terms, (source, gain))
            else
                throw(ValidationError("不支持的混合前馈块", Dict("block" => block_id, "type" => block.type)))
            end

            rhs[row] += constant_term
            for (source_id, coefficient) in source_terms
                source_row = get(feedthrough_index, source_id, 0)
                if source_row > 0
                    matrix[row, source_row] -= coefficient
                else
                    source_value = get(known, source_id, nothing)
                    source_value !== nothing ||
                        throw(ValidationError(
                            "无法解析混合信号依赖",
                            Dict("block" => block_id, "source" => source_id),
                        ))
                    rhs[row] += coefficient * source_value
                end
            end
        end

        feedthrough_values = try
            matrix \ rhs
        catch err
            throw(ValidationError("混合代数方程求解失败", Dict("code" => "LAB_SIM_FAILED", "error" => string(err))))
        end
        all(isfinite, feedthrough_values) ||
            throw(ValidationError("混合代数方程求解失败", Dict("code" => "LAB_SIM_FAILED", "error" => "solution contains NaN/Inf")))

        for block_id in compiled.feedthrough_ids
            idx = feedthrough_index[block_id]
            known[block_id] = feedthrough_values[idx]
        end
    end

    return known
end

function mixed_control_rhs!(
    du::AbstractVector{<:Real},
    u::AbstractVector{<:Real},
    compiled::MixedCompiledSystem,
    t::Float64,
    sensor_values::Dict{String, Float64},
)
    fill!(du, 0.0)
    outputs = evaluate_mixed_signal_outputs(t, u, compiled, sensor_values)

    for block_id in compiled.block_order
        block = compiled.blocks_by_id[block_id]
        if block.type == "control_integrator"
            source_id = compiled.incoming_source[(block_id, "in")]
            state_index = first(compiled.state_ranges[block_id])
            du[state_index] = outputs[source_id]
        elseif block.type == "control_plant_1st"
            source_id = compiled.incoming_source[(block_id, "in")]
            state_index = first(compiled.state_ranges[block_id])
            gain = block.parameters["gain"]
            tau = block.parameters["timeConstant"]
            du[state_index] = (-u[state_index] + gain * outputs[source_id]) / tau
        elseif block.type == "control_pid"
            source_id = compiled.incoming_source[(block_id, "in")]
            state_range = compiled.state_ranges[block_id]
            i_index = first(state_range)
            d_index = last(state_range)
            tf = block.parameters["tf"]
            error_signal = outputs[source_id]
            du[i_index] = error_signal
            du[d_index] = (error_signal - u[d_index]) / tf
        end
    end
end

function collect_actuator_commands(outputs::Dict{String, Float64}, compiled::MixedCompiledSystem)
    commands = Dict{String, Float64}()
    for actuator_id in compiled.actuator_ids
        source_id = compiled.incoming_source[(actuator_id, "in")]
        commands[actuator_id] = get(outputs, source_id, 0.0)
    end
    return commands
end

function solve_mixed_snapshot(compiled::MixedCompiledSystem, actuator_commands::Dict{String, Float64})
    snapshot_components = copy(compiled.circuit_components)

    for actuator_id in compiled.actuator_ids
        block = compiled.blocks_by_id[actuator_id]
        binding = compiled.bridge_by_block[actuator_id]
        gain = get(block.parameters, "gain", 1.0)
        command = get(actuator_commands, actuator_id, 0.0)
        value = gain * command

        if block.type == "controlled_voltage_source"
            push!(snapshot_components, ComponentPayload(
                actuator_id,
                "vsource_dc",
                Dict("dc" => value),
                Dict("pos" => binding.positiveNet, "neg" => binding.negativeNet),
            ))
        elseif block.type == "controlled_current_source"
            push!(snapshot_components, ComponentPayload(
                actuator_id,
                "isource_dc",
                Dict("dc" => value),
                Dict("pos" => binding.positiveNet, "neg" => binding.negativeNet),
            ))
        else
            throw(ValidationError("未知受控源类型", Dict("block" => actuator_id, "type" => block.type)))
        end
    end

    snapshot_payload = SimulationPayload(
        snapshot_components,
        compiled.circuit_nets,
        compiled.snapshot_settings,
        "node_voltage",
        nothing,
        nothing,
    )
    raw_result = solve_by_node_voltage(snapshot_payload)
    node_voltages = to_float_dict(raw_result["node_voltages"], "node_voltages")
    branch_currents = to_float_dict(raw_result["branch_currents"], "branch_currents")

    sensor_values = Dict{String, Float64}()
    for sensor_id in compiled.sensor_ids
        block = compiled.blocks_by_id[sensor_id]
        binding = compiled.bridge_by_block[sensor_id]
        if block.type == "voltage_sensor"
            vp = get(node_voltages, binding.positiveNet, 0.0)
            vn = get(node_voltages, binding.negativeNet, 0.0)
            sensor_values[sensor_id] = vp - vn
        elseif block.type == "current_sensor"
            alias = compiled.current_sensor_alias[sensor_id]
            sensor_values[sensor_id] = get(branch_currents, alias, 0.0)
        end
    end

    return (; node_voltages, branch_currents, sensor_values)
end

function simulate_mixed_payload(payload::MixedSimulationPayload)
    compiled = compile_mixed_payload(payload)
    time_points = collect(range(0.0, payload.sim.t_stop, length = payload.sim.n_samples))
    control_state = copy(compiled.initial_state)
    sensor_values = Dict{String, Float64}(sensor_id => 0.0 for sensor_id in compiled.sensor_ids)

    signal_values = Dict{String, Vector{Float64}}()
    signal_labels = Dict{String, String}()
    for output_spec in compiled.output_specs
        signal_values[output_spec.id] = zeros(Float64, length(time_points))
        signal_labels[output_spec.id] = output_spec.label
    end
    for probe_spec in compiled.voltage_probe_specs
        signal_values[probe_spec.id] = zeros(Float64, length(time_points))
        signal_labels[probe_spec.id] = probe_spec.label
    end
    for probe_spec in compiled.current_probe_specs
        signal_values[probe_spec.id] = zeros(Float64, length(time_points))
        signal_labels[probe_spec.id] = probe_spec.label
    end

    for idx in eachindex(time_points)
        t = time_points[idx]

        # 两次快照迭代，减小控制-电路代数耦合误差。
        outputs_guess = evaluate_mixed_signal_outputs(t, control_state, compiled, sensor_values)
        commands_guess = collect_actuator_commands(outputs_guess, compiled)
        guess_snapshot = solve_mixed_snapshot(compiled, commands_guess)

        outputs_now = evaluate_mixed_signal_outputs(t, control_state, compiled, guess_snapshot.sensor_values)
        commands_now = collect_actuator_commands(outputs_now, compiled)
        snapshot = solve_mixed_snapshot(compiled, commands_now)
        sensor_values = snapshot.sensor_values

        for output_spec in compiled.output_specs
            signal_values[output_spec.id][idx] = get(outputs_now, output_spec.source, 0.0)
        end
        for probe_spec in compiled.voltage_probe_specs
            signal_values[probe_spec.id][idx] = get(snapshot.node_voltages, probe_spec.net, 0.0)
        end
        for probe_spec in compiled.current_probe_specs
            signal_values[probe_spec.id][idx] = get(snapshot.branch_currents, probe_spec.alias, 0.0)
        end

        if idx < length(time_points) && !isempty(control_state)
            dt = time_points[idx + 1] - t
            du = zeros(Float64, length(control_state))
            mixed_control_rhs!(du, control_state, compiled, t, sensor_values)
            @inbounds for state_index in eachindex(control_state)
                control_state[state_index] = control_state[state_index] + dt * du[state_index]
            end
            # 显式欧拉即本路径的 ODE 求解：状态发散（NaN/Inf）等价于求解失败，
            # 与 ControlSimulation 的 successful_retcode 检查保持一致的错误封套。
            all(isfinite, control_state) ||
                throw(ValidationError("混合仿真求解失败", Dict("code" => "LAB_SIM_FAILED", "retcode" => "Divergence", "t" => t)))
        end
    end

    signals = Vector{Dict{String, Any}}()
    for (signal_id, values) in signal_values
        push!(signals, Dict(
            "id" => signal_id,
            "label" => signal_labels[signal_id],
            "values" => values,
        ))
    end

    return Dict(
        "time" => time_points,
        "signals" => signals,
    )
end

function run_simulation(payload::MixedSimulationPayload)
    try
        data = simulate_mixed_payload(payload)
        return Dict(
            "status" => "ok",
            "message" => "混合系统时域仿真完成",
            "method" => "transient",
            "data" => data,
        )
    catch err
        if err isa ValidationError
            return Dict("status" => "error", "code" => get(err.data, "code", "LAB_VALIDATION"), "message" => err.message, "data" => err.data)
        else
            @error "mixed simulation failed" exception = (err, catch_backtrace())
            return Dict("status" => "error", "code" => "LAB_INTERNAL", "message" => "internal error", "data" => Dict("error" => string(err)))
        end
    end
end
