# J-Circuit - 交互式电路仿真编辑器

中文 | [English](./README.en.md)

一个基于浏览器的电路仿真编辑器，支持常见电路分析方法、瞬态仿真、开关多场景预计算与结果快速切换、节点/元件电压覆盖显示以及支路电流可视化。

## 主要特性

- 电路编辑器：拖拽元件、严格端口连接、支持旋转与参数编辑
- 仿真方法：节点电压法、支路电流法、网孔电流法、戴维南等效、瞬态分析
- 开关元件：自动预计算“闭合/断开”两种状态，点击开关即可零延迟切换显示
- 结果面板：显示结果表格/波形，支持导出 `JSON`/`CSV`
- 电压显示模式：支持“节点电压”与“元件电压”两种覆盖模式
- 支路电流显示：可在顶栏切换是否在电路图上显示各支路电流
- 快捷键：`Ctrl+R` 运行仿真，`Ctrl+Shift+R` 显示/隐藏结果面板

## 技术栈

- 前端：`React 19`、`TypeScript`、`Vite`、`@xyflow/react`、`framer-motion`、`react-plotly.js`
- 后端：`Julia`（JCircuitServer），HTTP 接口提供仿真服务

## 快速开始（Windows）

1. 安装依赖
   - 安装 Node.js（≥ 18）
   - 安装 Julia（≥ 1.9）
2. 启动后端（根目录）
   ```powershell
   julia --project=server server/start_server.jl
   ```
3. 启动前端（`web` 目录）
   ```powershell
   npm install
   npm run dev
   ```
4. 打开编辑器
   - 浏览器访问 `http://localhost:3000/editor`

## 环境变量

- `VITE_API_BASE_URL`：后端服务地址，缺省为 `http://localhost:8080`

## 使用说明

- 画布编辑：从左侧组件面板拖拽元件到画布，按端口提示连接，添加 `ground` 后可运行
- 顶栏设置：
  - 分析方法选择（节点电压/支路电流/网孔电流/戴维南/瞬态）
  - 瞬态参数设置：`时间 tStop`、`采样点数 nSamples`
  - 电压显示模式：`node` 或 `element`
  - 支路电流显示切换：显示/隐藏普通元件上的支路电流
- 开关交互：首次仿真会预计算所有开关状态；点击开关即可从缓存切换显示，无需重新仿真
- 结果面板：根据方法显示相应结果，支持导出 `JSON`/`CSV`

## 目录结构（关键部分）

```
server/                      # Julia 仿真服务
web/
  ├── src/
  │   ├── workspace/         # 编辑器工作区与顶栏
  │   ├── simulation/        # 仿真请求、结果面板、映射与载荷构建
  │   ├── canvas/            # 画布节点、连线类型
  │   ├── circuit/           # 元件库与图标
  │   ├── pages/Editor.tsx   # 路由入口页（仅保留编辑器）
  │   ├── types/             # 类型定义
  │   └── utils/             # 工具函数
  ├── index.html             # 前端入口
  ├── package.json           # 前端依赖与脚本
  └── vite.config.ts         # Vite 配置
```

## 常见问题

- 后端未就绪：主页健康检查/指标请求报错可忽略，待后端启动后刷新即可
- 浏览器扩展触发的跨域请求报错（如 `h.trace.qq.com`）：与本项目无关，可忽略
- 字体 CDN 加载超时：不影响功能，可忽略或换用本地字体

## 构建与预览

```powershell
npm run build
npm run preview
```

## 维护说明

- 已移除登录/注册/营销页面与测试文件，聚焦编辑器与仿真功能
- 路由仅保留 `"/editor"`，`"/"` 重定向到编辑器页

## 许可证与贡献

- 许可证：Apache License 2.0（见仓库根目录 `LICENSE`）
- 欢迎提交 Issue 和 Pull Request
