import { useState, useMemo } from 'react'
import { Typography, Card, Row, Col, Select, Progress, List, Button, Tag, message } from 'antd'
import MainLayout from '@components/layout/MainLayout'

type Scenario = { id: string; title: string; steps: string[] }

export default function FaultDebug() {
  const scenarios: Scenario[] = [
    { id: 'overshoot', title: '温度控制系统超调过高', steps: ['检查PID参数比例项', '减小积分增益或增加微分', '调整仿真步长与求解器', '重新运行仿真并观察响应'] },
    { id: 'sensor-noise', title: '传感器噪声过大', steps: ['添加滤波模块', '优化传感器采样频率', '检查信号路由与量程', '重新运行仿真进行验证'] },
    { id: 'unstable-pid', title: 'PID参数导致不稳定', steps: ['重置参数为初始值', '采用Ziegler-Nichols初始估计', '逐步微调并记录结果', '最终确认稳定区间'] }
  ]
  const [sid, setSid] = useState<string>('overshoot')
  const s = useMemo(() => scenarios.find(x => x.id === sid)!, [sid])
  const [done, setDone] = useState<boolean[]>(s.steps.map(() => false))
  const progress = Math.round((done.filter(Boolean).length / s.steps.length) * 100)

  const runDiagnostic = () => {
    if (progress < 50) message.warning('诊断结果：建议先完成更多步骤再评估')
    else if (progress < 100) message.info('诊断结果：问题有所改善，建议继续优化参数')
    else message.success('诊断结果：问题已基本解决')
  }

  const applyFixToWorkspace = () => {
    try {
      let latest: string | null = null
      let latestTime = 0
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || ''
        if (key.startsWith('workspace:')) {
          const val = localStorage.getItem(key)
          if (!val) continue
          const obj = JSON.parse(val)
          const t = obj.savedAt || 0
          if (t >= latestTime) { latestTime = t; latest = key }
        }
      }
      if (!latest) return
      const val = localStorage.getItem(latest)
      if (!val) return
      const obj = JSON.parse(val)
      const label = `故障调试-${s.title}`
      if (Array.isArray(obj.tasks) && !obj.tasks.some((t: any) => t.title === label)) {
        obj.tasks.push({ id: String(obj.tasks.length + 1), title: label, description: '依据训练步骤完成调试', completed: false, estimatedTime: 20, difficulty: 'medium' })
        obj.savedAt = Date.now()
        localStorage.setItem(latest, JSON.stringify(obj))
        message.success('已将调试建议添加至最近的工作区任务')
      }
    } catch {}
  }

  return (
    <MainLayout>
      <Typography.Title level={3}>故障调试训练</Typography.Title>
      <Row gutter={[24,24]}>
        <Col xs={24} md={8}>
          <Card>
            <Select 
              value={sid}
              onChange={v => { setSid(v); setDone(scenarios.find(x => x.id === v)!.steps.map(() => false)) }}
              options={scenarios.map(x => ({ value: x.id, label: x.title }))}
              style={{ width: '100%' }}
            />
            <div className="mt-3"><Progress percent={progress} size="small" /></div>
            <div className="mt-2 flex gap-2">
              <Button onClick={runDiagnostic}>运行诊断</Button>
              <Button type="primary" onClick={applyFixToWorkspace}>应用到工作区</Button>
            </div>
          </Card>
        </Col>
        <Col xs={24} md={16}>
          <Card title={s.title}>
            <List
              dataSource={s.steps}
              renderItem={(step, i) => (
                <List.Item>
                  <div className="flex items-center justify-between w-full">
                    <span>{step}</span>
                    <Button size="small" onClick={() => {
                      const next = [...done]; next[i] = !next[i]; setDone(next)
                    }}>{done[i] ? '撤销' : '完成'}</Button>
                  </div>
                </List.Item>
              )}
            />
            <div className="mt-3">
              <Tag color={progress === 100 ? 'green' : progress >= 50 ? 'blue' : 'default'}>进度 {progress}%</Tag>
            </div>
          </Card>
        </Col>
      </Row>
    </MainLayout>
  )
}
