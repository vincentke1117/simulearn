#!/usr/bin/env julia
#
# 配电网内核的开发态服务。路由、令牌校验、静态页面都在 JGDO（src/server.jl），
# 与打包后的拓展入口 bin/simulearn-grid.exe 共用同一份实现。
# 用法：julia --project=packages/grid-backend packages/grid-backend/scripts/serve.jl
#   JGDO_HOST / JGDO_PORT 覆盖监听地址（默认 127.0.0.1:8123）；
#   SIMULEARN_TOKEN 是请求必须携带的 X-Zhifan-Ext-Token（未设置时用开发令牌 simulearn-dev）。

using JGDO

JGDO.serve_dev()
