/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API 주소 (기본 /api). 백엔드가 다른 origin 이면 https://api.example.com/api */
  readonly VITE_API_BASE?: string
  /** [Work] 단추가 같은 창에서 여는 주소 (기본 /agent-hub/) */
  readonly VITE_WORK_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
