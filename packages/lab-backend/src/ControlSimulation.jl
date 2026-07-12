struct ControlCompiledSystem
    block_order::Vector{String}
    blocks_by_id::Dict{String, ControlBlockPayload}
    incoming_source::Dict{Tuple{String, String}, String}
    feedthrough_ids::Vector{String}
    state_ranges::Dict{String, UnitRange{Int}}
    initial_state::Vector{Float64}
    output_specs::Vector{NamedTuple{(:id, :label, :source), Tuple{String, String, String}}}
end

function require_control_parameter(block::ControlBlockPayload, key::String)
    haskey(block.parameters, key) ||
        throw(ValidationError("控制块缺少参数", Dict("block" => block.id, "parameter" => key)))
    value = Float64(block.parameters[key])
    isfinite(value) ||
        throw(ValidationError("控制块参数必须为有限数值", Dict("block" => block.id, "parameter" => key)))
    return value
end

function validate_control_block(block::ControlBlockPayload)
    schema = control_block_schema(block.type)
    schema !== nothing ||
        throw(ValidationError("不支持的控制块类型", Dict("block" => block.id, "type" => block.type)))

    for required_key in schema.params
        value = require_control_parameter(block, required_key)
        minimum = get(schema.mins, required_key, nothing)
        if minimum !== nothing && value < minimum
            throw(ValidationError(
                "控制块参数不合法",
                Dict("block" => block.id, "parameter" => required_key, "min" => minimum, "value" => value),
            ))
        end
    end

    # 不在 schema 中的参数也必须是有限数值，避免后续求解阶段出现 NaN/Inf。
    for (key, raw_value) in block.parameters
        value = Float64(raw_value)
        isfinite(value) ||
            throw(ValidationError("控制块参数必须为有限数值", Dict("block" => block.id, "parameter" => key)))
    end
end

function strongly_connected_components(node_ids::Vector{String}, graph::Dict{String, Vector{String}})
    indices = Dict{String, Int}()
    lowlinks = Dict{String, Int}()
    on_stack = Set{String}()
    stack = String[]
    components = Vector{Vector{String}}()
    index = Ref(0)

    function visit(node_id::String)
        node_index = index[]
        indices[node_id] = node_index
        lowlinks[node_id] = node_index
        index[] = node_index + 1
        push!(stack, node_id)
        push!(on_stack, node_id)

        for neighbor in get(graph, node_id, String[])
            if !haskey(indices, neighbor)
                visit(neighbor)
                lowlinks[node_id] = min(lowlinks[node_id], lowlinks[neighbor])
            elseif neighbor in on_stack
                lowlinks[node_id] = min(lowlinks[node_id], indices[neighbor])
            end
        end

        if lowlinks[node_id] == indices[node_id]
            component = String[]
            while true
                member = pop!(stack)
                delete!(on_stack, member)
                push!(component, member)
                member == node_id && break
            end
            push!(components, component)
        end
    end

    for node_id in node_ids
        if !haskey(indices, node_id)
            visit(node_id)
        end
    end

    return components
end

function validate_control_loops!(
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

        has_dynamic = any(is_dynamic_control_block(blocks_by_id[node_id].type) for node_id in component)
        if !has_dynamic
            cycle_desc = join(sort(component), " -> ")
            throw(ValidationError("检测到纯代数环", Dict("cycle" => cycle_desc)))
        end
    end
end

function compile_control_payload(payload::ControlSimulationPayload)
    payload.kind == "control" ||
        throw(ValidationError("控制仿真 payload.kind 必须为 control", Dict("kind" => payload.kind)))
    payload.sim.t_stop > 0 ||
        throw(ValidationError("仿真时长必须大于 0", Dict()))
    payload.sim.n_samples > 1 ||
        throw(ValidationError("采样点数至少为 2", Dict()))
    !isempty(payload.blocks) ||
        throw(ValidationError("控制系统图为空", Dict()))
    !isempty(payload.outputs) ||
        throw(ValidationError("控制系统至少声明一个输出", Dict()))

    block_order = String[]
    blocks_by_id = Dict{String, ControlBlockPayload}()
    for block in payload.blocks
        isempty(strip(block.id)) &&
            throw(ValidationError("控制块 id 不能为空", Dict()))
        if haskey(blocks_by_id, block.id)
            throw(ValidationError("控制块 id 重复", Dict("block" => block.id)))
        end
        validate_control_block(block)
        push!(block_order, block.id)
        blocks_by_id[block.id] = block
    end

    incoming_source = Dict{Tuple{String, String}, String}()
    adjacency = Dict{String, Vector{String}}(block_id => String[] for block_id in block_order)

    for edge in payload.edges
        source_block = get(blocks_by_id, edge.source, nothing)
        source_block !== nothing ||
            throw(ValidationError("连线引用了不存在的 source 块", Dict("edge" => edge.id, "source" => edge.source)))
        target_block = get(blocks_by_id, edge.target, nothing)
        target_block !== nothing ||
            throw(ValidationError("连线引用了不存在的 target 块", Dict("edge" => edge.id, "target" => edge.target)))

        source_schema = control_block_schema(source_block.type)
        target_schema = control_block_schema(target_block.type)

        edge.sourceHandle in source_schema.outputs ||
            throw(ValidationError(
                "连线 sourceHandle 不合法",
                Dict(
                    "edge" => edge.id,
                    "source" => edge.source,
                    "sourceHandle" => edge.sourceHandle,
                ),
            ))
        edge.targetHandle in target_schema.inputs ||
            throw(ValidationError(
                "连线 targetHandle 不合法",
                Dict(
                    "edge" => edge.id,
                    "target" => edge.target,
                    "targetHandle" => edge.targetHandle,
                ),
            ))

        input_key = (edge.target, edge.targetHandle)
        if haskey(incoming_source, input_key)
            throw(ValidationError(
                "控制输入端口只能有一条输入线",
                Dict("target" => edge.target, "handle" => edge.targetHandle),
            ))
        end
        incoming_source[input_key] = edge.source
        push!(adjacency[edge.source], edge.target)
    end

    for block_id in block_order
        block = blocks_by_id[block_id]
        schema = control_block_schema(block.type)
        for input_handle in schema.inputs
            input_key = (block_id, input_handle)
            if !haskey(incoming_source, input_key)
                throw(ValidationError(
                    "控制块输入端子未连接",
                    Dict("block" => block_id, "handle" => input_handle),
                ))
            end
        end
    end

    output_specs = Vector{NamedTuple{(:id, :label, :source), Tuple{String, String, String}}}()
    seen_outputs = Set{String}()
    for output in payload.outputs
        block = get(blocks_by_id, output.blockId, nothing)
        block !== nothing ||
            throw(ValidationError("输出引用了不存在的控制块", Dict("output" => output.id, "block" => output.blockId)))
        block.type == "control_scope" ||
            throw(ValidationError("输出必须来自 control_scope", Dict("output" => output.id, "block" => output.blockId)))
        output.handle == "in" ||
            throw(ValidationError("control_scope 仅支持 in 句柄输出", Dict("output" => output.id, "handle" => output.handle)))

        input_key = (output.blockId, output.handle)
        source_block = get(incoming_source, input_key, nothing)
        source_block !== nothing ||
            throw(ValidationError(
                "输出对应的 scope 输入端子未连接",
                Dict("output" => output.id, "block" => output.blockId),
            ))

        normalized_id = isempty(strip(output.id)) ? "$(output.blockId):$(output.handle)" : output.id
        normalized_id in seen_outputs &&
            throw(ValidationError("输出 id 重复", Dict("output" => normalized_id)))
        push!(seen_outputs, normalized_id)

        normalized_label = isempty(strip(output.label)) ? "Scope $(output.blockId)" : output.label
        push!(output_specs, (id = normalized_id, label = normalized_label, source = source_block))
    end

    validate_control_loops!(block_order, blocks_by_id, adjacency)

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
    for block_id in block_order
        block = blocks_by_id[block_id]
        is_feedthrough_control_block(block.type) && push!(feedthrough_ids, block_id)
    end

    return ControlCompiledSystem(
        block_order,
        blocks_by_id,
        incoming_source,
        feedthrough_ids,
        state_ranges,
        initial_state,
        output_specs,
    )
end

function evaluate_control_outputs(
    t::Float64,
    state::AbstractVector{<:Real},
    compiled::ControlCompiledSystem,
)
    known = Dict{String, Float64}()

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
                throw(ValidationError("不支持的前馈控制块", Dict("block" => block_id, "type" => block.type)))
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
                            "无法解析控制信号依赖",
                            Dict("block" => block_id, "source" => source_id),
                        ))
                    rhs[row] += coefficient * source_value
                end
            end
        end

        feedthrough_values = try
            matrix \ rhs
        catch err
            throw(ValidationError("控制代数方程求解失败", Dict("code" => "LAB_SIM_FAILED", "error" => string(err))))
        end
        all(isfinite, feedthrough_values) ||
            throw(ValidationError("控制代数方程求解失败", Dict("code" => "LAB_SIM_FAILED", "error" => "solution contains NaN/Inf")))

        for block_id in compiled.feedthrough_ids
            idx = feedthrough_index[block_id]
            known[block_id] = feedthrough_values[idx]
        end
    end

    return known
end

function control_rhs!(du, u, compiled::ControlCompiledSystem, t)
    fill!(du, 0.0)
    outputs = evaluate_control_outputs(Float64(t), u, compiled)

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

function build_control_signals(
    time_points::Vector{Float64},
    state_samples::Vector{Vector{Float64}},
    compiled::ControlCompiledSystem,
)
    signals = Vector{Dict{String, Any}}()
    for output_spec in compiled.output_specs
        values = Vector{Float64}(undef, length(time_points))
        for idx in eachindex(time_points)
            outputs = evaluate_control_outputs(time_points[idx], state_samples[idx], compiled)
            values[idx] = outputs[output_spec.source]
        end
        push!(signals, Dict(
            "id" => output_spec.id,
            "label" => output_spec.label,
            "values" => values,
        ))
    end
    return signals
end

function simulate_control_payload(payload::ControlSimulationPayload)
    compiled = compile_control_payload(payload)
    tspan = (0.0, payload.sim.t_stop)
    time_points = collect(range(tspan[1], tspan[2], length = payload.sim.n_samples))

    state_samples = Vector{Vector{Float64}}(undef, length(time_points))
    if isempty(compiled.initial_state)
        for idx in eachindex(time_points)
            state_samples[idx] = Float64[]
        end
    else
        rhs! = (du, u, p, t) -> control_rhs!(du, u, compiled, t)
        problem = ODEProblem(rhs!, compiled.initial_state, tspan)
        solution = solve(problem, Tsit5(); saveat = time_points)
        if !SciMLBase.successful_retcode(solution)
            throw(ValidationError("控制系统求解失败", Dict("code" => "LAB_SIM_FAILED", "retcode" => string(solution.retcode))))
        end
        for idx in eachindex(solution.u)
            state_samples[idx] = collect(Float64, solution.u[idx])
        end
    end

    signals = build_control_signals(time_points, state_samples, compiled)
    return Dict{String, Any}(
        "time" => time_points,
        "signals" => signals,
    )
end

"""
    compute_step_metrics(time_points, values)

阶跃响应指标（对单条 scope 信号；数值细节：穿越时刻一律线性插值）：
- `final_value`：末段 5% 样本（至少 1 个）的均值；
- `peak_value` / `peak_time_s`：响应方向（final 相对首样本的符号）上最大偏移的极值及其首次时刻；
- `overshoot_pct`：(peak − final)·dir / |final| × 100，下限截断为 0（单调无超调 → 0）；
  |final| ≈ 0 时无定义，置 null；
- `rise_time_s`：从初值到终值的 10% → 90% 首次穿越时刻之差；任一阈值未穿越 → null；
- `settling_time_s`：最后一次离开 ±2%·|final| 带的带边界穿越时刻（其后恒在带内）；
  全程在带内 → 0.0；末样本仍在带外或 |final| ≈ 0 → null。
"""
function compute_step_metrics(time_points::Vector{Float64}, values::Vector{Float64})
    n = length(values)
    n >= 2 || throw(ValidationError("阶跃指标至少需要 2 个采样点", Dict("n_samples" => n)))

    tail_count = max(1, round(Int, 0.05 * n))
    final_value = sum(@view values[(n - tail_count + 1):n]) / tail_count

    y0 = values[1]
    direction = final_value >= y0 ? 1.0 : -1.0

    # 峰值：响应方向上最大偏移（首次出现）
    peak_idx = 1
    peak_metric = direction * values[1]
    for i in 2:n
        metric = direction * values[i]
        if metric > peak_metric
            peak_metric = metric
            peak_idx = i
        end
    end
    peak_value = values[peak_idx]
    peak_time = time_points[peak_idx]

    final_is_zero = abs(final_value) < 1e-12

    overshoot = if final_is_zero
        nothing
    else
        max(0.0, direction * (peak_value - final_value) / abs(final_value) * 100.0)
    end

    # 首次穿越 level 的时刻（线性插值；首样本已达阈值 → t[1]）
    function first_crossing(level::Float64)
        for i in 1:n
            direction * (values[i] - level) >= 0.0 || continue
            i == 1 && return time_points[1]
            denom = values[i] - values[i - 1]
            frac = abs(denom) < eps(Float64) ? 0.0 : (level - values[i - 1]) / denom
            return time_points[i - 1] + frac * (time_points[i] - time_points[i - 1])
        end
        return nothing
    end
    t_lo = first_crossing(y0 + 0.10 * (final_value - y0))
    t_hi = first_crossing(y0 + 0.90 * (final_value - y0))
    rise_time = (t_lo === nothing || t_hi === nothing) ? nothing : t_hi - t_lo

    # 稳定时间：最后一次离开 ±2%|final| 带的带边界穿越时刻
    settling_time = if final_is_zero
        nothing
    else
        band = 0.02 * abs(final_value)
        last_outside = 0
        for i in n:-1:1
            if abs(values[i] - final_value) > band
                last_outside = i
                break
            end
        end
        if last_outside == 0
            0.0  # 全程在带内
        elseif last_outside == n
            nothing  # 末样本仍在带外：未稳定
        else
            i = last_outside
            boundary = values[i] > final_value + band ? final_value + band : final_value - band
            denom = values[i + 1] - values[i]
            frac = abs(denom) < eps(Float64) ? 1.0 : (boundary - values[i]) / denom
            time_points[i] + frac * (time_points[i + 1] - time_points[i])
        end
    end

    return Dict{String, Any}(
        "final_value" => final_value,
        "overshoot_pct" => overshoot,
        "rise_time_s" => rise_time,
        "settling_time_s" => settling_time,
        "peak_value" => peak_value,
        "peak_time_s" => peak_time,
    )
end

function run_simulation(payload::ControlSimulationPayload)
    try
        data = simulate_control_payload(payload)
        metrics = Dict{String, Any}()
        for signal in data["signals"]
            metrics[signal["id"]] = compute_step_metrics(data["time"], signal["values"])
        end
        data["metrics"] = metrics
        return Dict(
            "status" => "ok",
            "message" => "控制系统时域仿真完成",
            "method" => "transient",
            "data" => data,
        )
    catch err
        if err isa ValidationError
            return Dict("status" => "error", "code" => get(err.data, "code", "LAB_VALIDATION"), "message" => err.message, "data" => err.data)
        else
            @error "control simulation failed" exception = (err, catch_backtrace())
            return Dict("status" => "error", "code" => "LAB_INTERNAL", "message" => "internal error", "data" => Dict("error" => string(err)))
        end
    end
end
