module Dynamics

# 机电暂态稳定仿真（经典模型，平衡正序，v1）。
#
# 模型假设：
#   * 同步机经典二阶模型：恒定内电势 |E'| 置于暂态电抗 X'd 之后，摇摆方程
#     dδ/dt = ω − ωs，dω/dt = ωs/(2H)·(Pm − Pe − D·(ω−ωs)/ωs)。
#   * 负荷转恒导纳 ȳ_L = (P_L − jQ_L)/|V|²，并入 Y-bus 对角元。
#   * 非动态（无 h_s）且不在无穷大母线上的在运机组按负的恒功率负荷同样转恒导纳。
#   * slack 且不带 h_s 的母线 = 无穷大母线：内电势即其预故障端电压，作为保留
#     节点参与 Kron 降阶，但 δ、|E| 固定不积分。
#   * 矩阵运算使用稠密 Complex{Float64}（33 节点规模足够）；`\` 的矩阵方法由
#     PowerModels 传递加载的 LinearAlgebra 提供（本包 Project.toml 保持不变）。

import ..Errors: TopologyError, ValidationError
import ..PowerFlow: execute_power_flow, default_optimizer, sorted_component_keys

export execute_transient, parse_transient_request, ybus_network

const SERIES_MAX_POINTS = 500
const MAX_SIM_STEPS = 200_000
const CCT_SEARCH_WINDOW_S = 1.0
const CCT_TOL_S = 1e-3
const MIN_FAULT_Z_PU = 1e-6

struct Machine
    name::String
    bus::Int
    h::Float64      # 惯性常数 H [s]（系统基准）
    xd1::Float64    # 暂态电抗 X'd [pu]（系统基准）
    d::Float64      # 阻尼系数 D [pu]
    emag::Float64   # |E'| [pu]
    delta0::Float64 # δ0 [rad]
    pm::Float64     # 机械功率 Pm [pu]（= 预故障电磁功率 pg）
end

# ---------------------------------------------------------------------------
# 请求解析
# ---------------------------------------------------------------------------

function require_number(value, path::Vector{String})
    (value isa Real && isfinite(value)) || throw(ValidationError("expected finite number", path))
    return Float64(value)
end

"""
    parse_transient_request(request)

校验并解析暂态请求
`{"topology": ..., "fault": {...}, "sim": {...}, "f_hz": 50, "find_cct": false}`，
返回 `(topology, fault::NamedTuple, sim::NamedTuple, f_hz, find_cct)`。
"""
function parse_transient_request(request::AbstractDict)
    haskey(request, "topology") || throw(ValidationError("missing value", ["topology"]))
    topology = request["topology"]
    topology isa AbstractDict || throw(ValidationError("topology must be an object", ["topology"]))

    fault_raw = get(request, "fault", nothing)
    fault_raw isa AbstractDict || throw(ValidationError("fault must be an object", ["fault"]))
    bus = get(fault_raw, "bus", nothing)
    bus isa AbstractString || throw(ValidationError("fault.bus is required", ["fault", "bus"]))
    t_fault = require_number(get(fault_raw, "t_fault_s", 0.1), ["fault", "t_fault_s"])
    t_clear = require_number(get(fault_raw, "t_clear_s", 0.25), ["fault", "t_clear_s"])
    zf = require_number(get(fault_raw, "zf_pu", 0.0), ["fault", "zf_pu"])
    trip = get(fault_raw, "trip_branch", nothing)
    trip === nothing || trip isa AbstractString ||
        throw(ValidationError("trip_branch must be a string or null", ["fault", "trip_branch"]))
    t_fault >= 0 || throw(ValidationError("t_fault_s must be non-negative", ["fault", "t_fault_s"]))
    t_clear > t_fault || throw(ValidationError("t_clear_s must be greater than t_fault_s", ["fault", "t_clear_s"]))
    zf >= 0 || throw(ValidationError("zf_pu must be non-negative", ["fault", "zf_pu"]))

    sim_raw = get(request, "sim", Dict{String,Any}())
    sim_raw isa AbstractDict || throw(ValidationError("sim must be an object", ["sim"]))
    t_stop = require_number(get(sim_raw, "t_stop_s", 3.0), ["sim", "t_stop_s"])
    dt = require_number(get(sim_raw, "dt_s", 0.001), ["sim", "dt_s"])
    dt > 0 || throw(ValidationError("dt_s must be positive", ["sim", "dt_s"]))
    t_stop >= t_clear || throw(ValidationError("t_stop_s must not be less than t_clear_s", ["sim", "t_stop_s"]))
    # CCT 搜索会把仿真窗口延长到 t_clear+1.5s，一并计入步数上限。
    max_horizon = max(t_stop, t_fault + CCT_SEARCH_WINDOW_S + 1.5)
    max_horizon / dt <= MAX_SIM_STEPS ||
        throw(ValidationError("simulation exceeds $(MAX_SIM_STEPS) steps; increase dt_s or reduce t_stop_s", ["sim"]))

    f_hz = require_number(get(request, "f_hz", 50.0), ["f_hz"])
    f_hz > 0 || throw(ValidationError("f_hz must be positive", ["f_hz"]))

    find_cct = get(request, "find_cct", false)
    find_cct isa Bool || throw(ValidationError("find_cct must be a boolean", ["find_cct"]))

    fault = (bus=String(bus), t_fault_s=t_fault, t_clear_s=t_clear, zf_pu=zf,
             trip_branch=trip === nothing ? nothing : String(trip))
    sim = (t_stop_s=t_stop, dt_s=dt)
    return topology, fault, sim, f_hz, find_cct
end

# ---------------------------------------------------------------------------
# 网络导纳阵
# ---------------------------------------------------------------------------

"""
    ybus_network(pm)

由求解后的 per-unit `pm_data` 组装 n×n 稠密节点导纳阵：在运支路按 π 模型
（串联 ys=1/(r+jx)、两端并联 g_fr/b_fr、g_to/b_to、变比 tap 与移相 shift）
stamp，节点并联补偿（shunt gs/bs）计入对角元。负荷与机组均不在此处理。
"""
function ybus_network(pm::AbstractDict)
    n = length(pm["bus"])
    Y = zeros(ComplexF64, n, n)
    for branch in values(pm["branch"])
        get(branch, "br_status", 1) == 1 || continue
        f = Int(branch["f_bus"])
        t = Int(branch["t_bus"])
        ys = inv(complex(Float64(branch["br_r"]), Float64(branch["br_x"])))
        y_fr = complex(Float64(get(branch, "g_fr", 0.0)), Float64(get(branch, "b_fr", 0.0)))
        y_to = complex(Float64(get(branch, "g_to", 0.0)), Float64(get(branch, "b_to", 0.0)))
        tm = Float64(get(branch, "tap", 1.0))
        tm > 0 || (tm = 1.0)
        shift = Float64(get(branch, "shift", 0.0))  # make_per_unit! 后为弧度
        tphasor = tm * cis(shift)
        Y[f, f] += (ys + y_fr) / tm^2
        Y[t, t] += ys + y_to
        Y[f, t] += -ys / conj(tphasor)
        Y[t, f] += -ys / tphasor
    end
    for shunt in values(pm["shunt"])
        get(shunt, "status", 1) == 1 || continue
        b = Int(shunt["shunt_bus"])
        Y[b, b] += complex(Float64(get(shunt, "gs", 0.0)), Float64(get(shunt, "bs", 0.0)))
    end
    return Y
end

"""从求解后的 pm_data 提取动态机组（带 h_s 的在运机组），内电势 Ē' = V̄ + jX'd·Ī。"""
function extract_machines(pm::AbstractDict)
    machines = Machine[]
    for key in sorted_component_keys(pm["gen"])
        gen = pm["gen"][key]
        get(gen, "gen_status", get(gen, "status", 1)) == 1 || continue
        haskey(gen, "h_s") || continue
        name = string(gen["name"])
        h = Float64(gen["h_s"])
        h > 0 || throw(ValidationError("h_s must be positive", [name, "h_s"]))
        haskey(gen, "xd1_pu") || throw(ValidationError("dynamic generator requires xd1_pu", [name, "xd1_pu"]))
        xd1 = Float64(gen["xd1_pu"])
        xd1 > 0 || throw(ValidationError("xd1_pu must be positive", [name, "xd1_pu"]))
        d = Float64(get(gen, "d_pu", 0.0))
        d >= 0 || throw(ValidationError("d_pu must be non-negative", [name, "d_pu"]))
        bus = pm["bus"][string(gen["gen_bus"])]
        V = Float64(bus["vm"]) * cis(Float64(bus["va"]))
        S = complex(Float64(gen["pg"]), Float64(gen["qg"]))
        I = conj(S) / conj(V)
        E = V + im * xd1 * I
        push!(machines, Machine(name, Int(gen["gen_bus"]), h, xd1, d, abs(E), angle(E), Float64(gen["pg"])))
    end
    return machines
end

"""无穷大母线 = 不带动态机组的 slack 母线（bus_type == 3），按索引升序。"""
function infinite_bus_indices(pm::AbstractDict, machines::Vector{Machine})
    machine_buses = Set(m.bus for m in machines)
    infs = Int[]
    for key in sorted_component_keys(pm["bus"])
        bus = pm["bus"][key]
        if bus["bus_type"] == 3 && !(Int(bus["bus_i"]) in machine_buses)
            push!(infs, Int(bus["bus_i"]))
        end
    end
    return infs
end

"""
    augmented_ybus(pm, machines, inf_buses)

增广导纳阵（n 母线 + m 机组内电势节点）：网络 Y-bus 基础上，
负荷及非动态、非无穷大母线机组按预故障电压转恒导纳并入对角元，
每台动态机组经 y_g = 1/(jX'd) 挂到其端母线。
"""
function augmented_ybus(pm::AbstractDict, machines::Vector{Machine}, inf_buses::Vector{Int})
    n = length(pm["bus"])
    m = length(machines)
    Y = zeros(ComplexF64, n + m, n + m)
    Y[1:n, 1:n] .= ybus_network(pm)

    vm2 = Dict{Int,Float64}()
    for bus in values(pm["bus"])
        vm2[Int(bus["bus_i"])] = Float64(bus["vm"])^2
    end

    # 负荷 → 恒导纳
    for load in values(pm["load"])
        get(load, "status", 1) == 1 || continue
        b = Int(load["load_bus"])
        Y[b, b] += conj(complex(Float64(load["pd"]), Float64(load["qd"]))) / vm2[b]
    end

    # 非动态、非无穷大母线机组 → 负的恒功率负荷 → 恒导纳
    dynamic_names = Set(mach.name for mach in machines)
    inf_set = Set(inf_buses)
    for gen in values(pm["gen"])
        get(gen, "gen_status", get(gen, "status", 1)) == 1 || continue
        string(gen["name"]) in dynamic_names && continue
        b = Int(gen["gen_bus"])
        b in inf_set && continue  # 无穷大母线上的机组即理想源本身
        Y[b, b] += conj(-complex(Float64(gen["pg"]), Float64(gen["qg"]))) / vm2[b]
    end

    # 动态机组内电势节点
    for (i, mach) in enumerate(machines)
        yg = inv(im * mach.xd1)
        k = n + i
        Y[k, k] += yg
        Y[mach.bus, mach.bus] += yg
        Y[k, mach.bus] -= yg
        Y[mach.bus, k] -= yg
    end
    return Y
end

"""
    kron_reduce(Y, keep)

Kron 消去所有不在 `keep` 中的节点：Y_kk − Y_ke·Y_ee⁻¹·Y_ek。
"""
function kron_reduce(Y::Matrix{ComplexF64}, keep::Vector{Int})
    N = size(Y, 1)
    elim = setdiff(collect(1:N), keep)
    isempty(elim) && return Y[keep, keep]
    Yee = Y[elim, elim]
    Yek = Y[elim, keep]
    X = try
        Yee \ Yek
    catch err
        throw(TopologyError("network reduction failed (singular admittance submatrix): " * sprint(showerror, err)))
    end
    return Y[keep, keep] - Y[keep, elim] * X
end

# ---------------------------------------------------------------------------
# 摇摆方程积分（RK4 定步长）
# ---------------------------------------------------------------------------

"""Pei = Re(Ēi · conj(Σj Yij·Ēj))，等价于 Σj |Ei||Ej|(Gij cos δij + Bij sin δij)。"""
function electrical_power(Yred::Matrix{ComplexF64}, machines::Vector{Machine},
                          deltas::Vector{Float64}, einf::Vector{ComplexF64})
    m = length(machines)
    pe = Vector{Float64}(undef, m)
    E = Vector{ComplexF64}(undef, m + length(einf))
    for j in 1:m
        E[j] = machines[j].emag * cis(deltas[j])
    end
    for (j, Ej) in enumerate(einf)
        E[m+j] = Ej
    end
    for i in 1:m
        Ii = zero(ComplexF64)
        for j in eachindex(E)
            Ii += Yred[i, j] * E[j]
        end
        pe[i] = real(E[i] * conj(Ii))
    end
    return pe
end

function swing_derivatives(deltas::Vector{Float64}, omegas::Vector{Float64},
                           Yred::Matrix{ComplexF64}, machines::Vector{Machine},
                           einf::Vector{ComplexF64}, ws::Float64)
    pe = electrical_power(Yred, machines, deltas, einf)
    m = length(machines)
    ddelta = Vector{Float64}(undef, m)
    domega = Vector{Float64}(undef, m)
    for i in 1:m
        mach = machines[i]
        ddelta[i] = omegas[i] - ws
        domega[i] = ws / (2 * mach.h) * (mach.pm - pe[i] - mach.d * (omegas[i] - ws) / ws)
    end
    return ddelta, domega
end

function rk4_step(deltas, omegas, h, Yred, machines, einf, ws)
    k1d, k1w = swing_derivatives(deltas, omegas, Yred, machines, einf, ws)
    k2d, k2w = swing_derivatives(deltas .+ (h / 2) .* k1d, omegas .+ (h / 2) .* k1w, Yred, machines, einf, ws)
    k3d, k3w = swing_derivatives(deltas .+ (h / 2) .* k2d, omegas .+ (h / 2) .* k2w, Yred, machines, einf, ws)
    k4d, k4w = swing_derivatives(deltas .+ h .* k3d, omegas .+ h .* k3w, Yred, machines, einf, ws)
    new_d = deltas .+ (h / 6) .* (k1d .+ 2 .* k2d .+ 2 .* k3d .+ k4d)
    new_w = omegas .+ (h / 6) .* (k1w .+ 2 .* k2w .+ 2 .* k3w .+ k4w)
    return new_d, new_w
end

"""失稳判据：任一机组角差（相对首个无穷大母线，否则相对惯量中心 COI）超过 180°。"""
function is_unstable(deltas::Vector{Float64}, machines::Vector{Machine}, ref_inf::Union{Nothing,Float64})
    ref = if ref_inf !== nothing
        ref_inf
    else
        sum(machines[i].h * deltas[i] for i in eachindex(machines)) / sum(m.h for m in machines)
    end
    return any(abs(deltas[i] - ref) > pi for i in eachindex(machines))
end

"""
    simulate_swing(machines, einf, Ypre, Yfault, Ypost, t_fault, t_clear, t_stop, dt, ws; record=true)

分段（pre → fault → post）RK4 定步长积分，段边界精确对齐。返回
`(stable, t_unstable, ts, deltas, omegas)`；失稳即刻停止积分。
"""
function simulate_swing(machines::Vector{Machine}, einf::Vector{ComplexF64},
                        Ypre::Matrix{ComplexF64}, Yfault::Matrix{ComplexF64}, Ypost::Matrix{ComplexF64},
                        t_fault::Float64, t_clear::Float64, t_stop::Float64, dt::Float64, ws::Float64;
                        record::Bool=true)
    m = length(machines)
    deltas = [mach.delta0 for mach in machines]
    omegas = fill(ws, m)
    ref_inf = isempty(einf) ? nothing : angle(einf[1])

    ts = Float64[]
    delta_series = [Float64[] for _ in 1:m]
    omega_series = [Float64[] for _ in 1:m]
    function push_sample!(t)
        record || return
        push!(ts, t)
        for i in 1:m
            push!(delta_series[i], deltas[i])
            push!(omega_series[i], omegas[i] / ws)
        end
    end
    push_sample!(0.0)

    segments = (
        (0.0, min(t_fault, t_stop), Ypre),
        (min(t_fault, t_stop), min(t_clear, t_stop), Yfault),
        (min(t_clear, t_stop), t_stop, Ypost),
    )
    for (t0, t1, Y) in segments
        t = t0
        while t < t1 - 1e-9
            h = min(dt, t1 - t)
            deltas, omegas = rk4_step(deltas, omegas, h, Y, machines, einf, ws)
            t += h
            push_sample!(t)
            if is_unstable(deltas, machines, ref_inf)
                return (stable=false, t_unstable=t, ts=ts, deltas=delta_series, omegas=omega_series)
            end
        end
    end
    return (stable=true, t_unstable=nothing, ts=ts, deltas=delta_series, omegas=omega_series)
end

"""
    search_cct(...)

在 (t_fault, t_fault + 1.0s] 上对切除时刻二分（容差 1 ms，每次完整仿真）。
窗口上限仍稳定时返回 `nothing`（CCT 超出搜索窗）。每次仿真的时间窗延长到
max(t_stop, t_clear + 1.5s)，避免临界慢发散被截断误判。
"""
function search_cct(machines, einf, Ypre, Yfault, Ypost, t_fault, t_stop, dt, ws)
    stable_at(tc) = simulate_swing(machines, einf, Ypre, Yfault, Ypost,
        t_fault, tc, max(t_stop, tc + 1.5), dt, ws; record=false).stable
    hi = t_fault + CCT_SEARCH_WINDOW_S
    stable_at(hi) && return nothing
    lo = t_fault
    while hi - lo > CCT_TOL_S
        mid = (lo + hi) / 2
        if stable_at(mid)
            lo = mid
        else
            hi = mid
        end
    end
    return lo - t_fault
end

# ---------------------------------------------------------------------------
# 编排
# ---------------------------------------------------------------------------

function bus_index_by_name(pm::AbstractDict, name::AbstractString)
    for bus in values(pm["bus"])
        string(bus["name"]) == name && return Int(bus["bus_i"])
    end
    throw(ValidationError("fault bus not found: " * String(name), ["fault", "bus"]))
end

function branch_key_by_name(pm::AbstractDict, name::AbstractString)
    for (key, branch) in pm["branch"]
        string(branch["name"]) == name && return key
    end
    throw(ValidationError("trip_branch not found: " * String(name), ["fault", "trip_branch"]))
end

"""等间隔抽稀到 ≤ `SERIES_MAX_POINTS` 个采样点的索引。"""
function downsample_indices(n::Int)
    n <= SERIES_MAX_POINTS && return collect(1:n)
    return unique(round.(Int, range(1, n; length=SERIES_MAX_POINTS)))
end

"""
    execute_transient(pm_data, fault, sim, f_hz, find_cct; optimizer=default_optimizer())

机电暂态稳定仿真主流程：预故障潮流 → 内电势/恒导纳负荷 → pre/fault/post
三网络 Kron 降阶 → RK4 摇摆积分（+ 可选 CCT 二分）。
"""
function execute_transient(pm_data::AbstractDict, fault, sim, f_hz::Float64, find_cct::Bool;
                           optimizer=default_optimizer())
    solved = execute_power_flow(pm_data; optimizer).pm_data

    machines = extract_machines(solved)
    isempty(machines) &&
        throw(ValidationError("no generator provides dynamic parameters (h_s)", ["topology", "nodes"]))
    inf_buses = infinite_bus_indices(solved, machines)
    einf = ComplexF64[Float64(solved["bus"][string(b)]["vm"]) * cis(Float64(solved["bus"][string(b)]["va"]))
                      for b in inf_buses]

    fault_bus = bus_index_by_name(solved, fault.bus)
    n = length(solved["bus"])
    m = length(machines)
    keep = vcat(collect(n+1:n+m), inf_buses)

    Ybase = augmented_ybus(solved, machines, inf_buses)
    Ypre = kron_reduce(Ybase, keep)

    Yfault_full = copy(Ybase)
    Yfault_full[fault_bus, fault_bus] += inv(complex(max(fault.zf_pu, MIN_FAULT_Z_PU), 0.0))
    Yfault = kron_reduce(Yfault_full, keep)

    Ypost = if fault.trip_branch === nothing
        Ypre
    else
        key = branch_key_by_name(solved, fault.trip_branch)
        post_pm = deepcopy(solved)  # 只在副本上改，br_status/status 同步置 0
        post_pm["branch"][key]["br_status"] = 0
        post_pm["branch"][key]["status"] = 0
        kron_reduce(augmented_ybus(post_pm, machines, inf_buses), keep)
    end

    ws = 2 * pi * f_hz
    outcome = simulate_swing(machines, einf, Ypre, Yfault, Ypost,
        fault.t_fault_s, fault.t_clear_s, sim.t_stop_s, sim.dt_s, ws)

    cct = find_cct ?
        search_cct(machines, einf, Ypre, Yfault, Ypost, fault.t_fault_s, sim.t_stop_s, sim.dt_s, ws) :
        nothing

    idx = downsample_indices(length(outcome.ts))
    series = Dict{String,Any}(
        "t_s" => outcome.ts[idx],
        "delta_deg" => Dict{String,Any}(machines[i].name => rad2deg.(outcome.deltas[i][idx]) for i in 1:m),
        "omega_pu" => Dict{String,Any}(machines[i].name => outcome.omegas[i][idx] for i in 1:m),
    )
    machine_payload = [Dict{String,Any}(
        "id" => mach.name,
        "h_s" => mach.h,
        "xd1_pu" => mach.xd1,
        "delta0_deg" => rad2deg(mach.delta0),
        "pm_pu" => mach.pm,
    ) for mach in machines]

    return Dict{String,Any}(
        "type" => "transient_stability",
        "stable" => outcome.stable,
        "t_unstable_s" => outcome.t_unstable,
        "cct_s" => cct,
        "series" => series,
        "machines" => machine_payload,
        "fault" => Dict{String,Any}(
            "bus" => fault.bus,
            "t_fault_s" => fault.t_fault_s,
            "t_clear_s" => fault.t_clear_s,
            "zf_pu" => fault.zf_pu,
            "trip_branch" => fault.trip_branch,
        ),
    )
end

end

using .Dynamics: execute_transient, parse_transient_request
