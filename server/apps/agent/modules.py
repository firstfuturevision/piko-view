"""외부 에이전트에 여는 모듈 목록 (일반 등록 방식).

각 앱이 AppConfig.ready() 에서 register() 로 자기 도구 모듈을 등록한다. 이 앱은 다른 앱을 import 하지 않는다.
'all'(통합)은 등록된 모든 모듈의 도구를 한 번에 연다. 주소는 /api/agent/<모듈>/… (지식 베이스는 /api/kb/… 도 된다).
"""
import importlib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Callable

from django.conf import settings
from django.contrib.auth import get_user_model

from .common import user_list
from .tools import ToolRegistry

GUIDES = Path(__file__).parent / 'guides'


def _guide(name: str) -> str:
    return (GUIDES / f'{name}.md').read_text(encoding='utf-8')


def common_guide() -> str:
    return _guide('common')


@dataclass(frozen=True)
class Module:
    key: str
    title: str
    description: str
    server_name: str
    prefix: str  # API 기준 주소 (예: /agent/schedules)
    build: Callable  # (user) -> list[Tool]
    read_only: Callable  # () -> set[str]
    guide: Callable  # () -> str (공통 규칙 포함)
    stats: Callable  # () -> list[dict]
    body: Callable | None = None  # () -> str: 통합 지침에 넣을 이 모듈만의 지침 (없으면 guide)

    def paths(self) -> dict:
        return {'mcp': f'{self.prefix}/mcp', 'tools': f'{self.prefix}/tools/', 'guide': f'{self.prefix}/guide/'}


_PARTS: dict[str, Module] = {}


def register(module: Module) -> None:
    """앱이 자기 도구 모듈을 등록한다 (같은 key 는 덮어쓴다)."""
    if module.key == 'all':
        raise ValueError("'all' 은 통합 모듈 이름이라 쓸 수 없습니다.")
    _PARTS[module.key] = module
    clear_cache()


def app_module(key: str, title: str, description: str, tools_module: str, guide_path: Path,
               stats: Callable = lambda: []) -> Module:
    """흔한 모양: tools_module 에 build(user) -> list[Tool] 과 READ_ONLY 가 있고, 공통 user_list 를 더한다."""
    def build(user):
        return [*importlib.import_module(tools_module).build(user), user_list]

    def read_only():
        return {*importlib.import_module(tools_module).READ_ONLY, 'user_list'}

    def body():
        return Path(guide_path).read_text(encoding='utf-8')

    return Module(key, title, description, f'piko-{key}', f'/agent/{key}', build, read_only,
                  lambda: f'{body()}\n{common_guide()}', stats, body)


def parts() -> list[Module]:
    return list(_PARTS.values())


def _all_guide() -> str:
    rows = '\n'.join(f'| {m.title} | {m.description} |' for m in parts())
    sections = [_guide('all').replace('{site}', settings.PIKO_SITE_NAME).replace('{modules}', rows)]
    for m in parts():
        body = m.body() if m.body else m.guide()
        sections.append(f'---\n# {m.title} ({m.description})\n\n{body}')
    sections.append(f'---\n{common_guide()}')
    return '\n\n'.join(sections)


ALL = Module(
    'all', '통합', '등록된 모든 모듈의 도구', 'piko', '/agent/all',
    lambda user: [t for m in parts() for t in m.build(user)],
    lambda: set().union(*(m.read_only() for m in parts())),
    _all_guide,
    lambda: [],
)


def get(key: str) -> Module | None:
    return ALL if key == 'all' else _PARTS.get(key)


def order() -> list[str]:
    return ['all', *_PARTS]


@lru_cache(maxsize=256)
def _registry(key: str, user_id: int) -> ToolRegistry:
    user = get_user_model().objects.get(pk=user_id)
    return ToolRegistry(get(key).build(user))


def registry(key: str, user) -> ToolRegistry:
    """사용자별 도구 레지스트리 (도구 스키마를 매번 만들지 않도록 캐시한다)."""
    return _registry(key, user.pk)


def clear_cache():
    _registry.cache_clear()
