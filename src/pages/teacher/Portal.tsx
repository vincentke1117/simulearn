import { Typography, Card, Row, Col } from 'antd'
import MainLayout from '@components/layout/MainLayout'

export default function TeacherPortal() {
  return (
    <MainLayout>
      <Typography.Title level={3}>教师门户（占位）</Typography.Title>
      <Row gutter={[24,24]}>
        <Col xs={24} md={12}>
          <Card title="课程管理">课程与作业的管理入口（前端占位）。</Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="学生进度">查看学生学习进度与结果（前端占位）。</Card>
        </Col>
      </Row>
    </MainLayout>
  )
}
