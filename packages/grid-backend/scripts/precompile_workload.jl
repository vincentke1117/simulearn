# sysimage 预编译工作负载：把每一种分析的求解链路各走一遍，全部 JIT 烤进镜像。
# 由 build_sysimage.jl 经 PackageCompiler 调用，也可单独运行做冒烟。
#
# 覆盖面必须跟着 JGDO 的能力走：漏掉一种分析，那种分析在服务里就退回 JIT
# （用户第一次点它时白等几十秒）。加了新的 run_* 记得在这里补一行。

using JGDO
using JSON3

const EXAMPLES = normpath(joinpath(@__DIR__, "..", "examples"))
read_example(name) = read(joinpath(EXAMPLES, name * ".json"), String)

# 把拓扑和额外参数拼成 {"topology": ..., ...extra} 形式的请求体
function wrap(topology_json::String, extra::Dict{String,Any})
    body = Dict{String,Any}("topology" => JSON3.read(topology_json))
    merge!(body, extra)
    return JSON3.write(body)
end

let ok = 0, failed = String[]
    ieee33 = read_example("ieee33")
    smib = read_example("smib")

    jobs = [
        ("pf", () -> JGDO.run_pf(ieee33)),
        ("reconfig", () -> JGDO.run_reconfiguration_dg(read_example("reconfiguration_test"))),
        ("opf", () -> JGDO.run_opf(read_example("econ2"))),
        # N-1 两条都要：不带转供（纯扫描）与带转供（多走一遍潮流 + 连通性搜索）
        ("n1", () -> JGDO.run_n1(ieee33)),
        ("n1+restore", () -> JGDO.run_n1(wrap(ieee33, Dict{String,Any}("restore" => true)))),
        ("timeseries", () -> JGDO.run_timeseries(wrap(ieee33, Dict{String,Any}("load_scale" => [0.5, 1.0])))),
        ("shortcircuit", () -> JGDO.run_shortcircuit(wrap(ieee33, Dict{String,Any}("fault_bus" => nothing, "zf_pu" => 0.0)))),
        ("transient", () -> JGDO.run_transient(wrap(smib, Dict{String,Any}(
            "fault" => Dict("bus" => "bus-2", "t_fault_s" => 0.1, "t_clear_s" => 0.25, "zf_pu" => 0.0, "trip_branch" => nothing),
            "sim" => Dict("t_stop_s" => 1.0, "dt_s" => 0.005),
            "f_hz" => 50,
            "find_cct" => false,
        )))),
    ]

    for (name, job) in jobs
        try
            response = job()
            status = JSON3.read(response)["status"]
            status == "ok" ? (ok += 1) : push!(failed, "$name → status=$status")
        catch err
            # 预编译负载不是测试：单条失败不该让镜像构建整体失败，但要吼出来。
            push!(failed, string(name, " → ", sprint(showerror, err)))
        end
    end

    println("precompile workload done: $ok ok, $(length(failed)) failed")
    for f in failed
        println("  [failed] ", f)
    end
end
