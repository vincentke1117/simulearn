module Errors

using JSON3

export TopologyError, ValidationError, SnapshotError, wrap_success, wrap_error

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

error_code(::ValidationError) = "VALIDATION_ERROR"
error_code(::TopologyError) = "TOPOLOGY_ERROR"
error_code(::SnapshotError) = "SNAPSHOT_ERROR"
error_code(::Exception) = "INTERNAL_ERROR"

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

using .Errors: TopologyError, ValidationError, SnapshotError, wrap_success, wrap_error
