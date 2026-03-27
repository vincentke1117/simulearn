using Pkg
Pkg.activate(@__DIR__)

include("src/JCircuitServer.jl")
using .JCircuitServer

# 启动服务器
result = JCircuitServer.bootstrap()
if result.server !== nothing
    wait(result.server)
end