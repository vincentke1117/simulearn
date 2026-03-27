import { Typography, Card, Descriptions, Button, Space, Tag } from 'antd'
import MainLayout from '@components/layout/MainLayout'
import { useAppSelector } from '@store/hooks'
import { logout } from '@store/index'
import { useAppDispatch } from '@store/hooks'
import { useNavigate } from 'react-router-dom'

export default function Profile() {
  const user = useAppSelector(s => s.user.user)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  
  const onLogout = () => {
    dispatch(logout())
    navigate('/auth/login')
  }
  
  return (
    <MainLayout>
      <Typography.Title level={3}>个人资料</Typography.Title>
      <Card>
        <Descriptions column={1} size="middle">
          <Descriptions.Item label="用户名">{user?.username || '未登录'}</Descriptions.Item>
          <Descriptions.Item label="邮箱">{user?.email || '-'}</Descriptions.Item>
          <Descriptions.Item label="角色">{user?.role || '-'}</Descriptions.Item>
        </Descriptions>
        <Space>
          <Button type="primary" onClick={() => navigate('/account/settings')}>前往设置</Button>
          <Button danger onClick={onLogout}>退出登录</Button>
          <Button onClick={() => navigate('/account/favorites')}>我的收藏</Button>
          <Button onClick={() => navigate('/account/learning-stats')}>学习统计</Button>
        </Space>
      </Card>
      <div className="mt-4 flex items-center gap-3">
        <Tag color="gold">收藏数 {(JSON.parse(localStorage.getItem('favorites:projects')||'[]') as string[]).length}</Tag>
        <Tag color="green">已完成项目 {Array.from({length: localStorage.length}).filter((_,i)=>((localStorage.key(i)||'').startsWith('results:'))).length}</Tag>
      </div>
    </MainLayout>
  )
}
