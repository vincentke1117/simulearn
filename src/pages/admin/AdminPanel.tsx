import { Typography, Card, Row, Col, Tag } from 'antd'
import MainLayout from '@components/layout/MainLayout'

export default function AdminPanel() {
  return (
    <MainLayout>
      <Typography.Title level={3}>管理面板</Typography.Title>
      <Row gutter={[24,24]}>
        <Col xs={24} md={12}>
          <Card title="用户与角色" extra={<Tag color="red">占位</Tag>}>
            <div className="text-gray-600">用于配置用户与角色的管理入口（前端占位）。</div>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="系统统计" extra={<Tag color="blue">占位</Tag>}>
            <div className="text-gray-600">展示系统使用统计（基于本地数据聚合）。</div>
          </Card>
        </Col>
      </Row>
    </MainLayout>
  )
}
