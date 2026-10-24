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
        cfg = JGDO.ServerConfig(; token=token, runs_dir=runs, ui_dir=ui, examples_dir=examples)
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
