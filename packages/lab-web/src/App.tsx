import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Editor from '@/pages/Editor'

// 嵌入页只在知帆课堂里打开，按需加载，不拖慢开发态的编辑器首屏
const EmbedPage = lazy(() => import('@/embed/EmbedPage'))

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/editor" replace />} />
      <Route path="/editor" element={<Editor />} />
      <Route
        path="/embed"
        element={
          <Suspense fallback={<div className="p-4 text-sm text-slate-400">正在加载实验…</div>}>
            <EmbedPage />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/editor" replace />} />
    </Routes>
  )
}

export default App
