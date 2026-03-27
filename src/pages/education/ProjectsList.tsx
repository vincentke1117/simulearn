import { Card, Input, Select, Row, Col, Tag, Button, Space, Spin } from 'antd'
import { useState } from 'react'
import { ClockCircleOutlined, StarOutlined, HeartOutlined } from '@ant-design/icons'
import MainLayout from '@components/layout/MainLayout'
import { useProjects } from '@features/education/projects.query'
import { Link } from 'react-router-dom'

export default function ProjectsList() {
  const [difficulty, setDifficulty] = useState<string | undefined>()
  const [industry, setIndustry] = useState<string | undefined>()
  const [search, setSearch] = useState<string>('')
  const { data: projects, isLoading } = useProjects({ difficulty, industry, search })

  if (isLoading) return (
    <MainLayout>
      <div className="flex justify-center py-12"><Spin size="large" /></div>
    </MainLayout>
  )

  return (
    <MainLayout>
      <div className="flex gap-3 mb-4">
        <Select 
          allowClear 
          placeholder="难度" 
          style={{ width: 140 }} 
          options={[{ value: 'beginner', label: '入门' }, { value: 'intermediate', label: '中级' }, { value: 'advanced', label: '高级' }]}
          value={difficulty}
          onChange={v => setDifficulty(v)}
        />
        <Select 
          allowClear
          placeholder="行业" 
          style={{ width: 160 }} 
          options={[{ value: '新能源汽车', label: '新能源汽车' }, { value: '通信', label: '通信' }, { value: '航空航天', label: '航空航天' }]}
          value={industry}
          onChange={v => setIndustry(v)}
        />
        <Input.Search 
          placeholder="搜索项目" 
          style={{ maxWidth: 300 }} 
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <Row gutter={[24, 24]}>
        {projects?.map(p => (
          <Col key={p.id} xs={24} md={12} lg={8}>
            <Card
              hoverable
              cover={<img alt="cover" src={p.cover} className="h-40 object-cover" />}
              actions={[
                <Button 
                  type="text" 
                  icon={<HeartOutlined style={{ color: (JSON.parse(localStorage.getItem('favorites:projects')||'[]') as string[]).includes(p.id) ? 'red' : undefined }} />}
                  onClick={() => {
                    try {
                      const favs = JSON.parse(localStorage.getItem('favorites:projects')||'[]') as string[]
                      const next = favs.includes(p.id) ? favs.filter(id => id !== p.id) : [...favs, p.id]
                      localStorage.setItem('favorites:projects', JSON.stringify(next))
                    } catch {}
                  }}
                >收藏</Button>,
                <Link to={`/education/projects/${p.id}`}><Button type="primary">查看</Button></Link>
              ]}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold">{p.title}</span>
                <Space>
                  <Tag color="blue">{p.industry}</Tag>
                  <Tag color="green">{p.difficulty}</Tag>
                </Space>
              </div>
              <p className="text-gray-600 mb-2">{p.description}</p>
              <div className="flex items-center text-gray-500 text-sm">
                <ClockCircleOutlined className="mr-1" /> {p.duration}分钟
                <StarOutlined className="ml-3 mr-1" /> {p.rating}
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </MainLayout>
  )
}
