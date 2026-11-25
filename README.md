# Piko View

Piko 의 현황 화면입니다. Piko Work(AI 에이전트 작업 화면)와 짝을 이루어, 왼쪽 위 **View | Work** 로 오갑니다. 에이전트가 한 일은 View 의 화면(일정 · 문제 · 문서 · 숫자)으로 사람에게 보입니다.

## 구조: 틀 + 기능 묶음 + 템플릿

- **틀**: 로그인 · 사용자, 왼쪽 메뉴와 화면 배치, 공용 화면 부품, 에이전트용 도구 API
- **기능 묶음**: 일정(`schedules`) · 문제 해결(`problems`) · 지식 베이스(`kb`) · 문서(`docs`). 준비 중: 프로젝트 · 고객/영업 · 채팅 · 자동화
- **템플릿**: 회사마다 켤 묶음 · 메뉴 · 첫 화면 · 부르는 말을 파일 하나로 정합니다 → [templates/](templates/README.md)

회사마다 업무가 다르므로 템플릿을 고르거나 만들어 씁니다. 회사 전용 기능과 회사 템플릿은 각 회사의 비공개 저장소나 `data/templates/` 에 둡니다(레포에 올라가지 않음).

## 폴더

| 폴더 | 내용 |
|---|---|
| `server/` | Django 서버(API · 로그인 · 에이전트 도구) — [server/README.md](server/README.md) |
| `web/` | React 화면 — [web/README.md](web/README.md) |
| `templates/` | 공개 템플릿(기본, 외주 개발사) |
| `data/` | 이 PC 의 데이터베이스 · 회사 템플릿 · 비밀 값(레포에 안 올라감) |

## 라이선스

[FutureVision Piko License 1.0](LICENSE)
