"""사람이 아닌 시스템 계정 (에이전트·봇용 계정 등).

계정은 지우거나 끄지 않는다 — 토큰 인증이 끊긴다. 사람을 고르는 목록(담당자 고르기 등)에서만 뺀다.
설정: PIKO_SYSTEM_USERNAMES(콤마로 이름들), PIKO_SYSTEM_USER_PREFIX(이 글로 시작하는 아이디).
"""
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Q


def usernames() -> list[str]:
    return list(getattr(settings, 'SYSTEM_USERNAMES', []) or [])


def prefix() -> str:
    return getattr(settings, 'SYSTEM_USER_PREFIX', '') or ''


def system_q(field: str = 'username') -> Q:
    """시스템 계정을 고르는 조건. field 는 'username' 또는 'user__username' 처럼"""
    q = Q(**{f'{field}__in': usernames()})
    if prefix():
        q |= Q(**{f'{field}__startswith': prefix()})
    return q


def is_system(user) -> bool:
    name = getattr(user, 'username', None) or ''
    return bool(user) and (name in usernames() or bool(prefix() and name.startswith(prefix())))


def humans(qs=None):
    """사람 고르기 목록에 보일 계정: 켜져 있고 시스템 계정이 아닌 것"""
    if qs is None:
        qs = get_user_model().objects.filter(is_active=True)
    return qs.exclude(system_q())
