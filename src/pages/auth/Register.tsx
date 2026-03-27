import { Form, Input, Button, Card, Typography, message } from 'antd'
import { UserOutlined, MailOutlined, LockOutlined } from '@ant-design/icons'
import MainLayout from '@components/layout/MainLayout'
import { register } from '@services/auth.api'
import { setAuth } from '@store/index'
import { useAppDispatch } from '@store/hooks'
import { useNavigate } from 'react-router-dom'

export default function Register() {
  const dispatch = useAppDispatch()
  const nav = useNavigate()
  const onFinish = async (values: any) => {
    try {
      const res = await register(values)
      dispatch(setAuth(res))
      message.success('注册成功')
      nav('/dashboard')
    } catch (e: any) {
      message.error(e.message || '注册失败')
    }
  }
  return (
    <MainLayout>
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <Card className="w-full max-w-md shadow-xl" title={<div className="text-center text-xl font-semibold">注册</div>}>
          <Form layout="vertical" onFinish={onFinish} size="large">
            <Form.Item name="username" rules={[{ required: true }]}> 
              <Input prefix={<UserOutlined />} placeholder="用户名" />
            </Form.Item>
            <Form.Item name="email" rules={[{ required: true }]}> 
              <Input prefix={<MailOutlined />} placeholder="邮箱" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true }]}> 
              <Input.Password prefix={<LockOutlined />} placeholder="密码" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large">创建账户</Button>
          </Form>
        </Card>
      </div>
    </MainLayout>
  )
}
