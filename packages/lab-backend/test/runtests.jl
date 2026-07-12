using Test
using JCircuitServer
using JCircuitServer: ComponentPayload, NetPayload, SimulationSettings, SimulationPayload

@testset "bootstrap" begin
    config = bootstrap(start = false)
    @test config.host == "127.0.0.1"
    @test config.port == 8080
    @test config.router !== nothing
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

@testset "validation" begin
    payload = SimulationPayload([
        ComponentPayload("R1", "resistor", Dict("value" => 100.0), Dict("p" => "n1", "n" => "n2")),
    ], [
        NetPayload("n1", [["R1", "p"]]),
        NetPayload("n2", [["R1", "n"]]),
    ], SimulationSettings(1e-3, 10))
    result = run_simulation(payload)
    @test result["status"] == "error"
    @test occursin("ground", result["message"]) || occursin("地线", result["message"])
end

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
