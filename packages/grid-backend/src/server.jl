# HTTP 服务与知帆拓展入口（zhifan-ext/1）。
# 开发态的 scripts/serve.jl 和打包后的 bin/simulearn-grid.exe 共用这一份路由：
# 两套实现迟早会漂移，而拓展约定的每一条（令牌、相对路径、只写数据目录）都要两边一致。

using Oxygen
using HTTP
using Sockets

const CONTRACT = "zhifan-ext/1"
# 拓展版本：ready 行与发布清单都用它，发版时改这里
const EXT_VERSION = "0.5.0"
const TOKEN_HEADER = "X-Zhifan-Ext-Token"
# 只给手工起服务的本机开发用；宿主与 start-all 每次启动都会传入随机令牌（设计记录 D17）
const DEV_TOKEN = "simulearn-dev"

"""
    ServerConfig

服务运行所需的令牌与目录。`runs_dir` 是运行记录目录：拓展模式下必须落在 `--data-dir` 里（约定 §3）。
"""
Base.@kwdef struct ServerConfig
    token::String
    runs_dir::String
    ui_dir::String
    examples_dir::String
    host::String = "127.0.0.1"
    port::Int = 0
end

"""宿主按约定 §2 传入的启动参数。"""
struct ExtArgs
    port::Int
    token::String
    data_dir::String
    host_version::String
end

function parse_ext_args(argv::AbstractVector{<:AbstractString})::ExtArgs
    port = 0
    token = ""
    data_dir = ""
    host_version = ""
    i = 1
    while i <= length(argv)
        key = argv[i]
        i < length(argv) || throw(ArgumentError("参数缺少取值：$key"))
        value = argv[i+1]
        if key == "--port"
            parsed = tryparse(Int, value)
            (parsed === nothing || !(0 <= parsed <= 65535)) && throw(ArgumentError("端口无效：$value"))
            port = parsed
        elseif key == "--token"
            token = value
        elseif key == "--data-dir"
            data_dir = value
        elseif key == "--host-version"
            host_version = value
        else
            throw(ArgumentError("未知参数：$key"))
        end
        i += 2
    end
    isempty(token) && throw(ArgumentError("缺少 --token"))
    isempty(data_dir) && throw(ArgumentError("缺少 --data-dir"))
    return ExtArgs(port, token, data_dir, host_version)
end

# 约定 §2：宿主只认以 {"ready" 开头的行。必须用 NamedTuple：Dict 的键序不定，会让这一行以别的键开头。
ready_line(port::Integer; version::AbstractString=EXT_VERSION) =
    JSON3.write((ready=true, port=Int(port), version=String(version), contract=CONTRACT))
failure_line(message::AbstractString) = JSON3.write((ready=false, error=String(message)))

json_response(body; status=200) = HTTP.Response(status, ["Content-Type" => "application/json; charset=utf-8"], body)

# 封套错误码 → HTTP 状态码（与 lab 内核一致：422 用户输入 / 500 服务端），映射本体见 errors.jl
envelope_response(body::AbstractString) = json_response(body; status=http_status(body))

const UNAUTHORIZED_BODY = """{"status":"error","code":"GRID_UNAUTHORIZED","message":"unauthorized","data":null}"""

"""所有请求（含 /health）都要带正确令牌，否则 401（约定 §3，设计记录 D17）。"""
function token_middleware(token::AbstractString)
    expected = String(token)
    return function (handler)
        return function (req::HTTP.Request)
            HTTP.header(req, TOKEN_HEADER, "") == expected || return json_response(UNAUTHORIZED_BODY; status=401)
            return handler(req)
        end
    end
end

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

"""
    resolve_static(root, rel) -> Union{String,Nothing}

把 `/ui/` 之后的相对路径解析成 `root` 里的文件。非法字符、`.` / `..` 段、越出根目录、
不存在的文件一律返回 `nothing`。空路径指向 index.html。
"""
function resolve_static(root::AbstractString, rel::AbstractString)::Union{String,Nothing}
    rel = isempty(rel) ? "index.html" : String(rel)
    occursin(r"^[A-Za-z0-9_\-./]+$", rel) || return nothing
    segments = split(rel, '/')
    any(s -> s == "." || s == ".." || isempty(s), segments) && return nothing
    base = normpath(root)
    path = normpath(joinpath(base, segments...))
    (startswith(path, base) && path != base) || return nothing
    isfile(path) || return nothing
    return path
end

function file_response(path::AbstractString)
    mime = get(MIME_TYPES, lowercase(splitext(path)[2]), "application/octet-stream")
    return HTTP.Response(200, ["Content-Type" => mime], read(path))
end

function static_response(ui_dir::AbstractString, req::HTTP.Request)
    path = HTTP.URI(req.target).path
    # 「/ui/**」在路由里也会匹配不带斜杠的 /ui；此时页面里的相对路径会解析错位，必须先重定向到 ui/
    path == "/ui" && return HTTP.Response(301, ["Location" => "ui/"])
    rel = startswith(path, "/ui/") ? path[length("/ui/")+1:end] : ""
    file = resolve_static(ui_dir, rel)
    file === nothing && return HTTP.Response(404, "not found")
    return file_response(file)
end

function list_examples(dir::AbstractString)::String
    entries = Vector{Dict{String,Any}}()
    isdir(dir) || return JSON3.write(entries)
    for file in sort(readdir(dir))
        endswith(file, ".json") || continue
        meta = try
            obj = JSON3.read(read(joinpath(dir, file), String))
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
    return JSON3.write(entries)
end

function example_response(dir::AbstractString, name::AbstractString)
    occursin(r"^[A-Za-z0-9_\-]+$", name) ||
        return json_response("""{"status":"error","message":"invalid example name"}"""; status=400)
    path = joinpath(dir, name * ".json")
    isfile(path) || return json_response("""{"status":"error","message":"example not found"}"""; status=404)
    return json_response(read(path, String))
end

function snapshot_if_ok(response::AbstractString, runs_dir::AbstractString)
    try
        obj = JSON3.read(response)
        if get(obj, "status", "error") == "ok" && get(obj, "data", nothing) !== nothing
            data = JSON3.read(JSON3.write(obj["data"]), Dict{String,Any})
            write_run_snapshot(data; runs_dir=runs_dir)
        end
    catch err
        @warn "snapshot persistence failed" error = err
    end
    return nothing
end

const ANALYSES = (
    ("pf", run_pf),
    ("reconfig", run_reconfiguration_dg),
    ("n1", run_n1),
    ("timeseries", run_timeseries),
    ("transient", run_transient),
    ("shortcircuit", run_shortcircuit),
    ("opf", run_opf),
)

function register_routes!(cfg::ServerConfig)
    Oxygen.resetstate()
    Oxygen.route(["GET"], "/health", _ -> "ok")
    # 开发态网关透传 /api/grid/* 不做前缀改写，健康检查在两个路径都可达
    Oxygen.route(["GET"], "/api/grid/health", _ -> "ok")
    for (name, run) in ANALYSES
        Oxygen.route(["POST"], "/api/grid/$name", function (req::HTTP.Request)
            response = run(String(req.body))
            snapshot_if_ok(response, cfg.runs_dir)
            return envelope_response(response)
        end)
    end
    Oxygen.route(["GET"], "/api/grid/examples", _ -> json_response(list_examples(cfg.examples_dir)))
    Oxygen.route(["GET"], "/api/grid/examples/{name}", (req::HTTP.Request, name::String) -> example_response(cfg.examples_dir, name))
    # 页面挂在 /ui/（约定 §3：宿主里实际位于 /ext/<id>/ui/，所以页面只用相对路径）。
    # 重定向也用相对地址：/ui → ui/，在宿主前缀下同样落到 /ext/<id>/ui/。
    Oxygen.route(["GET"], "/", _ -> HTTP.Response(301, ["Location" => "ui/"]))
    # HTTP.Router 把 /ui 与 /ui/ 视为同一条路由，不带斜杠的重定向在 static_response 里处理
    Oxygen.route(["GET"], "/ui/", req -> static_response(cfg.ui_dir, req))
    Oxygen.route(["GET"], "/ui/**", req -> static_response(cfg.ui_dir, req))
    return nothing
end

"""
    start_server(cfg) -> (port, server)

在 `cfg.host` 上监听（`cfg.port == 0` 时由系统分配空闲端口），不阻塞。
"""
function start_server(cfg::ServerConfig)
    listener = Sockets.listen(parse(Sockets.IPAddr, cfg.host), cfg.port)
    port = Int(Sockets.getsockname(listener)[2])
    register_routes!(cfg)
    server = Oxygen.serve(;
        host=cfg.host,
        port=port,
        server=listener,
        async=true,
        middleware=[token_middleware(cfg.token)],
        docs=false,
        metrics=false,
        show_banner=false,
    )
    return port, server
end

stop_server() = Oxygen.terminate()

# 打包后程序的根目录：create_app 产物里 Sys.BINDIR 是 <根>/bin
app_root() = normpath(joinpath(Sys.BINDIR, ".."))

"""
    julia_main() -> Cint

拓展入口（`bin/simulearn-grid.exe`）。按约定 §2：解析参数 → 起服务 → 打 ready 行 →
等宿主关闭标准输入后退出。失败时打 `{"ready": false, ...}` 并以非零码退出。
"""
function julia_main()::Cint
    args = try
        parse_ext_args(ARGS)
    catch err
        println(stdout, failure_line(err isa ArgumentError ? err.msg : sprint(showerror, err)))
        flush(stdout)
        return 2
    end
    try
        mkpath(args.data_dir)
        root = app_root()
        cfg = ServerConfig(;
            token=args.token,
            port=args.port,
            runs_dir=joinpath(args.data_dir, "runs"),
            ui_dir=get(ENV, "SIMULEARN_UI_DIR", joinpath(root, "ui")),
            examples_dir=get(ENV, "SIMULEARN_EXAMPLES_DIR", joinpath(root, "examples")),
        )
        port, _ = start_server(cfg)
        println(stdout, ready_line(port))
        flush(stdout)
        try
            while !eof(stdin)
                readavailable(stdin)
            end
        catch
        end
        stop_server()
        return 0
    catch err
        println(stdout, failure_line(sprint(showerror, err)))
        flush(stdout)
        return 1
    end
end

function dev_token()::String
    token = strip(get(ENV, "SIMULEARN_TOKEN", ""))
    if isempty(token)
        @warn "未设置 SIMULEARN_TOKEN，使用固定的开发令牌（仅限本机开发）" header = TOKEN_HEADER
        return DEV_TOKEN
    end
    return String(token)
end

"""开发态服务（scripts/serve.jl / start-all.ps1 用），阻塞直到服务停止。"""
function serve_dev(;
    host::AbstractString=get(ENV, "JGDO_HOST", "127.0.0.1"),
    port::Integer=parse(Int, get(ENV, "JGDO_PORT", "8123")),
)
    pkg_root = normpath(joinpath(@__DIR__, ".."))
    cfg = ServerConfig(;
        token=dev_token(),
        host=String(host),
        port=Int(port),
        runs_dir=DEFAULT_RUNS_DIR,
        ui_dir=normpath(joinpath(pkg_root, "..", "grid-web", "dist")),
        examples_dir=joinpath(pkg_root, "examples"),
    )
    actual, server = start_server(cfg)
    @info "JGDO server started" host actual ui_present = isdir(cfg.ui_dir)
    wait(server)
end
