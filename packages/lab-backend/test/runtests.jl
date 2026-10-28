using Test
using JCircuitServer
using JCircuitServer: ComponentPayload, NetPayload, SimulationSettings, SimulationPayload

@testset "bootstrap" begin
    config = bootstrap(start = false)
    @test config.host == "127.0.0.1"
    @test config.port == 8080
    @test config.router !== nothing
end

@testset "token guard (D17)" begin
    HTTP = JCircuitServer.HTTP
    config = bootstrap(start = false, warmup = false, token = "t0ken")
    no_token = config.handler(HTTP.Request("GET", "/health"))
    @test no_token.status == 401
    wrong = config.handler(HTTP.Request("GET", "/health", ["X-Zhifan-Ext-Token" => "nope"]))
    @test wrong.status == 401
    ok = config.handler(HTTP.Request("GET", "/health", ["X-Zhifan-Ext-Token" => "t0ken"]))
    @test ok.status == 200
    # 不再发跨域头，也不再响应 OPTIONS 预检
    @test !HTTP.hasheader(ok, "Access-Control-Allow-Origin")
    preflight = config.handler(HTTP.Request("OPTIONS", "/simulate", ["X-Zhifan-Ext-Token" => "t0ken"]))
    @test preflight.status != 200 || !HTTP.hasheader(preflight, "Access-Control-Allow-Origin")
end

@testset "封套 code → HTTP 状态码" begin
    status(code) = JCircuitServer.lab_http_status(Dict("status" => "error", "code" => code))
    @test JCircuitServer.lab_http_status(Dict("status" => "ok")) == 200
    @test status("LAB_VALIDATION") == 422
    @test status("LAB_SIM_FAILED") == 422   # 电路本身解不出来，学生改电路能解决
    @test status("LAB_INTERNAL") == 500
    @test status("LAB_NOT_REGISTERED") == 500   # 没登记的码保守归 500
    @test JCircuitServer.lab_http_status(Dict("status" => "error")) == 500
end

function sample_payload()
    components = [
        ComponentPayload("V1", "vsource_dc", Dict("dc" => 5.0), Dict("pos" => "n1", "neg" => "gnd")),
        ComponentPayload("R1", "resistor", Dict("value" => 1.0e3), Dict("p" => "n1", "n" => "n2")),
        ComponentPayload("C1", "capacitor", Dict("value" => 1.0e-6), Dict("p" => "n2", "n" => "gnd")),
        ComponentPayload("G1", "ground", Dict{String, Float64}(), Dict("gnd" => "gnd")),
        ComponentPayload("VP1", "voltage_probe", Dict{String, Float64}(), Dict("node" => "n1")),
    ]
    nets = [
        NetPayload("n1", [["V1", "pos"], ["R1", "p"], ["VP1", "node"]]),
        NetPayload("n2", [["R1", "n"], ["C1", "p"]]),
        NetPayload("gnd", [["V1", "neg"], ["C1", "n"], ["G1", "gnd"]]),
    ]
    SimulationPayload(components, nets, SimulationSettings(1e-3, 50))
end

@testset "run_simulation" begin
    payload = sample_payload()
    result = run_simulation(payload)
    @test result["status"] == "ok"
    data = result["data"]
    @test length(data["time"]) == payload.sim.n_samples
    @test length(data["signals"]) == 1
end

@testset "node_voltage branch_currents" begin
    components = [
        ComponentPayload("V1", "vsource_dc", Dict("dc" => 10.0), Dict("pos" => "n1", "neg" => "gnd")),
        ComponentPayload("A1", "current_probe", Dict{String, Float64}(), Dict("p" => "n1", "n" => "n2")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "n2", "n" => "gnd")),
        ComponentPayload("G1", "ground", Dict{String, Float64}(), Dict("gnd" => "gnd")),
    ]
    nets = [
        NetPayload("n1", [["V1", "pos"], ["A1", "p"]]),
        NetPayload("n2", [["A1", "n"], ["R1", "p"]]),
        NetPayload("gnd", [["V1", "neg"], ["R1", "n"], ["G1", "gnd"]]),
    ]
    payload = SimulationPayload(components, nets, SimulationSettings(1e-3, 10), "node_voltage", nothing, nothing)
    result = run_simulation(payload)
    @test result["status"] == "ok"
    data = result["data"]
    @test haskey(data, "branch_currents")
    @test abs(data["branch_currents"]["R1"] - 0.01) < 1e-6
    @test abs(data["branch_currents"]["A1"] - 0.01) < 1e-6   # 探针串联电流 p→n
    @test abs(data["branch_currents"]["V1"] + 0.01) < 1e-6   # 电压源电流 pos→neg（内部）= -0.01
end

# 结构化简后留有代数未知数的瞬态：原先代数量被钉成 0 → InitialFailure，或步长失控 → 插值取值全错。
# 直流纯电阻分压由 contracts/lab/transient-resistive-divider.json 覆盖。
@testset "瞬态：化简后留有代数未知数" begin
    ground = ComponentPayload("G1", "ground", Dict{String, Float64}(), Dict("gnd" => "gnd"))
    signal(result) = (result["data"]["time"], result["data"]["signals"][1]["values"])

    # 交流源 + 两个 1kΩ 分压：没有储能元件，n2 处处等于源电压的一半
    ac = run_simulation(SimulationPayload([
        ComponentPayload("V1", "vsource_ac", Dict("amplitude" => 1.0, "frequency" => 1000.0), Dict("pos" => "n1", "neg" => "gnd")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "n1", "n" => "n2")),
        ComponentPayload("R2", "resistor", Dict("value" => 1000.0), Dict("p" => "n2", "n" => "gnd")),
        ComponentPayload("VP1", "voltage_probe", Dict{String, Float64}(), Dict("node" => "n2")), ground,
    ], [
        NetPayload("n1", [["V1", "pos"], ["R1", "p"]]),
        NetPayload("n2", [["R1", "n"], ["R2", "p"], ["VP1", "node"]]),
        NetPayload("gnd", [["V1", "neg"], ["R2", "n"], ["G1", "gnd"]]),
    ], SimulationSettings(2e-3, 41), "transient"))
    @test ac["status"] == "ok"
    t, v = signal(ac)
    @test maximum(abs.(v .- 0.5 .* sin.(2pi * 1000 .* t))) < 1e-9

    # RC 充电但电容前面是电阻分压（n2 处的电阻环要撕裂，C1.i 留作代数量）：
    # 从电容看进去是 2.5V / 500Ω 再串 R3，τ = 1.5kΩ × 1µF = 1.5ms
    rc = run_simulation(SimulationPayload([
        ComponentPayload("V1", "vsource_dc", Dict("dc" => 5.0), Dict("pos" => "n1", "neg" => "gnd")),
        ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "n1", "n" => "n2")),
        ComponentPayload("R2", "resistor", Dict("value" => 1000.0), Dict("p" => "n2", "n" => "gnd")),
        ComponentPayload("R3", "resistor", Dict("value" => 1000.0), Dict("p" => "n2", "n" => "n3")),
        ComponentPayload("C1", "capacitor", Dict("value" => 1e-6), Dict("p" => "n3", "n" => "gnd")),
        ComponentPayload("VP1", "voltage_probe", Dict{String, Float64}(), Dict("node" => "n3")), ground,
    ], [
        NetPayload("n1", [["V1", "pos"], ["R1", "p"]]),
        NetPayload("n2", [["R1", "n"], ["R2", "p"], ["R3", "p"]]),
        NetPayload("n3", [["R3", "n"], ["C1", "p"], ["VP1", "node"]]),
        NetPayload("gnd", [["V1", "neg"], ["R2", "n"], ["C1", "n"], ["G1", "gnd"]]),
    ], SimulationSettings(7.5e-3, 101), "transient"))
    @test rc["status"] == "ok"
    t, v = signal(rc)
    @test maximum(abs.(v .- 2.5 .* (1 .- exp.(-t ./ 1.5e-3)))) < 1e-4
end

# 化简缓存只按拓扑命中：接法不变、只改元件值时要复用化简结果，但数值必须用这次的
@testset "瞬态：同一接法改电阻值，结果跟着变" begin
    rc(R) = SimulationPayload([
        ComponentPayload("V1", "vsource_dc", Dict("dc" => 5.0), Dict("pos" => "n1", "neg" => "gnd")),
        ComponentPayload("R1", "resistor", Dict("value" => R), Dict("p" => "n1", "n" => "n2")),
        ComponentPayload("C1", "capacitor", Dict("value" => 1e-6), Dict("p" => "n2", "n" => "gnd")),
        ComponentPayload("G1", "ground", Dict{String, Float64}(), Dict("gnd" => "gnd")),
        ComponentPayload("VP1", "voltage_probe", Dict{String, Float64}(), Dict("node" => "n2")),
    ], [
        NetPayload("n1", [["V1", "pos"], ["R1", "p"]]),
        NetPayload("n2", [["R1", "n"], ["C1", "p"], ["VP1", "node"]]),
        NetPayload("gnd", [["V1", "neg"], ["C1", "n"], ["G1", "gnd"]]),
    ], SimulationSettings(5e-3, 101), "transient")
    final(result) = last(result["data"]["signals"][1]["values"])

    first_run = run_simulation(rc(1000.0))
    @test first_run["status"] == "ok"
    @test isapprox(final(first_run), 5 * (1 - exp(-5)); atol = 1e-3)   # τ = 1ms，5τ

    hits = JCircuitServer._METRICS["simplify_hits"]
    second_run = run_simulation(rc(3000.0))
    @test JCircuitServer._METRICS["simplify_hits"] == hits + 1   # 确实走了缓存
    @test second_run["status"] == "ok"
    @test isapprox(final(second_run), 5 * (1 - exp(-5 / 3)); atol = 1e-3)   # τ = 3ms，原先错读成 4.966
end

# 没接地的电路不再报错，改为自动选参考点（原先这里断言单个电阻会因缺地线报错）
include("reference.jl")
include("dc_op_ac_phasor.jl")
include("control_simulation.jl")
include("mixed_simulation.jl")

# ---- Golden 契约（contracts/ 双端共享，冻结跨进程契约行为）----
using JSON3
const CONTRACTS_DIR = normpath(joinpath(@__DIR__, "..", "..", "..", "contracts"))
if isdir(CONTRACTS_DIR)
    include(joinpath(CONTRACTS_DIR, "contract_checker.jl"))
    @testset "Golden contracts (lab)" begin
        for spec in load_contracts(joinpath(CONTRACTS_DIR, "lab"))
            request = JSON3.write(spec[:request])
            kind = haskey(spec[:request], :kind) ? String(spec[:request][:kind]) : "circuit"
            payload = kind == "control" ? JSON3.read(request, ControlSimulationPayload) :
                      kind == "mixed"   ? JSON3.read(request, MixedSimulationPayload) :
                      JSON3.read(request, SimulationPayload)
            response = run_simulation(payload)
            @testset "$(spec[:name])" begin
                check_contract(JSON3.read(JSON3.write(response)), spec[:expect])
            end
        end
    end
else
    @info "contracts/ 不存在，跳过契约测试"
end
