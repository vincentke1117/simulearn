using Test
using JCircuitServer
using JCircuitServer: ComponentPayload, NetPayload, SimulationSettings
using JCircuitServer: ControlBlockPayload, ControlEdgePayload, ControlOutputPayload
using JCircuitServer: MixedBridgeBindingPayload, MixedCircuitPayload, MixedSimulationPayload

function sample_mixed_payload(; omit_actuator_bridge::Bool = false)
    circuit = MixedCircuitPayload(
        [
            ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "n_drive", "n" => "n_out")),
            ComponentPayload("R2", "resistor", Dict("value" => 1000.0), Dict("p" => "n_out", "n" => "gnd")),
            ComponentPayload("G1", "ground", Dict{String, Float64}(), Dict("gnd" => "gnd")),
            ComponentPayload("VP1", "voltage_probe", Dict{String, Float64}(), Dict("node" => "n_out")),
        ],
        [
            NetPayload("n_drive", [["R1", "p"]]),
            NetPayload("n_out", [["R1", "n"], ["R2", "p"], ["VP1", "node"]]),
            NetPayload("gnd", [["R2", "n"], ["G1", "gnd"]]),
        ],
    )

    blocks = [
        ControlBlockPayload("STEP1", "control_step", Dict("amplitude" => 1.0, "offset" => 0.0, "startTime" => 0.0)),
        ControlBlockPayload("SUM1", "control_sum", Dict("sign1" => 1.0, "sign2" => -1.0)),
        ControlBlockPayload("K1", "control_gain", Dict("gain" => 1.0)),
        ControlBlockPayload("CVS1", "controlled_voltage_source", Dict("gain" => 1.0)),
        ControlBlockPayload("VSEN1", "voltage_sensor", Dict{String, Float64}()),
        ControlBlockPayload("SCOPE1", "control_scope", Dict{String, Float64}()),
    ]

    edges = [
        ControlEdgePayload("sig1", "STEP1", "SUM1", "out", "in1"),
        ControlEdgePayload("sig2", "VSEN1", "SUM1", "out", "in2"),
        ControlEdgePayload("sig3", "SUM1", "K1", "out", "in"),
        ControlEdgePayload("sig4", "K1", "CVS1", "out", "in"),
        ControlEdgePayload("sig5", "VSEN1", "SCOPE1", "out", "in"),
    ]

    outputs = [ControlOutputPayload("scope:SCOPE1", "SCOPE1", "in", "Scope SCOPE1")]

    bridges = MixedBridgeBindingPayload[
        MixedBridgeBindingPayload("VSEN1", "n_out", "gnd"),
    ]
    if !omit_actuator_bridge
        push!(bridges, MixedBridgeBindingPayload("CVS1", "n_drive", "gnd"))
    end

    return MixedSimulationPayload("mixed", blocks, edges, outputs, bridges, circuit, SimulationSettings(1.0, 80))
end

@testset "mixed simulation closed loop" begin
    payload = sample_mixed_payload()
    result = run_simulation(payload)

    @test result["status"] == "ok"
    @test result["method"] == "transient"
    data = result["data"]
    @test length(data["time"]) == payload.sim.n_samples

    signals = data["signals"]
    @test length(signals) >= 2
    signal_ids = Set(String(signal["id"]) for signal in signals)
    @test "scope:SCOPE1" in signal_ids
    @test "VP1" in signal_ids

    scope_signal = only([signal for signal in signals if String(signal["id"]) == "scope:SCOPE1"])
    final_value = scope_signal["values"][end]
    @test final_value > 0.2
    @test final_value < 0.5
end

@testset "mixed simulation validation" begin
    bad_payload = sample_mixed_payload(omit_actuator_bridge = true)
    result = run_simulation(bad_payload)
    @test result["status"] == "error"
    @test occursin("绑定", result["message"])
end
