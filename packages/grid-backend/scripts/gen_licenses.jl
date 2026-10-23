# 生成拓展发布包里的第三方许可清单 LICENSES/index.html（设计记录 D18）。
# 约定 zhifan-ext/1 §1：宿主把它放进不带脚本的沙箱里显示，所以只能是静态 HTML。
#
# 用法：julia --project=packages/grid-backend packages/grid-backend/scripts/gen_licenses.jl <create_app 产物目录> <输出 html> [<前端依赖目录>...]
#   前端依赖目录：打进页面的 npm 包目录（如 node_modules/@joint/core），读它的 package.json 与 LICENSE。
#
# 这里只做「如实列出 + 标出需要注意的许可」，不替使用者下合规结论。
using Pkg
using Dates

length(ARGS) >= 2 || error("用法：gen_licenses.jl <产物目录> <输出 html> [<前端依赖目录>...]")
const APP_DIR = abspath(ARGS[1])
const OUT = abspath(ARGS[2])
const WEB_DEPS = ARGS[3:end]

html_escape(s::AbstractString) = replace(s, "&" => "&amp;", "<" => "&lt;", ">" => "&gt;", "\"" => "&quot;")

const LICENSE_FILE = r"^(licen[cs]e|copying|copyright)"i

function license_files(dir::AbstractString)
    isdir(dir) || return String[]
    return sort([joinpath(dir, f) for f in readdir(dir) if occursin(LICENSE_FILE, f) && isfile(joinpath(dir, f))])
end

read_text(path) = try
    read(path, String)
catch
    ""
end

# 需要额外留意的许可：按原文识别，只做提示
const NOTABLE = [
    (r"GNU LESSER GENERAL PUBLIC LICENSE"i, "LGPL"),
    (r"GNU GENERAL PUBLIC LICENSE"i, "GPL"),
    (r"Mozilla Public License"i, "MPL-2.0"),
    (r"Eclipse Public License"i, "EPL"),
    (r"CeCILL"i, "CeCILL"),
]

function notable_tags(text::AbstractString)
    tags = String[]
    for (pattern, tag) in NOTABLE
        occursin(pattern, text) && push!(tags, tag)
    end
    # MPL-2.0 / EPL-2.0 / CeCILL 原文在「次级许可 / 兼容许可」条款里都会提到 GNU GPL，
    # 识别出它们时 GPL 字样来自条款本身，不是另一份许可
    if any(t -> t in ("MPL-2.0", "EPL", "CeCILL"), tags)
        filter!(t -> t != "GPL" && t != "LGPL", tags)
    end
    # LGPL 原文里也会出现 "GNU General Public License"：已标 LGPL 时不再重复标 GPL
    "LGPL" in tags && filter!(!=("GPL"), tags)
    return tags
end

struct Entry
    group::String
    name::String
    version::String
    source::String
    text::String
end

entries = Entry[]

# 1. Julia 本体
julia_root = normpath(joinpath(Sys.BINDIR, ".."))
push!(entries, Entry("运行时", "Julia", string(VERSION),
    "https://github.com/JuliaLang/julia/tree/v$(VERSION)（第三方组件见同目录 THIRDPARTY.md）",
    read_text(joinpath(julia_root, "LICENSE.md"))))

# 2. Julia 包（Manifest 锁定的全部依赖；标准库随 Julia 本体，单列名称）
stdlibs = String[]
for (_, info) in sort(collect(Pkg.dependencies()); by=p -> p[2].name)
    src = info.source
    if src === nothing || startswith(normpath(src), normpath(Sys.STDLIB))
        push!(stdlibs, info.name)
        continue
    end
    info.name == "JGDO" && continue  # 本项目自身（Apache-2.0，见仓库根目录 LICENSE）
    files = license_files(src)
    text = isempty(files) ? "（包目录里没有找到许可文件，请到源码仓库核实）" : join(read_text.(files), "\n\n")
    version = info.version === nothing ? "" : string(info.version)
    push!(entries, Entry("Julia 包", info.name, version,
        "Julia General 注册表登记的源码仓库（按包名与版本检索：https://juliahub.com/ui/Packages）", text))
end

# 3. 打进产物的二进制库（JLL artifact 自带 share/licenses/<名称>/）
artifacts = joinpath(APP_DIR, "share", "julia", "artifacts")
if isdir(artifacts)
    for hash in sort(readdir(artifacts))
        lic_root = joinpath(artifacts, hash, "share", "licenses")
        isdir(lic_root) || continue
        for name in sort(readdir(lic_root))
            files = sort([joinpath(lic_root, name, f) for f in readdir(joinpath(lic_root, name))])
            push!(entries, Entry("二进制库（JLL）", name, "artifact $(first(hash, 12))",
                "构建配方：https://github.com/JuliaPackaging/Yggdrasil（按名称检索 $(name)）", join(read_text.(files), "\n\n")))
        end
    end
end

# 4. 打进页面的前端依赖
for dir in WEB_DEPS
    pkg = joinpath(dir, "package.json")
    isfile(pkg) || continue
    meta = read_text(pkg)
    name = something(match(r"\"name\"\s*:\s*\"([^\"]+)\"", meta), (; captures=[basename(dir)])).captures[1]
    version = something(match(r"\"version\"\s*:\s*\"([^\"]+)\"", meta), (; captures=[""])).captures[1]
    files = license_files(dir)
    push!(entries, Entry("前端依赖", name, version, "https://www.npmjs.com/package/$(name)",
        isempty(files) ? "（未找到许可文件）" : join(read_text.(files), "\n\n")))
end

# ---- 输出静态 HTML ----
io = IOBuffer()
notable = [(e, notable_tags(e.text)) for e in entries]
println(io, """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>第三方许可 · SimuLearn 配电网实验</title>
<style>body{font:14px/1.6 system-ui,"Segoe UI",sans-serif;margin:24px;color:#1d2433;max-width:960px}
h1{font-size:20px}h2{font-size:16px;margin-top:28px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d8dee8;padding:4px 8px;text-align:left;vertical-align:top}
.tag{display:inline-block;background:#fde68a;border-radius:4px;padding:0 6px;margin-right:4px;font-size:12px}
details{border:1px solid #d8dee8;border-radius:6px;margin:8px 0;padding:6px 10px}summary{cursor:pointer;font-weight:600}
pre{white-space:pre-wrap;font-size:12px;background:#f6f8fb;padding:8px;border-radius:4px}</style></head><body>
<h1>第三方许可</h1>
<p>SimuLearn 配电网实验（simulearn-grid）本身以 Apache-2.0 发布。本页列出发布包中包含的第三方软件及其许可原文。生成时间：$(Dates.format(now(), "yyyy-mm-dd HH:MM"))。</p>
<h2>需要留意的许可</h2>
<p>以下组件的许可带有分发义务（例如提供源码获取方式、保留声明、修改过的文件需公开），标注仅按许可原文自动识别，供核实用：</p>
<table><tr><th>组件</th><th>类别</th><th>识别到的许可</th><th>源码获取</th></tr>""")
for (e, tags) in notable
    isempty(tags) && continue
    println(io, "<tr><td>$(html_escape(e.name)) $(html_escape(e.version))</td><td>$(html_escape(e.group))</td><td>",
        join(("<span class=\"tag\">$(t)</span>" for t in tags)), "</td><td>$(html_escape(e.source))</td></tr>")
end
println(io, """</table>
<p>另：Julia 运行时自带 SuiteSparse 等库（随产物一起分发，例如 libcholmod、libumfpack、libspqr），其中部分模块为 LGPL / GPL。
详见 <a href="https://github.com/JuliaLang/julia/blob/v$(VERSION)/THIRDPARTY.md">Julia THIRDPARTY.md</a>，源码见 <a href="https://github.com/DrTimothyAldenDavis/SuiteSparse">SuiteSparse</a>。</p>
<h2>Julia 标准库</h2><p>随 Julia 本体分发，许可同 Julia（MIT）：$(html_escape(join(stdlibs, "、")))。</p>""")
for group in unique(e.group for e in entries)
    println(io, "<h2>$(html_escape(group))</h2>")
    for e in entries
        e.group == group || continue
        tags = join(("<span class=\"tag\">$(t)</span>" for t in notable_tags(e.text)))
        println(io, "<details><summary>$(html_escape(e.name)) $(html_escape(e.version)) $(tags)</summary>",
            "<p>源码：$(html_escape(e.source))</p><pre>$(html_escape(e.text))</pre></details>")
    end
end
println(io, "</body></html>")

mkpath(dirname(OUT))
write(OUT, take!(io))
flagged = count(!isempty(t) for (_, t) in notable)
@info "许可清单已生成" OUT entries = length(entries) flagged stdlibs = length(stdlibs)
