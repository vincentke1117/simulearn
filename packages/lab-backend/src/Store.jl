# 页面存储：草稿、偏好、「上次打开的案例」交给内核，写进宿主给的 --data-dir（约定 zhifan-ext/1 §3 允许）。
# 知帆每次启动都给拓展页面另开一个随机端口，localStorage 跟着来源（含端口）走，客户端一重开就全丢；
# 宿主给每个拓展的数据目录固定为 dataRoot/<拓展 id>，重启、更新都不变，放这里才留得住。
#
#   GET  store?prefix=<前缀>  → data: {entries: {键: 值}}（只列以这个前缀开头的键）
#   GET  store?key=<键>       → data: {value: 值 | null}
#   POST store {entries: {键: 值 | null}} → data: {written, removed}（null 表示删除）
#
# 形状与 grid-backend 的同名接口完全一致（两个前端各带一份同样的镜像模块 kernelStore.ts），改一边记得对照另一边。
# 每个键一个文件 <目录>/<sha256(键) 前 40 位十六进制>.json，内容 {key, value, savedAt}：文件名不含学生能控制的字符，
# 键里写什么都逃不出存储目录。

const STORE_MAX_KEY_CHARS = 256
const STORE_MAX_VALUE_BYTES = 4 * 1024 * 1024
const STORE_MAX_BODY_BYTES = 8 * 1024 * 1024
const STORE_MAX_TOTAL_BYTES = 64 * 1024 * 1024
const STORE_FILE_NAME = r"^[0-9a-f]{40}\.json$"

"""
    PageStore(dir)

一个存储目录加一把锁：一批写入「先全部校验、再逐个落盘」整个在锁里，别的请求看不到写了一半的批次，
总量核算也不会被并发的写入绕过（HTTP.jl 每个请求一个 task）。
"""
struct PageStore
    dir::String
    lock::ReentrantLock
end

function PageStore(dir::AbstractString)
    store = PageStore(String(dir), ReentrantLock())
    # 上次写到一半被强制结束留下的临时文件：不清掉会一直算在总量里
    if isdir(store.dir)
        for name in readdir(store.dir)
            path = joinpath(store.dir, name)
            endswith(name, ".tmp") && isfile(path) || continue
            # 逐个容错：一个删不掉（被占用）不影响后面的
            try
                rm(path; force = true)
            catch err
                @warn "清理存储目录里的临时文件失败" path exception = err
            end
        end
    end
    return store
end

"""开发态（run_server.jl，没有 --data-dir）的数据目录：SIMULEARN_DATA_DIR/lab，没设就放系统临时目录。"""
function dev_data_dir()
    root = strip(get(ENV, "SIMULEARN_DATA_DIR", ""))
    return joinpath(isempty(root) ? joinpath(tempdir(), "simulearn-dev-data") : String(root), "lab")
end

store_dir(data_dir::AbstractString) = joinpath(data_dir, "store")
store_path(store::PageStore, key::AbstractString) = joinpath(store.dir, bytes2hex(sha256(key))[1:40] * ".json")

"""校验不过的请求：给页面一句中文原因，按 LAB_VALIDATION 回 422。"""
struct StoreInvalid <: Exception
    message::String
end

function check_store_key(key)
    key isa AbstractString || throw(StoreInvalid("存储的键必须是字符串"))
    isvalid(key) || throw(StoreInvalid("存储的键不是有效的 UTF-8 文本"))
    n = length(key)
    n == 0 && throw(StoreInvalid("存储的键不能为空"))
    n > STORE_MAX_KEY_CHARS && throw(StoreInvalid("存储的键太长：最多 $(STORE_MAX_KEY_CHARS) 个字符，这个有 $n 个"))
    any(c -> c <= '\x1f' || c == '\x7f', key) && throw(StoreInvalid("存储的键里不能有控制字符"))
    return String(key)
end

# savedAt 只给人排查时看。Dates 不在 Project.toml 的依赖里（加进去会改 Manifest 的 project_hash），这里自己换算 UTC
function iso_utc(t::Real = time())
    ms_total = floor(Int, t * 1000)
    secs, ms = fldmod(ms_total, 1000)
    days, rest = fldmod(secs, 86400)
    hh, rest = divrem(rest, 3600)
    mm, ss = divrem(rest, 60)
    # 公历换算（Howard Hinnant 的 civil_from_days）
    z = days + 719468
    era = fld(z, 146097)
    doe = z - era * 146097
    yoe = div(doe - div(doe, 1460) + div(doe, 36524) - div(doe, 146096), 365)
    doy = doe - (365 * yoe + div(yoe, 4) - div(yoe, 100))
    mp = div(5 * doy + 2, 153)
    day = doy - div(153 * mp + 2, 5) + 1
    month = mp < 10 ? mp + 3 : mp - 9
    year = yoe + era * 400 + (month <= 2)
    p(x, n = 2) = lpad(string(x), n, '0')
    return "$(p(year, 4))-$(p(month))-$(p(day))T$(p(hh)):$(p(mm)):$(p(ss)).$(p(ms, 3))Z"
end

"""读一个存储文件；读不出来、不是我们写的格式、或者文件名和键对不上，都当没有（坏文件不能让整个列表报错）。"""
function read_store_file(store::PageStore, path::AbstractString)
    try
        record = JSON3.read(read(path), Dict{String, Any})
        key = get(record, "key", nothing)
        value = get(record, "value", nothing)
        (key isa String && value isa String) || return nothing
        store_path(store, key) == path || return nothing
        return key => value
    catch
        return nothing
    end
end

function store_files(store::PageStore)
    isdir(store.dir) || return String[]
    return [joinpath(store.dir, name) for name in readdir(store.dir) if occursin(STORE_FILE_NAME, name)]
end

store_total_bytes(store::PageStore) =
    isdir(store.dir) ? sum((filesize(joinpath(store.dir, name)) for name in readdir(store.dir)); init = 0) : 0

function store_list(store::PageStore, prefix::AbstractString)
    entries = Dict{String, String}()
    lock(store.lock) do
        for path in store_files(store)
            pair = read_store_file(store, path)
            pair !== nothing && startswith(pair.first, prefix) && (entries[pair.first] = pair.second)
        end
    end
    return entries
end

function store_get(store::PageStore, key::AbstractString)
    path = store_path(store, key)
    lock(store.lock) do
        isfile(path) || return nothing
        pair = read_store_file(store, path)
        return pair !== nothing && pair.first == key ? pair.second : nothing
    end
end

"""
    store_write!(store, entries) -> (written, removed)

整批先校验（键、单值大小、写入后的总量），全部通过才落盘；任何一条不合规就一条都不写。
`removed` 数的是这批里值为 null 的键（键本来就不在也算：页面只关心「现在没有了」）。
"""
function store_write!(store::PageStore, entries::AbstractDict)
    # 先把每条要落盘的内容序列化好：总量按真实文件大小核算，不是按值的长度估
    plan = Pair{String, Union{String, Nothing}}[]
    for (raw_key, value) in entries
        key = check_store_key(raw_key)
        if value === nothing
            push!(plan, key => nothing)
        elseif value isa AbstractString
            isvalid(value) || throw(StoreInvalid("「$key」的值不是有效的 UTF-8 文本"))
            sizeof(value) > STORE_MAX_VALUE_BYTES &&
                throw(StoreInvalid("「$key」的值太大：最多 4 MiB，这个有 $(round(sizeof(value) / 1024^2; digits = 1)) MiB"))
            push!(plan, key => JSON3.write((key = key, value = String(value), savedAt = iso_utc())))
        else
            throw(StoreInvalid("「$key」的值只能是字符串或 null"))
        end
    end
    lock(store.lock) do
        before = store_total_bytes(store)
        after = before
        for (key, content) in plan
            path = store_path(store, key)
            isfile(path) && (after -= filesize(path))
            content !== nothing && (after += sizeof(content))
        end
        # 只拦让总量变大的批次：已经超了（比如上限改小过）也要能删东西腾地方
        if after > STORE_MAX_TOTAL_BYTES && after > before
            throw(StoreInvalid("存储已满：电路实验的页面存储最多 64 MiB，这次写入后会到 $(round(after / 1024^2; digits = 1)) MiB，没有写入任何内容"))
        end
        written = removed = 0
        any(p -> p.second !== nothing, plan) && mkpath(store.dir)
        for (key, content) in plan
            path = store_path(store, key)
            if content === nothing
                rm(path; force = true)
                removed += 1
            else
                # 先写同目录的临时文件再改名覆盖：中途断电或被强制结束，旧文件仍是完整的
                tmp = string(path, ".", time_ns(), ".tmp")
                try
                    write(tmp, content)
                    mv(tmp, path; force = true)
                catch
                    rm(tmp; force = true)
                    rethrow()
                end
                written += 1
            end
        end
        return (written, removed)
    end
end

# 封套与 grid-backend 的 store 接口对齐：读的 message 是空串、写的是「已保存」，出错时 data 为 null。
# lab 其他接口（simulate、令牌校验）出错时 data 仍是 {}，只有 store 这一组跟 grid 走
store_envelope(data; message = "") = Dict("status" => "ok", "message" => message, "data" => data)
store_error(code, message) = Dict("status" => "error", "code" => code, "message" => message, "data" => nothing)

function store_respond(work::Function)
    envelope = try
        work()
    catch err
        if err isa StoreInvalid
            store_error("LAB_VALIDATION", err.message)
        elseif err isa ArgumentError
            # JSON3 解析失败（不是 JSON、顶层不是对象、孤立的代理字符）或查询参数解不开
            store_error("LAB_VALIDATION", "存储请求读不出来：读要带 prefix 或 key 参数，写的请求体要是 {\"entries\": {键: 字符串或 null}}")
        else
            @error "页面存储读写失败" exception = (err, catch_backtrace())
            store_error("LAB_INTERNAL", "页面存储读写失败：$(sprint(showerror, err))")
        end
    end
    return HTTP.Response(lab_http_status(envelope), collect(RESPONSE_HEADERS), JSON3.write(envelope))
end

function store_get_route(store::PageStore, req::HTTP.Request)
    return store_respond() do
        query = try
            HTTP.queryparams(HTTP.URI(req.target))
        catch
            throw(StoreInvalid("存储请求的查询参数解不开"))
        end
        if haskey(query, "key")
            key = check_store_key(query["key"])
            return store_envelope(Dict("value" => store_get(store, key)))
        elseif haskey(query, "prefix")
            prefix = query["prefix"]
            # 前缀可以为空（＝全部），但不能是坏文本或超长：和键同一套规矩
            isempty(prefix) || check_store_key(prefix)
            return store_envelope(Dict("entries" => store_list(store, prefix)))
        end
        throw(StoreInvalid("读存储要带 prefix 或 key 参数"))
    end
end

function store_post_route(store::PageStore, req::HTTP.Request)
    return store_respond() do
        length(req.body) > STORE_MAX_BODY_BYTES && throw(StoreInvalid("存储请求太大：请求体最多 8 MiB"))
        # 按字节解析：按 String 解析时 JSON3 碰到 \u0000 会抛无关的 C 字符串错误
        body = try
            JSON3.read(req.body, Dict{String, Any})
        catch
            throw(StoreInvalid("存储请求读不出来：请求体要是 {\"entries\": {键: 字符串或 null}}"))
        end
        entries = get(body, "entries", nothing)
        entries isa AbstractDict || throw(StoreInvalid("存储请求要有 entries 对象"))
        written, removed = store_write!(store, entries)
        return store_envelope(Dict("written" => written, "removed" => removed); message = "已保存")
    end
end

"""在路由上挂 GET/POST `<前缀>/store`（根路径和 /api/lab 各一份，见 build_router）。"""
function register_store_routes!(router, store::PageStore, prefixes)
    for prefix in prefixes
        HTTP.register!(router, "GET", prefix * "/store", req -> store_get_route(store, req))
        HTTP.register!(router, "POST", prefix * "/store", req -> store_post_route(store, req))
    end
    return router
end
