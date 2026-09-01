# JCircuitServer

`JCircuitServer` 是 J-Circuit 的 Julia 仿真后端，提供统一的 `POST /simulate` 接口，并按 payload 类型分流为：

- `kind = "circuit"`（默认）: 电路网络仿真/解析
- `kind = "control"`: 控制系统信号流仿真（Phase 1）
- `kind = "mixed"`: 控制信号与电阻电路的准静态耦合仿真

## 当前能力

### 电路分支（circuit）

- 支持瞬态分析、节点电压法、支路电流法、网孔电流法、戴维南等效
- 使用 ModelingToolkit + DifferentialEquations 建模与求解
- 返回统一响应：`{status, message, data}`

### 控制与混合分支

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

- `kind = "control"` 仅接受纯控制图；控制/电路耦合图使用 `kind = "mixed"`
- 混合仿真通过传感器与受控源桥接控制块和纯电阻电路；电感、电容等动态电路元件暂不参与
- 每个必填输入端口必须且只能有 1 条输入线
- 至少声明 1 个 `control_scope` 输出
- 纯代数环会被拒绝（错误消息包含“代数环”）
- 返回结果格式沿用 `time + signals`

## 运行

```bash
# 安装依赖
julia --project=. -e 'using Pkg; Pkg.instantiate()'

# 运行测试
julia --project=. -e 'using Pkg; Pkg.test()'

# 启动服务（默认 127.0.0.1:8080）
julia --project=. run_server.jl
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
