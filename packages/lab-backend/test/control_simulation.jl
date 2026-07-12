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

@testset "control step metrics（一阶解析解）" begin
    # step(1) → plant_1st(K=2, τ=0.2) → scope：y(t)=2(1-e^(-t/τ))
    # 解析：final=2，单调无超调，rise=τ·ln9≈0.43944s，settling(2%)=τ·ln50≈0.78240s
    blocks = [
        ControlBlockPayload("STEP1", "control_step", Dict("amplitude" => 1.0, "offset" => 0.0, "startTime" => 0.0)),
        ControlBlockPayload("P1", "control_plant_1st", Dict("gain" => 2.0, "timeConstant" => 0.2, "initialValue" => 0.0)),
        ControlBlockPayload("SCOPE1", "control_scope", Dict{String, Float64}()),
    ]
    edges = [
        ControlEdgePayload("e1", "STEP1", "P1", "out", "in"),
        ControlEdgePayload("e2", "P1", "SCOPE1", "out", "in"),
    ]
    outputs = [ControlOutputPayload("scope:SCOPE1", "SCOPE1", "in", "Scope SCOPE1")]
    payload = ControlSimulationPayload("control", blocks, edges, outputs, SimulationSettings(3.0, 601))
    result = run_simulation(payload)
    @test result["status"] == "ok"
    metrics = result["data"]["metrics"]["scope:SCOPE1"]
    @test abs(metrics["final_value"] - 2.0) < 1e-3
    @test 0.0 <= metrics["overshoot_pct"] < 0.05
    @test abs(metrics["rise_time_s"] - 0.2 * log(9)) < 5e-3
    @test abs(metrics["settling_time_s"] - 0.2 * log(50)) < 8e-3
    @test abs(metrics["peak_value"] - 2.0) < 1e-3
end

@testset "compute_step_metrics 解析样本" begin
    # 二阶欠阻尼解析序列：ζ=0.5、ωn=2 → 超调 = e^(-πζ/√(1-ζ²)) ≈ 16.3034%，
    # 峰值时刻 = π/ωd（ωd = ωn√(1-ζ²)）
    zeta = 0.5
    wn = 2.0
    wd = wn * sqrt(1 - zeta^2)
    ts = collect(range(0.0, 15.0, length = 30001))
    ys = [1 - exp(-zeta * wn * t) * (cos(wd * t) + zeta * wn / wd * sin(wd * t)) for t in ts]
    metrics = JCircuitServer.compute_step_metrics(ts, ys)
    @test abs(metrics["final_value"] - 1.0) < 1e-6
    @test abs(metrics["overshoot_pct"] - 100 * exp(-pi * zeta / sqrt(1 - zeta^2))) < 0.05
    @test abs(metrics["peak_time_s"] - pi / wd) < 1e-3
    @test metrics["settling_time_s"] !== nothing
    @test metrics["rise_time_s"] !== nothing

    # final ≈ 0：overshoot / settling 无定义 → null；恒零信号 rise = 0
    zero_metrics = JCircuitServer.compute_step_metrics(collect(0.0:0.01:1.0), zeros(101))
    @test zero_metrics["final_value"] == 0.0
    @test zero_metrics["overshoot_pct"] === nothing
    @test zero_metrics["settling_time_s"] === nothing
    @test zero_metrics["rise_time_s"] == 0.0
end
