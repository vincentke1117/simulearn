using Test
using JCircuitServer
using JCircuitServer: ControlBlockPayload, ControlEdgePayload, ControlOutputPayload, ControlSimulationPayload, SimulationSettings

function sample_control_payload()
    blocks = [
        ControlBlockPayload("STEP1", "control_step", Dict("amplitude" => 1.0, "offset" => 0.0, "startTime" => 0.0)),
        ControlBlockPayload("K1", "control_gain", Dict("gain" => 2.0)),
        ControlBlockPayload("P1", "control_plant_1st", Dict("gain" => 1.0, "timeConstant" => 0.2, "initialValue" => 0.0)),
        ControlBlockPayload("SCOPE1", "control_scope", Dict{String, Float64}()),
    ]
    edges = [
        ControlEdgePayload("e1", "STEP1", "K1", "out", "in"),
        ControlEdgePayload("e2", "K1", "P1", "out", "in"),
        ControlEdgePayload("e3", "P1", "SCOPE1", "out", "in"),
    ]
    outputs = [ControlOutputPayload("scope:SCOPE1", "SCOPE1", "in", "Scope SCOPE1")]
    ControlSimulationPayload("control", blocks, edges, outputs, SimulationSettings(2.0, 200))
end

function sample_algebraic_loop_payload()
    blocks = [
        ControlBlockPayload("STEP1", "control_step", Dict("amplitude" => 1.0, "offset" => 0.0, "startTime" => 0.0)),
        ControlBlockPayload("SUM1", "control_sum", Dict("sign1" => 1.0, "sign2" => -1.0)),
        ControlBlockPayload("K1", "control_gain", Dict("gain" => 2.0)),
        ControlBlockPayload("SCOPE1", "control_scope", Dict{String, Float64}()),
    ]
    edges = [
        ControlEdgePayload("e1", "STEP1", "SUM1", "out", "in1"),
        ControlEdgePayload("e2", "K1", "SUM1", "out", "in2"),
        ControlEdgePayload("e3", "SUM1", "K1", "out", "in"),
        ControlEdgePayload("e4", "K1", "SCOPE1", "out", "in"),
    ]
    outputs = [ControlOutputPayload("scope:SCOPE1", "SCOPE1", "in", "Scope SCOPE1")]
    ControlSimulationPayload("control", blocks, edges, outputs, SimulationSettings(1.0, 100))
end

function sample_pid_closed_loop_payload()
    blocks = [
        ControlBlockPayload("STEP1", "control_step", Dict("amplitude" => 1.0, "offset" => 0.0, "startTime" => 0.0)),
        ControlBlockPayload("SUM1", "control_sum", Dict("sign1" => 1.0, "sign2" => -1.0)),
        ControlBlockPayload("PID1", "control_pid", Dict("kp" => 2.0, "ki" => 1.0, "kd" => 0.05, "tf" => 0.01)),
        ControlBlockPayload("P1", "control_plant_1st", Dict("gain" => 1.0, "timeConstant" => 0.2, "initialValue" => 0.0)),
        ControlBlockPayload("SCOPE1", "control_scope", Dict{String, Float64}()),
    ]
    edges = [
        ControlEdgePayload("e1", "STEP1", "SUM1", "out", "in1"),
        ControlEdgePayload("e2", "P1", "SUM1", "out", "in2"),
        ControlEdgePayload("e3", "SUM1", "PID1", "out", "in"),
        ControlEdgePayload("e4", "PID1", "P1", "out", "in"),
        ControlEdgePayload("e5", "P1", "SCOPE1", "out", "in"),
    ]
    outputs = [ControlOutputPayload("scope:SCOPE1", "SCOPE1", "in", "Scope SCOPE1")]
    ControlSimulationPayload("control", blocks, edges, outputs, SimulationSettings(2.0, 300))
end

@testset "control simulation basic" begin
    payload = sample_control_payload()
    result = run_simulation(payload)
    @test result["status"] == "ok"
    data = result["data"]
    @test length(data["time"]) == payload.sim.n_samples
    @test length(data["signals"]) == 1
    @test data["signals"][1]["values"][end] > 0.9
end

@testset "control simulation algebraic loop validation" begin
    payload = sample_algebraic_loop_payload()
    result = run_simulation(payload)
    @test result["status"] == "error"
    @test occursin("代数环", result["message"])
end

@testset "control simulation pid closed-loop" begin
    payload = sample_pid_closed_loop_payload()
    result = run_simulation(payload)
    @test result["status"] == "ok"
    values = result["data"]["signals"][1]["values"]
    @test values[end] > 0.8
end
