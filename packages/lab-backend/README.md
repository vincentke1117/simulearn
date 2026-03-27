# JCircuitServer

`JCircuitServer` 是 J-Circuit 的 Julia 仿真后端，提供统一的 `POST /simulate` 接口，并按 payload 类型分流为：

- `kind = "circuit"`（默认）: 电路网络仿真/解析
- `kind = "control"`: 控制系统信号流仿真（Phase 1）

## 当前能力

### 电路分支（circuit）

- 支持瞬态分析、节点电压法、支路电流法、网孔电流法、戴维南等效
- 使用 ModelingToolkit + DifferentialEquations 建模与求解
- 返回统一响应：`{status, message, data}`

### 控制分支（control，Phase 1）

支持控制块：

- `control_step`
- `control_constant`
- `control_sum`
- `control_gain`
- `control_integrator`
- `control_plant_1st`
- `control_pid`
- `control_scope`

主要规则：

- 仅支持控制图（不支持 control/circuit 混合联立）
- 每个必填输入端口必须且只能有 1 条输入线
- 至少声明 1 个 `control_scope` 输出
- 纯代数环会被拒绝（错误消息包含“代数环”）
- 返回结果格式沿用 `time + signals`

## 运行

```bash
# 安装依赖
julia --project=server -e 'using Pkg; Pkg.instantiate()'

# 运行测试
julia --project=server -e 'using Pkg; Pkg.test()'

# 启动服务（默认 0.0.0.0:8080）
julia --project=server -e 'using JCircuitServer; bootstrap()'
```

## 示例：控制 payload

```json
{
  "kind": "control",
  "blocks": [
    { "id": "STEP1", "type": "control_step", "parameters": { "amplitude": 1, "offset": 0, "startTime": 0 } },
    { "id": "K1", "type": "control_gain", "parameters": { "gain": 2 } },
    { "id": "P1", "type": "control_plant_1st", "parameters": { "gain": 1, "timeConstant": 0.2, "initialValue": 0 } },
    { "id": "SCOPE1", "type": "control_scope", "parameters": {} }
  ],
  "edges": [
    { "id": "e1", "source": "STEP1", "target": "K1", "sourceHandle": "out", "targetHandle": "in" },
    { "id": "e2", "source": "K1", "target": "P1", "sourceHandle": "out", "targetHandle": "in" },
    { "id": "e3", "source": "P1", "target": "SCOPE1", "sourceHandle": "out", "targetHandle": "in" }
  ],
  "outputs": [
    { "id": "scope:SCOPE1", "blockId": "SCOPE1", "handle": "in", "label": "Scope SCOPE1" }
  ],
  "sim": { "t_stop": 2.0, "n_samples": 200 }
}
```

