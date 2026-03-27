import { Typography, Card, Row, Col, Button, Tag, Segmented } from 'antd'
import { useState } from 'react'
import MainLayout from '@components/layout/MainLayout'
import { useProjects } from '@features/education/projects.query'
import { useNavigate } from 'react-router-dom'

export default function MyProjects() {
  const { data = [], isLoading } = useProjects()
  const navigate = useNavigate()
  const [view, setView] = useState<'all' | 'favorites'>('all')
  const favs = (() => {
    try { return JSON.parse(localStorage.getItem('favorites:projects')||'[]') as string[] } catch { return [] }
  })()
  const list = view === 'favorites' ? data.filter(p => favs.includes(p.id)) : data
  
  return (
    <MainLayout>
      <Typography.Title level={3}>我的项目</Typography.Title>
      <Card className="mb-4">
        <Segmented options={[{label:'全部', value:'all'}, {label:'收藏', value:'favorites'}]} value={view} onChange={v => setView(v as any)} />
      </Card>
      <Row gutter={[24,24]}>
        {isLoading && <Col span={24}><Card>加载中...</Card></Col>}
        {!isLoading && list.map(p => (
          <Col xs={24} md={12} lg={8} key={p.id}>
            <Card hoverable cover={<img src={p.cover} alt={p.title} />}
              actions={[
                <Button type="link" onClick={() => navigate(`/education/projects/${p.id}`)}>查看详情</Button>,
                <Button type="link" onClick={() => navigate(`/education/projects/${p.id}/workspace`)}>进入工作区</Button>,
                <Button type="link" onClick={() => navigate(`/education/projects/${p.id}/results`)}>查看结果</Button>
              ]}
            >
              <Typography.Title level={5}>{p.title}</Typography.Title>
              <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }}>{p.description}</Typography.Paragraph>
              <div className="flex items-center gap-2">
                <Tag color="blue">{p.industry}</Tag>
                <Tag>{p.duration} 分钟</Tag>
                <Tag color="gold">评分 {p.rating}</Tag>
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </MainLayout>
  )
}
