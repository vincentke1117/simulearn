# 为 grid-backend 构建 sysimage，把 PowerModels/JuMP/求解器栈的加载与 JIT 烤进镜像。
# 用法：julia packages/grid-backend/scripts/build_sysimage.jl
# 产物：packages/grid-backend/sysimage/grid.sysimage.dll（gitignore）
# 启动：julia -J packages/grid-backend/sysimage/grid.sysimage.dll --project=packages/grid-backend packages/grid-backend/scripts/serve.jl
# 注意：工作负载会把 JGDO 自身的编译产物也烤进去；JGDO 源码大改后建议重建镜像（不重建也能跑，只是改动过的方法回到 JIT）。

using Pkg

const PROJECT = normpath(joinpath(@__DIR__, ".."))
const OUT_DIR = joinpath(PROJECT, "sysimage")
const OUT = joinpath(OUT_DIR, "grid.sysimage." * (Sys.iswindows() ? "dll" : Sys.isapple() ? "dylib" : "so"))

Pkg.activate(; temp = true)
Pkg.add("PackageCompiler")
using PackageCompiler

mkpath(OUT_DIR)

# 前置检查：Windows 上无法覆盖已被映射进运行中进程的 DLL。
# 服务如果正用 `-J<这个镜像>` 跑着，构建会一路跑到最后的链接步骤才失败
# （g++ 写不了输出文件，报一堆看不懂的 ProcessExited(1)），白等二十分钟。
# 在这里花一秒钟试写一下，把它变成一句人话。
if isfile(OUT)
    try
        open(OUT, "a") do _ end
    catch
        error("""
              sysimage 文件被占用，无法覆盖：$OUT
              多半是配电网内核正用 `-J$(basename(OUT))` 运行中（scripts/start-all.ps1 会自动带上它）。
              先停掉 8123 端口上的 julia 进程，再重新构建；构建完再启动即可。
              """)
    end
end

@info "开始构建 sysimage（约 10-40 分钟）" project = PROJECT output = OUT

create_sysimage(
    ["PowerModels", "JuMP", "Ipopt", "Juniper", "HiGHS", "MathOptInterface", "Graphs", "JSON3", "Oxygen", "HTTP"];
    sysimage_path = OUT,
    project = PROJECT,
    precompile_execution_file = joinpath(@__DIR__, "precompile_workload.jl"),
)

@info "sysimage 构建完成" path = OUT size_mb = round(filesize(OUT) / 1024^2; digits = 1)
