module Errors

using JSON3

export TopologyError, ValidationError, SnapshotError, wrap_success, wrap_error, http_status

struct TopologyError <: Exception
    msg::String
end

Base.showerror(io::IO, err::TopologyError) = print(io, err.msg)

struct ValidationError <: Exception
    msg::String
    path::Vector{String}
    ValidationError(msg::AbstractString, path::Vector{String}=String[]) = new(String(msg), path)
end

Base.showerror(io::IO, err::ValidationError) = isempty(err.path) ? print(io, err.msg) : print(io, err.msg, " @ ", join(err.path, "."))

struct SnapshotError <: Exception
    msg::String
    path::Union{Nothing,String}
    cause::Union{Nothing,Exception}
    function SnapshotError(msg::AbstractString; path=nothing, cause=nothing)
        str_path = isnothing(path) ? nothing : String(path)
        return new(String(msg), str_path, cause)
    end
end

function Base.showerror(io::IO, err::SnapshotError)
    print(io, err.msg)
    if err.path !== nothing
        print(io, " @ ", err.path)
    end
    if err.cause !== nothing
        print(io, " caused by ", sprint(showerror, err.cause))
    end
end

wrap_success(result_type::AbstractString, payload) = JSON3.write(Dict(
    "status" => "ok",
    "message" => String(result_type),
    "data" => payload,
))

error_code(::ValidationError) = "GRID_VALIDATION"
error_code(::TopologyError) = "GRID_TOPOLOGY"
error_code(::SnapshotError) = "GRID_SNAPSHOT"
error_code(::Exception) = "GRID_INTERNAL"

"""
    http_status(response_json) -> Int

封套 → HTTP 状态码（与 lab 内核统一）：
  成功                                → 200
  GRID_VALIDATION / GRID_TOPOLOGY     → 422（用户输入问题：请求体/拓扑可改）
  GRID_SNAPSHOT   / GRID_INTERNAL     → 500（服务端问题：学生改拓扑也没用）
GRID_SNAPSHOT 归 500 的理由：快照写盘失败是服务端文件系统故障，与请求内容无关。
未知/不可解析的 body 保守归 500。HTTP 层只读 code，body 一个字节都不改。
"""
const ERROR_HTTP_STATUS = Dict(
    "GRID_VALIDATION" => 422,
    "GRID_TOPOLOGY" => 422,
    "GRID_SNAPSHOT" => 500,
    "GRID_INTERNAL" => 500,
)

function http_status(response_json::AbstractString)
    try
        obj = JSON3.read(response_json)
        get(obj, :status, "ok") == "error" || return 200
        return get(ERROR_HTTP_STATUS, String(get(obj, :code, "GRID_INTERNAL")), 500)
    catch
        return 500
    end
end

function wrap_error(err)
    payload = Dict{String,Any}(
        "status" => "error",
        "code" => error_code(err),
        "message" => sprint(showerror, err),
        "data" => nothing,
    )
    if err isa ValidationError && !isempty(err.path)
        payload["path"] = err.path
    end
    return JSON3.write(payload)
end

end

using .Errors: TopologyError, ValidationError, SnapshotError, wrap_success, wrap_error, http_status
