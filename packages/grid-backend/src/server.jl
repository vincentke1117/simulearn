# HTTP 服务与知帆拓展入口（zhifan-ext/1）。
# 开发态的 scripts/serve.jl 和打包后的 bin/simulearn-grid.exe 共用这一份路由：
# 两套实现迟早会漂移，而拓展约定的每一条（令牌、相对路径、只写数据目录）都要两边一致。

using Oxygen
using HTTP
using Sockets

const CONTRACT = "zhifan-ext/1"
# 拓展版本：ready 行与发布清单都用它，发版时改这里
const EXT_VERSION = "0.5.3"
const TOKEN_HEADER = "X-Zhifan-Ext-Token"
# 只给手工起服务的本机开发用；宿主与 start-all 每次启动都会传入随机令牌（设计记录 D17）
const DEV_TOKEN = "simulearn-dev"

"""
    ServerConfig

服务运行所需的令牌与目录。`runs_dir` 是运行记录目录、`store_dir` 是页面键值存储目录（store.jl）：
拓展模式下两者都必须落在 `--data-dir` 里（约定 §3）。
"""
Base.@kwdef struct ServerConfig
    token::String
    runs_dir::String
    store_dir::String
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

# 标准输入关闭后的收尾（wait_until_quiet）：最近一次有请求进来或处理完的时刻、正在处理的请求数
const LAST_REQUEST_NS = Threads.Atomic{UInt64}(0)
const ACTIVE_REQUESTS = Threads.Atomic{Int}(0)
# 停服务前要求连续这么久没有新请求，且最多只等这么久（约定 §2 的退出预算是 5 s）
const SHUTDOWN_QUIET_S = 0.3
const SHUTDOWN_MAX_WAIT_S = 1.0

"""
记下每个请求进来和处理完的时刻。放在令牌校验的外层：处理完也记一次，
否则一个刚好在安静期末尾进来、要算几十毫秒的写请求会被停服务截断。
"""
function activity_middleware(handler)
    return function (req::HTTP.Request)
        LAST_REQUEST_NS[] = time_ns()
        Threads.atomic_add!(ACTIVE_REQUESTS, 1)
        try
            return handler(req)
        finally
            Threads.atomic_sub!(ACTIVE_REQUESTS, 1)
            LAST_REQUEST_NS[] = time_ns()
        end
    end
end

"""
    wait_until_quiet(; quiet_s, max_wait_s) -> Bool

等到没有请求在处理、且最近 `quiet_s` 秒内没有新请求，最多等 `max_wait_s` 秒；返回是否等到了安静。
安静期至少从调用时刻起算：调用前很久就没有请求了，也要再给 `quiet_s` 秒让晚到的请求进来。
"""
function wait_until_quiet(; quiet_s::Real=SHUTDOWN_QUIET_S, max_wait_s::Real=SHUTDOWN_MAX_WAIT_S)::Bool
    start = time_ns()
    deadline = start + round(UInt64, max_wait_s * 1e9)
    quiet_ns = round(UInt64, quiet_s * 1e9)
    while true
        last = max(LAST_REQUEST_NS[], start)
        now = time_ns()
        ACTIVE_REQUESTS[] == 0 && now >= last + quiet_ns && return true
        now >= deadline && return false
        sleep(0.01)
    end
end

"""
    wait_for_host_exit(input; quiet_s, max_wait_s)

约定 §2：宿主关闭标准输入就该退出。读到 EOF 后不立刻返回：宿主关窗口、切走场景时，页面正在 pagehide 里
用 keepalive 请求把最后一批草稿送过来，这批请求可能比 EOF 晚到几十毫秒。等到安静（wait_until_quiet）再返回，
最多多等 1 s，仍远在 5 s 的退出预算内。
"""
function wait_for_host_exit(input::IO; quiet_s::Real=SHUTDOWN_QUIET_S, max_wait_s::Real=SHUTDOWN_MAX_WAIT_S)
    try
        while !eof(input)
            readavailable(input)
        end
    catch
    end
    wait_until_quiet(; quiet_s, max_wait_s)
    return nothing
end

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
    # 页面的键值存储（草稿等，见 store.jl）：和健康检查一样，根路径与 /api/grid 前缀下都挂
    for base in ("", "/api/grid")
        Oxygen.route(["GET"], "$base/store", (req::HTTP.Request) -> envelope_response(store_get_response(cfg.store_dir, req)))
        Oxygen.route(["POST"], "$base/store", (req::HTTP.Request) -> envelope_response(store_post_response(cfg.store_dir, req)))
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
拓展模式与开发态都从这里起服务，所以存储目录里上次残留的临时文件在这里清。
"""
function start_server(cfg::ServerConfig)
    store_clean_tmp!(cfg.store_dir)
    listener = Sockets.listen(parse(Sockets.IPAddr, cfg.host), cfg.port)
    port = Int(Sockets.getsockname(listener)[2])
    register_routes!(cfg)
    server = Oxygen.serve(;
        host=cfg.host,
        port=port,
        server=listener,
        async=true,
        # Oxygen 按列表顺序从外到内套：activity 在最外层，被拒的请求也算动静
        middleware=[activity_middleware, token_middleware(cfg.token)],
        docs=false,
        metrics=false,
        show_banner=false,
    )
    return port, server
end

stop_server() = Oxygen.terminate()

"""
    stop_server_now(server)

拓展退出时停服务。调用前已经等过安静（wait_for_host_exit），没有请求在处理，剩下的只是浏览器留着复用的
空闲连接；HTTP.jl 的 close(server) 是优雅关闭，每 0.5 s 轮询一次连接走没走光，单这一步就要 0.5～1 s，
加上安静期和进程收尾会贴近 2 s。这里直接关掉连接（forceclose）。真到了 1 s 上限还有请求没处理完，
被截断的写入也只会留下临时文件，下次启动时清掉（store_clean_tmp!）。
"""
function stop_server_now(server::HTTP.Server)
    try
        HTTP.forceclose(server)
    catch err
        @warn "直接关闭服务失败，改用常规关闭" exception = err
    end
    # forceclose 之后 Oxygen 看到服务已关，这一步只是兜底
    stop_server()
    return nothing
end

# 打包后程序的根目录：create_app 产物里 Sys.BINDIR 是 <根>/bin
app_root() = normpath(joinpath(Sys.BINDIR, ".."))

"""
    julia_main() -> Cint

拓展入口（`bin/simulearn-grid.exe`）。按约定 §2：解析参数 → 起服务 → 打 ready 行 →
等宿主关闭标准输入、晚到的请求处理完（wait_for_host_exit）后退出。失败时打 `{"ready": false, ...}` 并以非零码退出。
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
            store_dir=joinpath(args.data_dir, "store"),
            ui_dir=get(ENV, "SIMULEARN_UI_DIR", joinpath(root, "ui")),
            examples_dir=get(ENV, "SIMULEARN_EXAMPLES_DIR", joinpath(root, "examples")),
        )
        port, server = start_server(cfg)
        println(stdout, ready_line(port))
        flush(stdout)
        wait_for_host_exit(stdin)
        stop_server_now(server)
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
        store_dir=dev_store_dir(),
        ui_dir=normpath(joinpath(pkg_root, "..", "grid-web", "dist")),
        examples_dir=joinpath(pkg_root, "examples"),
    )
    actual, server = start_server(cfg)
    @info "JGDO server started" host actual ui_present = isdir(cfg.ui_dir) store_dir = cfg.store_dir
    wait(server)
end
