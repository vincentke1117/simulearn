import { useEffect, useState } from 'react'
import { Typography, Button, Card, List, Checkbox, Progress, Tag, Space, Tooltip, Badge } from 'antd'
import { PlayCircleOutlined, SaveOutlined, ReloadOutlined, QuestionCircleOutlined, CheckCircleOutlined, ClockCircleOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import { useParams } from 'react-router-dom'
import MainLayout from '@components/layout/MainLayout'
import { CircuitWorkspace } from '@lab/workspace/CircuitWorkspace'

interface Task {
  id: string
  title: string
  description: string
  completed: boolean
  estimatedTime: number
  difficulty: 'easy' | 'medium' | 'hard'
}

export default function ProjectWorkspace() {
  const { projectId } = useParams()
  const storageKey = `workspace:${projectId}`
  const [tasks, setTasks] = useState<Task[]>([
    { id: '1', title: '创建系统模型', description: '使用Simulink创建基本的控制系统模型', completed: true, estimatedTime: 15, difficulty: 'easy' },
    { id: '2', title: '添加传感器组件', description: '为系统添加温度传感器和反馈回路', completed: false, estimatedTime: 20, difficulty: 'medium' },
    { id: '3', title: '配置仿真参数', description: '设置仿真时间、步长和求解器类型', completed: false, estimatedTime: 10, difficulty: 'easy' },
    { id: '4', title: '运行仿真分析', description: '执行仿真并分析系统响应', completed: false, estimatedTime: 25, difficulty: 'hard' }
  ])
  const [simulationStatus, setSimulationStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle')
  const [simulationProgress, setSimulationProgress] = useState(0)
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true)
  const [hints, setHints] = useState<string[]>([])
  const [leftPanelOpen, setLeftPanelOpen] = useState(true)
  const [rightPanelOpen, setRightPanelOpen] = useState(false)

  const addTaskFromHint = () => {
    const label = '检查仿真结果并调优参数'
    setTasks(prev => {
      if (prev.some(t => t.title === label)) return prev
      return [...prev, { id: String(prev.length + 1), title: label, description: '依据响应曲线调整PID等参数', completed: false, estimatedTime: 20, difficulty: 'medium' }]
    })
  }

  useEffect(() => {
    try {
      const s = localStorage.getItem('settings')
      if (s) {
        const obj = JSON.parse(s)
        if (typeof obj.autoSave === 'boolean') setAutoSaveEnabled(obj.autoSave)
      }
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const data = JSON.parse(saved)
        if (Array.isArray(data.tasks)) setTasks(data.tasks)
        if (data.simulationStatus) setSimulationStatus(data.simulationStatus)
        if (typeof data.simulationProgress === 'number') setSimulationProgress(data.simulationProgress)
      }
    } catch {}
  }, [storageKey])

  useEffect(() => {
    if (!autoSaveEnabled) return
    try {
      localStorage.setItem(storageKey, JSON.stringify({ tasks, simulationStatus, simulationProgress, savedAt: Date.now() }))
    } catch {}
  }, [tasks, simulationStatus, simulationProgress, autoSaveEnabled, storageKey])

  useEffect(() => {
    const hs: string[] = []
    const done = tasks.filter(t => t.completed).map(t => t.id)
    if (!done.includes('3')) hs.push('请检查并配置仿真参数')
    if (!done.includes('2')) hs.push('添加必要的传感器组件')
    if (simulationStatus === 'idle') hs.push('完成基本任务后可运行仿真')
    if (simulationStatus === 'completed') hs.push('查看结果页并分析响应曲线')
    setHints(hs)
  }, [tasks, simulationStatus])

  const toggleTask = (taskId: string) => {
    setTasks(prev => prev.map(task =>
      task.id === taskId ? { ...task, completed: !task.completed } : task
    ))
  }

  const completedTasks = tasks.filter(task => task.completed).length
  const totalTasks = tasks.length
  const progressPercentage = (completedTasks / totalTasks) * 100

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'easy': return 'green'
      case 'medium': return 'orange'
      case 'hard': return 'red'
      default: return 'default'
    }
  }

  const runSimulation = async () => {
    setSimulationStatus('running')
    setSimulationProgress(0)
    const interval = setInterval(() => {
      setSimulationProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval)
          setSimulationStatus('completed')
          try {
            const resultKey = `results:${projectId}`
            const completedTasksCount = tasks.filter(t => t.completed).length
            const accuracy = Math.round((completedTasksCount / tasks.length) * 100)
            localStorage.setItem(resultKey, JSON.stringify({ completedAt: new Date().toISOString(), completedTasks: completedTasksCount, totalTasks: tasks.length, accuracy, simulationStatus: 'completed' }))
          } catch {}
          return 100
        }
        return prev + 10
      })
    }, 500)
  }

  const resetWorkspace = () => {
    setTasks(prev => prev.map(task => ({ ...task, completed: false })))
    setSimulationStatus('idle')
    setSimulationProgress(0)
    try {
      localStorage.removeItem(`results:${projectId}`)
      localStorage.setItem(storageKey, JSON.stringify({ tasks, simulationStatus: 'idle', simulationProgress: 0, savedAt: Date.now() }))
    } catch {}
  }

  return (
    <MainLayout>
      {/* 紧凑工具栏 */}
      <div className="!bg-slate-800 !px-4 !py-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="!text-slate-200 !text-sm font-medium">项目 #{projectId}</span>
          <div className="flex items-center gap-2">
            {simulationStatus === 'idle' && <Badge status="default" text={<span className="text-slate-400 text-xs">待运行</span>} />}
            {simulationStatus === 'running' && <Badge status="processing" text={<span className="text-blue-400 text-xs">运行中</span>} />}
            {simulationStatus === 'completed' && <Badge status="success" text={<span className="text-green-400 text-xs">已完成</span>} />}
            {simulationStatus === 'error' && <Badge status="error" text={<span className="text-red-400 text-xs">错误</span>} />}
          </div>
          <Progress percent={progressPercentage} size="small" className="!w-24 !m-0" />
          <span className="!text-slate-400 !text-xs">
            {completedTasks}/{totalTasks} 任务
          </span>
        </div>
        <Space size="small">
          <Button size="small" icon={<MenuFoldOutlined />} onClick={() => setLeftPanelOpen(!leftPanelOpen)} className={leftPanelOpen ? '!bg-slate-700 !border-slate-600 !text-slate-300' : ''} />
          <Button size="small" icon={<SaveOutlined />} onClick={() => { try { localStorage.setItem(storageKey, JSON.stringify({ tasks, simulationStatus, simulationProgress, savedAt: Date.now() })) } catch {} }}>保存</Button>
          <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={runSimulation} loading={simulationStatus === 'running'}>仿真</Button>
          <Button size="small" icon={<ReloadOutlined />} onClick={resetWorkspace}>重置</Button>
          <Button size="small" icon={<MenuUnfoldOutlined />} onClick={() => setRightPanelOpen(!rightPanelOpen)} className={rightPanelOpen ? '!bg-slate-700 !border-slate-600 !text-slate-300' : ''} />
        </Space>
      </div>

      {/* 主工作区 */}
      <div className="flex" style={{ height: 'calc(100vh - 80px)' }}>
        {/* 左侧任务面板 - 可折叠 */}
        <div className={`transition-all duration-300 ${leftPanelOpen ? 'w-64' : 'w-0'} overflow-hidden flex-shrink-0`}>
          {leftPanelOpen && (
            <Card
              title={<span className="!text-sm">任务清单 <Tag className="!m-0" color="blue" size="small">{completedTasks}/{totalTasks}</Tag></span>}
              className="!h-full !rounded-none !bg-white"
              bodyStyle={{ flex: 1, overflow: 'auto', padding: 8 }}
            >
              <List
                dataSource={tasks}
                renderItem={task => (
                  <List.Item className="!px-1 !py-2 cursor-pointer hover:!bg-slate-50 rounded" onClick={() => toggleTask(task.id)}>
                    <div className="flex items-start gap-2 w-full">
                      <Checkbox checked={task.completed} onChange={() => toggleTask(task.id)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 flex-wrap">
                          <Typography.Text delete={task.completed} className={task.completed ? '!text-slate-400 !text-xs' : '!text-slate-700 !text-xs'}>{task.title}</Typography.Text>
                          <Tag className="!m-0" color={getDifficultyColor(task.difficulty)} size="small">{task.difficulty}</Tag>
                        </div>
                      </div>
                      {task.completed && <CheckCircleOutlined className="!text-green-500 text-xs" />}
                    </div>
                  </List.Item>
                )}
              />
            </Card>
          )}
        </div>

        {/* 中间编辑器 - 全高占用 */}
        <div className="flex-1 !bg-slate-800 overflow-hidden">
          <CircuitWorkspace />
        </div>

        {/* 右侧AI助手 - 可折叠 */}
        <div className={`transition-all duration-300 ${rightPanelOpen ? 'w-72' : 'w-0'} overflow-hidden flex-shrink-0`}>
          {rightPanelOpen && (
            <Card
              title={<span className="!text-sm">AI 助手</span>}
              className="!h-full !rounded-none !bg-white"
              bodyStyle={{ flex: 1, overflow: 'auto', padding: 8 }}
            >
              <div className="space-y-2">
                {hints.length > 0 && (
                  <div className="!bg-yellow-50 rounded p-2">
                    <Typography.Text className="!text-yellow-700 !text-xs font-medium">导师建议：</Typography.Text>
                    <ul className="!list-disc !pl-4 !mt-1 !m-0">
                      {hints.map((h, i) => (
                        <li key={i} className="!text-yellow-800 !text-xs">{h}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <Button block size="small">💡 建模建议</Button>
                <Button block size="small">🔧 组件指南</Button>
                <Button block size="small">📊 结果分析</Button>
                <Button block size="small" type="primary">💬 开始对话</Button>
                <Button block size="small" onClick={addTaskFromHint}>➕ 应用建议</Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </MainLayout>
  )
}
