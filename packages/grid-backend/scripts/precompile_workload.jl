# sysimage 预编译工作负载：走一遍潮流 + 重构全链路，把求解器 JIT 烤进镜像。
# 由 build_sysimage.jl 经 PackageCompiler 调用，也可单独运行做冒烟。

using JGDO
using JSON3

const EXAMPLES = normpath(joinpath(@__DIR__, "..", "examples"))

let
    pf = JGDO.run_pf(read(joinpath(EXAMPLES, "ieee33.json"), String))
    @assert JSON3.read(pf)["status"] == "ok"
    rc = JGDO.run_reconfiguration_dg(read(joinpath(EXAMPLES, "reconfiguration_test.json"), String))
    @assert JSON3.read(rc)["status"] == "ok"
    println("precompile workload done")
end
