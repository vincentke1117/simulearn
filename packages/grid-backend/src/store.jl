# 页面的键值存储（草稿、参数、运行记录……），落在宿主给的数据目录里。
# 为什么不留在页面的 localStorage：知帆客户端每次启动都给拓展页面开一个随机端口，
# localStorage 按来源（含端口）隔离，重开客户端就全丢了。数据目录固定为 dataRoot/<拓展 id>，
# 重启、更新都不变，而约定 zhifan-ext/1 §3 本来就允许拓展写它。
#
# 一个键一个文件：<存储目录>/<sha256(键) 前 40 位十六进制>.json，内容 {"key","value","savedAt"}。
# 文件名取哈希而不是键本身：键里可以有 : / 中文等任何字符，拼进路径既不安全也不可移植。

using HTTP
using SHA

const STORE_MAX_KEY_CHARS = 256
const STORE_MAX_VALUE_BYTES = 4 * 1024 * 1024
const STORE_MAX_BODY_BYTES = 8 * 1024 * 1024
const STORE_MAX_TOTAL_BYTES = 64 * 1024 * 1024
# 只认这种文件名：写到一半的临时文件、别人放进来的文件都不当条目读
const STORE_ENTRY_FILE = r"^[0-9a-f]{40}\.json$"
# 同一进程里并发的写请求要排队：总量检查和落盘之间不能插进别的写入
const STORE_LOCK = ReentrantLock()

store_entry_name(key::AbstractString) = bytes2hex(sha256(String(key)))[1:40] * ".json"
store_entry_path(dir::AbstractString, key::AbstractString) = joinpath(dir, store_entry_name(key))

is_control_char(c::AbstractChar) = c <= '\x1f' || c == '\x7f'

"""键：1..256 个字符的合法 UTF-8 文本，不含控制字符。不合格抛 ValidationError（→ 422）。"""
function validate_store_key(key)::String
    key isa AbstractString || throw(ValidationError("存储键必须是字符串"))
    isvalid(key) || throw(ValidationError("存储键不是合法的 UTF-8 文本"))
    n = length(key)
    1 <= n <= STORE_MAX_KEY_CHARS ||
        throw(ValidationError("存储键长度必须在 1 到 $(STORE_MAX_KEY_CHARS) 个字符之间（收到 $(n) 个）"))
    any(is_control_char, key) && throw(ValidationError("存储键不能含控制字符：$(repr(String(key)))"))
    return String(key)
end

"""列表用的前缀：可以为空串（＝全部），其余规则同键。"""
function validate_store_prefix(prefix::AbstractString)::String
    isvalid(prefix) || throw(ValidationError("存储前缀不是合法的 UTF-8 文本"))
    length(prefix) <= STORE_MAX_KEY_CHARS ||
        throw(ValidationError("存储前缀不能超过 $(STORE_MAX_KEY_CHARS) 个字符"))
    any(is_control_char, prefix) && throw(ValidationError("存储前缀不能含控制字符"))
    return String(prefix)
end

"""
    read_store_entry(path) -> Union{Nothing,Tuple{String,String}}

读一个条目文件。坏文件（读不出、JSON 解析失败、key/value 不是字符串、key 与文件名对不上）
一律返回 `nothing`：一个坏文件不能让整个列表报错。按字节解析：JSON3 拿到 String 会先拿它当路径
试 isfile，内容里有 NUL 时直接抛错。
"""
function read_store_entry(path::AbstractString)::Union{Nothing,Tuple{String,String}}
    try
        obj = JSON3.read(read(path), Dict{String,Any})
        key = get(obj, "key", nothing)
        value = get(obj, "value", nothing)
        (key isa String && value isa String) || return nothing
        store_entry_name(key) == basename(path) || return nothing
        return (key, value)
    catch
        return nothing
    end
end

"""`key` 的值；没有或文件坏了返回 `nothing`。"""
function store_get(dir::AbstractString, key::AbstractString)::Union{Nothing,String}
    path = store_entry_path(dir, key)
    isfile(path) || return nothing
    entry = read_store_entry(path)
    (entry === nothing || entry[1] != key) && return nothing
    return entry[2]
end

"""所有以 `prefix` 开头的键值。"""
function store_list(dir::AbstractString, prefix::AbstractString)::Dict{String,String}
    out = Dict{String,String}()
    isdir(dir) || return out
    for name in readdir(dir)
        occursin(STORE_ENTRY_FILE, name) || continue
        entry = read_store_entry(joinpath(dir, name))
        entry === nothing && continue
        startswith(entry[1], prefix) && (out[entry[1]] = entry[2])
    end
    return out
end

"""存储目录里所有文件的字节数之和（含临时文件与不认识的文件：它们一样占盘）。"""
function store_total_bytes(dir::AbstractString)::Int
    isdir(dir) || return 0
    total = 0
    for name in readdir(dir)
        path = joinpath(dir, name)
        isfile(path) && (total += filesize(path))
    end
    return total
end

"""
先写同目录的临时文件 `<目标>.<time_ns>.tmp` 再改名覆盖：写到一半断电，旧文件还在。失败时删掉临时文件；
进程被强制结束来不及删的，下次启动时由 `store_clean_tmp!` 清掉。
"""
function store_atomic_write(path::AbstractString, bytes::Vector{UInt8})
    tmp = string(path, ".", time_ns(), ".tmp")
    try
        open(tmp, "w") do io
            write(io, bytes)
        end
        mv(tmp, path; force=true)
    catch
        rm(tmp; force=true)
        rethrow()
    end
    return nothing
end

"""
    store_clean_tmp!(dir) -> Int

服务启动时调用：上次写到一半被强制结束（宿主杀进程、断电）留下的 `*.tmp` 不会再被谁改名，
不清掉就一直算在 64 MiB 总量里。返回删掉的个数；清理失败只警告，不挡启动。
"""
function store_clean_tmp!(dir::AbstractString)::Int
    removed = 0
    try
        isdir(dir) || return 0
        for name in readdir(dir)
            endswith(name, ".tmp") || continue
            path = joinpath(dir, name)
            isfile(path) || continue
            rm(path; force=true)
            removed += 1
        end
    catch err
        @warn "清理存储目录里的临时文件失败" dir exception = err
    end
    return removed
end

store_timestamp() = Dates.format(Dates.now(Dates.UTC), "yyyy-mm-ddTHH:MM:SS.sss") * "Z"

"""
    store_write!(dir, entries; max_value_bytes, max_total_bytes) -> (written, removed)

逐个写入 `entries`（值为 `nothing` 表示删除）。整批要么都写要么都不写：
先校验每个键值、再按写入后的总量核对上限，全部通过才动盘。
`written` / `removed` 是请求里写入与删除的条目数（删除不存在的键也算一条，删除是幂等的）。
"""
function store_write!(dir::AbstractString, entries::AbstractDict;
                      max_value_bytes::Integer=STORE_MAX_VALUE_BYTES,
                      max_total_bytes::Integer=STORE_MAX_TOTAL_BYTES)
    plan = Tuple{String,Union{Nothing,Vector{UInt8}}}[]
    for (rawkey, value) in entries
        key = validate_store_key(rawkey)
        if value === nothing
            push!(plan, (key, nothing))
        elseif value isa AbstractString
            isvalid(value) || throw(ValidationError("键 $(repr(key)) 的值不是合法的 UTF-8 文本"))
            ncodeunits(value) <= max_value_bytes ||
                throw(ValidationError("键 $(repr(key)) 的值有 $(ncodeunits(value)) 字节，超过单条上限 $(max_value_bytes ÷ (1024 * 1024)) MiB"))
            # NamedTuple 保证字段顺序 key → value → savedAt，文件人眼可读
            content = Vector{UInt8}(JSON3.write((key=key, value=String(value), savedAt=store_timestamp())))
            push!(plan, (key, content))
        else
            throw(ValidationError("键 $(repr(key)) 的值必须是字符串或 null"))
        end
    end
    return lock(STORE_LOCK) do
        current = store_total_bytes(dir)
        projected = current
        for (key, content) in plan
            path = store_entry_path(dir, key)
            projected -= isfile(path) ? filesize(path) : 0
            projected += content === nothing ? 0 : length(content)
        end
        # 只拦会让存储变大的批次：上限调低后，删除照样能把它降下来
        if projected > max_total_bytes && projected > current
            throw(ValidationError("存储已满：写入后共 $(projected) 字节，超过上限 $(max_total_bytes ÷ (1024 * 1024)) MiB，本次没有写入任何条目"))
        end
        isempty(plan) || mkpath(dir)
        written = 0
        removed = 0
        for (key, content) in plan
            path = store_entry_path(dir, key)
            if content === nothing
                rm(path; force=true)
                removed += 1
            else
                store_atomic_write(path, content)
                written += 1
            end
        end
        (written, removed)
    end
end

"""POST 请求体按字节解析（理由见 read_store_entry）；读不出 JSON 对象一律归 422。"""
function parse_store_body(body::AbstractVector{UInt8})::Dict{String,Any}
    length(body) > STORE_MAX_BODY_BYTES &&
        throw(ValidationError("请求体有 $(length(body)) 字节，超过上限 $(STORE_MAX_BODY_BYTES ÷ (1024 * 1024)) MiB"))
    all(b -> b in (0x20, 0x09, 0x0a, 0x0d), body) && throw(ValidationError("请求体为空，需要 {\"entries\": {...}}"))
    try
        return JSON3.read(body, Dict{String,Any})
    catch
        throw(ValidationError("请求体不是合法的 JSON 对象"))
    end
end

# 封套与 lab 内核的同名接口对齐：成功时读用空 message、写用「已保存」；出错时 data 为 null（wrap_error）
const STORE_READ_MESSAGE = ""
const STORE_WRITE_MESSAGE = "已保存"

"""GET store?key=<键> → {value}；GET store?prefix=<前缀> → {entries}。封套字符串。"""
function store_get_response(dir::AbstractString, req::HTTP.Request)::String
    try
        params = try
            HTTP.queryparams(HTTP.URI(req.target))
        catch
            throw(ValidationError("查询参数无法解析"))
        end
        if haskey(params, "key")
            key = validate_store_key(params["key"])
            return wrap_success(STORE_READ_MESSAGE, Dict{String,Any}("value" => store_get(dir, key)))
        elseif haskey(params, "prefix")
            prefix = validate_store_prefix(params["prefix"])
            return wrap_success(STORE_READ_MESSAGE, Dict{String,Any}("entries" => store_list(dir, prefix)))
        end
        throw(ValidationError("读取存储需要 prefix 或 key 参数"))
    catch err
        return wrap_error(err)
    end
end

"""POST store {entries: {键: 值字符串 | null}} → {written, removed}。封套字符串。"""
function store_post_response(dir::AbstractString, req::HTTP.Request)::String
    try
        body = parse_store_body(req.body)
        entries = get(body, "entries", nothing)
        entries isa AbstractDict || throw(ValidationError("请求体需要 entries 对象：{\"entries\": {键: 值字符串或 null}}"))
        written, removed = store_write!(dir, entries)
        return wrap_success(STORE_WRITE_MESSAGE, Dict{String,Any}("written" => written, "removed" => removed))
    catch err
        return wrap_error(err)
    end
end

"""开发态（没有 --data-dir）的存储目录：SIMULEARN_DATA_DIR/grid/store，没设就放系统临时目录。"""
function dev_store_dir()::String
    root = strip(get(ENV, "SIMULEARN_DATA_DIR", ""))
    base = isempty(root) ? joinpath(tempdir(), "simulearn-dev-data", "grid") : joinpath(String(root), "grid")
    return joinpath(base, "store")
end
