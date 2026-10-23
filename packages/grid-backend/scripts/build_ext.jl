# 把配电网内核打成知帆拓展的可移植程序（PackageCompiler.create_app，多 CPU 目标）。
# 用法：julia packages/grid-backend/scripts/build_ext.jl [输出目录]
# 产物：<输出目录>/bin/simulearn-grid.exe（默认 packages/grid-backend/sysimage/ext/simulearn-grid，已 gitignore）
# 入口是 JGDO.julia_main（src/server.jl）。页面、算例、许可清单由 scripts/release-ext.ps1 另行拼进发布包。
#
# 注意（M0 spike 实测，见设计记录修订记录）：
#   - 必须用增量模式：非增量在 Julia 1.12.1 上预编译 JLL 时报 __artifact_str MethodError；
#   - PackageCompiler 子进程失败时会把整个环境变量表打进日志，调用方先剥离密钥类变量（D22，release-ext.ps1 已做）。
using Pkg

const PROJECT = normpath(joinpath(@__DIR__, ".."))
const OUT = isempty(ARGS) ? joinpath(PROJECT, "sysimage", "ext", "simulearn-grid") : abspath(ARGS[1])

function build()
    cpu_target = PackageCompiler.default_app_cpu_target()
    @info "开始构建拓展程序（约 30-40 分钟）" project = PROJECT output = OUT cpu_target
    seconds = @elapsed PackageCompiler.create_app(PROJECT, OUT;
        executables=["simulearn-grid" => "julia_main"],
        precompile_execution_file=joinpath(@__DIR__, "precompile_workload.jl"),
        incremental=true,
        cpu_target=cpu_target,
        force=true,
    )
    @info "拓展程序构建完成" minutes = round(seconds / 60; digits=1) exe = joinpath(OUT, "bin", "simulearn-grid.exe")
end

# 顶层加载 PackageCompiler，再用 invokelatest 调用：在函数里 @eval using 会撞上 world age
Pkg.activate(; temp=true)
Pkg.add(PackageSpec(name="PackageCompiler", version="2.4.0"))
using PackageCompiler
Base.invokelatest(build)
