# 拓展程序的预编译工作负载：把每一种分析的求解链路各走一遍，烤进镜像。
# 由 build_ext.jl 经 PackageCompiler 调用，也可单独运行做冒烟：
#   julia --project=packages/lab-backend packages/lab-backend/scripts/precompile_workload.jl
#
# 覆盖面跟着 contracts/lab 走：每份金标准契约就是一种分析（含控制仿真），全跑一遍；
# 契约里没有混合仿真，单独补一条。MTK 为每个新电路生成的右端函数（RuntimeGeneratedFunctions）
# 按定义烤不进去，所以瞬态的「新电路第一次」仍要现编，这里热的是包与通用求解器。

using JCircuitServer
using JCircuitServer: ComponentPayload, NetPayload, SimulationSettings, SimulationPayload
using JCircuitServer: ControlSimulationPayload, ControlBlockPayload, ControlEdgePayload, ControlOutputPayload
using JCircuitServer: MixedBridgeBindingPayload, MixedCircuitPayload, MixedSimulationPayload
using JSON3
using HTTP

const CONTRACTS = normpath(joinpath(@__DIR__, "..", "..", "..", "contracts", "lab"))

# 闭环：阶跃 → 求和 → 增益 → 受控电压源驱动分压电路，电压传感器反馈（与 test/mixed_simulation.jl 同构）
function mixed_payload()
    circuit = MixedCircuitPayload(
        [
            ComponentPayload("R1", "resistor", Dict("value" => 1000.0), Dict("p" => "n_drive", "n" => "n_out")),
            ComponentPayload("R2", "resistor", Dict("value" => 1000.0), Dict("p" => "n_out", "n" => "gnd")),
            ComponentPayload("G1", "ground", Dict{String, Float64}(), Dict("gnd" => "gnd")),
        ],
        [
            NetPayload("n_drive", [["R1", "p"]]),
            NetPayload("n_out", [["R1", "n"], ["R2", "p"]]),
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
    bridges = [MixedBridgeBindingPayload("VSEN1", "n_out", "gnd"), MixedBridgeBindingPayload("CVS1", "n_drive", "gnd")]
    return MixedSimulationPayload("mixed", blocks, edges, outputs, bridges, circuit, SimulationSettings(1.0, 80))
end

let ok = 0, failed = String[]
    jobs = Pair{String, Function}[]
    for file in sort(readdir(CONTRACTS))
        endswith(file, ".json") || continue
        request = JSON3.write(JSON3.read(read(joinpath(CONTRACTS, file), String))[:request])
        push!(jobs, file => () -> JCircuitServer.handle_simulate(
            HTTP.Request("POST", "/simulate", ["Content-Type" => "application/json"], request)))
    end
    push!(jobs, "mixed" => () -> JCircuitServer.handle_simulate(
        HTTP.Request("POST", "/simulate", ["Content-Type" => "application/json"], JSON3.write(mixed_payload()))))

    for (name, job) in jobs
        try
            response = job()
            status = JSON3.read(String(response.body))["status"]
            status == "ok" ? (ok += 1) : push!(failed, "$name → status=$status")
        catch err
            # 预编译负载不是测试：单条失败不该让镜像构建整体失败，但要吼出来。
            push!(failed, string(name, " → ", sprint(showerror, err)))
        end
    end
    # 启动时实际跑的那段预热也走一遍：它的方法要在镜像里，拓展冷启动才快
    JCircuitServer.warmup!()

    println("precompile workload done: $ok ok, $(length(failed)) failed")
    for f in failed
        println("  [failed] ", f)
    end
end

# HTTP 链路：起服务（端口 0）→ 带令牌的页面、计算请求、页面存储 → 不带令牌的 401 → 停服务。
# 拓展的第一次真实请求靠这一段热起来：请求解析、令牌守卫、路由、静态文件这条链路否则要现场 JIT。
# 页面存储的预读挡在嵌入页面第一次画出电路之前，也要热好
let token = repeat("ab", 32), tmp = mktempdir()
    ui = joinpath(tmp, "ui")
    mkpath(joinpath(ui, "assets"))
    write(joinpath(ui, "index.html"), "<!doctype html><p>warmup</p>")
    write(joinpath(ui, "assets", "app.js"), "1")
    port, server = JCircuitServer.start_ext_server(; token, ui_dir = ui, data_dir = joinpath(tmp, "data"))
    try
        base = "http://127.0.0.1:$port"
        auth = ["X-Zhifan-Ext-Token" => token, "Content-Type" => "application/json"]
        for path in ("/api/lab/health", "/api/lab/version", "/ui/", "/ui/assets/app.js", "/ui")
            HTTP.get(base * path; headers = auth, status_exception = false, redirect = false)
        end
        store = base * "/api/lab/store"
        HTTP.get(store * "?prefix=slp%3Alab%3Aexp%3Awarmup%3A"; headers = auth, status_exception = false)
        HTTP.post(store; headers = auth, status_exception = false,
                  body = JSON3.write(Dict("entries" => Dict("slp:lab:exp:warmup:draft-v1" => "{}", "slp:lab:exp:warmup:last-case" => nothing))))
        HTTP.get(store * "?key=slp%3Alab%3Aexp%3Awarmup%3Adraft-v1"; headers = auth, status_exception = false)
        HTTP.post(store; headers = auth, body = "{}", status_exception = false)
        divider = JSON3.read(read(joinpath(CONTRACTS, "dc-node-voltage-divider.json"), String))[:request]
        HTTP.post(base * "/api/lab/simulate"; headers = auth, body = JSON3.write(divider), status_exception = false)
        HTTP.post(base * "/api/lab/simulate"; headers = auth, body = "{}", status_exception = false)
        HTTP.get(base * "/api/lab/health"; status_exception = false)
    finally
        close(server)
    end
    println("http workload done")
end
