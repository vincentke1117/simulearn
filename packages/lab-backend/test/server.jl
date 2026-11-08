# 拓展入口与 HTTP 路由（src/Server.jl，知帆拓展约定 zhifan-ext/1）
using JSON3

@testset "拓展启动参数（约定 §2）" begin
    parse = JCircuitServer.parse_ext_args
    args = parse(["--port", "0", "--token", "ab", "--data-dir", "d", "--host-version", "0.11.3"])
    @test args.port == 0
    @test args.token == "ab"
    @test args.data_dir == "d"
    @test args.host_version == "0.11.3"
    @test_throws ArgumentError parse(["--port", "0", "--data-dir", "d"])              # 缺令牌
    @test_throws ArgumentError parse(["--token", "ab"])                               # 缺数据目录
    @test_throws ArgumentError parse(["--token", "ab", "--data-dir", "d", "--mode"])  # 缺取值
    @test_throws ArgumentError parse(["--token", "ab", "--data-dir", "d", "--bogus", "1"])
    @test_throws ArgumentError parse(["--port", "70000", "--token", "ab", "--data-dir", "d"])
end

@testset "ready 行以 {\"ready\" 开头（约定 §2）" begin
    line = JCircuitServer.ready_line(51234)
    @test startswith(line, "{\"ready\":true")
    obj = JSON3.read(line)
    @test obj["port"] == 51234
    @test obj["contract"] == "zhifan-ext/1"
    @test obj["version"] == JCircuitServer.EXT_VERSION
    bad = JCircuitServer.failure_line("内核加载失败")
    @test startswith(bad, "{\"ready\":false")
    @test JSON3.read(bad)["error"] == "内核加载失败"
end

@testset "标准输入关闭后等请求安静下来再停（wait_quiet）" begin
    wait_quiet = JCircuitServer.wait_quiet
    # 安静窗口 300 ms、最多等 1 s：加上 close 收尾，远在约定的 5 s 退出预算内
    @test JCircuitServer.EOF_QUIET_S == 0.3
    @test JCircuitServer.EOF_MAX_WAIT_S == 1.0
    last_request = Threads.Atomic{UInt64}(0)
    # 很久没有请求：也从读到 EOF 起再等满一个窗口
    t0 = time()
    @test wait_quiet(last_request; quiet = 0.3, max_wait = 1.0)
    @test 0.29 <= time() - t0 < 0.9
    # 请求一直不断：等到上限就停
    busy = Ref(true)
    feeder = @async while busy[]
        last_request[] = time_ns()
        sleep(0.05)
    end
    t0 = time()
    @test !wait_quiet(last_request; quiet = 0.3, max_wait = 1.0)
    @test 0.95 <= time() - t0 < 1.6
    busy[] = false
    wait(feeder)
end

@testset "静态文件路径解析" begin
    mktempdir() do tmp
        ui = joinpath(tmp, "ui")
        mkpath(joinpath(ui, "assets"))
        write(joinpath(ui, "index.html"), "<p>ui</p>")
        write(joinpath(ui, "assets", "app.js"), "1")
        write(joinpath(tmp, "secret.txt"), "x")
        resolve = JCircuitServer.resolve_static
        @test resolve(ui, "") == normpath(joinpath(ui, "index.html"))
        @test resolve(ui, "assets/app.js") == normpath(joinpath(ui, "assets", "app.js"))
        for bad in ["../secret.txt", "assets/../../secret.txt", "./index.html", "assets//app.js",
                    "a\\b", "%2e%2e/secret.txt", "missing.js", "assets", "/index.html"]
            @test resolve(ui, bad) === nothing
        end
    end
end

@testset "开发态路由：接口在根路径和 /api/lab 下都能到，不挂页面" begin
    HTTP = JCircuitServer.HTTP
    handler = bootstrap(start = false, warmup = false, token = "t0k").handler
    auth = ["X-Zhifan-Ext-Token" => "t0k"]
    for path in ("/health", "/api/lab/health", "/version", "/api/lab/version", "/api/lab/metrics")
        @test handler(HTTP.Request("GET", path, auth)).status == 200
    end
    version = JSON3.read(String(handler(HTTP.Request("GET", "/api/lab/version", auth)).body))
    @test version["version"] == JCircuitServer.EXT_VERSION
    # 没给 ui_dir 就不挂页面；run_server.jl 在 lab-web 构建过时传 dist，开发态也能 --attach 走嵌入链路
    @test handler(HTTP.Request("GET", "/ui/", auth)).status == 404
    mktempdir() do ui
        write(joinpath(ui, "index.html"), "<p>dev</p>")
        with_ui = bootstrap(start = false, warmup = false, token = "t0k", ui_dir = ui).handler
        @test with_ui(HTTP.Request("GET", "/ui/", auth)).status == 200
        @test with_ui(HTTP.Request("GET", "/ui/", ["X-Zhifan-Ext-Token" => "nope"])).status == 401
    end
end

@testset "采样点数有上限（三条路径一致，超出给 422 而不是拖死内核）" begin
    HTTP = JCircuitServer.HTTP
    handler = bootstrap(start = false, warmup = false, token = "t0k").handler
    over = JCircuitServer.MAX_SAMPLES + 1
    rc = Dict(
        "components" => [
            Dict("id" => "V1", "type" => "vsource_dc", "parameters" => Dict("dc" => 1.0), "connections" => Dict("pos" => "n1", "neg" => "gnd")),
            Dict("id" => "C1", "type" => "capacitor", "parameters" => Dict("value" => 1e-6), "connections" => Dict("p" => "n1", "n" => "gnd")),
            Dict("id" => "G1", "type" => "ground", "parameters" => Dict(), "connections" => Dict("gnd" => "gnd")),
        ],
        "nets" => [Dict("name" => "n1", "nodes" => [["V1", "pos"], ["C1", "p"]]), Dict("name" => "gnd", "nodes" => [["V1", "neg"], ["C1", "n"], ["G1", "gnd"]])],
        "sim" => Dict("t_stop" => 0.001, "n_samples" => over),
        "method" => "transient",
    )
    control = Dict(
        "kind" => "control",
        "blocks" => [Dict("id" => "S", "type" => "control_step", "parameters" => Dict("amplitude" => 1.0, "offset" => 0.0, "startTime" => 0.0)),
                     Dict("id" => "SC", "type" => "control_scope", "parameters" => Dict())],
        "edges" => [Dict("id" => "e", "source" => "S", "target" => "SC", "sourceHandle" => "out", "targetHandle" => "in")],
        "outputs" => [Dict("id" => "scope:SC", "blockId" => "SC", "handle" => "in", "label" => "SC")],
        "sim" => Dict("t_stop" => 1.0, "n_samples" => over),
    )
    for body in (rc, control)
        response = handler(HTTP.Request("POST", "/api/lab/simulate", ["X-Zhifan-Ext-Token" => "t0k"], JSON3.write(body)))
        @test response.status == 422
        envelope = JSON3.read(String(response.body))
        @test envelope["code"] == "LAB_VALIDATION"
        @test occursin("采样点数", envelope["message"])
    end
end

@testset "拓展服务端到端（回环）" begin
    HTTP = JCircuitServer.HTTP
    mktempdir() do tmp
        ui = joinpath(tmp, "ui")
        mkpath(joinpath(ui, "assets"))
        write(joinpath(ui, "index.html"), "<!doctype html><p>circuit</p>")
        write(joinpath(ui, "assets", "app.js"), "console.log(1)")
        write(joinpath(tmp, "secret.txt"), "top secret")
        token = repeat("ab", 32)
        port, server = JCircuitServer.start_ext_server(; token, ui_dir = ui, data_dir = joinpath(tmp, "data"))
        try
            base = "http://127.0.0.1:$port"
            auth = ["X-Zhifan-Ext-Token" => token]
            hget(path; headers = auth) = HTTP.get(base * path; headers, status_exception = false, redirect = false)
            hpost(path, body) = HTTP.post(base * path; headers = [auth; "Content-Type" => "application/json"],
                                          body, status_exception = false)

            # 令牌：所有路径（含健康检查与页面）都要带
            @test hget("/api/lab/health"; headers = Pair{String, String}[]).status == 401
            @test hget("/ui/"; headers = Pair{String, String}[]).status == 401
            @test hget("/api/lab/health").status == 200
            @test isempty(HTTP.header(hget("/api/lab/health"), "Access-Control-Allow-Origin"))

            # 页面挂在 /ui/，重定向用相对地址（宿主前缀下同样成立）
            page = hget("/ui/")
            @test page.status == 200
            @test occursin("circuit", String(page.body))
            @test occursin("text/html", HTTP.header(page, "Content-Type"))
            @test hget("/ui/assets/app.js").status == 200
            for path in ("/ui", "/")
                redirect = hget(path)
                @test redirect.status == 301
                @test HTTP.header(redirect, "Location") == "ui/"
            end
            @test hget("/ui/../secret.txt").status == 404
            @test hget("/ui/%2e%2e/secret.txt").status == 404

            # 计算：页面经相对路径 ../api/lab/simulate 调到这里
            body = JSON3.write(Dict(
                "components" => [
                    Dict("id" => "V1", "type" => "vsource_dc", "parameters" => Dict("dc" => 5.0), "connections" => Dict("pos" => "n1", "neg" => "n3")),
                    Dict("id" => "R1", "type" => "resistor", "parameters" => Dict("value" => 1000.0), "connections" => Dict("p" => "n1", "n" => "n2")),
                    Dict("id" => "R2", "type" => "resistor", "parameters" => Dict("value" => 1000.0), "connections" => Dict("p" => "n2", "n" => "n3")),
                ],
                "nets" => [
                    Dict("name" => "n1", "nodes" => [["V1", "pos"], ["R1", "p"]]),
                    Dict("name" => "n2", "nodes" => [["R1", "n"], ["R2", "p"]]),
                    Dict("name" => "n3", "nodes" => [["R2", "n"], ["V1", "neg"]]),
                ],
                "sim" => Dict("t_stop" => 0.001, "n_samples" => 10),
                "method" => "node_voltage",
            ))
            result = hpost("/api/lab/simulate", body)
            @test result.status == 200
            data = JSON3.read(String(result.body))["data"]
            @test isapprox(data["node_voltages"]["n2"], 2.5; atol = 1e-9)
            # 读不出来的请求体：422 + LAB_VALIDATION 封套（与码表一致，grid 同类输入也是 422）
            garbage = hpost("/api/lab/simulate", "not json")
            @test garbage.status == 422
            @test JSON3.read(String(garbage.body))["code"] == "LAB_VALIDATION"
            # 开发态网关剥掉 /api/lab 前缀后打到根路径，同一条链路
            @test JSON3.read(String(hpost("/simulate", body).body))["status"] == "ok"
        finally
            close(server)
        end
    end
end
