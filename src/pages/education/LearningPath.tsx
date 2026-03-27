import { Typography, Card, Row, Col, Tag, Button, Progress } from 'antd'
import MainLayout from '@components/layout/MainLayout'
import { useNavigate } from 'react-router-dom'

export default function LearningPath() {
  const nav = useNavigate()
  const startedIds = (() => {
    const ids: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || ''
      if (key.startsWith('projectStarted:')) ids.push(key.replace('projectStarted:', ''))
    }
    return ids
  })()
  const paths = [
    { id: 'p-basic', title: '基础入门路径', desc: '从Simulink基础到简单控制系统建模', steps: 5, recommend: true, match: (id: string) => ['1'].includes(id) },
    { id: 'p-ev', title: '新能源汽车BMS路径', desc: '电池管理系统建模与仿真分析', steps: 6, match: (id: string) => ['1'].includes(id) },
    { id: 'p-5g', title: '通信系统路径', desc: '5G链路级仿真与性能评估', steps: 6, match: (id: string) => ['2'].includes(id) }
  ]
  return (
    <MainLayout>
      <Typography.Title level={3}>学习路径</Typography.Title>
      {startedIds.length === 0 && (
        <Card className="mb-4">
          <div className="flex items-center justify-between">
            <Typography.Text type="secondary">尚未开始任何项目，先从项目列表选择一个项目以开启路径进度。</Typography.Text>
            <Button type="primary" onClick={() => nav('/education/projects')}>去项目列表</Button>
          </div>
        </Card>
      )}
      <Row gutter={[24,24]}>
        {paths.map(p => (
          <Col xs={24} md={12} lg={8} key={p.id}>
            <Card hoverable actions={[<Button type="link" onClick={() => nav('/education/projects')}>开始学习</Button>]}> 
              <div className="flex items-center justify-between mb-2">
                <Typography.Title level={4}>{p.title}</Typography.Title>
                {p.recommend && <Tag color="green">推荐</Tag>}
              </div>
              <Typography.Paragraph type="secondary">{p.desc}</Typography.Paragraph>
              <Tag>{p.steps} 步</Tag>
              <div className="mt-3">
                {(() => {
                  const completed = startedIds.filter(id => p.match(id)).length
                  const percent = Math.min(100, Math.round((completed / p.steps) * 100))
                  return <Progress percent={percent} size="small" />
                })()}
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </MainLayout>
  )
}
