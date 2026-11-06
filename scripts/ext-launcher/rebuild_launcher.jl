# 只重编拓展的启动程序 bin/<名字>.exe（用同目录 embedding_wrapper.c），系统镜像 lib/julia/sys.dll 不动。
# 启动程序只是个几十 KB 的小程序：修它不必把几个小时的镜像重建一遍。
#
#   julia scripts/ext-launcher/rebuild_launcher.jl <程序目录> <可执行文件名> <入口函数>
#   例：julia scripts/ext-launcher/rebuild_launcher.jl E:\…\out\simulearn-lab simulearn-lab JCircuitServer.julia_main
#
# 必须用构建这份程序的同一个 Julia 版本来跑（启动程序按当前 Julia 的头文件与 libjulia 编译）。
# 编译器用 PackageCompiler 自带的 mingw，版本与 build_ext.jl 一致。
using Pkg

length(ARGS) == 3 || error("用法：rebuild_launcher.jl <程序目录> <可执行文件名> <入口函数>")
const APP = abspath(ARGS[1])
const NAME = ARGS[2]
const MAIN = ARGS[3]
const WRAPPER = joinpath(@__DIR__, "embedding_wrapper.c")
isfile(joinpath(APP, "lib", "julia", "sys.dll")) || error("$APP 不像 create_app 的产物（没有 lib/julia/sys.dll）")

function rebuild()
    exe = joinpath(APP, "bin", NAME)
    old = exe * ".exe"
    isfile(old) && mv(old, old * ".old"; force = true)
    PackageCompiler.create_executable_from_sysimg(exe, WRAPPER, MAIN)
    isfile(old) || error("没有生成 $old")
    rm(old * ".old"; force = true)
    @info "启动程序已重编" exe = old bytes = filesize(old)
end

# 与 build_ext.jl 相同：顶层加载 PackageCompiler，再用 invokelatest 调用
Pkg.activate(; temp = true)
Pkg.add(PackageSpec(name = "PackageCompiler", version = "2.4.0"))
using PackageCompiler
Base.invokelatest(rebuild)
