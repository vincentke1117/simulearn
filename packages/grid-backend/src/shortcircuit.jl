module ShortCircuit

# 三相对称短路计算（v1，IEC 教学惯例）。
#
# 建模假设（文档约定）：
#   * 预故障电压 V_pre 取自 AC 潮流解。
#   * Y-bus 按支路 π 模型组装（含 b_fr/b_to 并联与非 1 变比的标准 stamp）。
#   * 带 xd1_pu 的机组在其端母线并入 y_g = 1/(jX'd)。
#   * 无穷大母线（slack，bus_type == 3）并入大导纳源阻抗 j·1e-6 pu，
#     因此 slack 母线自身的短路电流数值上趋近 |V|/1e-6（理想源假设）。
#   * 负荷忽略（IEC 教学惯例）。
#   * Z_th(k) = 对 Y 解单位注入后的第 k 个对角元；I_f = |V_pre(k)|/|Z_th + zf|。
#   * 矩阵运算使用稠密 Complex{Float64}；`\` 的矩阵方法由 PowerModels 传递
#     加载的 LinearAlgebra 提供（本包 Project.toml 保持不变）。

import ..Errors: TopologyError, ValidationError
import ..PowerFlow: execute_power_flow, default_optimizer, sorted_component_keys
import ..Dynamics: ybus_network

export execute_shortcircuit, parse_shortcircuit_request

const SOURCE_X_PU = 1e-6

"""
    parse_shortcircuit_request(request)

校验并解析 `{"topology": ..., "fault_bus": "bus-5"|null, "zf_pu": 0.0}`，
返回 `(topology, fault_bus::Union{Nothing,String}, zf::Float64)`。
`fault_bus` 为 `null`/缺省时逐母线全扫。
"""
function parse_shortcircuit_request(request::AbstractDict)
    haskey(request, "topology") || throw(ValidationError("missing value", ["topology"]))
    topology = request["topology"]
    topology isa AbstractDict || throw(ValidationError("topology must be an object", ["topology"]))

    fault_bus = get(request, "fault_bus", nothing)
    fault_bus === nothing || fault_bus isa AbstractString ||
        throw(ValidationError("fault_bus must be a string or null", ["fault_bus"]))

    zf_raw = get(request, "zf_pu", 0.0)
    (zf_raw isa Real && isfinite(zf_raw)) || throw(ValidationError("expected finite number", ["zf_pu"]))
    zf = Float64(zf_raw)
    zf >= 0 || throw(ValidationError("zf_pu must be non-negative", ["zf_pu"]))

    return topology, fault_bus === nothing ? nothing : String(fault_bus), zf
end

"""短路计算用 Y-bus：网络支路/并联补偿 + 机组暂态电抗 + slack 源导纳，负荷忽略。"""
function shortcircuit_ybus(pm::AbstractDict)
    Y = ybus_network(pm)
    for gen in values(pm["gen"])
        get(gen, "gen_status", get(gen, "status", 1)) == 1 || continue
        haskey(gen, "xd1_pu") || continue
        xd1 = Float64(gen["xd1_pu"])
        xd1 > 0 || throw(ValidationError("xd1_pu must be positive", [string(gen["name"]), "xd1_pu"]))
        b = Int(gen["gen_bus"])
        Y[b, b] += inv(im * xd1)
    end
    for bus in values(pm["bus"])
        if bus["bus_type"] == 3
            b = Int(bus["bus_i"])
            Y[b, b] += inv(im * SOURCE_X_PU)
        end
    end
    return Y
end

"""对每个目标母线解单位注入，取 Z_th(k) = (Y⁻¹)[k,k]。"""
function thevenin_impedances(Y::Matrix{ComplexF64}, targets::Vector{Int})
    n = size(Y, 1)
    rhs = zeros(ComplexF64, n, length(targets))
    for (j, k) in enumerate(targets)
        rhs[k, j] = 1
    end
    Z = try
        Y \ rhs
    catch err
        throw(TopologyError("short-circuit network is singular: " * sprint(showerror, err)))
    end
    return [Z[k, j] for (j, k) in enumerate(targets)]
end

"""
    execute_shortcircuit(pm_data, fault_bus, zf; optimizer=default_optimizer())

三相对称短路主流程：预故障潮流 → 短路 Y-bus → 戴维南阻抗 → 短路电流/容量。
`fault_bus === nothing` 时逐母线全扫（按母线索引升序）。
"""
function execute_shortcircuit(pm_data::AbstractDict, fault_bus::Union{Nothing,String}, zf::Float64;
                              optimizer=default_optimizer())
    solved = execute_power_flow(pm_data; optimizer).pm_data
    base_mva = Float64(solved["baseMVA"])
    n = length(solved["bus"])

    targets = if fault_bus === nothing
        collect(1:n)
    else
        found = nothing
        for bus in values(solved["bus"])
            if string(bus["name"]) == fault_bus
                found = Int(bus["bus_i"])
                break
            end
        end
        found === nothing && throw(ValidationError("fault_bus not found: " * fault_bus, ["fault_bus"]))
        [found]
    end

    Y = shortcircuit_ybus(solved)
    zths = thevenin_impedances(Y, targets)

    results = Vector{Dict{String,Any}}()
    max_entry = nothing
    min_entry = nothing
    for (j, k) in enumerate(targets)
        bus = solved["bus"][string(k)]
        vpre = Float64(bus["vm"])
        kv = Float64(bus["base_kv"])
        zth = zths[j]
        i_f_pu = vpre / abs(zth + zf)
        s_sc_mva = i_f_pu * base_mva
        i_f_ka = s_sc_mva / (sqrt(3.0) * kv)
        entry = Dict{String,Any}(
            "bus" => string(bus["name"]),
            "v_prefault_pu" => vpre,
            "zth_pu" => Dict{String,Any}("r" => real(zth), "x" => imag(zth)),
            "i_f_pu" => i_f_pu,
            "i_f_ka" => i_f_ka,
            "s_sc_mva" => s_sc_mva,
        )
        push!(results, entry)
        (max_entry === nothing || i_f_ka > max_entry[2]) && (max_entry = (entry["bus"], i_f_ka))
        (min_entry === nothing || i_f_ka < min_entry[2]) && (min_entry = (entry["bus"], i_f_ka))
    end

    return Dict{String,Any}(
        "type" => "short_circuit",
        "results" => results,
        "summary" => Dict{String,Any}(
            "max_bus" => max_entry[1],
            "max_i_f_ka" => max_entry[2],
            "min_bus" => min_entry[1],
            "min_i_f_ka" => min_entry[2],
        ),
    )
end

end

using .ShortCircuit: execute_shortcircuit, parse_shortcircuit_request
