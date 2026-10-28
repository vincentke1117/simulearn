# 不接地的电路：自动选参考点（src/Reference.jl）。数值正解由 contracts/lab/*floating*.json 契约覆盖，
# 这里测参考点怎么选、多块互不导通的电路、各分析方法都能走通、结果里的网络名还原。

_settings() = SimulationSettings(1e-3, 10)

# 5V 电源 + 两个 1kΩ 分压；ground = false 时不接地，V1 负极所在的网络叫 n3
function _divider(; method = "node_voltage", ground = false, port = nothing)
    neg = ground ? "gnd" : "n3"
    components = [
        ComponentPayload("V1", "vsource_dc", Dict("dc" => 5.0), Dict("pos" => "n1", "neg" => neg)),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "n1", "n" => "n2")),
        ComponentPayload("R2", "resistor", Dict("value" => 1000.0), Dict("p" => "n2", "n" => neg)),
    ]
    nets = [
        NetPayload("n1", [["V1", "pos"], ["R1", "p"]]),
        NetPayload("n2", [["R1", "n"], ["R2", "p"]]),
        NetPayload(neg, [["R2", "n"], ["V1", "neg"]]),
    ]
    if ground
        push!(components, ComponentPayload("G1", "ground", Dict{String, Float64}(), Dict("gnd" => "gnd")))
        push!(nets[3].nodes, ["G1", "gnd"])
    end
    SimulationPayload(components, nets, _settings(), method, port, nothing)
end

# 两块只靠 VCVS 控制口耦合的电路：左边 V1(1V)–R1，右边 E1(增益 2)–R2，两边之间不导通
function _vcvs_islands(; ground = false)
    left = ground ? "gnd" : "a0"
    components = [
        ComponentPayload("V1", "vsource_dc", Dict("dc" => 1.0), Dict("pos" => "a1", "neg" => left)),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "a1", "n" => left)),
        ComponentPayload("E1", "vcvs", Dict("gain" => 2.0), Dict("pos" => "b1", "neg" => "b0", "ctrl_p" => "a1", "ctrl_n" => left)),
        ComponentPayload("R2", "resistor", Dict("value" => 1000.0), Dict("p" => "b1", "n" => "b0")),
    ]
    nets = [
        NetPayload("a1", [["V1", "pos"], ["R1", "p"], ["E1", "ctrl_p"]]),
        NetPayload(left, [["V1", "neg"], ["R1", "n"], ["E1", "ctrl_n"]]),
        NetPayload("b1", [["E1", "pos"], ["R2", "p"]]),
        NetPayload("b0", [["E1", "neg"], ["R2", "n"]]),
    ]
    if ground
        push!(components, ComponentPayload("G1", "ground", Dict{String, Float64}(), Dict("gnd" => "gnd")))
        push!(nets[2].nodes, ["G1", "gnd"])
    end
    SimulationPayload(components, nets, _settings(), "node_voltage", nothing, nothing)
end

@testset "参考点：接了地的电路原样求解，不带 reference" begin
    result = run_simulation(_divider(ground = true))
    @test result["status"] == "ok"
    @test !haskey(result["data"], "reference")
    @test result["data"]["node_voltages"]["gnd"] == 0.0
end

@testset "参考点：不接地的分压电路，各直流方法都能算，网络名还原成学生的原名" begin
    grounded = run_simulation(_divider(ground = true))["data"]
    for method in ("node_voltage", "branch_current", "mesh_current", "dc_op")
        result = run_simulation(_divider(method = method))
        @test result["status"] == "ok"
        data = result["data"]
        @test data["reference"] == [Dict{String, Any}("net" => "n3", "component" => "V1", "terminal" => "neg")]
        @test data["node_voltages"]["n3"] == 0.0
        @test !haskey(data["node_voltages"], "gnd")   # 学生没画过 gnd，结果里也不出现
        @test isapprox(data["node_voltages"]["n2"], 2.5; atol = 1e-9)
        for id in ("R1", "R2", "V1")
            @test isapprox(data["branch_currents"][id], grounded["branch_currents"][id]; atol = 1e-9)
        end
    end
end

@testset "参考点：戴维南端口落在自动参考点上，端口名照旧" begin
    result = run_simulation(_divider(method = "thevenin", port = Dict("positive" => "n2", "negative" => "n3")))
    @test result["status"] == "ok"
    data = result["data"]
    @test isapprox(data["vth"], 2.5; atol = 1e-9)
    @test isapprox(data["rth"], 500.0; rtol = 1e-3)
    @test data["port"] == Dict("positive" => "n2", "negative" => "n3")
end

@testset "参考点：交流相量与频率扫描" begin
    components = [
        ComponentPayload("VAC1", "vsource_ac", Dict("amplitude" => 1.0, "frequency" => 1000.0), Dict("pos" => "n1", "neg" => "n0")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "n1", "n" => "n2")),
        ComponentPayload("C1", "capacitor", Dict("value" => 1.0 / (2pi * 1000.0 * 1000.0)), Dict("p" => "n2", "n" => "n0")),
        ComponentPayload("VP1", "voltage_probe", Dict{String, Float64}(), Dict("node" => "n2")),
    ]
    nets = [
        NetPayload("n1", [["VAC1", "pos"], ["R1", "p"]]),
        NetPayload("n2", [["R1", "n"], ["C1", "p"], ["VP1", "node"]]),
        NetPayload("n0", [["VAC1", "neg"], ["C1", "n"]]),
    ]
    ac = run_simulation(SimulationPayload(components, nets, _settings(), "ac_phasor"))
    @test ac["status"] == "ok"
    # 转折频率处 |V(n2)| = 1/√2，相角 −45°
    @test isapprox(ac["data"]["node_voltages"]["n2"], 1 / sqrt(2); atol = 1e-9)
    @test isapprox(ac["data"]["node_phases_deg"]["n2"], -45.0; atol = 1e-9)
    @test ac["data"]["node_phases_deg"]["n0"] == 0.0
    @test !haskey(ac["data"]["node_phases_deg"], "gnd")

    sweep = SimulationPayload(components, nets, _settings(), "frequency_sweep", nothing, nothing, SweepSettings(10.0, 1.0e5, 21))
    result = run_simulation(sweep)
    @test result["status"] == "ok"
    @test isapprox(first(result["data"]["probes"]["VP1"]["mag"]), 1.0; atol = 1e-3)
    @test result["data"]["reference"][1]["net"] == "n0"
end

@testset "参考点：只靠 VCVS 控制口耦合的两块电路，每块各取一个参考点" begin
    # 只有左边接地：右边原先整块悬空、方程奇异；现在取 E1 输出负极 b0 为参考
    result = run_simulation(_vcvs_islands(ground = true))
    @test result["status"] == "ok"
    data = result["data"]
    @test data["reference"] == [Dict{String, Any}("net" => "b0", "component" => "E1", "terminal" => "neg")]
    @test isapprox(data["node_voltages"]["b1"], 2.0; atol = 1e-9)
    @test isapprox(data["branch_currents"]["R2"], 0.002; atol = 1e-12)
    @test data["node_voltages"]["gnd"] == 0.0   # 学生自己画的地保留

    # 两边都不接地：左边取 V1 负极，右边取 E1 输出负极
    result = run_simulation(_vcvs_islands())
    @test result["status"] == "ok"
    data = result["data"]
    @test [point["net"] for point in data["reference"]] == ["a0", "b0"]
    @test data["node_voltages"]["a0"] == 0.0 && data["node_voltages"]["b0"] == 0.0
    @test isapprox(data["branch_currents"]["R1"], 0.001; atol = 1e-12)
    @test isapprox(data["branch_currents"]["R2"], 0.002; atol = 1e-12)
end

@testset "参考点：没有电源时取名字最小的网络；瞬态仍然要求电源" begin
    lone = SimulationPayload([
        ComponentPayload("R1", "resistor", Dict("value" => 100.0), Dict("p" => "n1", "n" => "n2")),
    ], [
        NetPayload("n1", [["R1", "p"]]),
        NetPayload("n2", [["R1", "n"]]),
    ], _settings())
    result = run_simulation(lone)
    @test result["status"] == "ok"
    @test result["data"]["reference"] == [Dict{String, Any}("net" => "n1", "component" => nothing, "terminal" => nothing)]

    transient = SimulationPayload(lone.components, lone.nets, _settings(), "transient")
    result = run_simulation(transient)
    @test result["status"] == "error"
    @test occursin("source", result["message"])
end
