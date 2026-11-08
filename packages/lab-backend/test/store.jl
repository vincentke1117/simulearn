# 页面存储（src/Store.jl）：草稿、上次打开的案例写进宿主给的 --data-dir，客户端重开后还在
using JSON3

const STORE_FILE = r"^[0-9a-f]{40}\.json$"

@testset "页面存储：UTC 时间与开发态目录" begin
    iso = JCircuitServer.iso_utc
    @test iso(0) == "1970-01-01T00:00:00.000Z"
    @test iso(951782400) == "2000-02-29T00:00:00.000Z"          # 闰日
    @test iso(1785974400.123) == "2026-08-06T00:00:00.123Z"
    @test iso(4102444799) == "2099-12-31T23:59:59.000Z"
    @test occursin(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", iso())

    mktempdir() do root
        withenv("SIMULEARN_DATA_DIR" => root) do
            @test JCircuitServer.dev_data_dir() == joinpath(root, "lab")
        end
    end
    withenv("SIMULEARN_DATA_DIR" => nothing) do
        @test JCircuitServer.dev_data_dir() == joinpath(tempdir(), "simulearn-dev-data", "lab")
    end
end

@testset "页面存储：接口" begin
    HTTP = JCircuitServer.HTTP
    mktempdir() do data
        dir = joinpath(data, "store")
        auth = ["X-Zhifan-Ext-Token" => "t0k"]
        handler = bootstrap(start = false, warmup = false, token = "t0k", data_dir = data).handler
        call(method, target, body = "") = handler(HTTP.Request(method, target, auth, body))
        envelope(response) = JSON3.read(String(response.body))
        post(entries; target = "/api/lab/store") = call("POST", target, JSON3.write(Dict("entries" => entries)))
        q(text) = HTTP.escapeuri(text)
        get_value(key; target = "/api/lab/store") = envelope(call("GET", "$target?key=$(q(key))"))["data"]["value"]
        list(prefix) = Dict(String(k) => v for (k, v) in envelope(call("GET", "/api/lab/store?prefix=$(q(prefix))"))["data"]["entries"])
        expect_invalid(response, needle) = begin
            @test response.status == 422
            env = envelope(response)
            @test env["status"] == "error"
            @test env["code"] == "LAB_VALIDATION"
            @test occursin(needle, env["message"])
            @test haskey(env, "data") && env["data"] === nothing   # 与 grid 的 store 接口一致：出错时 data 为 null
        end

        # 目录还不存在：读是空的，也不去建它
        @test isempty(list("slp:lab:"))
        @test get_value("slp:lab:exp:a:draft-v1") === nothing
        @test !isdir(dir)

        # 往返：中文值、多条一批；根路径和 /api/lab 下是同一份存储
        draft = JSON3.write(Dict("fingerprint" => "f1", "project" => Dict("名称" => "分压电路", "R" => 2200)))
        written = post(Dict("slp:lab:exp:a:draft-v1" => draft, "slp:lab:exp:a:last-case" => "case-1-1",
                            "slp:lab:exp:b:draft-v1" => "别的实验"))
        @test written.status == 200
        @test envelope(written)["status"] == "ok"
        @test envelope(written)["message"] == "已保存"   # 封套与 grid 对齐：写是「已保存」，读是空串
        @test envelope(call("GET", "/api/lab/store?prefix=$(q("slp:lab:"))"))["message"] == ""
        @test envelope(call("GET", "/api/lab/store?key=$(q("slp:lab:exp:a:draft-v1"))"))["message"] == ""
        @test envelope(written)["data"]["written"] == 3
        @test envelope(written)["data"]["removed"] == 0
        @test isempty(HTTP.header(written, "Access-Control-Allow-Origin"))
        @test get_value("slp:lab:exp:a:draft-v1") == draft
        @test get_value("slp:lab:exp:a:draft-v1"; target = "/store") == draft
        @test envelope(post(Dict("slp:lab:exp:a:pref" => "1"); target = "/store"))["data"]["written"] == 1

        # 前缀列表：只给以这个前缀开头的键
        @test list("slp:lab:exp:a:") == Dict("slp:lab:exp:a:draft-v1" => draft, "slp:lab:exp:a:last-case" => "case-1-1",
                                              "slp:lab:exp:a:pref" => "1")
        @test list("slp:lab:exp:b:") == Dict("slp:lab:exp:b:draft-v1" => "别的实验")
        @test length(list("")) == 4
        @test isempty(list("slp:lab:exp:c:"))

        # 覆盖写与 null 删除（键本来就不在也算进 removed）
        @test envelope(post(Dict("slp:lab:exp:a:last-case" => "case-2-3")))["data"]["written"] == 1
        @test get_value("slp:lab:exp:a:last-case") == "case-2-3"
        removed = post(Dict("slp:lab:exp:a:last-case" => nothing, "slp:lab:exp:a:never" => nothing))
        @test (envelope(removed)["data"]["written"], envelope(removed)["data"]["removed"]) == (0, 2)
        @test get_value("slp:lab:exp:a:last-case") === nothing
        @test !haskey(list("slp:lab:exp:a:"), "slp:lab:exp:a:last-case")

        # 落盘格式：{key, value, savedAt}，文件名是键的 sha256 前 40 位
        record = JSON3.read(read(joinpath(dir, bytes2hex(JCircuitServer.sha256("slp:lab:exp:a:draft-v1"))[1:40] * ".json"), String))
        @test record["key"] == "slp:lab:exp:a:draft-v1"
        @test record["value"] == draft
        @test occursin(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", record["savedAt"])

        # 键：1..256 个字符（按字符数，不按字节），不能有控制字符；整批里有一条不合规就一条都不写
        ok_key = "slp:lab:" * repeat("键", 248)
        @test length(ok_key) == 256
        @test envelope(post(Dict(ok_key => "x")))["data"]["written"] == 1
        expect_invalid(post(Dict("slp:lab:" * repeat("键", 249) => "x", "slp:lab:exp:a:good" => "1")), "太长")
        expect_invalid(post(Dict("" => "x")), "不能为空")
        for bad in ("slp:lab:\x01", "slp:lab:\x1f", "slp:lab:\x7f", "slp:lab:a\nb", "slp:lab:\0")
            expect_invalid(post(Dict(bad => "x", "slp:lab:exp:a:good" => "1")), "")
        end
        @test get_value("slp:lab:exp:a:good") === nothing
        expect_invalid(call("GET", "/api/lab/store?key=$(q("slp:lab:\x01"))"), "控制字符")
        expect_invalid(call("GET", "/api/lab/store?key="), "不能为空")
        expect_invalid(call("GET", "/api/lab/store"), "prefix 或 key")

        # 值只能是字符串或 null；请求体得是 {entries: {…}}
        expect_invalid(post(Dict("slp:lab:exp:a:n" => 1, "slp:lab:exp:a:good" => "1")), "字符串或 null")
        for body in ("not json", "[1]", "{\"entries\": [1]}", "{}", "")
            expect_invalid(call("POST", "/api/lab/store", body), "")
        end
        @test get_value("slp:lab:exp:a:good") === nothing

        # 单值上限 4 MiB（按 UTF-8 字节），请求体上限 8 MiB：超了整批不写
        expect_invalid(post(Dict("slp:lab:exp:a:big" => repeat("x", 4 * 1024 * 1024 + 1), "slp:lab:exp:a:good" => "1")), "太大")
        @test get_value("slp:lab:exp:a:good") === nothing
        @test envelope(post(Dict("slp:lab:exp:a:big" => repeat("x", 4 * 1024 * 1024))))["data"]["written"] == 1
        expect_invalid(call("POST", "/api/lab/store", repeat(" ", 8 * 1024 * 1024 + 1)), "8 MiB")
        @test envelope(post(Dict("slp:lab:exp:a:big" => nothing)))["data"]["removed"] == 1

        # 总量上限 64 MiB（目录里所有文件都算）：写入后会超就整批不写，删除照样能做
        filler = joinpath(dir, "filler.bin")
        write(filler, zeros(UInt8, 63 * 1024 * 1024))
        full = post(Dict("slp:lab:exp:a:big" => repeat("y", 2 * 1024 * 1024), "slp:lab:exp:a:good" => "1"))
        expect_invalid(full, "存储已满")
        @test get_value("slp:lab:exp:a:good") === nothing
        @test get_value("slp:lab:exp:a:big") === nothing
        @test envelope(post(Dict("slp:lab:exp:a:small" => "fits")))["data"]["written"] == 1   # 小的还放得下
        @test envelope(post(Dict("slp:lab:exp:a:small" => nothing)))["data"]["removed"] == 1
        rm(filler)

        # 坏文件跳过：读不出来的、key 字段不对的、文件名和键对不上的，都不让整个列表报错
        write(joinpath(dir, repeat("0", 40) * ".json"), "{broken")
        write(joinpath(dir, repeat("1", 40) * ".json"), JSON3.write((key = 42, value = "x")))
        write(joinpath(dir, repeat("2", 40) * ".json"), JSON3.write((key = "slp:lab:exp:a:forged", value = "x", savedAt = "")))
        corrupt_path = joinpath(dir, bytes2hex(JCircuitServer.sha256("slp:lab:exp:a:pref"))[1:40] * ".json")
        write(corrupt_path, "\0\0\0")
        listed = list("slp:lab:exp:a:")
        @test listed == Dict("slp:lab:exp:a:draft-v1" => draft)
        @test get_value("slp:lab:exp:a:pref") === nothing
        @test get_value("slp:lab:exp:a:forged") === nothing
        # 坏文件可以被正常写入覆盖
        @test envelope(post(Dict("slp:lab:exp:a:pref" => "2")))["data"]["written"] == 1
        @test get_value("slp:lab:exp:a:pref") == "2"
        foreach(name -> rm(joinpath(dir, repeat(name, 40) * ".json")), ("0", "1", "2"))

        # 键里写什么都逃不出存储目录
        @test envelope(post(Dict("slp:lab:../../../evil" => "x", "slp:lab:..\\..\\evil" => "y")))["data"]["written"] == 2
        @test get_value("slp:lab:../../../evil") == "x"
        @test readdir(data) == ["store"]
        @test all(name -> occursin(STORE_FILE, name), readdir(dir))   # 也说明没有残留的临时文件

        # 读不出来的请求一律 422，不是 500（与 grid 一致）：坏百分号编码（HTTP.jl 抛 EOFError）、极深嵌套的请求体（栈溢出）
        for target in ("/api/lab/store?key=%", "/api/lab/store?key=a%2", "/api/lab/store?prefix=%", "/api/lab/store?%=1&key=p")
            expect_invalid(call("GET", target), "查询参数")
        end
        expect_invalid(call("POST", "/api/lab/store", "{\"entries\": {\"slp:lab:x\": " * repeat("[", 100_000) * "}}"), "读不出来")

        # 换一个服务实例（同一 data-dir，相当于客户端重开）：还能读到；上次残留的临时文件在启动时清掉。
        # 名字以 .tmp 结尾的目录跳过（只删文件），而且不挡住排在它后面的残留文件
        write(joinpath(dir, "deadbeef.json.123.tmp"), "half")
        mkpath(joinpath(dir, "0folder.tmp", "inner"))
        write(joinpath(dir, "zzzz.json.9.tmp"), "half")
        again = bootstrap(start = false, warmup = false, token = "t0k", data_dir = data).handler
        @test !isfile(joinpath(dir, "deadbeef.json.123.tmp"))
        @test !isfile(joinpath(dir, "zzzz.json.9.tmp"))
        @test isdir(joinpath(dir, "0folder.tmp"))
        rm(joinpath(dir, "0folder.tmp"); recursive = true)
        fresh = JSON3.read(String(again(HTTP.Request("GET", "/api/lab/store?key=$(q("slp:lab:exp:a:draft-v1"))", auth)).body))
        @test fresh["data"]["value"] == draft

        # 令牌：和别的接口一样，不带、带错一律 401，也不碰存储
        for headers in (Pair{String, String}[], ["X-Zhifan-Ext-Token" => "nope"])
            @test handler(HTTP.Request("GET", "/api/lab/store?prefix=", headers)).status == 401
            @test handler(HTTP.Request("POST", "/store", headers, JSON3.write(Dict("entries" => Dict("slp:lab:x" => "1"))))).status == 401
        end
        @test get_value("slp:lab:x") === nothing
    end
end

@testset "页面存储：拓展服务端到端（只写 --data-dir）" begin
    HTTP = JCircuitServer.HTTP
    mktempdir() do tmp
        ui = joinpath(tmp, "ui")
        mkpath(ui)
        write(joinpath(ui, "index.html"), "<p>ui</p>")
        data = joinpath(tmp, "data")
        token = repeat("cd", 32)
        # 上次写到一半被强制结束留下的临时文件（<目标>.<time_ns>.tmp）：拓展启动时就清掉
        leftover = joinpath(data, "store", repeat("a", 40) * ".json.1234567890.tmp")
        mkpath(dirname(leftover))
        write(leftover, "half")
        port, server = JCircuitServer.start_ext_server(; token, ui_dir = ui, data_dir = data)
        @test !isfile(leftover)
        try
            url = "http://127.0.0.1:$port/api/lab/store"
            auth = ["X-Zhifan-Ext-Token" => token]
            body = JSON3.write(Dict("entries" => Dict("slp:lab:exp:ch1:draft-v1" => "{\"a\":1}")))
            saved = HTTP.post(url; headers = [auth; "Content-Type" => "application/json"], body, status_exception = false)
            @test saved.status == 200
            got = HTTP.get(url * "?prefix=slp%3Alab%3Aexp%3Ach1%3A"; headers = auth, status_exception = false)
            @test JSON3.read(String(got.body))["data"]["entries"]["slp:lab:exp:ch1:draft-v1"] == "{\"a\":1}"
            @test HTTP.post(url; body, status_exception = false).status == 401
            # 只落在 --data-dir/store 下（ui 目录、临时目录里别处都没多出东西）
            @test readdir(data) == ["store"]
            @test length(readdir(joinpath(data, "store"))) == 1
            @test sort(readdir(tmp)) == ["data", "ui"]
            @test readdir(ui) == ["index.html"]
        finally
            close(server)
        end
    end
end

@testset "拓展退出：标准输入关闭后到达的最后一批写入仍落盘，2 s 内停服务" begin
    HTTP = JCircuitServer.HTTP
    mktempdir() do tmp
        ui = joinpath(tmp, "ui")
        mkpath(ui)
        write(joinpath(ui, "index.html"), "<p>ui</p>")
        data = joinpath(tmp, "data")
        token = repeat("ef", 32)
        last_request = Threads.Atomic{UInt64}(0)
        port, server = JCircuitServer.start_ext_server(; token, ui_dir = ui, data_dir = data, last_request)
        url = "http://127.0.0.1:$port/api/lab/store"
        auth = ["X-Zhifan-Ext-Token" => token]
        key = "slp:lab:exp:ch1:draft-v1"
        file = joinpath(data, "store", bytes2hex(JCircuitServer.sha256(key))[1:40] * ".json")
        stopped_at = Ref{Float64}(NaN)
        try
            # 先有过一次请求、再静置 0.5 s：读到 EOF 时「最近 300 ms 没有请求」早就成立，也不能马上停
            @test HTTP.get(url * "?prefix="; headers = auth, status_exception = false).status == 200
            @test last_request[] > 0
            sleep(0.5)

            input = Base.BufferStream()   # 代替标准输入：宿主关掉它就是 EOF
            done = @async (JCircuitServer.serve_until_eof(server, last_request; input); stopped_at[] = time())
            closed_at = time()
            close(input)
            sleep(0.15)   # 页面在 pagehide 里 keepalive 发出的最后一批，EOF 之后 200 ms 内才到
            body = JSON3.write(Dict("entries" => Dict(key => "最后一次修改")))
            saved = HTTP.post(url; headers = [auth; "Content-Type" => "application/json"], body, status_exception = false)
            arrived = time() - closed_at
            @test arrived < 0.3   # 确实是在安静窗口里到的（机器太忙时这条先红，别去调大窗口）
            @test saved.status == 200
            @test JSON3.read(String(saved.body))["data"]["written"] == 1
            @test isfile(file)
            @test JSON3.read(read(file, String))["value"] == "最后一次修改"

            @test timedwait(() -> istaskdone(done), 5.0) == :ok
            elapsed = stopped_at[] - closed_at
            @test elapsed < 2.0
            # 最后那次请求之后还安静等了一个窗口，不是读到 EOF 就停
            @test elapsed >= arrived + JCircuitServer.EOF_QUIET_S - 0.05
            # 服务确实停了：新请求连不上
            @test_throws Exception HTTP.get(url * "?prefix="; headers = auth, retry = false, connect_timeout = 2, readtimeout = 2)
        finally
            isnan(stopped_at[]) && close(server)
        end
    end
end
