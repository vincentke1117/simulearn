import { Typography, Card, Row, Col, Button, Tag } from 'antd'
import MainLayout from '@components/layout/MainLayout'
import { useProjects } from '@features/education/projects.query'
import { useNavigate } from 'react-router-dom'

export default function Favorites() {
  const { data = [], isLoading } = useProjects()
  const navigate = useNavigate()
  const favs = (() => { try { return JSON.parse(localStorage.getItem('favorites:projects')||'[]') as string[] } catch { return [] } })()
  const list = data.filter(p => favs.includes(p.id))
  return (
    <MainLayout>
      <Typography.Title level={3}>我的收藏</Typography.Title>
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
        {!isLoading && list.length === 0 && <Col span={24}><Card>暂无收藏项目</Card></Col>}
      </Row>
    </MainLayout>
  )
}
