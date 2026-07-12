using Pkg
Pkg.activate(@__DIR__)
Pkg.instantiate()

# 用 `using JCircuitServer`（包）而不是 `include("src/JCircuitServer.jl")`：
# include 绕过 Julia 的预编译缓存，每次启动都要把整个模块连同 MTK 的方法特化重编一遍。
# 本项目 Project.toml 里 JCircuitServer 就是包本身（name + uuid），项目激活后可直接 using，
# 走 .ji/pkgimage 缓存。
using JCircuitServer

println("Starting JCircuitServer...")
result = JCircuitServer.bootstrap()
println("Server started on $(result.host):$(result.port)")
println("Press Ctrl+C to stop")

# 保持服务器运行
try
    while true
        sleep(1)
    end
catch e
    if isa(e, InterruptException)
        println("\nShutting down server...")
    else
        rethrow(e)
    end
end