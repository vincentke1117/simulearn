import { Form, Input, Button, Card, Typography, message } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import MainLayout from '@components/layout/MainLayout'
import { login } from '@services/auth.api'
import { setAuth } from '@store/index'
import { useAppDispatch } from '@store/hooks'
import { useNavigate, useLocation } from 'react-router-dom'

export default function Login() {
  const dispatch = useAppDispatch()
  const nav = useNavigate()
  const location = useLocation()
  
  const onFinish = async (values: any) => {
    try {
      const res = await login(values)
      dispatch(setAuth(res))
      message.success('登录成功')
      
      // Redirect to intended route or dashboard
      const from = (location.state as any)?.from?.pathname || '/dashboard'
      nav(from, { replace: true })
    } catch (e: any) {
      message.error(e.message || '登录失败')
    }
  }
  return (
    <MainLayout>
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <Card className="w-full max-w-md shadow-xl" title={<div className="text-center text-xl font-semibold">登录</div>}>
          <Form layout="vertical" onFinish={onFinish} size="large">
            <Form.Item name="email" rules={[{ required: true }]}>
              <Input prefix={<UserOutlined />} placeholder="邮箱" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="密码" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large">登录</Button>
          </Form>
        </Card>
      </div>
    </MainLayout>
  )
}
