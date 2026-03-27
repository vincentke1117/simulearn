import { Routes, Route, Navigate } from 'react-router-dom'
import Editor from '@/pages/Editor'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/editor" replace />} />
      <Route path="/editor" element={<Editor />} />
      <Route path="*" element={<Navigate to="/editor" replace />} />
    </Routes>
  )
}

export default App
