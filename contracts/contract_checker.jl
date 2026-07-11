# Golden 契约检查器：双端（grid-backend / lab-backend）测试套共用。
# 契约文件格式（contracts/<domain>/*.json）：
#   { "name": "...", "endpoint": "...",
#     "request": {...} 或 "request_example": "<grid examples 文件名去后缀>",
#     "expect": [ {"path": "data.summary.loss_mw", "approx": 0.2027, "atol": 5e-4},
#                 {"path": "status", "equals": "ok"},
#                 {"path": "data.signals", "exists": true} ] }
# path 规则：`.` 分段；数组段用 1 起始下标，-1 表示末位。

using JSON3
using Test

function contract_get(obj, path::AbstractString)
    current = obj
    for segment in split(path, '.')
        if current isa AbstractVector || current isa JSON3.Array
            idx = parse(Int, segment)
            current = idx == -1 ? current[end] : current[idx]
        else
            key = Symbol(segment)
            haskey(current, key) || error("contract path 不存在: $(path)（缺 $(segment)）")
            current = current[key]
        end
    end
    return current
end

function check_contract(response, expects)
    for expectation in expects
        path = String(expectation[:path])
        if haskey(expectation, :exists)
            @test contract_get(response, path) !== nothing
        elseif haskey(expectation, :approx)
            value = Float64(contract_get(response, path))
            atol = Float64(get(expectation, :atol, 1e-6))
            @test isapprox(value, Float64(expectation[:approx]); atol)
        elseif haskey(expectation, :equals)
            value = contract_get(response, path)
            expected = expectation[:equals]
            @test string(value) == string(expected) || value == expected
        else
            error("契约期望必须含 equals/approx/exists 之一: $(path)")
        end
    end
end

function load_contracts(domain_dir::AbstractString)
    specs = []
    isdir(domain_dir) || return specs
    for file in sort(readdir(domain_dir))
        endswith(file, ".json") || continue
        push!(specs, JSON3.read(read(joinpath(domain_dir, file), String)))
    end
    return specs
end
