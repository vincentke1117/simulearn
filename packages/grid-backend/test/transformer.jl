# 变压器分接头与并联电容组（教材第十二章调压，例 12-3）：两母线闭式解对拍。
#
# 例 12-3：降压变压器 110±2×2.5%/6.3 kV，阻抗归算到高压侧 2.44 + j40 Ω；
# 最大负荷 28 + j14 MVA（高压侧 110 kV），最小负荷 10 + j6 MVA（高压侧 113 kV）；
# 低压母线要求 6.0~6.6 kV。教材简化法选 107.25 kV 挡（−1 挡）。

const CH12 = (hv_kv=110.0, lv_kv=6.3, r=2.44, x=40.0, step=2.5, steps=2, lv_bus_kv=6.0)
const CH12_CASES = (
    max=(u1=110.0, p=28.0, q=14.0),
    min=(u1=113.0, p=10.0, q=6.0),
)

function ch12_topology(; u1, p, q, tap_pos, caps_on=0, q_unit_kvar=2000.0)
    return Dict(
        "meta" => Dict("baseMVA" => 100.0),
        "nodes" => [
            Dict("id" => "bus-hv", "type" => "Bus", "kv" => CH12.hv_kv, "is_slack" => true, "vm_pu" => u1 / CH12.hv_kv,
                "vmin_pu" => 0.9, "vmax_pu" => 1.1),
            Dict("id" => "bus-lv", "type" => "Bus", "kv" => CH12.lv_bus_kv, "vmin_pu" => 1.0, "vmax_pu" => 1.1),
            Dict("id" => "grid", "type" => "Gen", "bus" => "bus-hv", "p_kw" => 0.0, "p_max_kw" => 1e6,
                "q_max_kvar" => 1e6, "q_min_kvar" => -1e6),
            Dict("id" => "load", "type" => "Load", "bus" => "bus-lv", "p_kw" => p * 1000, "q_kvar" => q * 1000),
            Dict("id" => "cap", "type" => "Capacitor", "bus" => "bus-lv", "q_unit_kvar" => q_unit_kvar, "groups" => 4,
                "in_service" => caps_on),
        ],
        "links" => [
            Dict("id" => "T1", "type" => "Transformer", "from" => "bus-hv", "to" => "bus-lv",
                "hv_kv" => CH12.hv_kv, "lv_kv" => CH12.lv_kv, "r_ohm" => CH12.r, "x_ohm" => CH12.x,
                "tap_step_pct" => CH12.step, "tap_steps" => CH12.steps, "tap_pos" => tap_pos),
        ],
    )
end

"""
两母线精确闭式解（高压侧归算）：U1 —— Z —— 内节点 V（高压侧 kV）—— 理想变压器 U_tap:U_2N —— 低压母线。
低压侧恒功率负荷 P + jQ，并联电容组电纳在低压母线额定电压下为 bs（MVar），其补偿无功随 V² 变化：
Q' = Q − bs·(V_低/U_低额定)²。对 a = |V|² 得一元二次方程，取较大根。
返回 (低压母线 kV, 高压侧送出 P, Q, 低压侧收到 P, Q)。
"""
function ch12_exact(; u1, p, q, tap_pos, bs=0.0)
    r, x = CH12.r, CH12.x
    u_tap = CH12.hv_kv * (1 + tap_pos * CH12.step / 100)
    k = (CH12.lv_kv / u_tap)^2 / CH12.lv_bus_kv^2      # V_低² / U_低额定² = k·a
    c = bs * k                                          # Q_C = c·a
    α, β, γ, δ = 1 - x * c, r * p + x * q, r * c, x * p - r * q
    A = α^2 + γ^2
    B = 2α * β + 2γ * δ - u1^2
    C = β^2 + δ^2
    a = (-B + sqrt(B^2 - 4A * C)) / (2A)
    q_net = q - c * a
    loss = (p^2 + q_net^2) / a
    v_lv = sqrt(a) * CH12.lv_kv / u_tap
    return (v_lv=v_lv, p_send=p + r * loss, q_send=q_net + x * loss, p_recv=p, q_recv=q_net)
end

function ch12_run(; kwargs...)
    raw = JGDO.run_pf(JSON3.write(ch12_topology(; kwargs...)))
    res = JSON3.read(raw)
    res["status"] == "ok" || error("power flow failed: " * String(raw))
    lv = only(b for b in res["data"]["buses"] if b["id"] == "bus-lv")
    hv = only(b for b in res["data"]["buses"] if b["id"] == "bus-hv")
    t1 = only(b for b in res["data"]["branches"] if b["id"] == "T1")
    return (lv=lv, hv=hv, t1=t1)
end

@testset "Transformer taps vs two-bus closed form (例 12-3)" begin
    for (name, case) in pairs(CH12_CASES), pos in -CH12.steps:CH12.steps
        got = ch12_run(; case..., tap_pos=pos)
        exact = ch12_exact(; case..., tap_pos=pos)
        @test isapprox(got.lv["v_kv"], exact.v_lv; rtol=1e-6)
        @test isapprox(got.lv["vm_pu"] * CH12.lv_bus_kv, exact.v_lv; rtol=1e-6)
        @test got.lv["kv"] == CH12.lv_bus_kv
        # 高压侧送出 = 负荷 + 变压器损耗；低压侧收到 = 负荷（PowerModels 的 to 端功率是注入支路，取负号）
        @test isapprox(got.t1["p_mw"], exact.p_send; rtol=1e-6)
        @test isapprox(got.t1["q_mvar"], exact.q_send; rtol=1e-6)
        @test isapprox(-got.t1["p_to_mw"], exact.p_recv; rtol=1e-6)
        @test isapprox(-got.t1["q_to_mvar"], exact.q_recv; rtol=1e-6)
    end
end

@testset "Slack voltage setpoint other than 1.0 pu (113 kV)" begin
    got = ch12_run(; CH12_CASES.min..., tap_pos=0)
    @test isapprox(got.hv["vm_pu"], 113 / 110; atol=1e-9)
    @test isapprox(got.hv["v_kv"], 113.0; atol=1e-7)
end

@testset "例 12-3 conclusion: 107.25 kV is the only tap meeting 6.0~6.6 kV in both cases" begin
    feasible = Int[]
    for pos in -CH12.steps:CH12.steps
        vmax_case = ch12_run(; CH12_CASES.max..., tap_pos=pos).lv["v_kv"]
        vmin_case = ch12_run(; CH12_CASES.min..., tap_pos=pos).lv["v_kv"]
        (vmax_case >= 6.0 && vmin_case <= 6.6) && push!(feasible, pos)
    end
    @test feasible == [-1]
    @test CH12.hv_kv * (1 + feasible[1] * CH12.step / 100) ≈ 107.25
    # 教材简化法（忽略横分量）的数值：精确值与之相差约 0.05 kV，结论相同
    textbook_max = (110 - (28 * 2.44 + 14 * 40) / 110) * 6.3 / 107.25
    textbook_min = (113 - (10 * 2.44 + 6 * 40) / 113) * 6.3 / 107.25
    @test isapprox(ch12_run(; CH12_CASES.max..., tap_pos=-1).lv["v_kv"], textbook_max; atol=0.06)
    @test isapprox(ch12_run(; CH12_CASES.min..., tap_pos=-1).lv["v_kv"], textbook_min; atol=0.02)
end

@testset "Capacitor groups raise voltage by the closed-form amount" begin
    for caps in 0:4
        got = ch12_run(; CH12_CASES.max..., tap_pos=0, caps_on=caps)
        exact = ch12_exact(; CH12_CASES.max..., tap_pos=0, bs=caps * 2.0)
        @test isapprox(got.lv["v_kv"], exact.v_lv; rtol=1e-6)
        @test isapprox(-got.t1["q_to_mvar"], exact.q_recv; rtol=1e-6)
    end
    # 投入越多，电压越高（符号对：电容向系统注入无功）
    v = [ch12_run(; CH12_CASES.max..., tap_pos=0, caps_on=c).lv["v_kv"] for c in 0:4]
    @test issorted(v) && v[end] > v[1] + 0.1
end

@testset "Transformer and capacitor validation" begin
    function bad(mutate!)
        t = ch12_topology(; CH12_CASES.max..., tap_pos=0)
        mutate!(t)
        return JSON3.read(JGDO.run_pf(JSON3.write(t)))
    end
    reversed = bad(t -> (t["links"][1]["from"], t["links"][1]["to"]) = ("bus-lv", "bus-hv"))
    @test reversed["status"] == "error"
    out_of_range = bad(t -> (t["links"][1]["tap_pos"] = 3))
    @test out_of_range["status"] == "error"
    too_many_caps = bad(t -> (t["nodes"][5]["in_service"] = 5))
    @test too_many_caps["status"] == "error"
    line_across_levels = bad(t -> (t["links"][1]["type"] = "Line"))
    @test line_across_levels["status"] == "error"
end
