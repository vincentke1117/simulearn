# 储能元件初始值（电容 v0、电感 i0）与交流源初相（phase）：数值正解由
# contracts/lab/transient-rc-discharge / rc-full-response / rl-initial-current / ac-source-phase、
# ac-phasor-source-phase 覆盖，这里测校验、缺省行为和串联 RLC 两个初值同时生效。

function _rlc_series(; v0 = 0.0, i0 = 0.0, extra = Dict{String, Float64}())
    components = [
        ComponentPayload("R1", "resistor", Dict("value" => 10.0), Dict("p" => "a", "n" => "b")),
        ComponentPayload("L1", "inductor", merge(Dict("value" => 1e-3, "i0" => i0), extra), Dict("p" => "b", "n" => "c")),
        ComponentPayload("C1", "capacitor", Dict("value" => 1e-6, "v0" => v0), Dict("p" => "c", "n" => "a")),
        ComponentPayload("G1", "ground", Dict{String, Float64}(), Dict("gnd" => "a")),
        ComponentPayload("VP1", "voltage_probe", Dict{String, Float64}(), Dict("node" => "c")),
    ]
    nets = [
        NetPayload("a", [["R1", "p"], ["C1", "n"], ["G1", "gnd"]]),
        NetPayload("b", [["R1", "n"], ["L1", "p"]]),
        NetPayload("c", [["L1", "n"], ["C1", "p"], ["VP1", "node"]]),
    ]
    SimulationPayload(components, nets, SimulationSettings(2e-3, 201), "transient", nothing, nothing)
end

@testset "初始值：串联 RLC 的电容电压与电感电流同时生效" begin
    # 电容初压 10V、电感初流 0：t=0 读数就是 10V，之后欠阻尼振荡衰减（ζ = R/2·√(C/L) ≈ 0.158）
    result = run_simulation(_rlc_series(v0 = 10.0))
    @test result["status"] == "ok"
    values = result["data"]["signals"][1]["values"]
    @test isapprox(first(values), 10.0; atol = 1e-6)
    @test minimum(values) < -5            # 过零反向，说明能量在 L、C 之间来回交换
    @test abs(last(values)) < 1.0         # 2ms ≈ 10 个时间常数 2L/R 之后基本放完

    # 只给电感初流：电容电压从 0 起步，初始斜率 dv/dt = i/C，方向取决于 i0 的正负（p→n 为正）
    up = run_simulation(_rlc_series(i0 = 0.01))["data"]["signals"][1]["values"]
    down = run_simulation(_rlc_series(i0 = -0.01))["data"]["signals"][1]["values"]
    @test isapprox(first(up), 0.0; atol = 1e-6)
    @test up[2] > 0 && down[2] < 0
    @test isapprox(up[2], -down[2]; rtol = 1e-6)
end

@testset "初始值：全为 0 且没有电源时仍然报缺电源" begin
    result = run_simulation(_rlc_series())
    @test result["status"] == "error"
    @test result["data"]["missing"] == ["source"]
    @test occursin("初始值", result["message"])
end

@testset "初始值 / 初相：非有限数拒收" begin
    result = run_simulation(_rlc_series(v0 = NaN))
    @test result["status"] == "error"
    @test result["code"] == "LAB_VALIDATION"
    @test result["data"]["parameter"] == "v0"

    phased = SimulationPayload([
        ComponentPayload("VAC1", "vsource_ac", Dict("amplitude" => 1.0, "frequency" => 50.0, "phase" => Inf), Dict("pos" => "n1", "neg" => "gnd")),
        ComponentPayload("R1", "resistor", Dict("value" => 1.0), Dict("p" => "n1", "n" => "gnd")),
        ComponentPayload("G1", "ground", Dict{String, Float64}(), Dict("gnd" => "gnd")),
    ], [
        NetPayload("n1", [["VAC1", "pos"], ["R1", "p"]]),
        NetPayload("gnd", [["VAC1", "neg"], ["R1", "n"], ["G1", "gnd"]]),
    ], SimulationSettings(1e-3, 10), "ac_phasor", nothing, nothing)
    result = run_simulation(phased)
    @test result["status"] == "error"
    @test result["data"]["parameter"] == "phase"
end

@testset "初始值：稳态类分析不看 v0 / i0" begin
    # 直流工作点里电容开路、电感短路，与初值无关：两种初值的结果必须完全一样
    payload(v0) = begin
        p = _rlc_series(v0 = v0)
        components = [p.components; ComponentPayload("V1", "vsource_dc", Dict("dc" => 5.0), Dict("pos" => "d", "neg" => "a"))]
        # 把电源串进 R1 前面：a—V1—d—R1
        components[1] = ComponentPayload("R1", "resistor", Dict("value" => 10.0), Dict("p" => "d", "n" => "b"))
        nets = [
            NetPayload("a", [["C1", "n"], ["G1", "gnd"], ["V1", "neg"]]),
            NetPayload("d", [["V1", "pos"], ["R1", "p"]]),
            p.nets[2], p.nets[3],
        ]
        SimulationPayload(components, nets, p.sim, "dc_op", nothing, nothing)
    end
    a = run_simulation(payload(0.0))
    b = run_simulation(payload(7.0))
    @test a["status"] == "ok" && b["status"] == "ok"
    @test a["data"]["node_voltages"] == b["data"]["node_voltages"]
end

# ---- 第二轮：初值只写进微分状态（审查发现的回归）、电流源进瞬态、零输入的参考点 ----

_gnd() = ComponentPayload("G1", "ground", Dict{String, Float64}(), Dict("gnd" => "gnd"))
_probe(id, net) = ComponentPayload(id, "voltage_probe", Dict{String, Float64}(), Dict("node" => net))
_tran(components, nets; t = 5e-3, n = 101) = SimulationPayload(components, nets, SimulationSettings(t, n), "transient", nothing, nothing)

# 电压源 5V 并电容并电阻：电容电压被电源钉住，C.v 不是状态
function _vdc_parallel_c(; v0 = nothing)
    params = v0 === nothing ? Dict("value" => 1e-6) : Dict("value" => 1e-6, "v0" => v0)
    _tran([
        ComponentPayload("V1", "vsource_dc", Dict("dc" => 5.0), Dict("pos" => "a", "neg" => "gnd")),
        ComponentPayload("C1", "capacitor", params, Dict("p" => "a", "n" => "gnd")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "a", "n" => "gnd")),
        _gnd(), _probe("VP1", "a"),
    ], [
        NetPayload("a", [["V1", "pos"], ["C1", "p"], ["R1", "p"], ["VP1", "node"]]),
        NetPayload("gnd", [["V1", "neg"], ["C1", "n"], ["R1", "n"], ["G1", "gnd"]]),
    ])
end

# 两个电容直接并联再并电阻（电荷重新分配，物理上是 t=0 的跳变）
function _parallel_caps(v1, v2)
    _tran([
        ComponentPayload("C1", "capacitor", Dict("value" => 1e-6, "v0" => v1), Dict("p" => "a", "n" => "gnd")),
        ComponentPayload("C2", "capacitor", Dict("value" => 1e-6, "v0" => v2), Dict("p" => "a", "n" => "gnd")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "a", "n" => "gnd")),
        _gnd(), _probe("VP1", "a"),
    ], [
        NetPayload("a", [["C1", "p"], ["C2", "p"], ["R1", "p"], ["VP1", "node"]]),
        NetPayload("gnd", [["C1", "n"], ["C2", "n"], ["R1", "n"], ["G1", "gnd"]]),
    ])
end

@testset "初值：被电源钉住的电容不带初值照常能算（回归），带了矛盾的初值明确拒绝" begin
    for payload in (_vdc_parallel_c(), _vdc_parallel_c(v0 = 0.0))
        result = run_simulation(payload)
        @test result["status"] == "ok"
        @test all(v -> isapprox(v, 5.0; atol = 1e-6), result["data"]["signals"][1]["values"])
    end
    result = run_simulation(_vdc_parallel_c(v0 = 2.0))
    @test result["status"] == "error"
    @test result["code"] == "LAB_VALIDATION"
    @test result["data"]["component"] == "C1" && result["data"]["parameter"] == "v0"
    @test occursin("电压源", result["message"])
end

@testset "初值：两个初压不同的电容直接并联，不给一条看似正常的曲线" begin
    for (a, b) in ((10.0, 0.0), (0.0, 10.0))
        result = run_simulation(_parallel_caps(a, b))
        @test result["status"] == "error"
        @test result["code"] == "LAB_VALIDATION"
    end
    # 初压相同就是自洽的：从 3V 开始放电（τ = R·2C = 2ms）
    result = run_simulation(_parallel_caps(3.0, 3.0))
    @test result["status"] == "ok"
    @test isapprox(first(result["data"]["signals"][1]["values"]), 3.0; atol = 1e-6)
end

@testset "初值：化简结果按拓扑缓存，改初值后不沿用上一次的值" begin
    discharge(v0) = _tran([
        ComponentPayload("C1", "capacitor", Dict("value" => 1e-6, "v0" => v0), Dict("p" => "a", "n" => "gnd")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "a", "n" => "gnd")),
        _gnd(), _probe("VP1", "a"),
    ], [
        NetPayload("a", [["C1", "p"], ["R1", "p"], ["VP1", "node"]]),
        NetPayload("gnd", [["C1", "n"], ["R1", "n"], ["G1", "gnd"]]),
    ])
    for v0 in (5.0, 3.0, -2.0)
        result = run_simulation(discharge(v0))
        @test result["status"] == "ok"
        @test isapprox(first(result["data"]["signals"][1]["values"]), v0; atol = 1e-6)
    end
end

@testset "电流源进瞬态（原先 structural_simplify 抛 MethodError，一律 500）" begin
    # 1 mA 从电流源的 neg 端流出注入结点 a，经 1kΩ 并 1μF 到地：u = 1V·(1 − e^(−t/τ))，τ = 1ms
    payload = _tran([
        ComponentPayload("I1", "isource_dc", Dict("dc" => 1e-3), Dict("pos" => "gnd", "neg" => "a")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "a", "n" => "gnd")),
        ComponentPayload("C1", "capacitor", Dict("value" => 1e-6), Dict("p" => "a", "n" => "gnd")),
        _gnd(), _probe("VP1", "a"),
    ], [
        NetPayload("a", [["I1", "neg"], ["R1", "p"], ["C1", "p"], ["VP1", "node"]]),
        NetPayload("gnd", [["I1", "pos"], ["R1", "n"], ["C1", "n"], ["G1", "gnd"]]),
    ])
    result = run_simulation(payload)
    @test result["status"] == "ok"
    values = result["data"]["signals"][1]["values"]
    @test isapprox(values[21], 1 - exp(-1); atol = 5e-3)
    @test isapprox(last(values), 1 - exp(-5); atol = 5e-3)
end

@testset "零输入、不接地：参考点取带初值电容的 n 端，p 端读数从 +v0 开始" begin
    payload = _tran([
        ComponentPayload("C1", "capacitor", Dict("value" => 1e-6, "v0" => 10.0), Dict("p" => "h1", "n" => "h2")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "h1", "n" => "h2")),
        _probe("VP1", "h1"),
    ], [
        NetPayload("h1", [["C1", "p"], ["R1", "p"], ["VP1", "node"]]),
        NetPayload("h2", [["C1", "n"], ["R1", "n"]]),
    ])
    result = run_simulation(payload)
    @test result["status"] == "ok"
    @test result["data"]["reference"][1]["component"] == "C1"
    @test isapprox(first(result["data"]["signals"][1]["values"]), 10.0; atol = 1e-6)
end

@testset "戴维宁：外加电源法求 Req，电桥平衡时不再得到 0 或 1e12" begin
    # 10V 源接两个桥臂 R1-R2、R3-R4（全 100Ω），端口在两个中点：Uoc = 0，Req = 100∥100 + 100∥100 = 100Ω
    components = [
        ComponentPayload("V1", "vsource_dc", Dict("dc" => 10.0), Dict("pos" => "top", "neg" => "gnd")),
        ComponentPayload("R1", "resistor", Dict("value" => 100.0), Dict("p" => "top", "n" => "m1")),
        ComponentPayload("R2", "resistor", Dict("value" => 100.0), Dict("p" => "m1", "n" => "gnd")),
        ComponentPayload("R3", "resistor", Dict("value" => 100.0), Dict("p" => "top", "n" => "m2")),
        ComponentPayload("R4", "resistor", Dict("value" => 100.0), Dict("p" => "m2", "n" => "gnd")),
        _gnd(),
    ]
    nets = [
        NetPayload("top", [["V1", "pos"], ["R1", "p"], ["R3", "p"]]),
        NetPayload("m1", [["R1", "n"], ["R2", "p"]]),
        NetPayload("m2", [["R3", "n"], ["R4", "p"]]),
        NetPayload("gnd", [["V1", "neg"], ["R2", "n"], ["R4", "n"], ["G1", "gnd"]]),
    ]
    payload = SimulationPayload(components, nets, SimulationSettings(1e-3, 10), "thevenin", Dict("positive" => "m1", "negative" => "m2"), nothing)
    result = run_simulation(payload)
    @test result["status"] == "ok"
    @test isapprox(result["data"]["vth"], 0.0; atol = 1e-9)
    @test isapprox(result["data"]["rth"], 100.0; atol = 1e-6)
    @test isapprox(result["data"]["isc"], 0.0; atol = 1e-9)
end

# ---- 第三轮（第二轮审查发现）：元件 id 不是合法标识符、被电源钉住的电容不被连坐、受控电流源进瞬态、戴维宁端口校验 ----

@testset "初值：元件 id 不是合法 Julia 标识符（C-1、带空格、数字开头）时初值照样生效" begin
    for id in ("C-1", "C 1", "C.1", "1C", "电容1")
        payload = _tran([
            ComponentPayload(id, "capacitor", Dict("value" => 1e-6, "v0" => 5.0), Dict("p" => "a", "n" => "gnd")),
            ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "a", "n" => "gnd")),
            _gnd(), _probe("VP1", "a"),
        ], [
            NetPayload("a", [[id, "p"], ["R1", "p"], ["VP1", "node"]]),
            NetPayload("gnd", [[id, "n"], ["R1", "n"], ["G1", "gnd"]]),
        ])
        result = run_simulation(payload)
        @test result["status"] == "ok"
        @test isapprox(first(result["data"]["signals"][1]["values"]), 5.0; atol = 1e-6)
    end
end

@testset "初值：电源两端并的滤波电容（没设初值）不因别处有初值而被拒" begin
    # 5V 并 C1（被钉住、不设初值），经 R1 给带 2V 初压的 C2 充电：C2 从 2V 走向 5V
    payload = _tran([
        ComponentPayload("V1", "vsource_dc", Dict("dc" => 5.0), Dict("pos" => "a", "neg" => "gnd")),
        ComponentPayload("C1", "capacitor", Dict("value" => 1e-6, "v0" => 0.0), Dict("p" => "a", "n" => "gnd")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "a", "n" => "b")),
        ComponentPayload("C2", "capacitor", Dict("value" => 1e-6, "v0" => 2.0), Dict("p" => "b", "n" => "gnd")),
        _gnd(), _probe("VP1", "b"),
    ], [
        NetPayload("a", [["V1", "pos"], ["C1", "p"], ["R1", "p"]]),
        NetPayload("b", [["R1", "n"], ["C2", "p"], ["VP1", "node"]]),
        NetPayload("gnd", [["V1", "neg"], ["C1", "n"], ["C2", "n"], ["G1", "gnd"]]),
    ])
    result = run_simulation(payload)
    @test result["status"] == "ok"
    values = result["data"]["signals"][1]["values"]
    @test isapprox(first(values), 2.0; atol = 1e-6)
    @test isapprox(values[21], 5 - 3 * exp(-1); atol = 5e-3)
end

@testset "初值：只给一个并联电容设初压，另一个没设，同样拒绝（物理上是 t=0 的电荷重新分配）" begin
    payload = _tran([
        ComponentPayload("C1", "capacitor", Dict("value" => 1e-6, "v0" => 5.0), Dict("p" => "a", "n" => "gnd")),
        ComponentPayload("C2", "capacitor", Dict("value" => 1e-6), Dict("p" => "a", "n" => "gnd")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "a", "n" => "gnd")),
        _gnd(), _probe("VP1", "a"),
    ], [
        NetPayload("a", [["C1", "p"], ["C2", "p"], ["R1", "p"], ["VP1", "node"]]),
        NetPayload("gnd", [["C1", "n"], ["C2", "n"], ["R1", "n"], ["G1", "gnd"]]),
    ])
    result = run_simulation(payload)
    @test result["status"] == "error"
    @test result["code"] == "LAB_VALIDATION"
    @test occursin("电容", result["message"])
end

@testset "受控电流源进瞬态（控制侧原先写成 sensor.i ~ 连接器，一律 500）：稳态与直流同号" begin
    # 控制电流 = 1V / 1kΩ = 1mA 从 ctrl_p 流到 ctrl_n；CCCS 增益 1，从 neg 端（a）流出注入 1kΩ 并 1μF
    function cccs_rc(method)
        SimulationPayload([
            ComponentPayload("V1", "vsource_dc", Dict("dc" => 1.0), Dict("pos" => "c", "neg" => "gnd")),
            ComponentPayload("Rc", "resistor", Dict("value" => 1000.0), Dict("p" => "d", "n" => "gnd")),
            ComponentPayload("F1", "cccs", Dict("gain" => 1.0), Dict("pos" => "gnd", "neg" => "a", "ctrl_p" => "c", "ctrl_n" => "d")),
            ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "a", "n" => "gnd")),
            ComponentPayload("C1", "capacitor", Dict("value" => 1e-6), Dict("p" => "a", "n" => "gnd")),
            _gnd(), _probe("VP1", "a"),
        ], [
            NetPayload("c", [["V1", "pos"], ["F1", "ctrl_p"]]),
            NetPayload("d", [["F1", "ctrl_n"], ["Rc", "p"]]),
            NetPayload("a", [["F1", "neg"], ["R1", "p"], ["C1", "p"], ["VP1", "node"]]),
            NetPayload("gnd", [["V1", "neg"], ["Rc", "n"], ["F1", "pos"], ["R1", "n"], ["C1", "n"], ["G1", "gnd"]]),
        ], SimulationSettings(5e-3, 101), method, nothing, nothing)
    end
    dc = run_simulation(cccs_rc("dc_op"))
    @test dc["status"] == "ok"
    @test isapprox(dc["data"]["node_voltages"]["a"], 1.0; atol = 1e-6)
    tr = run_simulation(cccs_rc("transient"))
    @test tr["status"] == "ok"
    @test isapprox(last(tr["data"]["signals"][1]["values"]), 1 - exp(-5); atol = 5e-3)
end

@testset "瞬态里电流源开路：说清原因（原先 500「内部出错」）" begin
    payload = _tran([
        ComponentPayload("I1", "isource_dc", Dict("dc" => 1e-3), Dict("pos" => "gnd", "neg" => "a")),
        _gnd(), _probe("VP1", "a"),
    ], [
        NetPayload("a", [["I1", "neg"], ["VP1", "node"]]),
        NetPayload("gnd", [["I1", "pos"], ["G1", "gnd"]]),
    ])
    result = run_simulation(payload)
    @test result["status"] == "error"
    @test result["code"] == "LAB_VALIDATION"
end

@testset "戴维宁端口：不存在、同一结点、跨在互不导通的两块电路上、等效电阻无穷大，都明确拒绝" begin
    divider = [
        ComponentPayload("V1", "vsource_dc", Dict("dc" => 10.0), Dict("pos" => "s", "neg" => "gnd")),
        ComponentPayload("R1", "resistor", Dict("value" => 10.0), Dict("p" => "s", "n" => "m")),
        ComponentPayload("R2", "resistor", Dict("value" => 10.0), Dict("p" => "m", "n" => "gnd")),
        _gnd(),
    ]
    island = [
        ComponentPayload("R3", "resistor", Dict("value" => 10.0), Dict("p" => "x", "n" => "y")),
        ComponentPayload("R4", "resistor", Dict("value" => 10.0), Dict("p" => "x", "n" => "y")),
    ]
    nets = [
        NetPayload("s", [["V1", "pos"], ["R1", "p"]]),
        NetPayload("m", [["R1", "n"], ["R2", "p"]]),
        NetPayload("gnd", [["V1", "neg"], ["R2", "n"], ["G1", "gnd"]]),
        NetPayload("x", [["R3", "p"], ["R4", "p"]]),
        NetPayload("y", [["R3", "n"], ["R4", "n"]]),
    ]
    thevenin(components, port) = run_simulation(SimulationPayload(components, nets, SimulationSettings(1e-3, 10), "thevenin", port, nothing))
    for port in (Dict("positive" => "nope", "negative" => "gnd"),
                 Dict("positive" => "m", "negative" => "m"),
                 Dict("positive" => "m", "negative" => "x"))
        result = thevenin([divider; island], port)
        @test result["status"] == "error"
        @test result["code"] == "LAB_VALIDATION"
    end
    ok = thevenin([divider; island], Dict("positive" => "m", "negative" => "gnd"))
    @test ok["status"] == "ok"
    @test isapprox(ok["data"]["rth"], 5.0; atol = 1e-9)

    # 端口 a 只接了一个理想电流源：独立源置零后 a 悬空，从端口看进去开路，等效电阻无穷大
    only_source = SimulationPayload([
        ComponentPayload("I1", "isource_dc", Dict("dc" => 1.0), Dict("pos" => "gnd", "neg" => "a")),
        ComponentPayload("R1", "resistor", Dict("value" => 10.0), Dict("p" => "b", "n" => "gnd")),
        _gnd(),
    ], [
        NetPayload("a", [["I1", "neg"]]),
        NetPayload("b", [["R1", "p"]]),
        NetPayload("gnd", [["I1", "pos"], ["R1", "n"], ["G1", "gnd"]]),
    ], SimulationSettings(1e-3, 10), "thevenin", Dict("positive" => "a", "negative" => "b"), nothing)
    result = run_simulation(only_source)
    @test result["status"] == "error"
    @test result["code"] == "LAB_VALIDATION"
    @test occursin("无穷大", result["message"])
end
