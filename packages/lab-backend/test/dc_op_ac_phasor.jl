# dc_op / ac_phasor 错误路径与响应形状测试（正解数值由 contracts/lab/*.json 金标准契约覆盖）

using JSON3

function _ground(id::String)
    ComponentPayload(id, "ground", Dict{String, Float64}(), Dict("gnd" => "gnd"))
end

@testset "dc_op" begin
    # 响应形状与 node_voltage 一致（node_voltages / branch_currents）
    components = [
        ComponentPayload("V1", "vsource_dc", Dict("dc" => 10.0), Dict("pos" => "n1", "neg" => "gnd")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "n1", "n" => "n2")),
        ComponentPayload("L1", "inductor", Dict("value" => 0.1), Dict("p" => "n2", "n" => "gnd")),
        _ground("G1"),
    ]
    nets = [
        NetPayload("n1", [["V1", "pos"], ["R1", "p"]]),
        NetPayload("n2", [["R1", "n"], ["L1", "p"]]),
        NetPayload("gnd", [["V1", "neg"], ["L1", "n"], ["G1", "gnd"]]),
    ]
    result = run_simulation(SimulationPayload(components, nets, SimulationSettings(1e-3, 10), "dc_op"))
    @test result["status"] == "ok"
    @test result["method"] == "dc_op"
    data = result["data"]
    @test haskey(data, "node_voltages")
    @test haskey(data, "branch_currents")
    # 电感短路：两端节点电压相等；稳态电流 10V/1k = 10mA（方向 p→n）
    @test abs(data["node_voltages"]["n2"] - 0.0) < 1e-9
    @test abs(data["branch_currents"]["L1"] - 0.01) < 1e-9
end

@testset "ac_phasor validation" begin
    settings = SimulationSettings(1e-3, 10)

    # 交流源频率不一致 → ValidationError
    components = [
        ComponentPayload("VAC1", "vsource_ac", Dict("amplitude" => 5.0, "frequency" => 1000.0), Dict("pos" => "n1", "neg" => "gnd")),
        ComponentPayload("VAC2", "vsource_ac", Dict("amplitude" => 5.0, "frequency" => 2000.0), Dict("pos" => "n2", "neg" => "gnd")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "n1", "n" => "n2")),
        _ground("G1"),
    ]
    nets = [
        NetPayload("n1", [["VAC1", "pos"], ["R1", "p"]]),
        NetPayload("n2", [["VAC2", "pos"], ["R1", "n"]]),
        NetPayload("gnd", [["VAC1", "neg"], ["VAC2", "neg"], ["G1", "gnd"]]),
    ]
    result = run_simulation(SimulationPayload(components, nets, settings, "ac_phasor"))
    @test result["status"] == "error"
    @test occursin("频率不一致", result["message"])

    # 无交流源 → ValidationError
    components = [
        ComponentPayload("V1", "vsource_dc", Dict("dc" => 5.0), Dict("pos" => "n1", "neg" => "gnd")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "n1", "n" => "gnd")),
        _ground("G1"),
    ]
    nets = [
        NetPayload("n1", [["V1", "pos"], ["R1", "p"]]),
        NetPayload("gnd", [["V1", "neg"], ["R1", "n"], ["G1", "gnd"]]),
    ]
    result = run_simulation(SimulationPayload(components, nets, settings, "ac_phasor"))
    @test result["status"] == "error"
    @test occursin("至少一个交流源", result["message"])

    # 受控源 → ValidationError（v1 不支持）
    components = [
        ComponentPayload("VAC1", "vsource_ac", Dict("amplitude" => 5.0, "frequency" => 1000.0), Dict("pos" => "n1", "neg" => "gnd")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "n1", "n" => "n2")),
        ComponentPayload("E1", "vcvs", Dict("gain" => 2.0), Dict("pos" => "n2", "neg" => "gnd", "ctrl_p" => "n1", "ctrl_n" => "gnd")),
        _ground("G1"),
    ]
    nets = [
        NetPayload("n1", [["VAC1", "pos"], ["R1", "p"], ["E1", "ctrl_p"]]),
        NetPayload("n2", [["R1", "n"], ["E1", "pos"]]),
        NetPayload("gnd", [["VAC1", "neg"], ["E1", "neg"], ["E1", "ctrl_n"], ["G1", "gnd"]]),
    ]
    result = run_simulation(SimulationPayload(components, nets, settings, "ac_phasor"))
    @test result["status"] == "error"
    @test occursin("暂不支持受控源", result["message"])
end

@testset "ac_phasor power" begin
    # RC 低通 @fc：|I|=5/(1000√2)（峰值），P_R1=|I|²R/2=6.25mW；
    # 源输出 P=6.25mW（R1 为唯一耗能元件）、Q=-6.25mvar（容性）、|S|=8.8388mVA、pf=0.7071
    components = [
        ComponentPayload("VAC1", "vsource_ac", Dict("amplitude" => 5.0, "frequency" => 1000.0), Dict("pos" => "n1", "neg" => "gnd")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "n1", "n" => "n2")),
        ComponentPayload("C1", "capacitor", Dict("value" => 1.5915494309189535e-7), Dict("p" => "n2", "n" => "gnd")),
        _ground("G1"),
    ]
    nets = [
        NetPayload("n1", [["VAC1", "pos"], ["R1", "p"]]),
        NetPayload("n2", [["R1", "n"], ["C1", "p"]]),
        NetPayload("gnd", [["VAC1", "neg"], ["C1", "n"], ["G1", "gnd"]]),
    ]
    result = run_simulation(SimulationPayload(components, nets, SimulationSettings(1e-3, 10), "ac_phasor"))
    @test result["status"] == "ok"
    data = result["data"]
    # 既有键全部保留（只新增 power）
    for key in ("frequency_hz", "node_voltages", "branch_currents", "node_phases_deg", "branch_phases_deg")
        @test haskey(data, key)
    end
    power = data["power"]
    @test haskey(power, "convention")
    @test abs(power["elements"]["R1"]["p_w"] - 0.00625) < 1e-9
    source = power["sources"]["VAC1"]
    @test abs(source["p_w"] - 0.00625) < 1e-9
    @test abs(source["q_var"] + 0.00625) < 1e-9
    @test abs(source["s_va"] - 0.008838834764831844) < 1e-9
    @test abs(source["pf"] - 0.7071067811865476) < 1e-9
end

@testset "frequency_sweep" begin
    settings = SimulationSettings(1e-3, 10)
    function rc_sweep_payload(sweep; with_probe::Bool = true)
        components = ComponentPayload[
            ComponentPayload("VAC1", "vsource_ac", Dict("amplitude" => 1.0, "frequency" => 1000.0), Dict("pos" => "n1", "neg" => "gnd")),
            ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "n1", "n" => "n2")),
            ComponentPayload("C1", "capacitor", Dict("value" => 1.5915494309189535e-7), Dict("p" => "n2", "n" => "gnd")),
            _ground("G1"),
        ]
        with_probe && push!(components, ComponentPayload("VP1", "voltage_probe", Dict{String, Float64}(), Dict("node" => "n2")))
        nets = [
            NetPayload("n1", [["VAC1", "pos"], ["R1", "p"]]),
            NetPayload("n2", [["R1", "n"], ["C1", "p"]]),
            NetPayload("gnd", [["VAC1", "neg"], ["C1", "n"], ["G1", "gnd"]]),
        ]
        SimulationPayload(components, nets, settings, "frequency_sweep", nothing, nothing, sweep)
    end

    # 缺少 sweep 参数
    result = run_simulation(rc_sweep_payload(nothing))
    @test result["status"] == "error"
    @test occursin("sweep", result["message"])

    # scale 非 log（v1 仅支持对数刻度）
    result = run_simulation(rc_sweep_payload(SweepSettings(10.0, 1000.0, 5, "linear")))
    @test result["status"] == "error"
    @test occursin("对数", result["message"])

    # f_start <= 0
    result = run_simulation(rc_sweep_payload(SweepSettings(0.0, 1000.0, 5, "log")))
    @test result["status"] == "error"
    # f_stop <= f_start
    result = run_simulation(rc_sweep_payload(SweepSettings(1000.0, 1000.0, 5, "log")))
    @test result["status"] == "error"
    # n_points 越界（下界/上界）
    result = run_simulation(rc_sweep_payload(SweepSettings(10.0, 1000.0, 1, "log")))
    @test result["status"] == "error"
    result = run_simulation(rc_sweep_payload(SweepSettings(10.0, 1000.0, 402, "log")))
    @test result["status"] == "error"

    # 无探针
    result = run_simulation(rc_sweep_payload(SweepSettings(100.0, 10000.0, 3, "log"); with_probe = false))
    @test result["status"] == "error"
    @test occursin("至少一个探针", result["message"])

    # 正常扫描（scale 缺省视为 log）：RC 低通 fc=1kHz 解析解
    result = run_simulation(rc_sweep_payload(SweepSettings(100.0, 10000.0, 3)))
    @test result["status"] == "ok"
    @test result["method"] == "frequency_sweep"
    data = result["data"]
    @test data["freq_hz"] ≈ [100.0, 1000.0, 10000.0]
    series = data["probes"]["VP1"]
    @test length(series["mag"]) == 3
    @test abs(series["mag"][2] - 1 / sqrt(2)) < 1e-9
    @test abs(series["phase_deg"][2] + 45.0) < 1e-6
    @test abs(series["mag_db"][2] + 3.0102999566398121) < 1e-9

    # 电流探针：支路电流（方向 p→n）也可作为扫描输出
    components = ComponentPayload[
        ComponentPayload("VAC1", "vsource_ac", Dict("amplitude" => 1.0, "frequency" => 1000.0), Dict("pos" => "n1", "neg" => "gnd")),
        ComponentPayload("A1", "current_probe", Dict{String, Float64}(), Dict("p" => "n1", "n" => "n2")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "n2", "n" => "n3")),
        ComponentPayload("C1", "capacitor", Dict("value" => 1.5915494309189535e-7), Dict("p" => "n3", "n" => "gnd")),
        _ground("G1"),
    ]
    nets = [
        NetPayload("n1", [["VAC1", "pos"], ["A1", "p"]]),
        NetPayload("n2", [["A1", "n"], ["R1", "p"]]),
        NetPayload("n3", [["R1", "n"], ["C1", "p"]]),
        NetPayload("gnd", [["VAC1", "neg"], ["C1", "n"], ["G1", "gnd"]]),
    ]
    payload = SimulationPayload(components, nets, settings, "frequency_sweep", nothing, nothing, SweepSettings(100.0, 10000.0, 3, "log"))
    result = run_simulation(payload)
    @test result["status"] == "ok"
    series = result["data"]["probes"]["A1"]
    # @fc：|I| = 1/(1000√2)，相位 +45°（电流超前电压）
    @test abs(series["mag"][2] - 1 / (1000 * sqrt(2))) < 1e-12
    @test abs(series["phase_deg"][2] - 45.0) < 1e-6
end

@testset "SimulationPayload sweep 可选字段零破坏" begin
    # 老 JSON（无 sweep / method / thevenin_port / teaching_mode）解析行为不变
    old_json = """
    {
      "components": [],
      "nets": [],
      "sim": { "t_stop": 0.001, "n_samples": 10 }
    }
    """
    payload = JSON3.read(old_json, SimulationPayload)
    @test payload.sweep === nothing
    @test payload.method === nothing
    @test payload.thevenin_port === nothing
    @test payload.teaching_mode === nothing

    # 带 sweep 的新 JSON 正常解析
    new_json = """
    {
      "components": [],
      "nets": [],
      "sim": { "t_stop": 0.001, "n_samples": 10 },
      "method": "frequency_sweep",
      "sweep": { "f_start_hz": 10.0, "f_stop_hz": 100000.0, "n_points": 61, "scale": "log" }
    }
    """
    payload = JSON3.read(new_json, SimulationPayload)
    @test payload.sweep isa SweepSettings
    @test payload.sweep.f_start_hz == 10.0
    @test payload.sweep.f_stop_hz == 100000.0
    @test payload.sweep.n_points == 61
    @test payload.sweep.scale == "log"

    # sweep 内 scale 可省略（缺省视为 log）
    no_scale_json = """
    {
      "components": [],
      "nets": [],
      "sim": { "t_stop": 0.001, "n_samples": 10 },
      "sweep": { "f_start_hz": 10.0, "f_stop_hz": 100.0, "n_points": 5 }
    }
    """
    payload = JSON3.read(no_scale_json, SimulationPayload)
    @test payload.sweep isa SweepSettings
    @test payload.sweep.scale === nothing
end

@testset "ac_phasor current probe" begin
    # 电流探针 = 0V 复数源：支路电流为 MNA 扩展变量（方向 p→n）
    components = [
        ComponentPayload("VAC1", "vsource_ac", Dict("amplitude" => 10.0, "frequency" => 1000.0), Dict("pos" => "n1", "neg" => "gnd")),
        ComponentPayload("A1", "current_probe", Dict{String, Float64}(), Dict("p" => "n1", "n" => "n2")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "n2", "n" => "gnd")),
        _ground("G1"),
    ]
    nets = [
        NetPayload("n1", [["VAC1", "pos"], ["A1", "p"]]),
        NetPayload("n2", [["A1", "n"], ["R1", "p"]]),
        NetPayload("gnd", [["VAC1", "neg"], ["R1", "n"], ["G1", "gnd"]]),
    ]
    result = run_simulation(SimulationPayload(components, nets, SimulationSettings(1e-3, 10), "ac_phasor"))
    @test result["status"] == "ok"
    data = result["data"]
    @test abs(data["branch_currents"]["A1"] - 0.01) < 1e-9
    @test abs(data["branch_phases_deg"]["A1"] - 0.0) < 1e-6
end
