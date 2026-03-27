using Pkg
Pkg.activate(@__DIR__)
Pkg.instantiate()

include("src/JCircuitServer.jl")
using .JCircuitServer

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