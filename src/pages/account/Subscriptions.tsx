import { Typography, Card, Row, Col, Button, Tag } from 'antd'
import MainLayout from '@components/layout/MainLayout'
import { useState, useEffect } from 'react'

export default function Subscriptions() {
  const [plan, setPlan] = useState<string>('basic')
  useEffect(() => {
    const saved = localStorage.getItem('plan')
    if (saved) setPlan(saved)
  }, [])
  const choose = (p: string) => {
    setPlan(p)
    localStorage.setItem('plan', p)
  }
  
  return (
    <MainLayout>
      <Typography.Title level={3}>订阅管理</Typography.Title>
      <Row gutter={[24,24]}>
        <Col xs={24} md={8}>
          <Card title="Basic" extra={plan==='basic' && <Tag color="green">当前</Tag>}>
            <Typography.Paragraph>适合入门学习者</Typography.Paragraph>
            <Typography.Title level={4}>￥0/月</Typography.Title>
            <Button type={plan==='basic'?'default':'primary'} onClick={() => choose('basic')}>选择</Button>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="Pro" extra={plan==='pro' && <Tag color="green">当前</Tag>}>
            <Typography.Paragraph>包含高级项目与AI助手</Typography.Paragraph>
            <Typography.Title level={4}>￥49/月</Typography.Title>
            <Button type={plan==='pro'?'default':'primary'} onClick={() => choose('pro')}>选择</Button>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="Enterprise" extra={plan==='enterprise' && <Tag color="green">当前</Tag>}>
            <Typography.Paragraph>团队与企业服务</Typography.Paragraph>
            <Typography.Title level={4}>￥199/月</Typography.Title>
            <Button type={plan==='enterprise'?'default':'primary'} onClick={() => choose('enterprise')}>选择</Button>
          </Card>
        </Col>
      </Row>
    </MainLayout>
  )
}
