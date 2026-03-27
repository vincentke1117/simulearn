import { Form, Input, Button, Card, Typography, message } from 'antd'
import { MailOutlined } from '@ant-design/icons'
import MainLayout from '@components/layout/MainLayout'
import { useNavigate } from 'react-router-dom'

export default function ResetPassword() {
  const nav = useNavigate()
  const onFinish = async () => {
    message.success('重置邮件已发送（模拟）')
    nav('/auth/login')
  }
  return (
    <MainLayout>
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <Card className="w-full max-w-md shadow-xl" title={<div className="text-center text-xl font-semibold">重置密码</div>}>
          <Form layout="vertical" onFinish={onFinish} size="large">
            <Form.Item name="email" rules={[{ required: true }]}> 
              <Input prefix={<MailOutlined />} placeholder="邮箱" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large">发送重置邮件</Button>
          </Form>
        </Card>
      </div>
    </MainLayout>
  )
}
