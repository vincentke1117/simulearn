# 页面键值存储（src/store.jl）：嵌入页面把草稿交给内核，写进宿主给的数据目录（约定 zhifan-ext/1 §3）
using HTTP

const ENTRY_FILE = r"^[0-9a-f]{40}\.json$"

@testset "Store keys" begin
    @test JGDO.validate_store_key("slp:grid:exp:ch12-tap-1:embed-draft-v2") == "slp:grid:exp:ch12-tap-1:embed-draft-v2"
    @test JGDO.validate_store_key("中文键") == "中文键"
    @test JGDO.validate_store_key(repeat("键", 256)) == repeat("键", 256)   # 按字符数，不按字节
    for bad in ["", repeat("a", 257), "a\nb", "a\0b", "tab\t", "del\x7f", "esc\x1b"]
        @test_throws ValidationError JGDO.validate_store_key(bad)
    end
    @test_throws ValidationError JGDO.validate_store_key(42)
    @test_throws ValidationError JGDO.validate_store_key(String([0xff, 0xfe]))
    # 文件名只由哈希决定：同一个键永远落在同一个文件
    @test occursin(ENTRY_FILE, JGDO.store_entry_name("a:b/c\\d"))
    @test JGDO.store_entry_name("x") == JGDO.store_entry_name("x")
    @test JGDO.store_entry_name("x") != JGDO.store_entry_name("y")
end

@testset "Store write/read (functions)" begin
    mktempdir() do tmp
        dir = joinpath(tmp, "store")
        @test JGDO.store_list(dir, "") == Dict{String,String}()     # 目录不存在：空
        @test JGDO.store_get(dir, "a") === nothing
        @test JGDO.store_write!(dir, Dict{String,Any}("p:a" => "1", "p:b" => "二", "q:c" => "3")) == (3, 0)
        @test JGDO.store_get(dir, "p:b") == "二"
        @test JGDO.store_list(dir, "p:") == Dict("p:a" => "1", "p:b" => "二")
        @test length(JGDO.store_list(dir, "")) == 3
        # 文件内容：{"key","value","savedAt"}
        obj = JSON3.read(read(JGDO.store_entry_path(dir, "p:a"), String))
        @test collect(keys(obj)) == [:key, :value, :savedAt]
        @test obj[:key] == "p:a" && obj[:value] == "1"
        @test occursin(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$", obj[:savedAt])
        # null 删除；删除不存在的键也算一条（幂等）
        @test JGDO.store_write!(dir, Dict{String,Any}("p:a" => nothing, "p:none" => nothing, "p:b" => "改")) == (1, 2)
        @test JGDO.store_list(dir, "p:") == Dict("p:b" => "改")
        @test all(name -> occursin(ENTRY_FILE, name), readdir(dir))   # 没有残留的临时文件
    end
end

@testset "Store limits reject the whole batch" begin
    mktempdir() do tmp
        dir = joinpath(tmp, "store")
        JGDO.store_write!(dir, Dict{String,Any}("k:keep" => "old"))
        before = Dict(name => read(joinpath(dir, name)) for name in readdir(dir))
        # 单值上限：同批里合格的条目也不写
        @test_throws ValidationError JGDO.store_write!(dir, Dict{String,Any}("k:keep" => "new", "k:big" => "x"^11);
                                                       max_value_bytes=10)
        # 值类型
        @test_throws ValidationError JGDO.store_write!(dir, Dict{String,Any}("k:keep" => "new", "k:num" => 1))
        # 坏键
        @test_throws ValidationError JGDO.store_write!(dir, Dict{String,Any}("k:keep" => "new", "" => "x"))
        # 总量上限：按写入后的总量核对
        current = JGDO.store_total_bytes(dir)
        err = try
            JGDO.store_write!(dir, Dict{String,Any}("k:keep" => "new", "k:more" => "y"^200); max_total_bytes=current + 100)
            nothing
        catch e
            e
        end
        @test err isa ValidationError
        @test occursin("存储已满", err.msg)
        @test Dict(name => read(joinpath(dir, name)) for name in readdir(dir)) == before
        # 覆盖同一个键只算增量；上限调低后删除仍然放行
        @test JGDO.store_write!(dir, Dict{String,Any}("k:keep" => "new"); max_total_bytes=current + 10) == (1, 0)
        @test JGDO.store_write!(dir, Dict{String,Any}("k:keep" => nothing); max_total_bytes=1) == (0, 1)
        @test isempty(readdir(dir))
    end
end

@testset "Store skips corrupt files" begin
    mktempdir() do tmp
        dir = joinpath(tmp, "store")
        JGDO.store_write!(dir, Dict{String,Any}("p:good" => "ok", "p:bad" => "x", "p:moved" => "m"))
        write(JGDO.store_entry_path(dir, "p:bad"), "{not json\0")
        # key 字段与文件名对不上（比如被手工改过）
        write(JGDO.store_entry_path(dir, "p:moved"), JSON3.write((key="p:other", value="m", savedAt="")))
        write(joinpath(dir, "notes.txt"), "不是条目")
        write(joinpath(dir, repeat("0", 40) * ".json"), "[1,2,3]")
        @test JGDO.store_list(dir, "p:") == Dict("p:good" => "ok")
        @test JGDO.store_get(dir, "p:bad") === nothing
        @test JGDO.store_get(dir, "p:moved") === nothing
        @test JGDO.store_get(dir, "p:good") == "ok"
    end
end

@testset "Store leftover temp files" begin
    mktempdir() do tmp
        dir = joinpath(tmp, "store")
        @test JGDO.store_clean_tmp!(dir) == 0            # 目录还不存在：什么都不做
        JGDO.store_write!(dir, Dict{String,Any}("p:a" => "1"))
        entry = JGDO.store_entry_path(dir, "p:a")
        write(string(entry, ".", time_ns(), ".tmp"), "写到一半")
        write(joinpath(dir, "other.tmp"), "x")
        write(joinpath(dir, "notes.txt"), "不是临时文件")
        mkpath(joinpath(dir, "folder.tmp"))              # 目录不是我们写的临时文件
        @test JGDO.store_clean_tmp!(dir) == 2
        @test sort(readdir(dir)) == sort([basename(entry), "notes.txt", "folder.tmp"])
        @test JGDO.store_get(dir, "p:a") == "1"
    end
end

@testset "Store dev directory" begin
    withenv("SIMULEARN_DATA_DIR" => nothing) do
        @test JGDO.dev_store_dir() == joinpath(tempdir(), "simulearn-dev-data", "grid", "store")
    end
    mktempdir() do tmp
        withenv("SIMULEARN_DATA_DIR" => tmp) do
            @test JGDO.dev_store_dir() == joinpath(tmp, "grid", "store")
        end
    end
end

@testset "Store over HTTP (extension data dir)" begin
    mktempdir() do tmp
        data = joinpath(tmp, "data")
        store = joinpath(data, "store")
        ui = joinpath(tmp, "ui")
        mkpath(ui)
        write(joinpath(ui, "index.html"), "<p>grid</p>")
        token = repeat("cd", 32)
        config() = JGDO.ServerConfig(; token=token, runs_dir=joinpath(data, "runs"), store_dir=store,
                                     ui_dir=ui, examples_dir=joinpath(tmp, "examples"))
        auth = [JGDO.TOKEN_HEADER => token]
        q(s) = HTTP.escapeuri(s)
        prefix = "slp:grid:exp:ch12-tap-1:"
        draft = "{\"topology\":{\"nodes\":[{\"id\":\"bus-1\",\"name\":\"母线一\"}]}}"

        port, _ = JGDO.start_server(config())
        try
            base = "http://127.0.0.1:$port"
            hget(path; headers=auth) = HTTP.get(base * path; headers=headers, status_exception=false)
            hpost(path, body; headers=auth) = HTTP.post(base * path; headers=[headers; "Content-Type" => "application/json"],
                                                        body=body, status_exception=false)
            envelope(resp) = JSON3.read(String(resp.body))

            # 令牌：根路径与 /api/grid 前缀下都要带，读写都一样
            for path in ("/store?prefix=", "/api/grid/store?prefix=")
                @test hget(path; headers=Pair{String,String}[]).status == 401
                @test hget(path; headers=[JGDO.TOKEN_HEADER => "nope"]).status == 401
            end
            for path in ("/store", "/api/grid/store")
                @test hpost(path, """{"entries":{"$(prefix)x":"1"}}"""; headers=Pair{String,String}[]).status == 401
            end
            @test !isdir(store)   # 被拒的请求一个字节都没写

            # 往返：写入、单键读取、前缀列表
            resp = hpost("/api/grid/store", JSON3.write(Dict("entries" => Dict(
                prefix * "embed-draft-v2" => draft, prefix * "analysis-v1" => "pf", "slp:grid:exp:other:analysis-v1" => "opf"))))
            @test resp.status == 200
            env = envelope(resp)
            @test env[:status] == "ok"
            @test env[:message] == "已保存"    # 封套与 lab 内核的同名接口一致：写用「已保存」、读用空串
            @test env[:data][:written] == 3 && env[:data][:removed] == 0
            @test isempty(HTTP.header(resp, "Access-Control-Allow-Origin"))
            got = envelope(hget("/api/grid/store?key=" * q(prefix * "embed-draft-v2")))
            @test got[:status] == "ok"
            @test got[:message] == ""
            @test got[:data][:value] == draft
            @test envelope(hget("/store?prefix=" * q(prefix)))[:message] == ""
            @test envelope(hget("/store?key=" * q(prefix * "missing")))[:data][:value] === nothing
            listed = envelope(hget("/api/grid/store?prefix=" * q(prefix)))[:data][:entries]
            @test Dict(String(k) => v for (k, v) in pairs(listed)) ==
                  Dict(prefix * "embed-draft-v2" => draft, prefix * "analysis-v1" => "pf")
            @test length(envelope(hget("/store?prefix="))[:data][:entries]) == 3
            # 空列表是对象 {}，不是数组
            @test occursin("\"entries\":{}", String(hget("/store?prefix=" * q("nobody:")).body))

            # null 删除
            resp = hpost("/store", """{"entries":{"$(prefix)analysis-v1":null}}""")
            @test envelope(resp)[:data][:removed] == 1
            @test envelope(hget("/store?key=" * q(prefix * "analysis-v1")))[:data][:value] === nothing

            # 键与请求体校验：422 + GRID_VALIDATION，中文原因
            for body in ("""{"entries":{"":"x"}}""", """{"entries":{"a\\u0001b":"x"}}""",
                         """{"entries":{"a\\u0000b":"x"}}""", """{"entries":{"$(repeat("a", 257))":"x"}}""",
                         """{"entries":{"k":1}}""", """{"entries":[]}""", """{"nope":1}""", "not json", "")
                resp = hpost("/api/grid/store", body)
                @test resp.status == 422
                env = envelope(resp)   # String(resp.body) 会取走 body 的字节：每个响应只解析一次
                @test env[:code] == "GRID_VALIDATION"
                @test env[:data] === nothing   # 出错时 data 一律为 null
            end
            bad_key = hget("/store?key=" * q("a\nb"))
            @test bad_key.status == 422
            env = envelope(bad_key)
            @test occursin("控制字符", env[:message])
            @test env[:data] === nothing
            @test hget("/store?key=").status == 422
            @test hget("/store").status == 422          # 既没有 key 也没有 prefix

            # 单值上限 4 MiB：整批不写
            big = repeat("x", JGDO.STORE_MAX_VALUE_BYTES + 1)
            resp = hpost("/store", JSON3.write(Dict("entries" => Dict(prefix * "ok" => "1", prefix * "big" => big))))
            @test resp.status == 422
            @test occursin("超过单条上限", envelope(resp)[:message])
            @test envelope(hget("/store?key=" * q(prefix * "ok")))[:data][:value] === nothing
            # 请求体上限 8 MiB
            resp = hpost("/store", repeat(" ", JGDO.STORE_MAX_BODY_BYTES + 1))
            @test resp.status == 422
            @test occursin("请求体", envelope(resp)[:message])
            # 总量上限 64 MiB（按存储目录里所有文件计）：塞一个占位大文件，再写一条就满了
            files_before = sort(readdir(store))
            filler = joinpath(store, "filler.bin")
            write(filler, zeros(UInt8, JGDO.STORE_MAX_TOTAL_BYTES - JGDO.store_total_bytes(store) - 10))
            resp = hpost("/store", JSON3.write(Dict("entries" => Dict(prefix * "a" => "1", prefix * "b" => "2"))))
            @test resp.status == 422
            @test occursin("存储已满", envelope(resp)[:message])
            @test sort(readdir(store)) == sort([files_before; "filler.bin"])
            rm(filler)

            # 文件只落在 data-dir/store 下，且没有残留的临时文件
            @test all(name -> occursin(ENTRY_FILE, name), readdir(store))
            @test sort(readdir(data)) == ["store"]   # 存储请求不碰别的目录
            # 写错的文件不让列表整体报错
            write(JGDO.store_entry_path(store, prefix * "broken"), "{oops")
            @test hget("/store?prefix=" * q(prefix)).status == 200
        finally
            JGDO.stop_server()
        end

        # 上次写到一半被强制结束留下的临时文件（<目标>.<time_ns>.tmp）：下次起服务时清掉，条目本身不动
        total = JGDO.store_total_bytes(store)
        stale = string(JGDO.store_entry_path(store, prefix * "embed-draft-v2"), ".", time_ns(), ".tmp")
        write(stale, "写到一半")
        @test JGDO.store_total_bytes(store) == total + filesize(stale)   # 不清就一直占着总量

        # 同一个数据目录换一个服务实例（客户端重启、拓展更新）还能读到
        port, _ = JGDO.start_server(config())
        @test !isfile(stale)
        @test JGDO.store_total_bytes(store) == total
        @test all(name -> occursin(ENTRY_FILE, name), readdir(store))
        try
            resp = HTTP.get("http://127.0.0.1:$port/api/grid/store?prefix=" * q(prefix); headers=auth, status_exception=false)
            listed = JSON3.read(String(resp.body))[:data][:entries]
            @test Dict(String(k) => v for (k, v) in pairs(listed)) == Dict(prefix * "embed-draft-v2" => draft)
        finally
            JGDO.stop_server()
        end
    end
end
