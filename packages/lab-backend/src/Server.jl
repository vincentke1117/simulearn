# HTTP 路由与知帆拓展入口（zhifan-ext/1）。
# 开发态（run_server.jl → bootstrap）和打包后的 bin/simulearn-lab.exe（julia_main）共用 build_router：
# 两套路由迟早会漂移，而约定的每一条（令牌、相对路径、只写数据目录）都要两边一致。
# 参数解析、ready 行、静态文件与 grid-backend/src/server.jl 同一套规则；两个内核分进程、分环境
# （AGENTS.md 约束 1），没有共享包可放，只能各抄一份，改一边记得对照另一边。

const CONTRACT = "zhifan-ext/1"
# 拓展版本：ready 行与发布清单都用它，发版时改这里
const EXT_VERSION = "0.5.1"
# 页面在宿主里位于 /ext/<id>/ui/，接口用相对路径 ../api/lab/…；开发态网关把 /api/lab 剥掉再转发，
# 所以根路径和带前缀的路径都要能到
const API_PREFIXES = ("", "/api/lab")

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
ready_line(port::Integer; version::AbstractString = EXT_VERSION) =
    JSON3.write((ready = true, port = Int(port), version = String(version), contract = CONTRACT))
failure_line(message::AbstractString) = JSON3.write((ready = false, error = String(message)))

const MIME_TYPES = Dict(
    ".html" => "text/html; charset=utf-8",
    ".js" => "application/javascript; charset=utf-8",
    ".css" => "text/css; charset=utf-8",
    ".map" => "application/json",
    ".svg" => "image/svg+xml",
    ".png" => "image/png",
    ".ico" => "image/x-icon",
    ".json" => "application/json; charset=utf-8",
    ".woff" => "font/woff",
    ".woff2" => "font/woff2",
)

"""
    resolve_static(root, rel) -> Union{String,Nothing}

把 `/ui/` 之后的相对路径解析成 `root` 里的文件。非法字符、`.` / `..` 段、越出根目录、
不存在的文件一律返回 `nothing`。空路径指向 index.html。
"""
function resolve_static(root::AbstractString, rel::AbstractString)::Union{String, Nothing}
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

function static_response(ui_dir::AbstractString, req::HTTP.Request)
    path = HTTP.URI(req.target).path
    # 不带斜杠的 /ui 也会进到这里（见 build_router）：页面里的相对路径会解析错位，必须先重定向到 ui/。
    # 重定向用相对地址：在宿主前缀下同样落到 /ext/<id>/ui/
    path == "/ui" && return HTTP.Response(301, ["Location" => "ui/"])
    rel = startswith(path, "/ui/") ? path[length("/ui/")+1:end] : ""
    file = resolve_static(ui_dir, rel)
    file === nothing && return HTTP.Response(404, "not found")
    mime = get(MIME_TYPES, lowercase(splitext(file)[2]), "application/octet-stream")
    return HTTP.Response(200, ["Content-Type" => mime], read(file))
end

json_ok(body) = HTTP.Response(200, collect(RESPONSE_HEADERS), JSON3.write(body))

function simulate_route(req::HTTP.Request)
    try
        return handle_simulate(req)
    catch err
        # 能落到这里的只有请求体读不出来（不是 JSON、字段类型不对）：run_simulation 自己会把求解失败包成封套。
        # 状态码按码表走（LAB_VALIDATION → 422），与封套映射一致（AGENTS.md 约束 4），grid 同类输入也是 422
        @error "请求处理失败" exception = (err, catch_backtrace())
        envelope = Dict("status" => "error", "code" => "LAB_VALIDATION", "message" => "请求内容读不出来，不是有效的仿真请求", "data" => Dict())
        return HTTP.Response(lab_http_status(envelope), collect(RESPONSE_HEADERS), JSON3.write(envelope))
    end
end

"""
    build_router(; ui_dir = nothing) -> HTTP.Router

接口挂在根路径和 `/api/lab` 下各一份；给了 `ui_dir` 时页面挂在 `/ui/`（拓展模式）。
"""
function build_router(; ui_dir::Union{AbstractString, Nothing} = nothing)
    router = HTTP.Router()
    for prefix in API_PREFIXES
        HTTP.register!(router, "GET", prefix * "/health", _ -> json_ok(Dict("status" => "ok")))
        HTTP.register!(router, "GET", prefix * "/metrics", _ -> json_ok(lock(() -> copy(_METRICS), _STATE_LOCK)))
        HTTP.register!(router, "GET", prefix * "/version", _ -> json_ok(Dict(
            "server" => "JCircuitServer",
            "julia" => string(VERSION),
            "version" => EXT_VERSION,
        )))
        HTTP.register!(router, "POST", prefix * "/simulate", simulate_route)
    end
    if ui_dir !== nothing
        HTTP.register!(router, "GET", "/", _ -> HTTP.Response(301, ["Location" => "ui/"]))
        # HTTP.Router 切路径时丢掉空段：/ui 和 /ui/ 是同一条路由，都由这一条接住（宿主入口 /ui/#/embed 靠它，
        # 不能删）；/ui/** 只管 ui 后面还有段的路径
        HTTP.register!(router, "GET", "/ui", req -> static_response(ui_dir, req))
        HTTP.register!(router, "GET", "/ui/**", req -> static_response(ui_dir, req))
    end
    return router
end

"""
    start_ext_server(; token, ui_dir, port = 0) -> (port, server)

只绑 127.0.0.1（约定 §2），`port == 0` 时由系统分配空闲端口；不阻塞。
"""
function start_ext_server(; token::AbstractString, ui_dir::AbstractString, port::Integer = 0)
    listener = Sockets.listen(Sockets.ip"127.0.0.1", port)
    actual = Int(Sockets.getsockname(listener)[2])
    handler = token_guard(build_router(; ui_dir), token)
    server = HTTP.serve!(handler, "127.0.0.1", actual; server = listener, verbose = false)
    return actual, server
end

# 打包后程序的根目录：create_app 产物里 Sys.BINDIR 是 <根>/bin
app_root() = normpath(joinpath(Sys.BINDIR, ".."))

"""
    julia_main() -> Cint

拓展入口（`bin/simulearn-lab.exe`）。按约定 §2：解析参数 → 预热 → 起服务 → 打 ready 行 →
等宿主关闭标准输入后退出。失败时打 `{"ready": false, ...}` 并以非零码退出。

预热放在 ready 之前：宿主装好后会试启动一次，等到 ready 就关标准输入；要是 ready 之后才预热，
Julia 单线程上预热一直占着，读标准输入的任务轮不到，5 s 内就退不出去。
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
        # 电路内核什么都不存，但约定要求数据目录可用；建好它，宿主卸载时才有东西可问
        mkpath(args.data_dir)
        warmup!()
        port, server = start_ext_server(;
            token = args.token,
            port = args.port,
            ui_dir = get(ENV, "SIMULEARN_UI_DIR", joinpath(app_root(), "ui")),
        )
        println(stdout, ready_line(port))
        flush(stdout)
        try
            while !eof(stdin)
                readavailable(stdin)
            end
        catch
        end
        close(server)
        return 0
    catch err
        println(stdout, failure_line(sprint(showerror, err)))
        flush(stdout)
        return 1
    end
end
