import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { App as WorkspaceApp } from '@/app/App'

export default function Editor() {
  useEffect(() => {
    if (import.meta.env.PROD) {
      const meta = document.createElement('meta')
      meta.name = 'robots'
      meta.content = 'noindex'
      document.head.appendChild(meta)
      return () => {
        document.head.removeChild(meta)
      }
    }
  }, [])

  return (
    <div className="relative h-screen w-full bg-slate-900 overflow-hidden">
      {/* 顶部触发区域 - 仅 2px 高度防止误触 */}
      <div className="absolute top-0 left-0 w-full h-0.5 z-50 bg-transparent peer" />
      
      {/* 自动隐藏的顶部栏 */}
      <header className="absolute top-0 left-0 w-full z-40 bg-slate-900/95 backdrop-blur-sm border-b border-slate-800 transition-transform duration-300 -translate-y-full peer-hover:translate-y-0 hover:translate-y-0 shadow-lg">
        <div className="px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">返回首页</Link>
            <span className="text-sm text-slate-500">测试编辑器</span>
          </div>
          <EditorUserBadge />
        </div>
      </header>

      <main className="w-full h-full">
        <WorkspaceApp />
      </main>
    </div>
  )
}

function EditorUserBadge() {
  useEffect(() => {}, [])
  return <span className="text-xs text-slate-500">访客模式</span>
}
