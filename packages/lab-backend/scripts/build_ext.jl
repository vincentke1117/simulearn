# 把电路内核打成知帆拓展的可移植程序（PackageCompiler.create_app，多 CPU 目标）。
# 用法：julia packages/lab-backend/scripts/build_ext.jl [输出目录]
# 产物：<输出目录>/bin/simulearn-lab.exe（默认 packages/lab-backend/sysimage/ext/simulearn-lab，已 gitignore）
# 入口是 JCircuitServer.julia_main（src/Server.jl）。页面、许可清单由 scripts/release-ext.ps1 另行拼进发布包。
#
# 与 grid-backend/scripts/build_ext.jl 同一套做法（M0 spike 实测，见设计记录修订记录）：
#   - 必须用增量模式：非增量在 Julia 1.12.1 上预编译 JLL 时报 __artifact_str MethodError；
#   - PackageCompiler 子进程失败时会把整个环境变量表打进日志，调用方先剥离密钥类变量（D22，release-ext.ps1 已做）。
using Pkg

const PROJECT = normpath(joinpath(@__DIR__, ".."))
const OUT = isempty(ARGS) ? joinpath(PROJECT, "sysimage", "ext", "simulearn-lab") : abspath(ARGS[1])

# CPU 目标默认与 grid 一致，用 PackageCompiler 的多目标（generic + sandybridge 全量克隆 + haswell，设计记录 R1）。
# MTK / DiffEq 栈很大，多目标单线程出镜像时编译进程峰值近 28 GB：正式包在 labpc（96 GB 内存）上构建。
# 32 GB 的开发机（提交内存上限约 64 GB，别的程序平时就占四十多 GB）上 2026-11-02 有三次因此崩掉，
# 在那种机器上设 SIMULEARN_CPU_TARGET=generic：任何 x86-64 CPU 都能直接用、不现场重编，
# 只是镜像里的函数没有针对新 CPU 的专门版本（电路内核解的是小方程，差别可以忽略）。
cpu_target() = get(ENV, "SIMULEARN_CPU_TARGET", PackageCompiler.default_app_cpu_target())

const RANDOM123 = Base.PkgId(Base.UUID("74087812-796a-5b5d-8853-05524746bad3"), "Random123")

pkgid_expr(id::Base.PkgId) = "Base.PkgId(Base.UUID(\"$(id.uuid)\"), \"$(id.name)\")"

"""
在 --pkgimages=no 的进程里 `using JCircuitServer`（出镜像的进程就是这样一路载入依赖的），看载进来的 Random123 启没启用 AES-NI。
每个依赖方的缓存都按 build id 钉死它依赖的那一份缓存（JCircuitServer → ModelingToolkit → DiffEqNoiseProcess → Random123），
所以必须从顶上载入来查：顶层直接 require Random123 总拿到最新的一份，只查 DiffEqNoiseProcess 也可能被 ModelingToolkit 的旧缓存绕过
（2026-11-02 第五次构建前就是这样漏掉的）。依赖链的缓存失效时，这一步顺带在 --pkgimages=no 下把整条链重编出来。
"""
function chain_uses_aes()
    code = "using JCircuitServer; exit(Base.loaded_modules[$(pkgid_expr(RANDOM123))].R123_USE_X86_AES_NI ? 1 : 0)"
    return !success(`$(Base.julia_cmd()) --startup-file=no --pkgimages=no --project=$PROJECT -e $code`)
end

"""
Random123（ModelingToolkit → DiffEqNoiseProcess 引入）预编译时在子进程里试一条 AES-NI 指令，试得通就把 AES 代码编进包。
系统镜像要为 generic 目标也生成机器码，generic 没有 AES，LLVM 报「Cannot select: intrinsic llvm.x86.aesni.aesenclast」
直接中止（2026-11-02 第四次构建实测；PackageCompiler 默认的目标列表里也有 generic，同样会撞上）。

做法：检测子进程沿用父进程的 --cpu-target，所以在 generic 进程里重新生成一份 --pkgimages=no 的 Random123 缓存就检测不到 AES；
再删掉其余 --pkgimages=no 的 Random123 缓存（没有同名 .dll 的 .ji），钉着它们的整条依赖链随之失效，重编时就改钉无 AES 的那一份
（重编整条 MTK 链要十几分钟）。开发态用的 pkgimage 缓存（.ji + .dll）不动。依赖链已经是无 AES 的就跳过。
"""
function precompile_random123_without_aes()
    if !chain_uses_aes()
        @info "Random123 的依赖链已经用的是不含 AES-NI 的缓存"
        return
    end
    code = """
        id = $(pkgid_expr(RANDOM123))
        path = Base.compilecache(id)
        Base.require(id).R123_USE_X86_AES_NI && error("Random123 仍然启用了 AES-NI")
        println(path isa Tuple ? first(path) : path)
    """
    fresh = normpath(String(last(split(strip(read(`$(Base.julia_cmd()) --startup-file=no --pkgimages=no --cpu-target=generic --project=$PROJECT -e $code`, String)), '\n'))))
    isfile(fresh) || error("没找到刚生成的 Random123 缓存：$fresh")
    compiled = "compiled/v$(VERSION.major).$(VERSION.minor)/$(RANDOM123.name)"
    for depot in DEPOT_PATH
        dir = joinpath(depot, compiled)
        isdir(dir) || continue
        for file in readdir(dir; join = true)
            endswith(file, ".ji") || continue
            normpath(file) == fresh && continue
            isfile(splitext(file)[1] * ".dll") && continue
            @info "删除含 AES-NI 的 Random123 缓存" file
            rm(file)
        end
    end
    chain_uses_aes() && error("依赖链仍然钉着含 AES-NI 的 Random123 缓存，镜像会编不过")
    @info "Random123 已改用不含 AES-NI 的缓存" fresh
end

"""
载入 `JCircuitServer` 之后，凡是带「按需下载」（lazy）artifact 的 JLL 都不该在里面：PackageCompiler 默认不打包 lazy artifact，
程序一启动这些 JLL 的 `__init__` 就去联网下载——断网的电脑上起不来，也违反约定「拓展不主动联网」。
2026-11-02 第六次构建出来的包就栽在这里（LinearSolve → MKL_jll → IntelOpenMP_jll），已在 Project.toml 里关掉 MKL。
构建前先查，免得白跑三个小时。查的是 `using JCircuitServer` 实际载入的包，所以 create_app 必须配
`include_transitive_dependencies = false`，否则镜像会另外塞进 Manifest 里的全部传递依赖，这里查了也白查。
"""
function check_no_lazy_artifacts()
    code = """
        using JCircuitServer
        lazy(meta) = meta isa AbstractDict ? get(meta, "lazy", false) == true : any(lazy, meta)
        bad = String[]
        for (id, mod) in Base.loaded_modules
            endswith(id.name, "_jll") || continue
            file = joinpath(pkgdir(mod), "Artifacts.toml")
            isfile(file) && any(lazy, values(Base.parsed_toml(file))) && push!(bad, id.name)
        end
        isempty(bad) || (println(join(sort(bad), ", ")); exit(1))
    """
    out = IOBuffer()
    ok = success(pipeline(`$(Base.julia_cmd()) --startup-file=no --project=$PROJECT -e $code`; stdout = out))
    ok || error("这些 JLL 带「按需下载」的 artifact，打进拓展后一启动就会去联网下载：$(strip(String(take!(out))))")
    @info "没有带「按需下载」artifact 的 JLL"
end

function build()
    check_no_lazy_artifacts()
    precompile_random123_without_aes()
    # Julia 1.12 生成镜像时默认按核数并行跑 LLVM，每个并行块各拷一份模块：MTK / DiffEq 整套代码在 16 核上
    # 把 32 GB 的开发机吃满，编译子进程直接崩掉（2026-11-02 实测两次：16 块时空闲内存掉到 88 MiB，4 块时掉到 6 MiB）。
    # 默认只用一个线程，慢一些但内存峰值最低；内存大的机器（labpc）可以设 JULIA_IMAGE_THREADS 加快。
    get!(ENV, "JULIA_IMAGE_THREADS", "1")
    target = cpu_target()
    @info "开始构建拓展程序（MTK / DiffEq 栈，预计一小时以上）" project = PROJECT output = OUT cpu_target = target image_threads = ENV["JULIA_IMAGE_THREADS"]
    seconds = @elapsed PackageCompiler.create_app(PROJECT, OUT;
        executables = ["simulearn-lab" => "julia_main"],
        precompile_execution_file = joinpath(@__DIR__, "precompile_workload.jl"),
        incremental = true,
        # 只放 `using JCircuitServer` 实际载入的包。默认 true 会把 Manifest 里全部传递依赖逐个 `using` 进镜像，
        # LinearSolve 关掉 MKL 的偏好就被绕过去：MKL_jll / IntelOpenMP_jll 照样进镜像、一启动就去联网下载
        # （2026-11-03 labpc 构建的包在隔离环境里实测）。设成 false 后，镜像内容与 check_no_lazy_artifacts 查的一致
        include_transitive_dependencies = false,
        # 启动程序用仓库里修过的版本：原版在系统代码页不是 UTF-8 的 Windows 上，安装路径一带中文就找不到自带的库
        c_driver_program = normpath(joinpath(@__DIR__, "..", "..", "..", "scripts", "ext-launcher", "embedding_wrapper.c")),
        cpu_target = target,
        force = true,
    )
    @info "拓展程序构建完成" minutes = round(seconds / 60; digits = 1) exe = joinpath(OUT, "bin", "simulearn-lab.exe")
end

# 顶层加载 PackageCompiler，再用 invokelatest 调用：在函数里 @eval using 会撞上 world age
Pkg.activate(; temp = true)
Pkg.add(PackageSpec(name = "PackageCompiler", version = "2.4.0"))
using PackageCompiler
Base.invokelatest(build)
