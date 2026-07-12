#!/usr/bin/env julia
#
# JGDO web server: serves the built frontend (web/dist) plus the compute API.
# Usage: julia --project=. scripts/serve.jl   (JGDO_HOST / JGDO_PORT override defaults)

using Oxygen
using HTTP
using JSON3
using JGDO
using Logging

const ROOT = normpath(joinpath(@__DIR__, ".."))
const WEB_DIST = joinpath(ROOT, "..", "grid-web", "dist")
const EXAMPLES_DIR = joinpath(ROOT, "examples")

const MIME_TYPES = Dict(
    ".html" => "text/html; charset=utf-8",
    ".js" => "application/javascript; charset=utf-8",
    ".css" => "text/css; charset=utf-8",
    ".map" => "application/json",
    ".svg" => "image/svg+xml",
    ".png" => "image/png",
    ".ico" => "image/x-icon",
    ".json" => "application/json; charset=utf-8",
    ".woff2" => "font/woff2",
)

json_response(body; status=200) = HTTP.Response(status, ["Content-Type" => "application/json; charset=utf-8"], body)

function file_response(path)
    isfile(path) || return HTTP.Response(404, "not found")
    mime = get(MIME_TYPES, lowercase(splitext(path)[2]), "application/octet-stream")
    return HTTP.Response(200, ["Content-Type" => mime], read(path))
end

function snapshot_if_ok(response::AbstractString)
    try
        obj = JSON3.read(response)
        if get(obj, "status", "error") == "ok" && get(obj, "data", nothing) !== nothing
            data = JSON3.read(JSON3.write(obj["data"]), Dict{String,Any})
            JGDO.write_run_snapshot(data)
        end
    catch err
        @warn "snapshot persistence failed" error = err
    end
    return nothing
end

@get "/health" function (req::HTTP.Request)
    return "ok"
end

# 网关透传 /api/grid/* 不做前缀改写，健康检查在两个路径都可达
@get "/api/grid/health" function (req::HTTP.Request)
    return "ok"
end

@post "/api/grid/pf" function (req::HTTP.Request)
    response = JGDO.run_pf(String(req.body))
    snapshot_if_ok(response)
    return json_response(response)
end

@post "/api/grid/reconfig" function (req::HTTP.Request)
    response = JGDO.run_reconfiguration_dg(String(req.body))
    snapshot_if_ok(response)
    return json_response(response)
end

@post "/api/grid/n1" function (req::HTTP.Request)
    response = JGDO.run_n1(String(req.body))
    snapshot_if_ok(response)
    return json_response(response)
end

@post "/api/grid/timeseries" function (req::HTTP.Request)
    response = JGDO.run_timeseries(String(req.body))
    snapshot_if_ok(response)
    return json_response(response)
end

@get "/api/grid/examples" function (req::HTTP.Request)
    entries = Vector{Dict{String,Any}}()
    for file in sort(readdir(EXAMPLES_DIR))
        endswith(file, ".json") || continue
        meta = try
            obj = JSON3.read(read(joinpath(EXAMPLES_DIR, file), String))
            get(obj, "meta", Dict())
        catch
            Dict()
        end
        push!(entries, Dict(
            "name" => splitext(file)[1],
            "feeder" => string(get(meta, "feeder", "")),
            "description" => string(get(meta, "description", "")),
        ))
    end
    return json_response(JSON3.write(entries))
end

@get "/api/grid/examples/{name}" function (req::HTTP.Request, name::String)
    occursin(r"^[A-Za-z0-9_\-]+$", name) || return json_response("""{"status":"error","message":"invalid example name"}"""; status=400)
    path = joinpath(EXAMPLES_DIR, name * ".json")
    isfile(path) || return json_response("""{"status":"error","message":"example not found"}"""; status=404)
    return json_response(read(path, String))
end

@get "/" function (req::HTTP.Request)
    return file_response(joinpath(WEB_DIST, "index.html"))
end

@get "/assets/{file}" function (req::HTTP.Request, file::String)
    occursin(r"^[A-Za-z0-9_\.\-]+$", file) || return HTTP.Response(400, "bad request")
    return file_response(joinpath(WEB_DIST, "assets", file))
end

host = get(ENV, "JGDO_HOST", "127.0.0.1")
port = parse(Int, get(ENV, "JGDO_PORT", "8123"))

@info "JGDO server starting" host port web_dist_present = isdir(WEB_DIST)
serve(; host, port)
