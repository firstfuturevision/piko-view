"""View 템플릿 읽기: PIKO_TEMPLATE 이름을 data/templates/ 에서 먼저, 없으면 templates/ 에서 찾는다."""
import json
import re

from django.apps import apps
from django.conf import settings

from .registry import card_keys

NAME_RE = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
# 기능 묶음이 아닌 바탕 앱 (템플릿 modules 에 적어도 기능 묶음으로 보지 않는다)
BASE_APPS = {'core', 'agent', 'view'}


class TemplateNotFound(Exception):
    pass


def find(name: str):
    if not NAME_RE.match(name or ''):
        raise TemplateNotFound(f"템플릿 이름이 올바르지 않습니다: {name!r} (영문·숫자·_·- 만)")
    for d in settings.PIKO_TEMPLATE_DIRS:
        p = d / f'{name}.json'
        if p.is_file():
            return p
    where = ', '.join(str(d) for d in settings.PIKO_TEMPLATE_DIRS)
    raise TemplateNotFound(f"'{name}' 템플릿이 없습니다. 찾은 곳: {where}")


def installed(module: str) -> bool:
    return module not in BASE_APPS and module in apps.app_configs


def load(name: str | None = None) -> dict:
    """템플릿 JSON 에서 설치되지 않은 기능 묶음을 빼고, 뺀 것을 missing 에 적어 돌려준다."""
    name = name or settings.PIKO_TEMPLATE
    path = find(name)
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as e:
        raise TemplateNotFound(f'템플릿 파일을 읽지 못했습니다: {path.name} ({e})') from e
    if not isinstance(data, dict):
        raise TemplateNotFound(f'템플릿 모양이 올바르지 않습니다: {path.name}')

    wanted = [m for m in data.get('modules') or [] if isinstance(m, str)]
    missing = [m for m in wanted if not installed(m)]
    data['modules'] = [m for m in wanted if installed(m)]

    nav = []
    for group in data.get('nav') or []:
        if not isinstance(group, dict):
            continue
        items = [it for it in group.get('items') or []
                 if not (isinstance(it, dict) and it.get('module') and not installed(it['module']))]
        if items:
            nav.append({**group, 'items': items})
    data['nav'] = nav

    known = card_keys()
    home = data.get('home') if isinstance(data.get('home'), dict) else {}
    missing_cards = []
    for part in ('stats', 'panels'):
        keys = [k for k in home.get(part) or [] if isinstance(k, str)]
        missing_cards += [k for k in keys if k not in known and k not in missing_cards]
        home[part] = [k for k in keys if k in known]
    data['home'] = home

    data.setdefault('name', name)
    data['brand'] = settings.PIKO_SITE_NAME if settings.PIKO_SITE_NAME_SET else (data.get('brand') or 'Piko')
    data.setdefault('labels', {})
    data['missing'] = missing
    data['missing_cards'] = missing_cards
    return data
