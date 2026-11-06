import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import '@xyflow/react/dist/style.css'
import App from './App.tsx'

// hash 路由：页面在知帆宿主里位于 /ext/<id>/ui/、在开发态网关里位于 /circuit/，
// 路由只放在 # 之后，页面本身不依赖挂在哪个路径下，服务端也不用做 SPA 回退（约定 §3、§4 的 #/embed）
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
