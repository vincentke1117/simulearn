import { useState } from 'react'
import { Typography, Card, Input, Tag, Row, Col, List, Button } from 'antd'
import MainLayout from '@components/layout/MainLayout'

const mockPosts = [
  { id: 'p1', title: '温度控制系统仿真技巧', summary: '分享一些在Simulink中进行温度控制仿真的小技巧', tags: ['控制系统','仿真'], likes: 128 },
  { id: 'p2', title: 'BMS建模最佳实践', summary: '新能源汽车BMS模型的模块选择与参数设置', tags: ['新能源汽车','BMS'], likes: 203 },
  { id: 'p3', title: '通信系统链路级仿真', summary: '5G系统的链路级仿真流程与常见坑位', tags: ['通信','5G'], likes: 156 }
]

const mockResources = [
  { id: 'r1', title: 'Simulink基础速查', type: '文档', link: '#' },
  { id: 'r2', title: 'PID调优指南', type: '视频', link: '#' },
  { id: 'r3', title: '信号处理模块图谱', type: '图谱', link: '#' }
]

export default function CommunityExplore() {
  const [kw, setKw] = useState('')
  const filtered = mockPosts.filter(p => p.title.includes(kw) || p.summary.includes(kw))
  
  return (
    <MainLayout>
      <Typography.Title level={3}>社区探索</Typography.Title>
      <Card>
        <Input.Search value={kw} onChange={e => setKw(e.target.value)} placeholder="搜索帖子或资源" allowClear />
        <div className="mt-4 flex gap-2">
          <Tag color="blue">控制系统</Tag>
          <Tag color="green">新能源汽车</Tag>
          <Tag color="orange">通信</Tag>
          <Tag>仿真</Tag>
        </div>
      </Card>
      <Row gutter={[24,24]} className="mt-4">
        <Col xs={24} lg={16}>
          <Card title="热门帖子">
            <List
              dataSource={filtered}
              renderItem={item => (
                <List.Item>
                  <div className="w-full">
                    <Typography.Title level={4}>{item.title}</Typography.Title>
                    <Typography.Paragraph type="secondary">{item.summary}</Typography.Paragraph>
                    <div className="flex items-center gap-2">
                      {item.tags.map(t => <Tag key={t}>{t}</Tag>)}
                      <Tag color="gold">赞 {item.likes}</Tag>
                    </div>
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="精选资源">
            <List
              dataSource={mockResources}
              renderItem={r => (
                <List.Item>
                  <div className="w-full">
                    <div className="flex items-center justify-between">
                      <div>
                        <Typography.Text strong>{r.title}</Typography.Text>
                        <div className="text-sm text-gray-500">{r.type}</div>
                      </div>
                      <Button type="link" href={r.link}>查看</Button>
                    </div>
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </MainLayout>
  )
}
