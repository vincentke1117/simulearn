import { useParams, Link } from 'react-router-dom'
import { Typography, Button, Card, Steps, Tag, Space, Spin, message, Checkbox, Progress } from 'antd'
import { useEffect, useState } from 'react'
import { CheckCircleOutlined, HeartOutlined, ShareAltOutlined } from '@ant-design/icons'
import MainLayout from '@components/layout/MainLayout'
import { useProject } from '@features/education/projects.query'

export default function ProjectDetail() {
  const { projectId } = useParams()
  const { data: project, isLoading } = useProject(projectId!)
  const [prereqState, setPrereqState] = useState<boolean[]>([])
  const [allDone, setAllDone] = useState(false)
  const storageKey = `prereq:${projectId}`

  // All hooks MUST be called before any early returns
  useEffect(() => {
    if (!project) return
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const arr = JSON.parse(saved)
        if (Array.isArray(arr) && arr.length === project.prerequisites.length) {
          setPrereqState(arr)
        } else {
          setPrereqState(project.prerequisites.map(() => false))
        }
      } else {
        setPrereqState(project.prerequisites.map(() => false))
      }
    } catch {
      setPrereqState(project.prerequisites.map(() => false))
    }
  }, [storageKey, project])

  useEffect(() => {
    const done = prereqState.filter(Boolean).length
    setAllDone(project ? done === project.prerequisites.length : false)
    try { localStorage.setItem(storageKey, JSON.stringify(prereqState)) } catch {}
  }, [prereqState, project])

  if (isLoading || !project) return (
    <MainLayout>
      <div className="flex justify-center py-12"><Spin size="large" /></div>
    </MainLayout>
  )

  const completedCount = prereqState.filter(Boolean).length
  const progressPercent = Math.round((completedCount / project.prerequisites.length) * 100)

  const steps = [
    { title: '阅读项目说明', status: 'finish' },
    { title: '完成前置知识', status: allDone ? 'finish' : 'process' },
    { title: '开始建模', status: allDone ? 'process' : 'wait' },
    { title: '运行仿真', status: 'wait' },
    { title: '查看结果', status: 'wait' }
  ]
  const currentStep = allDone ? 2 : 1

  return (
    <MainLayout>
      <div className="mb-4 flex items-center justify-between">
        <Link to="/education/projects" className="text-blue-600">返回列表</Link>
        <Space>
          <Button icon={<HeartOutlined />}>收藏</Button>
          <Button icon={<ShareAltOutlined />}>分享</Button>
        </Space>
      </div>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <Typography.Title level={2}>{project.title}</Typography.Title>
          <Space>
            <Tag color="blue">{project.industry}</Tag>
            <Tag color="green">{project.difficulty}</Tag>
          </Space>
        </div>
        <Steps items={steps} current={currentStep} />
      </Card>

      <Card title="项目描述" className="mt-4">
        <p className="text-gray-700">{project.description}</p>
      </Card>

      <Card title="学习目标" className="mt-4">
        <ul className="list-disc pl-5 text-gray-700">
          {project.objectives.map((o, i) => <li key={i}>{o}</li>)}
        </ul>
      </Card>

      <Card title="前置知识" className="mt-4">
        <div className="mb-3">
          <Progress percent={progressPercent} size="small" />
        </div>
        <div className="space-y-2">
          {project.prerequisites.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <Checkbox 
                checked={!!prereqState[i]}
                onChange={(e) => {
                  const next = [...prereqState]
                  next[i] = e.target.checked
                  setPrereqState(next)
                }}
              />
              <Typography.Text>{p}</Typography.Text>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-6 text-center">
        <Link to={`/education/projects/${projectId}/workspace`}>
          <Button
            type="primary"
            size="large"
            icon={<CheckCircleOutlined />}
            disabled={!allDone}
            onClick={() => {
              try {
                localStorage.setItem(`projectStarted:${projectId}`, 'true')
                message.success('已开始项目，进入工作区')
              } catch {}
            }}
          >开始项目</Button>
        </Link>
      </div>
    </MainLayout>
  )
}
