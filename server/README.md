# Piko View server

Piko View 화면 뒤의 Django 서버입니다. 기능 묶음(앱)은 일정 · 문제 해결 · 지식 베이스 · 문서이고,
같은 데이터를 외부 에이전트가 도구 API(REST · MCP)로 다룰 수 있습니다.

## 실행

```bash
cd server
uv sync                      # 지식 베이스 의미 검색까지: uv sync --extra search
uv run python manage.py migrate
uv run python manage.py createsuperuser
uv run python manage.py runserver 8100
```

- DB·비밀 키·업로드 파일은 저장소의 `data/` 에 생깁니다 (`data/view.sqlite3`, `data/secret_key` …). git 에 올리지 않습니다.
- `runserver` 는 Daphne(ASGI)로 떠서 문서 실시간 공동 편집(웹소켓)도 됩니다.
- 화면(Vite)은 `/api`·`/ws` 를 이 서버(8100)로 넘기면 같은 주소에서 로그인 쿠키가 그대로 됩니다.
- 테스트: `uv run python manage.py test` · 점검: `uv run python manage.py check`
- 지식 베이스 예시 문서 넣기: `uv run python manage.py kb_seed`

## 환경변수

| 이름 | 기본값 | 뜻 |
|---|---|---|
| `PIKO_SITE_NAME` | `Piko` | 화면 이름. 정하면 템플릿의 `brand` 보다 먼저 씁니다 |
| `PIKO_TEMPLATE` | `default` | View 템플릿 이름. `data/templates/<이름>.json` → `templates/<이름>.json` 순서로 찾습니다 |
| `PIKO_DATA_DIR` | `<저장소>/data` | 데이터 폴더 |
| `PIKO_DB_PATH` | `<데이터>/view.sqlite3` | SQLite 파일 |
| `PIKO_SECRET_KEY` | (자동) | 없으면 `<데이터>/secret_key` 를 만들어 씁니다 |
| `PIKO_ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1]` | 받을 호스트 (콤마) |
| `PIKO_CSRF_TRUSTED_ORIGINS` | `http://localhost:5173,…:8100` | 화면 주소 (콤마, `https://…` 포함) |
| `PIKO_DEBUG` | `0` | 1 이면 개발 모드 |
| `PIKO_HTTPS` | `0` | https 프록시 뒤 운영이면 1 (보안 쿠키·HSTS) |
| `PIKO_TIME_ZONE` / `PIKO_LANGUAGE` | `Asia/Seoul` / `ko-kr` | 시간대·언어 |
| `PIKO_LOGIN_USER_LIMIT` · `_IP_LIMIT` · `_WINDOW_MIN` · `_LOCK_MIN` | 5 · 20 · 15 · 15 | 로그인 실패 잠금 |
| `PIKO_TRUSTED_PROXIES` · `PIKO_TRUST_CF_HEADER` | 없음 · `1` | 진짜 IP 를 읽을 프록시 |
| `PIKO_AGENT_TOKEN_DAYS` | `365` | API 토큰 유효 일수 (0 = 무기한) |
| `PIKO_SYSTEM_USERNAMES` · `PIKO_SYSTEM_USER_PREFIX` | 없음 | 사람 고르기 목록에서 뺄 봇 계정 |
| `PIKO_KB_EMBED` | fastembed 있으면 `fastembed:intfloat/multilingual-e5-large`, 없으면 `none` | 지식 베이스 임베딩 |
| `PIKO_KB_DATA_DIR` · `PIKO_KB_PAGES_DIR` · `PIKO_KB_ALLOWED_ROOTS` | `<데이터>/kb` · `<데이터>/kb_pages` · 없음 | 지식 베이스 폴더 |
| `PIKO_COLLAB_SAVE_DELAY` | `3` | 공동 편집 저장 간격(초) |

`search` 묶음(fastembed · kiwipiepy)이 없으면 지식 베이스는 키워드 검색만 쓰고, 한국어 조사는 간단한 규칙으로 뗍니다.

## API

모두 `/api/` 아래, 로그인(세션 쿠키) 필요. 표시한 것만 로그인 없이 됩니다.

| 묶음 | 주소 |
|---|---|
| 계정 (core) | `POST auth/login/`(로그인 없이) · `POST auth/logout/` · `GET auth/me/`(로그인 없이) · `GET auth/csrf/`(로그인 없이) · `GET/PATCH auth/profile/` · `GET/PATCH auth/users/` |
| View | `GET view/template`(로그인 없이: 활성 템플릿, 없는 묶음은 `missing`) · `GET view/home`(홈 카드 `{cards: {키: {label, value, items}}}`, `?date=`, `?cards=`) |
| 일정 | `schedules/` (`?start=&end=&category=`) · `categories/` |
| 문제 해결 | `problems/` (`?process=&include_children=&group=`) · `problems/process-nodes/` (`move/`, `positions/`, `bulk-update/`, `seed-default/`) · `problems/process-edges/` · `problems/process-groups/` |
| 지식 베이스 | `kb/status/` · `kb/tree/` · `kb/recent/` · `kb/catalog/` · `kb/search/` · `kb/documents/<id>/`(`content/` `raw/` `move/` `tags/` `related/` `graph/`) · `kb/notes/` · `kb/similar/` · `kb/graph/` · `kb/upload/` · `kb/ingest/` · `kb/attachments/` · `kb/files/<h>/<이름>` · `kb/wiki/` · `kb/glossary/` |
| 문서 | `docs/` (`?kind=&scope=mine&ref_type=&ref_id=`, `duplicate/` `share/` `unshare/` `save-template/`) · `doc-assets/` (`file/`) · `comments/` (`resolve/` `reopen/`) · `templates/` (`use/`) · 웹소켓 `/ws/collab/doc/<id>` |
| 외부 에이전트 | `agent/modules/` · `agent/token/` · `agent/<모듈>/tools/` · `agent/<모듈>/tools/<이름>/` · `agent/<모듈>/mcp` · `agent/<모듈>/guide/` (모듈: `all` · `schedules` · `problems` · `kb`, 지식 베이스는 `kb/tools/` · `kb/mcp` 도 됨) |

외부 에이전트는 `Authorization: Token <키>` 로 인증합니다. 키는 화면(또는 `POST agent/token/` + 비밀번호)에서 발급하고, 서버에는 해시만 남습니다.

## 기능 묶음 더하기

- 에이전트 도구: 앱의 `AppConfig.ready()` 에서 `apps.agent.modules.register(...)` (흔한 모양은 `app_module(...)`).
- 홈 카드: `apps.view.registry.register_card('<묶음>.<이름>', '이름', 함수)`. 함수는 `{value, items: [{title, sub, tag, url?}]}` 를 돌려줍니다.
- 템플릿의 `modules` 에 적은 묶음 중 설치되지 않은 것은 `view/template` 응답의 `missing` 에, 없는 카드 키는 `missing_cards` 에 나옵니다.
