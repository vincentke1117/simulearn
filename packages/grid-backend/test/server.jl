# 拓展入口与 HTTP 服务（src/server.jl，知帆拓展约定 zhifan-ext/1）
using HTTP

@testset "Extension args (zhifan-ext/1 §2)" begin
    args = JGDO.parse_ext_args(["--port", "0", "--token", "ab", "--data-dir", "d", "--host-version", "0.11.0"])
    @test args.port == 0
    @test args.token == "ab"
    @test args.data_dir == "d"
    @test args.host_version == "0.11.0"
    @test_throws ArgumentError JGDO.parse_ext_args(["--port", "0", "--data-dir", "d"])              # 缺令牌
    @test_throws ArgumentError JGDO.parse_ext_args(["--token", "ab"])                               # 缺数据目录
    @test_throws ArgumentError JGDO.parse_ext_args(["--token", "ab", "--data-dir", "d", "--mode"])  # 缺取值
    @test_throws ArgumentError JGDO.parse_ext_args(["--token", "ab", "--data-dir", "d", "--bogus", "1"])
    @test_throws ArgumentError JGDO.parse_ext_args(["--port", "70000", "--token", "ab", "--data-dir", "d"])
end

@testset "Ready line starts with {\"ready\" (zhifan-ext/1 §2)" begin
    line = JGDO.ready_line(51234)
    @test startswith(line, "{\"ready\":true")
    obj = JSON3.read(line)
    @test obj["port"] == 51234
    @test obj["contract"] == "zhifan-ext/1"
    @test obj["version"] == JGDO.EXT_VERSION
    bad = JGDO.failure_line("内核加载失败")
    @test startswith(bad, "{\"ready\":false")
    @test JSON3.read(bad)["error"] == "内核加载失败"
end

@testset "Static path resolution" begin
    mktempdir() do tmp
        ui = joinpath(tmp, "ui")
        mkpath(joinpath(ui, "assets"))
        write(joinpath(ui, "index.html"), "<p>ui</p>")
        write(joinpath(ui, "assets", "app.js"), "1")
        write(joinpath(tmp, "secret.txt"), "x")
        @test JGDO.resolve_static(ui, "") == normpath(joinpath(ui, "index.html"))
        @test JGDO.resolve_static(ui, "assets/app.js") == normpath(joinpath(ui, "assets", "app.js"))
        for bad in ["../secret.txt", "assets/../../secret.txt", "./index.html", "assets//app.js",
                    "a\\b", "%2e%2e/secret.txt", "missing.js", "assets", "/index.html"]
            @test JGDO.resolve_static(ui, bad) === nothing
        end
    end
end

@testset "Token middleware (D17)" begin
    guarded = JGDO.token_middleware("t0k")(req -> HTTP.Response(200, "ok"))
    @test guarded(HTTP.Request("GET", "/health")).status == 401
    @test guarded(HTTP.Request("GET", "/health", [JGDO.TOKEN_HEADER => "nope"])).status == 401
    @test guarded(HTTP.Request("GET", "/health", [JGDO.TOKEN_HEADER => "t0k"])).status == 200
end

@testset "Extension server end-to-end (loopback)" begin
    mktempdir() do tmp
        ui = joinpath(tmp, "ui")
        mkpath(joinpath(ui, "assets"))
        write(joinpath(ui, "index.html"), "<!doctype html><p>grid</p>")
        write(joinpath(ui, "assets", "app.js"), "console.log(1)")
        write(joinpath(tmp, "secret.txt"), "top secret")
        examples = joinpath(tmp, "examples")
        mkpath(examples)
        cp(joinpath(@__DIR__, "..", "examples", "ieee33.json"), joinpath(examples, "ieee33.json"))
        runs = joinpath(tmp, "data", "runs")
        token = repeat("ab", 32)
        cfg = JGDO.ServerConfig(; token=token, runs_dir=runs, store_dir=joinpath(tmp, "data", "store"),
                                ui_dir=ui, examples_dir=examples)
        port, _ = JGDO.start_server(cfg)
        try
            base = "http://127.0.0.1:$port"
            auth = [JGDO.TOKEN_HEADER => token]
            hget(path; headers=auth) = HTTP.get(base * path; headers=headers, status_exception=false, redirect=false)
            hpost(path, body) = HTTP.post(base * path; headers=[auth; "Content-Type" => "application/json"],
                                          body=body, status_exception=false)

            # 令牌：所有路径（含健康检查与页面）都要带
            @test hget("/health"; headers=Pair{String,String}[]).status == 401
            @test hget("/ui/"; headers=Pair{String,String}[]).status == 401
            @test hget("/health").status == 200
            @test isempty(HTTP.header(hget("/health"), "Access-Control-Allow-Origin"))

            # 页面挂在 /ui/，重定向用相对地址（宿主前缀下同样成立）
            page = hget("/ui/")
            @test page.status == 200
            @test occursin("grid", String(page.body))
            @test occursin("text/html", HTTP.header(page, "Content-Type"))
            @test hget("/ui/assets/app.js").status == 200
            redirect = hget("/ui")
            @test redirect.status == 301
            @test HTTP.header(redirect, "Location") == "ui/"
            @test hget("/ui/../secret.txt").status == 404
            @test hget("/ui/%2e%2e/secret.txt").status == 404

            # 内置算例
            list = JSON3.read(String(hget("/api/grid/examples").body))
            @test any(e -> e["name"] == "ieee33", list)
            @test hget("/api/grid/examples/ieee33").status == 200
            @test hget("/api/grid/examples/nope").status == 404

            # 计算，运行记录只写进数据目录（约定 §3）
            pf = hpost("/api/grid/pf", read(joinpath(examples, "ieee33.json")))
            @test pf.status == 200
            @test JSON3.read(String(pf.body))["status"] == "ok"
            @test isdir(runs) && !isempty(readdir(runs))
            @test 400 <= hpost("/api/grid/pf", "{}").status < 500
            # 读不出 JSON 对象的请求体：422 + GRID_VALIDATION 封套，而不是 500
            garbage = hpost("/api/grid/pf", "not json")
            @test garbage.status == 422
            @test JSON3.read(String(garbage.body))["code"] == "GRID_VALIDATION"
        finally
            JGDO.stop_server()
        end
    end
end

@testset "Quiet period before shutdown" begin
    # 没有动静：至少等满安静期（从调用时刻起算），不等到上限
    t = @elapsed @test JGDO.wait_until_quiet(; quiet_s=0.2, max_wait_s=2.0)
    @test 0.2 <= t < 1.5
    # 有请求在处理：等到上限就放弃，不无限等
    Threads.atomic_add!(JGDO.ACTIVE_REQUESTS, 1)
    try
        t = @elapsed @test !JGDO.wait_until_quiet(; quiet_s=0.05, max_wait_s=0.4)
        @test 0.4 <= t < 1.5
    finally
        Threads.atomic_sub!(JGDO.ACTIVE_REQUESTS, 1)
    end
end

# 宿主关窗口时：先关标准输入，页面同时在 pagehide 里用 keepalive 把最后一批草稿发过来，可能比 EOF 晚到
const LATE_KEY = "slp:grid:exp:ch12-tap-1:embed-draft-v2"
late_body(value) = JSON3.write(Dict("entries" => Dict(LATE_KEY => value)))

@testset "Stdin EOF waits for late writes (in-process)" begin
    mktempdir() do tmp
        store = joinpath(tmp, "data", "store")
        token = repeat("ef", 32)
        cfg = JGDO.ServerConfig(; token=token, runs_dir=joinpath(tmp, "data", "runs"), store_dir=store,
                                ui_dir=joinpath(tmp, "ui"), examples_dir=joinpath(tmp, "examples"))
        port, server = JGDO.start_server(cfg)
        input = Base.BufferStream()
        stopped = @async begin                 # 和 julia_main 的收尾一样
            JGDO.wait_for_host_exit(input)
            JGDO.stop_server_now(server)
            time()
        end
        try
            post(value) = HTTP.post("http://127.0.0.1:$port/api/grid/store";
                                    headers=[JGDO.TOKEN_HEADER => token, "Content-Type" => "application/json"],
                                    body=late_body(value), status_exception=false)
            @test post("early").status == 200
            sleep(0.5)                       # 上一次请求早就过了安静期
            closed_at = time()
            close(input)                     # 宿主关掉标准输入
            sleep(0.15)
            late = post("late")              # EOF 之后 200 ms 内到的写请求
            @test late.status == 200
            @test JGDO.store_get(store, LATE_KEY) == "late"
            @test timedwait(() -> istaskdone(stopped), 5.0) === :ok
            elapsed = fetch(stopped) - closed_at
            # 等过了安静期，但不拖：客户端留着的空闲连接不能让停服务再多等 0.5 s 一轮的优雅关闭
            @test 0.3 <= elapsed < 1.0
            @test !isopen(server)
        finally
            istaskdone(stopped) || (close(input); wait(stopped))
        end
    end
end

@testset "Extension process exits within 2 s of stdin EOF, after late writes" begin
    mktempdir() do tmp
        data = joinpath(tmp, "data")
        store = joinpath(data, "store")
        mkpath(store)
        stale = joinpath(store, "0123.json.42.tmp")   # 上次被强制结束留下的临时文件
        write(stale, "写到一半")
        token = repeat("9a", 32)
        code = "using JGDO; exit(JGDO.julia_main())"
        # 用当前测试进程的 julia 选项与环境：预编译缓存能复用，只付一次加载 JGDO 的时间
        cmd = `$(Base.julia_cmd()) --startup-file=no --project=$(Base.active_project()) -e $code --
               --port 0 --token $token --data-dir $data --host-version test`
        errlog = joinpath(tmp, "stderr.log")
        proc = open(pipeline(cmd; stderr=errlog), "r+")
        try
            lines = Channel{String}(Inf)
            reader = @async try
                for line in eachline(proc)
                    put!(lines, line)
                end
            finally
                close(lines)
            end
            ready = nothing
            deadline = time() + 600
            while ready === nothing && time() < deadline
                timedwait(() -> isready(lines) || !isopen(lines), max(deadline - time(), 0.1)) === :ok || break
                isready(lines) || break
                line = take!(lines)
                startswith(line, "{\"ready\"") && (ready = JSON3.read(line))
            end
            ready === nothing && @info "拓展进程没有打出 ready 行" stderr = read(errlog, String)
            @test ready !== nothing && ready["ready"] === true
            if ready !== nothing
                @test !isfile(stale)                   # 起服务时清掉了残留的临时文件
                url = "http://127.0.0.1:$(ready["port"])/api/grid/store"
                post(value) = HTTP.post(url; headers=[JGDO.TOKEN_HEADER => token, "Content-Type" => "application/json"],
                                        body=late_body(value), status_exception=false, readtimeout=120)
                # 早晚两次必须走同一个 post：本进程里 HTTP.post 换一组关键字参数就要现场 JIT 一两秒，
                # 晚到的请求会在发出之前就耗过安静期；先发一次也让子进程的这条链路编译好，下面量的只是收尾
                @test post("early").status == 200
                sleep(0.5)
                exited = @async (wait(proc); time())
                closed_at = time()
                close(proc.in)                         # 宿主关掉标准输入
                sleep(0.1)
                late = post("late")                    # EOF 之后 200 ms 内到的写请求
                @test late.status == 200
                @test timedwait(() -> istaskdone(exited), 10.0) === :ok
                @test fetch(exited) - closed_at < 2.0  # 仍在 2 s 内退出（约定的预算是 5 s）
                @test success(proc)
                @test JGDO.store_get(store, LATE_KEY) == "late"   # 已经落盘
            end
        finally
            process_running(proc) && kill(proc)
        end
    end
end
