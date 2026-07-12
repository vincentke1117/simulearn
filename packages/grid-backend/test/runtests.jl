using Test
using JSON3

using JGDO
using JGDO: TopologyError, ValidationError, SnapshotError, topology_to_powermodels, build_pf_payload, write_run_snapshot
using JGDO.Optimization

const EXAMPLES_DIR = joinpath(@__DIR__, "..", "examples")

function base_topology()
    return Dict(
        "meta" => Dict(
            "baseMVA" => 100.0,
            "feeder" => "F1",
        ),
        "nodes" => Any[
            Dict("id" => "bus-1", "type" => "Bus", "kv" => 12.66, "is_slack" => true, "vm_pu" => 1.0, "va_deg" => 0.0),
            Dict("id" => "bus-2", "type" => "Bus", "kv" => 12.66, "vm_pu" => 1.0, "va_deg" => -0.5),
            Dict("id" => "bus-3", "type" => "Bus", "kv" => 12.66, "vm_pu" => 0.99, "va_deg" => -1.0),
            Dict("id" => "load-1", "type" => "Load", "p_kw" => 800.0, "q_kvar" => 200.0, "bus" => "bus-2"),
            Dict("id" => "grid-1", "type" => "Gen", "p_kw" => 600.0, "p_max_kw" => 2000.0, "q_kvar" => 100.0, "q_max_kvar" => 500.0, "bus" => "bus-1"),
            Dict("id" => "dg-1", "type" => "DG", "p_kw" => 500.0, "p_max_kw" => 800.0, "q_kvar" => 50.0, "bus" => "bus-3"),
        ],
        "links" => Any[
            Dict("id" => "line-12", "type" => "Line", "from" => "bus-1", "to" => "bus-2", "r_ohm" => 0.2, "x_ohm" => 0.4, "rate_mva" => 5.0, "status" => "CLOSED"),
            Dict("id" => "line-23", "type" => "Line", "from" => "bus-2", "to" => "bus-3", "r_ohm" => 0.1, "x_ohm" => 0.3, "rate_mva" => 5.0, "status" => "CLOSED"),
            Dict("id" => "sw-13", "type" => "Switch", "from" => "bus-1", "to" => "bus-3", "r_ohm" => 0.001, "x_ohm" => 0.003, "rate_mva" => 5.0, "status" => "OPEN"),
        ],
    )
end

@testset "Topology conversion (per-unit)" begin
    topo = base_topology()
    pm = topology_to_powermodels(topo)

    @test pm["baseMVA"] == 100.0
    @test pm["per_unit"] === true
    @test length(pm["bus"]) == 3
    @test isempty(pm["storage"])
    @test isempty(pm["switch"])
    @test isempty(pm["dcline"])

    @test pm["bus"]["1"]["name"] == "bus-1"
    @test pm["bus"]["1"]["bus_type"] == 3
    @test pm["bus"]["3"]["bus_type"] == 2
    # va is stored in radians after make_per_unit!
    @test isapprox(pm["bus"]["2"]["va"], deg2rad(-0.5); atol=1e-9)

    # 800 kW → 0.8 MW → 0.008 pu on a 100 MVA base
    load = only(values(pm["load"]))
    @test load["load_bus"] == 2
    @test isapprox(load["pd"], 0.008; atol=1e-9)
    @test isapprox(load["qd"], 0.002; atol=1e-9)

    @test length(pm["gen"]) == 2
    slack_gen = pm["gen"]["1"]
    dg = pm["gen"]["2"]
    @test slack_gen["gen_bus"] == 1
    @test isapprox(slack_gen["pg"], 0.006; atol=1e-9)
    @test isapprox(slack_gen["qmax"], 0.005; atol=1e-9)
    @test dg["gen_bus"] == 3
    @test isapprox(dg["pg"], 0.005; atol=1e-9)
    # q_max_kvar unspecified for dg-1 → defaults to |q_kvar| = 50 kvar = 0.0005 pu
    # (regression guard for the old double /1000 bug that produced 5e-7)
    @test isapprox(dg["qmax"], 0.0005; atol=1e-9)
    @test isapprox(dg["qmin"], -0.0005; atol=1e-9)

    branches = collect(values(pm["branch"]))
    line12 = only(filter(b -> b["name"] == "line-12", branches))
    z_base = (12.66^2) / 100.0
    @test isapprox(line12["br_r"], 0.2 / z_base; atol=1e-9)
    @test isapprox(line12["rate_a"], 0.05; atol=1e-9)
    @test line12["br_status"] == 1
    @test line12["switchable"] == false
    @test isapprox(line12["angmax"], deg2rad(60.0); atol=1e-9)

    switch13 = only(filter(b -> b["name"] == "sw-13", branches))
    @test switch13["br_status"] == 0
    @test switch13["status"] == 0
    @test switch13["device_type"] == "switch"
    @test switch13["switchable"] == true
end

@testset "Topology conversion from JSON3 object" begin
    topo = JSON3.read(JSON3.write(base_topology()))
    pm = topology_to_powermodels(topo)

    @test pm["baseMVA"] == 100.0
    @test pm["per_unit"] === true
    @test pm["bus"]["1"]["bus_type"] == 3
    @test pm["bus"]["3"]["bus_type"] == 2
    @test length(pm["branch"]) == 3
end

@testset "Topology validation" begin
    no_slack = base_topology()
    no_slack["nodes"][1]["is_slack"] = false
    @test_throws TopologyError topology_to_powermodels(no_slack)

    missing_base = base_topology()
    delete!(missing_base["meta"], "baseMVA")
    @test_throws ValidationError topology_to_powermodels(missing_base)

    islanded = base_topology()
    islanded["links"][1]["status"] = "OPEN"
    islanded["links"][2]["status"] = "OPEN"
    @test_throws TopologyError topology_to_powermodels(islanded)
end

@testset "Power flow payload (real solve)" begin
    pm = topology_to_powermodels(base_topology())
    solved = JGDO.execute_power_flow(pm)
    payload = build_pf_payload(solved)

    @test payload["status"] == "ok"
    @test payload["type"] == "ac_pf"
    @test length(payload["buses"]) == 3
    @test length(payload["branches"]) == 3

    b1 = only(filter(b -> b["id"] == "bus-1", payload["buses"]))
    @test isapprox(b1["vm_pu"], 1.0; atol=1e-6)
    b2 = only(filter(b -> b["id"] == "bus-2", payload["buses"]))
    @test abs(b2["va_deg"]) < 5.0  # degrees, small angle on a lightly loaded feeder

    # bus-2 carries 0.8 MW; dg-1 injects 0.5 MW at bus-3, remainder flows over line-12
    line12 = only(filter(b -> b["id"] == "line-12", payload["branches"]))
    @test 0.2 < line12["p_mw"] < 0.5
    @test line12["status"] == "CLOSED"
    sw13 = only(filter(b -> b["id"] == "sw-13", payload["branches"]))
    @test sw13["status"] == "OPEN"
    @test sw13["p_mw"] == 0.0

    @test payload["summary"]["loss_mw"] > 1.0e-6
    @test payload["summary"]["loss_mw"] < 0.05
    @test isempty(payload["summary"]["violation_buses"])
    @test payload["summary"]["termination_status"] == "LOCALLY_SOLVED"
end

@testset "IEEE 33-bus golden case (Baran & Wu)" begin
    topo_json = read(joinpath(EXAMPLES_DIR, "ieee33.json"), String)
    response = JSON3.read(JGDO.run_pf(topo_json))
    @test response["status"] == "ok"
    data = response["data"]

    loss_kw = data["summary"]["loss_mw"] * 1000
    @test isapprox(loss_kw, 202.68; atol=0.5)       # literature: 202.7 kW
    vms = [bus["vm_pu"] for bus in data["buses"]]
    @test isapprox(minimum(vms), 0.9131; atol=1e-3)  # literature: 0.9131 @ bus 18
    @test data["summary"]["vmin_bus"] == "bus-18"

    # Literature-optimal reconfiguration: open {7, 9, 14, 32, 37}, close the other ties.
    topo = JSON3.read(topo_json, Dict{String,Any})
    open_ids = Set(["br-7", "br-9", "br-14", "br-32", "br-37"])
    for link in topo["links"]
        link["status"] = link["id"] in open_ids ? "OPEN" : "CLOSED"
    end
    response_opt = JSON3.read(JGDO.run_pf(JSON3.write(topo)))
    @test response_opt["status"] == "ok"
    loss_opt_kw = response_opt["data"]["summary"]["loss_mw"] * 1000
    @test isapprox(loss_opt_kw, 139.55; atol=0.5)   # literature: 139.55 kW
    vms_opt = [bus["vm_pu"] for bus in response_opt["data"]["buses"]]
    @test isapprox(minimum(vms_opt), 0.9378; atol=1e-3)
end

@testset "Reconfiguration dataset" begin
    pm = topology_to_powermodels(base_topology())
    data = Optimization.build_dataset(pm)

    @test data.base_mva == 100.0
    @test length(data.branch_keys) == 3
    @test length(data.gen_keys) == 2
    @test data.branches[3].switchable
    @test !data.branches[1].switchable
    @test data.gens["1"].bus == 1
    @test data.gens["2"].pmax > data.gens["2"].pmin
    @test data.required_closed == length(data.bus_keys) - 1
    @test data.root_bus in data.slack_buses

    switches = Optimization.collect_switch_status(pm)
    @test length(switches) == 1
    @test switches[1]["id"] == "sw-13"
    @test switches[1]["status"] == "OPEN"
end

@testset "Radiality precheck" begin
    topo = base_topology()
    push!(topo["links"], Dict(
        "id" => "line-13", "type" => "Line", "from" => "bus-1", "to" => "bus-3",
        "r_ohm" => 0.1, "x_ohm" => 0.3, "rate_mva" => 5.0, "status" => "CLOSED",
    ))
    pm = topology_to_powermodels(topo)
    # three non-switchable closed lines form a loop → must fail fast, not reach the solver
    @test_throws TopologyError Optimization.build_dataset(pm)
end

@testset "Reconfiguration execution (3-bus)" begin
    response = JSON3.read(JGDO.run_reconfiguration_dg(JSON3.write(base_topology())))

    @test response["status"] == "ok"
    @test response["data"]["type"] == "reconfiguration_dg"
    @test length(response["data"]["switch_schedule"]) == 1
    @test length(response["data"]["dg_dispatch"]) == 2
end

@testset "Reconfiguration end-to-end (fixture)" begin
    topo_json = read(joinpath(EXAMPLES_DIR, "reconfiguration_test.json"), String)
    response = JSON3.read(JGDO.run_reconfiguration_dg(topo_json))

    @test response["status"] == "ok"
    data = response["data"]
    @test data["type"] == "reconfiguration_dg"
    @test !isempty(data["switch_schedule"])
    @test data["summary"]["loss_before_mw"] > 0
    @test data["summary"]["loss_after_mw"] < data["summary"]["loss_before_mw"]
    @test data["summary"]["improvement_pct"] > 0
end

@testset "N-1 analysis (3-bus)" begin
    response = JSON3.read(JGDO.run_n1(JSON3.write(base_topology())))
    @test response["status"] == "ok"
    data = response["data"]
    @test data["type"] == "n1_analysis"
    # sw-13 is OPEN → only the two closed lines are screened
    @test data["summary"]["n_branches"] == 2
    @test data["summary"]["n_islanding"] == 2
    @test data["summary"]["n_ok"] == 0
    @test data["summary"]["n_diverged"] == 0

    r12 = only(filter(r -> r["branch"] == "line-12", data["results"]))
    @test r12["outcome"] == "islanding"
    @test sort(String.(r12["islanded_buses"])) == ["bus-2", "bus-3"]
    @test isapprox(r12["lost_load_mw"], 0.8; atol=1e-9)

    r23 = only(filter(r -> r["branch"] == "line-23", data["results"]))
    @test r23["outcome"] == "islanding"
    @test String.(r23["islanded_buses"]) == ["bus-3"]
    @test isapprox(r23["lost_load_mw"], 0.0; atol=1e-9)

    @test isapprox(data["summary"]["max_lost_load_mw"], 0.8; atol=1e-9)
    @test data["summary"]["worst_branch"] == "line-12"
end

@testset "Timeseries power flow (3-bus)" begin
    # Drop the DG: its fixed injection dominates at light load (reverse flow) and its
    # PV bus pins vmin at the setpoint, which would mask the load-scaling physics.
    topo = base_topology()
    topo["nodes"] = filter(n -> n["id"] != "dg-1", topo["nodes"])
    request = Dict("topology" => topo, "load_scale" => [0.5, 1.0])
    response = JSON3.read(JGDO.run_timeseries(JSON3.write(request)))
    @test response["status"] == "ok"
    data = response["data"]
    @test data["type"] == "timeseries_pf"
    @test data["summary"]["n_points"] == 2
    @test length(data["points"]) == 2
    p_half, p_full = data["points"][1], data["points"][2]
    @test p_half["outcome"] == "ok"
    @test p_full["outcome"] == "ok"
    @test p_half["vmin_pu"] > p_full["vmin_pu"]      # lighter load → higher voltage
    @test p_half["loss_mw"] < p_full["loss_mw"]      # lighter load → lower loss
    @test data["summary"]["max_loss_mw"] == maximum(p["loss_mw"] for p in data["points"])
    @test data["summary"]["min_vmin_pu"] == minimum(p["vmin_pu"] for p in data["points"])
end

@testset "Timeseries validation" begin
    topo = base_topology()

    no_topo = JSON3.read(JGDO.run_timeseries(JSON3.write(Dict("load_scale" => [1.0]))))
    @test no_topo["status"] == "error"
    @test no_topo["code"] == "GRID_VALIDATION"

    empty_scale = JSON3.read(JGDO.run_timeseries(JSON3.write(Dict("topology" => topo, "load_scale" => Any[]))))
    @test empty_scale["status"] == "error"
    @test empty_scale["code"] == "GRID_VALIDATION"

    negative = JSON3.read(JGDO.run_timeseries(JSON3.write(Dict("topology" => topo, "load_scale" => [1.0, -0.5]))))
    @test negative["status"] == "error"
    @test negative["code"] == "GRID_VALIDATION"

    too_many = JSON3.read(JGDO.run_timeseries(JSON3.write(Dict("topology" => topo, "load_scale" => fill(1.0, 97)))))
    @test too_many["status"] == "error"
    @test too_many["code"] == "GRID_VALIDATION"
end

# ---- 机电暂态稳定（SMIB 解析解对拍）----

@testset "Transient dynamic params passthrough (topology)" begin
    topo = JSON3.read(read(joinpath(EXAMPLES_DIR, "smib.json"), String), Dict{String,Any})
    pm = topology_to_powermodels(topo)
    gen1 = only(filter(g -> g["name"] == "gen-1", collect(values(pm["gen"]))))
    @test gen1["h_s"] == 5.0
    @test gen1["xd1_pu"] == 0.3
    @test gen1["d_pu"] == 0.0
    grid1 = only(filter(g -> g["name"] == "grid-1", collect(values(pm["gen"]))))
    @test !haskey(grid1, "h_s")
    @test !haskey(grid1, "xd1_pu")
end

@testset "Transient stability SMIB (analytic cross-check)" begin
    # 解析推导（经典模型；故障置于机端 zf=0 → 故障期间 Pe≈0；post=pre 网络）：
    #   预故障：V1=V2=1，sinθ2 = Pm·x_line → θ2 = asin(0.16)
    #   Ē' = V̄2 + jX'd·Ī，δ0 = angle(Ē')；X_total = x_line + X'd
    #   δ_cr = acos[(π−2δ0)·sinδ0 − cosδ0]
    #   CCT = sqrt(4H(δ_cr−δ0)/(ωs·Pm))
    pm_pu = 0.8; x_line = 0.2; xd1 = 0.3; h = 5.0; f = 50.0
    theta2 = asin(pm_pu * x_line)
    V2 = cis(theta2)
    I2 = (V2 - 1.0) / (im * x_line)
    E = V2 + im * xd1 * I2
    delta0 = angle(E)
    delta_cr = acos((pi - 2 * delta0) * sin(delta0) - cos(delta0))
    ws = 2 * pi * f
    cct = sqrt(4 * h * (delta_cr - delta0) / (ws * pm_pu))
    @test isapprox(delta0, 0.391929; atol=1e-5)      # 22.4559°
    @test isapprox(delta_cr, 1.594384; atol=1e-5)    # 91.3515°
    @test isapprox(cct, 0.309335; atol=1e-5)

    topo = JSON3.read(read(joinpath(EXAMPLES_DIR, "smib.json"), String))
    t_fault = 0.1
    make_request(t_clear; find_cct=false) = JSON3.write(Dict(
        "topology" => topo,
        "fault" => Dict("bus" => "bus-2", "t_fault_s" => t_fault, "t_clear_s" => t_clear,
                        "zf_pu" => 0.0, "trip_branch" => nothing),
        "sim" => Dict("t_stop_s" => 3.0, "dt_s" => 0.001),
        "f_hz" => 50,
        "find_cct" => find_cct,
    ))

    # ① t_clear = 0.9×CCT → 稳定
    stable = JSON3.read(JGDO.run_transient(make_request(t_fault + 0.9 * cct)))
    @test stable["status"] == "ok"
    data = stable["data"]
    @test data["type"] == "transient_stability"
    @test data["stable"] === true
    @test data["t_unstable_s"] === nothing
    @test data["cct_s"] === nothing
    mach = only(data["machines"])
    @test mach["id"] == "gen-1"
    @test isapprox(mach["delta0_deg"], rad2deg(delta0); atol=0.05)
    @test isapprox(mach["pm_pu"], 0.8; atol=1e-6)
    @test length(data["series"]["t_s"]) <= 500
    @test length(data["series"]["delta_deg"]["gen-1"]) == length(data["series"]["t_s"])
    @test isapprox(data["series"]["omega_pu"]["gen-1"][1], 1.0; atol=1e-9)
    # 稳定摇摆的最大角必须低于 180°（等面积极限 π−δ0 ≈ 157.5°）
    @test maximum(data["series"]["delta_deg"]["gen-1"]) < 180.0
    @test data["fault"]["bus"] == "bus-2"

    # ② t_clear = 1.2×CCT → 失稳，t_unstable 在切除之后
    unstable = JSON3.read(JGDO.run_transient(make_request(t_fault + 1.2 * cct)))
    @test unstable["status"] == "ok"
    @test unstable["data"]["stable"] === false
    @test unstable["data"]["t_unstable_s"] > t_fault + 1.2 * cct

    # ③ find_cct：二分结果对拍解析 CCT（容差取解析值 5% 与 5 ms 中较大者）
    cct_resp = JSON3.read(JGDO.run_transient(make_request(t_fault + 0.9 * cct; find_cct=true)))
    @test cct_resp["status"] == "ok"
    @test cct_resp["data"]["stable"] === true
    @test isapprox(cct_resp["data"]["cct_s"], cct; atol=max(0.05 * cct, 0.005))
end

@testset "Transient validation" begin
    # 无任何机组带 h_s → GRID_VALIDATION
    no_dyn = JSON3.read(JGDO.run_transient(JSON3.write(Dict(
        "topology" => base_topology(),
        "fault" => Dict("bus" => "bus-2", "t_fault_s" => 0.1, "t_clear_s" => 0.2)))))
    @test no_dyn["status"] == "error"
    @test no_dyn["code"] == "GRID_VALIDATION"

    smib = JSON3.read(read(joinpath(EXAMPLES_DIR, "smib.json"), String))

    bad_bus = JSON3.read(JGDO.run_transient(JSON3.write(Dict(
        "topology" => smib,
        "fault" => Dict("bus" => "bus-99", "t_fault_s" => 0.1, "t_clear_s" => 0.2)))))
    @test bad_bus["status"] == "error"
    @test bad_bus["code"] == "GRID_VALIDATION"

    bad_order = JSON3.read(JGDO.run_transient(JSON3.write(Dict(
        "topology" => smib,
        "fault" => Dict("bus" => "bus-2", "t_fault_s" => 0.3, "t_clear_s" => 0.2)))))
    @test bad_order["status"] == "error"
    @test bad_order["code"] == "GRID_VALIDATION"

    bad_trip = JSON3.read(JGDO.run_transient(JSON3.write(Dict(
        "topology" => smib,
        "fault" => Dict("bus" => "bus-2", "t_fault_s" => 0.1, "t_clear_s" => 0.2,
                        "trip_branch" => "line-99")))))
    @test bad_trip["status"] == "error"
    @test bad_trip["code"] == "GRID_VALIDATION"
end

# ---- 三相对称短路（手算对拍 + IEEE33 全扫）----

@testset "Short circuit SMIB (hand calc)" begin
    # 手算：Zth(bus-2) = j[(x_line + x_src) ∥ X'd] = j[(0.2+1e-6)·0.3/0.500001] = j0.1200004 pu
    #      I_f = |V_pre|/|Zth| = 8.33331 pu；S_sc = 833.331 MVA；I_ka = S_sc/(√3·10 kV) = 48.1124 kA
    topo = JSON3.read(read(joinpath(EXAMPLES_DIR, "smib.json"), String))
    resp = JSON3.read(JGDO.run_shortcircuit(JSON3.write(Dict(
        "topology" => topo, "fault_bus" => "bus-2", "zf_pu" => 0.0))))
    @test resp["status"] == "ok"
    data = resp["data"]
    @test data["type"] == "short_circuit"
    entry = only(data["results"])
    x_expected = (0.2 + 1e-6) * 0.3 / (0.2 + 1e-6 + 0.3)
    @test entry["bus"] == "bus-2"
    @test isapprox(entry["v_prefault_pu"], 1.0; atol=1e-6)
    @test isapprox(entry["zth_pu"]["r"], 0.0; atol=1e-9)
    @test isapprox(entry["zth_pu"]["x"], x_expected; atol=1e-9)
    @test isapprox(entry["i_f_pu"], 1.0 / x_expected; atol=1e-4)
    @test isapprox(entry["s_sc_mva"], 100.0 / x_expected; atol=0.01)
    @test isapprox(entry["i_f_ka"], 100.0 / x_expected / (sqrt(3.0) * 10.0); atol=1e-3)
    @test data["summary"]["max_bus"] == "bus-2"
    @test data["summary"]["min_bus"] == "bus-2"

    # 经故障阻抗 zf=0.1：I_f = |V|/|Zth + zf|
    resp_zf = JSON3.read(JGDO.run_shortcircuit(JSON3.write(Dict(
        "topology" => topo, "fault_bus" => "bus-2", "zf_pu" => 0.1))))
    entry_zf = only(resp_zf["data"]["results"])
    @test isapprox(entry_zf["i_f_pu"], 1.0 / abs(0.1 + im * x_expected); atol=1e-4)
end

@testset "Short circuit IEEE33 (full scan)" begin
    topo = JSON3.read(read(joinpath(EXAMPLES_DIR, "ieee33.json"), String))
    resp = JSON3.read(JGDO.run_shortcircuit(JSON3.write(Dict(
        "topology" => topo, "fault_bus" => nothing, "zf_pu" => 0.0))))
    @test resp["status"] == "ok"
    data = resp["data"]
    @test length(data["results"]) == 33
    @test data["summary"]["max_bus"] == "bus-1"   # 理想源母线短路容量最大
    @test data["summary"]["min_bus"] == "bus-18"  # 主馈线末端阻抗累计最大

    # 自证 Z_th 随馈线深度单调：主干 bus-1..bus-18 电流逐点单调下降
    main = [data["results"][k]["i_f_pu"] for k in 1:18]
    @test all(diff(main) .< 0)

    # bus-18 的 Z_th ≈ 源阻抗 j1e-6 + br-1..17 累计阻抗（独立按 r_ohm/x_ohm 换算 pu 复核）
    z_base = 12.66^2 / 10.0
    rsum = 0.0
    xsum = 0.0
    for link in topo["links"]
        idx = parse(Int, split(String(link["id"]), "-")[2])
        if idx <= 17
            rsum += link["r_ohm"]
            xsum += link["x_ohm"]
        end
    end
    e18 = data["results"][18]
    @test e18["bus"] == "bus-18"
    @test isapprox(e18["zth_pu"]["r"], rsum / z_base; atol=1e-6)
    @test isapprox(e18["zth_pu"]["x"], xsum / z_base + 1e-6; atol=1e-6)
    @test isapprox(e18["v_prefault_pu"], 0.91309; atol=1e-3)   # 潮流金标准 vmin
    @test isapprox(e18["i_f_pu"], 1.0197; atol=0.01)
    # slack 母线：理想源假设 → I_f ≈ |V|/1e-6
    @test isapprox(data["results"][1]["i_f_pu"], 1.0e6; atol=1.0)
end

@testset "Short circuit validation" begin
    topo = JSON3.read(read(joinpath(EXAMPLES_DIR, "smib.json"), String))

    bad_bus = JSON3.read(JGDO.run_shortcircuit(JSON3.write(Dict(
        "topology" => topo, "fault_bus" => "bus-99", "zf_pu" => 0.0))))
    @test bad_bus["status"] == "error"
    @test bad_bus["code"] == "GRID_VALIDATION"

    bad_zf = JSON3.read(JGDO.run_shortcircuit(JSON3.write(Dict(
        "topology" => topo, "fault_bus" => "bus-2", "zf_pu" => -1.0))))
    @test bad_zf["status"] == "error"
    @test bad_zf["code"] == "GRID_VALIDATION"

    no_topo = JSON3.read(JGDO.run_shortcircuit(JSON3.write(Dict("fault_bus" => "bus-2"))))
    @test no_topo["status"] == "error"
    @test no_topo["code"] == "GRID_VALIDATION"
end

# ---- 最优潮流 / 经济调度（等微增率解析解对拍）----

@testset "Generator cost curve (MATPOWER units)" begin
    # 缺省：model=2 / ncost=3 / cost=[0, 1, 0]（1 元/MWh 线性），make_per_unit! 不改变
    # 零和一次项的 baseMVA^0 / baseMVA^1 缩放语义 —— c1=1 → 1*100 = 100。
    pm = topology_to_powermodels(base_topology())
    g = pm["gen"]["1"]
    @test g["model"] == 2
    @test g["ncost"] == 3
    @test g["cost"] == [0.0, 100.0, 0.0]   # [c2·S², c1·S, c0]，S = baseMVA = 100

    # 显式二次成本：cost 的 P 单位是 MW（MATPOWER 约定）。make_per_unit! 调
    # _rescale_cost_model!(gen, baseMVA)，把 cost[i] 乘 baseMVA^(ncost-i)，于是在 pu 上
    # 求解时目标函数仍是 元/h：c2·S²·(P_pu)² + c1·S·P_pu + c0 = c2·P_MW² + c1·P_MW + c0。
    topo = base_topology()
    for node in topo["nodes"]
        if node["id"] == "grid-1"
            node["cost_c2"] = 0.02
            node["cost_c1"] = 10.0
            node["cost_c0"] = 100.0
        end
    end
    pm2 = topology_to_powermodels(topo)
    @test pm2["gen"]["1"]["cost"] == [0.02 * 100^2, 10.0 * 100, 100.0]
    @test pm2["gen"]["1"]["cost"] == [200.0, 1000.0, 100.0]
end

@testset "OPF economic dispatch econ2 (analytic cross-check)" begin
    # 解析解（等微增率）：λ = 0.04·P1 + 10 = 0.10·P2 + 8，P1 + P2 = 100（网损可忽略）
    #   → P1* = 400/7 = 57.142857 MW，P2* = 300/7 = 42.857143 MW，λ* = 86/7 = 12.285714 元/MWh
    #   → C* = 8550/7 = 1221.428571 元/h
    p1 = 400 / 7
    p2 = 300 / 7
    lambda = 86 / 7
    cost_star = 0.02p1^2 + 10p1 + 100 + 0.05p2^2 + 8p2 + 50
    @test isapprox(lambda, 12.285714; atol=1e-6)
    @test isapprox(cost_star, 1221.428571; atol=1e-5)

    topo_json = read(joinpath(EXAMPLES_DIR, "econ2.json"), String)
    response = JSON3.read(JGDO.run_opf(topo_json))
    @test response["status"] == "ok"
    data = response["data"]
    @test data["type"] == "opf"
    @test data["objective"]["termination_status"] == "LOCALLY_SOLVED"
    @test data["objective"]["solve_time_s"] >= 0.0

    g1 = only(filter(g -> g["id"] == "gen-1", data["gens"]))
    g2 = only(filter(g -> g["id"] == "gen-2", data["gens"]))
    @test isapprox(g1["pg_mw"], p1; atol=0.05)
    @test isapprox(g2["pg_mw"], p2; atol=0.05)
    # 等微增率：两台机的边际成本必须相等（且等于 λ*）
    @test isapprox(g1["marginal_cost_yuan_per_mwh"], g2["marginal_cost_yuan_per_mwh"]; atol=0.01)
    @test isapprox(g1["marginal_cost_yuan_per_mwh"], lambda; atol=0.02)
    @test !g1["at_pmax"] && !g1["at_pmin"] && !g2["at_pmax"] && !g2["at_pmin"]
    @test !g1["binding"] && !g2["binding"]
    @test isapprox(g1["cost_yuan_per_h"] + g2["cost_yuan_per_h"], cost_star; atol=0.1)
    @test isapprox(data["objective"]["cost_total_yuan_per_h"], cost_star; atol=0.1)

    # LMP：无阻塞、网损≈0 → 全网 LMP 相等且 = λ*（这是 LMP 换算方向正确的硬证据；
    # 若漏掉 /baseMVA 会得到 1228.6，若符号搞反会得到 −12.29）
    lmps = [Float64(bus["lmp_yuan_per_mwh"]) for bus in data["buses"]]
    @test all(isfinite, lmps)
    @test all(l -> isapprox(l, lambda; atol=0.02), lmps)
    @test maximum(lmps) - minimum(lmps) < 0.01
    # 负荷母线的 LMP 最高（边际网损为正）
    @test data["summary"]["lmp_max_bus"] == "bus-2"

    # 网损可忽略 → 总发电 ≈ 总负荷；两者之差就是网损
    @test isapprox(data["summary"]["load_total_mw"], 100.0; atol=1e-9)
    @test data["summary"]["loss_mw"] < 0.01
    @test isapprox(data["summary"]["gen_total_mw"] - data["summary"]["load_total_mw"],
                   data["summary"]["loss_mw"]; atol=1e-3)
    @test length(data["branches"]) == 2
    line12 = only(filter(b -> b["id"] == "line-12", data["branches"]))
    @test isapprox(line12["p_mw"], p1; atol=0.05)
end

@testset "OPF IEEE33 (single source, LMP = marginal cost + loss component)" begin
    topo_json = read(joinpath(EXAMPLES_DIR, "ieee33.json"), String)
    response = JSON3.read(JGDO.run_opf(topo_json))
    @test response["status"] == "ok"
    data = response["data"]
    @test data["objective"]["termination_status"] == "LOCALLY_SOLVED"
    @test data["objective"]["cost_total_yuan_per_h"] > 0

    # 单机、默认成本 [0, 1, 0] → 边际成本 1 元/MWh；总成本 = 总发电（MW）
    gen = only(data["gens"])
    @test gen["id"] == "grid-1"
    @test isapprox(gen["marginal_cost_yuan_per_mwh"], 1.0; atol=1e-9)
    @test isapprox(gen["cost_yuan_per_h"], gen["pg_mw"]; atol=1e-9)
    # OPF 的潮流解必须与 pf 金标准一致（bus-1 的 vmin=vmax=1 锁死了唯一的电压自由度）
    @test isapprox(data["summary"]["loss_mw"], 0.202677; atol=5e-4)
    @test isapprox(gen["pg_mw"], 3.715 + 0.202677; atol=5e-4)

    lmps = [Float64(bus["lmp_yuan_per_mwh"]) for bus in data["buses"]]
    @test length(lmps) == 33
    @test all(isfinite, lmps)
    @test all(l -> l > 0, lmps)
    # slack 母线 LMP = 系统边际成本（该处无网损分量）；其余母线因边际网损更贵
    @test isapprox(lmps[1], 1.0; atol=1e-6)
    @test all(l -> l >= 1.0 - 1e-6, lmps)
    @test data["summary"]["lmp_min_bus"] == "bus-1"
    @test data["summary"]["lmp_max_bus"] == "bus-18"   # 主馈线末端，网损分量最大
end

@testset "OPF validation" begin
    no_slack = base_topology()
    no_slack["nodes"][1]["is_slack"] = false
    bad = JSON3.read(JGDO.run_opf(JSON3.write(no_slack)))
    @test bad["status"] == "error"
    @test bad["code"] == "GRID_TOPOLOGY"

    empty_req = JSON3.read(JGDO.run_opf("{}"))
    @test empty_req["status"] == "error"
    @test empty_req["code"] == "GRID_VALIDATION"

    # {"topology": ...} 包装与裸拓扑等价
    wrapped = JSON3.read(JGDO.run_opf(JSON3.write(Dict("topology" => JSON3.read(read(joinpath(EXAMPLES_DIR, "econ2.json"), String))))))
    @test wrapped["status"] == "ok"
    @test wrapped["data"]["type"] == "opf"
end

# ---- N-1 转供恢复 ----

@testset "N-1 restoration (ieee33 tie switches)" begin
    topo = JSON3.read(read(joinpath(EXAMPLES_DIR, "ieee33.json"), String))
    request = JSON3.write(Dict("topology" => topo, "restore" => true))
    response = JSON3.read(JGDO.run_n1(request))
    @test response["status"] == "ok"
    data = response["data"]

    # 基础 N-1 行为不变
    @test data["summary"]["n_branches"] == 32
    @test data["summary"]["n_islanding"] == 32
    @test data["summary"]["n_ok"] == 0
    @test isapprox(data["summary"]["max_lost_load_mw"], 3.715; atol=1e-9)

    @test data["summary"]["n_restorable"] == 31
    @test data["summary"]["n_unrestorable"] == 1
    @test length(data["restoration"]) == 32

    # br-1 是电源出线：所有联络开关两端都在孤岛内 → 不可恢复，且给出原因
    r1 = only(filter(r -> r["branch"] == "br-1", data["restoration"]))
    @test r1["restorable"] === false
    @test occursin("both ends inside the island", r1["reason"])
    @test isapprox(r1["lost_load_after_mw"], 3.715; atol=1e-9)
    @test isempty(r1["closed_ties"])

    # br-17 只带 bus-18：由联络开关 br-36（bus-18 ↔ bus-33）单条恢复
    r17 = only(filter(r -> r["branch"] == "br-17", data["restoration"]))
    @test r17["restorable"] === true
    @test String.(r17["closed_ties"]) == ["br-36"]
    @test r17["search_depth"] == 1
    @test isapprox(r17["lost_load_before_mw"], 0.09; atol=1e-9)
    @test isapprox(r17["lost_load_after_mw"], 0.0; atol=1e-9)
    @test 0.0 < r17["loss_mw"] < 1.0                 # 恢复后网损为有限正值
    @test isfinite(r17["loss_mw"])
    @test r17["vmin_pu"] > 0.9                        # 不越限
    @test r17["violated"] === false

    # br-2 转供成功但严重越限：可带电 ≠ 运行合格
    r2 = only(filter(r -> r["branch"] == "br-2", data["restoration"]))
    @test r2["restorable"] === true
    @test String.(r2["closed_ties"]) == ["br-33"]
    @test r2["vmin_pu"] < 0.9
    @test r2["violated"] === true

    # 辐射状不变量：ieee33 基态是树（n_loops_base=0）→ 每条恢复方案仍必须是树
    @test data["summary"]["n_loops_base"] == 0
    for entry in data["restoration"]
        entry["restorable"] === true || continue
        @test entry["radial"] === true
        @test entry["n_bus"] == 33
        @test entry["n_closed_branches"] == entry["n_bus"] - 1
        @test entry["n_loops_after"] == 0
        @test length(entry["closed_ties"]) == entry["search_depth"]
        @test entry["lost_load_after_mw"] < entry["lost_load_before_mw"]
        @test isfinite(entry["loss_mw"]) && entry["loss_mw"] > 0
    end

    # 深度定理：单条支路开断最多切出 2 个连通分量 → 恢复连通当且仅当闭合一条跨界联络
    # 开关。内核只搜深度 1，且这不是能力缺失 —— 每条可恢复条目都恰好闭 1 条开关且完
    # 全复电（restorable ⇒ fully_restored），不存在需要更深搜索的残余孤岛。
    @test data["summary"]["max_search_depth"] == 1
    for entry in data["restoration"]
        entry["restorable"] === true || continue
        @test entry["search_depth"] == 1
        @test length(entry["closed_ties"]) == 1
        @test entry["fully_restored"] === true
        @test isempty(entry["islanded_buses_after"])
    end

    # 5 条联络开关每条开断都被实际枚举检查过（包括 br-1 那条不可恢复的）
    for entry in data["restoration"]
        @test entry["n_candidates_evaluated"] == 5
        @test length(entry["candidate_ties"]) == 5
    end

    # 条目形状一致性：可恢复 / 不可恢复两个分支必须返回**同一套键**（前端不能拿到 undefined）
    restorable_keys = sort(String.(keys(only(filter(r -> r["branch"] == "br-17", data["restoration"])))))
    unrestorable_keys = sort(String.(keys(r1)))
    @test restorable_keys == unrestorable_keys
    for k in ["loss_mw", "vmin_pu", "vmin_bus", "violated", "radial", "n_closed_branches", "n_loops_after"]
        @test r1[k] === nothing            # 恢复后才有意义的字段 → null，而不是缺键
    end
    @test isempty(r1["violation_buses"])
    @test isempty(r1["overloaded_branches"])
    @test String.(r1["islanded_buses_after"]) == String.(r1["islanded_buses"])
    @test r1["n_bus"] == 33
    @test r1["n_loops_base"] == 0
end

@testset "N-1 restoration on a MESHED base (环网不再假阴性)" begin
    # bus1—bus2—bus3—bus1 成环 + bus3—bus4 支线 + 常开联络 sw-24(bus2↔bus4)。
    # 基态回路数 = 4 − 4 + 1 = 1（非辐射状）。旧实现的准入判据是绝对辐射状
    # 「闭合支路数 == 母线数 − 1」，恢复后是 4 ≠ 3 → 一律 restorable=false（假阴性）。
    topo = JSON3.read(read(joinpath(EXAMPLES_DIR, "ring4.json"), String))
    response = JSON3.read(JGDO.run_n1(JSON3.write(Dict("topology" => topo, "restore" => true))))
    @test response["status"] == "ok"
    data = response["data"]

    @test data["summary"]["n_loops_base"] == 1        # 基态就不是树
    @test data["summary"]["n_branches"] == 4
    @test data["summary"]["n_ok"] == 3                # 环上三条支路开断都不孤岛
    @test data["summary"]["n_islanding"] == 1
    @test data["summary"]["n_restorable"] == 1
    @test data["summary"]["n_unrestorable"] == 0

    entry = only(data["restoration"])
    @test entry["branch"] == "line-34"
    @test String.(entry["islanded_buses"]) == ["bus-4"]
    @test entry["restorable"] === true                # ← 旧内核在这里返回 false
    @test entry["fully_restored"] === true
    @test String.(entry["closed_ties"]) == ["sw-24"]
    @test isapprox(entry["lost_load_before_mw"], 0.5; atol=1e-9)
    @test isapprox(entry["lost_load_after_mw"], 0.0; atol=1e-9)
    @test entry["n_closed_branches"] == 4             # 4 母线 4 支路 —— 不是树，但也没多出回路
    @test entry["n_loops_base"] == 1
    @test entry["n_loops_after"] == 1                 # 回路数不增 = 真正的准入判据
    @test entry["radial"] === false                   # 且 restorable=true —— 辐射状不是必要条件
    @test entry["violated"] === false
    @test entry["vmin_pu"] > 0.9
    @test isfinite(entry["loss_mw"]) && entry["loss_mw"] > 0
end

@testset "N-1 restoration is opt-in (default payload unchanged)" begin
    # 裸拓扑（历史请求形状）→ 没有 restoration 块，summary 不含 n_restorable
    response = JSON3.read(JGDO.run_n1(JSON3.write(base_topology())))
    @test response["status"] == "ok"
    @test !haskey(response["data"], "restoration")
    @test !haskey(response["data"]["summary"], "n_restorable")

    # 3 母线算例：sw-13（bus-1 ↔ bus-3，switchable & OPEN）两条开断都能救 ——
    # line-12 断 → 闭 sw-13 后 bus-1→bus-3→bus-2 供电（失负荷 0.8 → 0）；
    # line-23 断 → 闭 sw-13 后 bus-3 复电（该孤岛失负荷本来就是 0，但挂着 dg-1，
    # 判据是「失电母线数严格下降」而不是「失负荷严格下降」）。
    request = JSON3.write(Dict("topology" => base_topology(), "restore" => true))
    resp = JSON3.read(JGDO.run_n1(request))
    data = resp["data"]
    @test data["summary"]["n_restorable"] == 2
    @test data["summary"]["n_unrestorable"] == 0
    @test data["summary"]["max_search_depth"] == 1

    r12 = only(filter(r -> r["branch"] == "line-12", data["restoration"]))
    @test r12["restorable"] === true
    @test r12["fully_restored"] === true
    @test String.(r12["closed_ties"]) == ["sw-13"]
    @test isapprox(r12["lost_load_before_mw"], 0.8; atol=1e-9)
    @test isapprox(r12["lost_load_after_mw"], 0.0; atol=1e-9)
    @test r12["n_closed_branches"] == 2      # 3 母线 → 2 条闭合支路，仍是树
    @test r12["radial"] === true
    @test isempty(r12["islanded_buses_after"])

    r23 = only(filter(r -> r["branch"] == "line-23", data["restoration"]))
    @test r23["restorable"] === true
    @test String.(r23["closed_ties"]) == ["sw-13"]
    @test isapprox(r23["lost_load_before_mw"], 0.0; atol=1e-9)
    @test r23["n_closed_branches"] == 2
end

@testset "N-1 restore request validation" begin
    bad_restore = JSON3.read(JGDO.run_n1(JSON3.write(Dict("topology" => base_topology(), "restore" => 3))))
    @test bad_restore["status"] == "error"
    @test bad_restore["code"] == "GRID_VALIDATION"

    # max_ties 已被删除：任何取值（包括「合法」的 1/2）都必须显式拒绝，而不是被静默忽略 ——
    # 深度 ≥ 2 的联络开关组合搜索在数学上不可能恢复单条搜索恢复不了的负荷（见 attempt_restoration）。
    for value in (1, 2, 9)
        bad_ties = JSON3.read(JGDO.run_n1(JSON3.write(
            Dict("topology" => base_topology(), "restore" => true, "max_ties" => value))))
        @test bad_ties["status"] == "error"
        @test bad_ties["code"] == "GRID_VALIDATION"
        @test occursin("max_ties", bad_ties["message"]) || occursin("max_ties", JSON3.write(bad_ties))
    end
end

@testset "Error envelope" begin
    bad = JSON3.read(JGDO.run_pf("{\"meta\":{},\"nodes\":[],\"links\":[]}"))
    @test bad["status"] == "error"
    @test haskey(bad, "code")
    @test bad["data"] === nothing
end

@testset "Envelope → HTTP status (serve.jl 的映射源)" begin
    # 成功 → 200
    @test JGDO.http_status(JGDO.run_pf(JSON3.write(base_topology()))) == 200
    @test JGDO.http_status(JGDO.run_opf(read(joinpath(EXAMPLES_DIR, "econ2.json"), String))) == 200

    # 用户输入问题 → 422
    no_slack = base_topology()
    no_slack["nodes"][1]["is_slack"] = false
    topo_err = JGDO.run_pf(JSON3.write(no_slack))
    @test JSON3.read(topo_err)["code"] == "GRID_TOPOLOGY"
    @test JGDO.http_status(topo_err) == 422

    validation_err = JGDO.run_timeseries(JSON3.write(Dict("topology" => base_topology(), "load_scale" => Any[])))
    @test JSON3.read(validation_err)["code"] == "GRID_VALIDATION"
    @test JGDO.http_status(validation_err) == 422

    # 服务端问题 → 500
    snapshot_err = JGDO.Errors.wrap_error(SnapshotError("failed to write snapshot"; path="/nope"))
    @test JSON3.read(snapshot_err)["code"] == "GRID_SNAPSHOT"
    @test JGDO.http_status(snapshot_err) == 500

    internal_err = JGDO.Errors.wrap_error(ErrorException("boom"))
    @test JSON3.read(internal_err)["code"] == "GRID_INTERNAL"
    @test JGDO.http_status(internal_err) == 500

    # 不可解析的 body 保守归 500
    @test JGDO.http_status("not json at all") == 500
end

@testset "Snapshot persistence" begin
    mktempdir() do dir
        data = Dict(
            "status" => "ok",
            "meta" => Dict("baseMVA" => 100.0),
            "buses" => [Dict("id" => "bus-1", "vm_pu" => 1.0)],
        )
        path = write_run_snapshot(data; runs_dir=dir)
        @test isfile(path)
        stored = JSON3.read(read(path, String))
        @test stored["status"] == "ok"
        @test haskey(stored, "buses")
    end
end

@testset "Snapshot error handling" begin
    mktempdir() do dir
        data = Dict("status" => "ok")
        Base.Filesystem.chmod(dir, 0o500)
        try
            @test_throws SnapshotError write_run_snapshot(data; runs_dir=dir)
        finally
            Base.Filesystem.chmod(dir, 0o700)
        end
    end
end

# ---- Golden 契约（contracts/ 双端共享，冻结跨进程契约行为）----
const CONTRACTS_DIR = normpath(joinpath(@__DIR__, "..", "..", "..", "contracts"))
if isdir(CONTRACTS_DIR)
    include(joinpath(CONTRACTS_DIR, "contract_checker.jl"))
    @testset "Golden contracts (grid)" begin
        for spec in load_contracts(joinpath(CONTRACTS_DIR, "grid"))
            request = if haskey(spec, :request_example)
                read(joinpath(EXAMPLES_DIR, String(spec[:request_example]) * ".json"), String)
            elseif haskey(spec, :request_topology_example)
                # 组合请求：{"topology": <examples/<名>.json>, ...request_extra}
                topo = JSON3.read(read(joinpath(EXAMPLES_DIR, String(spec[:request_topology_example]) * ".json"), String))
                body = Dict{String,Any}("topology" => topo)
                for (key, value) in pairs(get(spec, :request_extra, Dict{Symbol,Any}()))
                    body[String(key)] = value
                end
                JSON3.write(body)
            else
                JSON3.write(spec[:request])
            end
            endpoint = String(spec[:endpoint])
            raw = endpoint == "pf" ? JGDO.run_pf(request) :
                  endpoint == "reconfig" ? JGDO.run_reconfiguration_dg(request) :
                  endpoint == "n1" ? JGDO.run_n1(request) :
                  endpoint == "timeseries" ? JGDO.run_timeseries(request) :
                  endpoint == "transient" ? JGDO.run_transient(request) :
                  endpoint == "shortcircuit" ? JGDO.run_shortcircuit(request) :
                  endpoint == "opf" ? JGDO.run_opf(request) :
                  error("未知契约端点: " * endpoint)
            @testset "$(spec[:name])" begin
                check_contract(JSON3.read(raw), spec[:expect])
                # HTTP 状态码这一层：contract_checker 只看 body，所以夹具用可选的
                # expect_http 字段直接对 JGDO.http_status（serve.jl 的 HTTP 码来源）断言。
                if haskey(spec, :expect_http)
                    @test JGDO.http_status(raw) == Int(spec[:expect_http])
                end
            end
        end
    end
else
    @info "contracts/ 不存在，跳过契约测试（standalone 模式）"
end
