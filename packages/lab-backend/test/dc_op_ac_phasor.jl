# dc_op / ac_phasor 错误路径与响应形状测试（正解数值由 contracts/lab/*.json 金标准契约覆盖）

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
