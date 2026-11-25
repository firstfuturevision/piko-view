# Piko View — 웹

Piko View 의 화면(React + Vite + TypeScript + Tailwind). 백엔드는 `../server`(Django)이고, 왼쪽 메뉴와 첫 화면은 템플릿(`../templates/*.json`)이 정합니다.

## 실행

```bash
npm install
npm run dev        # 개발 서버 (http://localhost:5173), /api 등은 백엔드로 넘김
npm run build      # tsc -b && vite build → dist/
npm run preview    # 빌드한 dist 를 띄워 보기
npm run lint       # eslint
```

## 환경 변수

| 이름 | 기본값 | 뜻 |
|---|---|---|
| `PIKO_VIEW_API` | `http://127.0.0.1:8100` | dev/preview 서버가 `/api` `/admin` `/static` `/media` `/ws` 를 넘길 백엔드 주소 |
| `PIKO_VIEW_ALLOWED_HOSTS` | (전체 허용) | dev 서버가 받을 Host 이름(쉼표로 여러 개) |
| `VITE_BASE` | `/` | 하위 주소에 올릴 때 (예: `/view/`). 라우터 basename 도 이 값을 따름 |
| `VITE_WORK_URL` | `/agent-hub/` | 왼쪽 위 `[View \| Work]` 의 Work, 아래 탭 Work 가 같은 창에서 여는 주소 |
| `VITE_API_BASE` | `/api` | 백엔드가 다른 origin 이면 그 API 주소 (예: `https://api.example.com/api`) |

## 템플릿이 메뉴를 정하는 방법

로그인하면 `GET /api/view/template` 을 한 번 불러옵니다(못 불러오면 `src/view/template.ts` 의 기본 템플릿).

- `brand` → 왼쪽 위 이름(기본 `Piko`)과 창 제목.
- `modules` → 켤 기능 묶음. 프론트엔드 registry 에 있고, 서버 응답의 `missing` 에 없는 묶음만 주소·메뉴가 생깁니다.
- `nav` → 왼쪽 메뉴 묶음과 순서.
  - `{ "module": "kb" }` → registry 에 적힌 그 묶음의 기본 메뉴.
  - `{ "module": "crm", "page": "leads" }` → 그 묶음 `pages.leads` 메뉴.
  - `{ "to": "/", "label": "현황", "icon": "home" }` → 적힌 그대로 (아이콘 이름은 `src/components/iconPaths.ts`).
  - 없는 묶음의 항목은 빠지고, 항목이 하나도 없는 묶음 제목도 빠집니다.
- `home.stats` / `home.panels` → 첫 화면 숫자 칸 / 목록 칸. `GET /api/view/home` 의 `cards` 에서 그 키를 찾아 그리고, 없는 키는 건너뜁니다.
- `labels` → 부르는 말 바꾸기. 묶음 기본 메뉴 이름은 묶음 이름(예: `"kb": "자료실"`)으로, 화면 안에서는 `useLabel()` 로 `label('lead', '영업 건')` 처럼 씁니다.

좁은 화면에서는 메뉴 앞 3개 + Work + 더보기(전체 메뉴 서랍)가 아래 탭으로 나옵니다. 사이드바 넓이는 오른쪽 경계를 끌어 180~480px(두 번 누르면 260px)로 바꾸고, `localStorage["agent-hub:sideW"]` 에 숫자로 기억합니다.

## 기능 묶음 더하기

1. 화면을 `src/pages/`(작은 부품은 `src/features/<묶음>/`)에, API 호출을 `src/api/<묶음>.ts` 에 두고 `src/api/index.ts` 의 `api` 에 펼쳐 넣습니다.
2. `src/view/registry.ts` 의 `MODULES` 에 한 줄 더합니다.

```ts
{
  name: 'crm',                                   // 템플릿 modules · nav[].module 에 쓰는 이름
  routes: [{ path: '/crm/*', component: CrmPage }],
  nav: { to: '/crm', label: '고객', icon: 'users' },
  pages: { leads: { to: '/crm/leads', label: '영업 건', icon: 'briefcase', labelKey: 'lead' } },
  fullBleed: ['/crm/board/:id'],                 // (선택) 화면을 꽉 채우는 주소
  selfScroll: ['/crm'],                          // (선택) 스스로 칸을 나눠 스크롤하는 주소
},
```

3. 템플릿 `modules` 와 `nav` 에 그 이름을 적고, 서버에도 같은 묶음을 켭니다. 무거운 화면은 `lazy(() => import(...))` 로 불러옵니다.

## 쓰는 API

`/api/auth/{me,login,logout,users}/` · `/api/view/template` · `/api/view/home` · `/api/schedules/` · `/api/categories/` · `/api/problems/` (+ `process-nodes/`) · `/api/kb/…` · `/api/docs/` · `/api/templates/` · `/api/comments/` · `/api/doc-assets/` · 공동 편집 웹소켓 `/ws/…`.
