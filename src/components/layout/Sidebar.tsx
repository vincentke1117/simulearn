import { Menu } from 'antd'
import { Link, useLocation, useNavigate } from 'react-router-dom'

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const seg = location.pathname.split('/')[1]
  const selected = seg === 'education' ? 'learn' : seg === 'ai-assistant' ? 'ai' : seg || 'dashboard'
  const onClick = (e: any) => {
    const map: Record<string, string> = {
      dashboard: '/dashboard',
      learn: '/education/projects',
      ai: '/ai-assistant/chat',
      community: '/community/explore',
      account: '/account/profile'
    }
    const to = map[e.key]
    if (to) navigate(to)
  }
  return (
    <Menu mode="inline" selectedKeys={[selected]} onClick={onClick} items={[
      { key: 'dashboard', label: <Link to="/dashboard">主页</Link> },
      { key: 'learn', label: <Link to="/education/projects">学习</Link> },
      { key: 'ai', label: <Link to="/ai-assistant/chat">AI助手</Link> },
      { key: 'community', label: <Link to="/community/explore">社区</Link> },
      { key: 'account', label: <Link to="/account/profile">我的</Link> }
    ]} />
  )
}
