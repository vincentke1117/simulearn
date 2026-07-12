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

@testset "Error envelope" begin
    bad = JSON3.read(JGDO.run_pf("{\"meta\":{},\"nodes\":[],\"links\":[]}"))
    @test bad["status"] == "error"
    @test haskey(bad, "code")
    @test bad["data"] === nothing
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
                  error("未知契约端点: " * endpoint)
            @testset "$(spec[:name])" begin
                check_contract(JSON3.read(raw), spec[:expect])
            end
        end
    end
else
    @info "contracts/ 不存在，跳过契约测试（standalone 模式）"
end
