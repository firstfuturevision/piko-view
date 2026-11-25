import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startMermaid } from './lib/mermaid'

// 마크다운의 ```mermaid 코드 블록을 그림으로 (처음 쓸 때만 불러온다)
startMermaid()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
