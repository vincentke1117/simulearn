import { Layout, Menu, Button, Tag } from 'antd'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAppSelector } from '@store/hooks'
import { useAppDispatch } from '@store/hooks'
import { logout } from '@store/index'

export default function Header() {
  const location = useLocation()
  const selected = location.pathname.split('/')[1] || 'home'
  const navigate = useNavigate()
  const user = useAppSelector(s => s.user.user)
  const dispatch = useAppDispatch()
  const onClick = (e: any) => {
    const map: Record<string, string> = {
      home: '/',
      education: '/education/projects',
      learning: '/education/learning-path',
      'ai-assistant': '/ai-assistant/chat',
      community: '/community/explore',
      graph: '/knowledge/graph',
      training: '/training/fault-debug',
      account: '/account/profile'
    }
    const to = map[e.key]
    if (to) navigate(to)
  }
  return (
    <Layout.Header className="!h-14 !px-4 flex items-center justify-between !bg-slate-900 !border-b !border-slate-800">
      <div className="flex items-center">
        <div className="text-white font-semibold mr-6 text-sm">SimuLearn</div>
        <Menu theme="dark" mode="horizontal" selectedKeys={[selected]} onClick={onClick} className="!bg-transparent !min-h-fit" items={(() => {
          const items = [
            { key: 'home', label: <Link to="/">首页</Link> },
            { key: 'education', label: <Link to="/education/projects">教育</Link> },
            { key: 'learning', label: <Link to="/education/learning-path">学习路径</Link> },
            { key: 'ai-assistant', label: <Link to="/ai-assistant/chat">AI助手</Link> },
            { key: 'community', label: <Link to="/community/explore">社区</Link> },
            { key: 'graph', label: <Link to="/knowledge/graph">知识图谱</Link> },
            { key: 'training', label: <Link to="/training/fault-debug">故障训练</Link> },
            { key: 'account', label: <Link to="/account/profile">我的</Link> }
          ]
          if (user?.role === 'admin') {
            items.push({ key: 'admin', label: <Link to="/admin">管理</Link> })
          }
          return items
        })()} />
      </div>
      <div className="flex items-center gap-3">
        {user && <Tag color={user.role === 'admin' ? 'red' : 'blue'} className="!m-0">{user.username}</Tag>}
        {user ? (
          <Button type="default" size="small" onClick={() => { dispatch(logout()); navigate('/auth/login') }}>退出</Button>
        ) : (
          <>
            <Link to="/auth/login"><Button type="text" className="text-white !text-xs">登录</Button></Link>
            <Link to="/auth/register"><Button type="primary" size="small">注册</Button></Link>
          </>
        )}
      </div>
    </Layout.Header>
  )
}
