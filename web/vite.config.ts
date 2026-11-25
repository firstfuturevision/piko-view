import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// 백엔드(Django) 주소. 예) PIKO_VIEW_API=http://127.0.0.1:8100
const apiTarget = process.env.PIKO_VIEW_API ?? 'http://127.0.0.1:8100'

// 터널 도메인 등 허용할 Host 헤더. 비어 있으면 전체 허용(true). 예) PIKO_VIEW_ALLOWED_HOSTS=view.example.com
const allowedHosts = process.env.PIKO_VIEW_ALLOWED_HOSTS
  ? process.env.PIKO_VIEW_ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean)
  : true

const apiProxy = {
  '/api': apiTarget,
  '/admin': apiTarget,
  '/static': apiTarget,
  '/media': apiTarget,
  // 실시간 공동 편집 웹소켓
  '/ws': { target: apiTarget.replace(/^http/, 'ws'), ws: true },
}

// https://vite.dev/config/
export default defineConfig({
  // 하위 주소에 올릴 때: VITE_BASE=/view/
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  server: {
    proxy: apiProxy,
    allowedHosts,
  },
  preview: {
    proxy: apiProxy,
    allowedHosts,
  },
})
