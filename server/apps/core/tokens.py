"""외부 에이전트 API 토큰 (Authorization: Token <키>). 해시만 저장하고 만료가 있다.

- 키는 발급할 때 한 번만 돌려준다. 화면에는 앞 6자리·만든 때·만료·마지막 사용만 보인다.
- 만료: PIKO_AGENT_TOKEN_DAYS 일 (기본 365, 0 이면 만료 없음). 만료되면 401 — 화면에서 다시 발급한다.
"""
import hashlib
import os
import secrets
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import exceptions
from rest_framework.authentication import TokenAuthentication

from .models import ApiToken

LAST_USED_EVERY = timedelta(minutes=5)   # 마지막 사용 시각은 이 간격으로만 고쳐 쓴다 (요청마다 쓰지 않게)


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def token_days() -> int:
    try:
        return max(0, int(os.environ.get('PIKO_AGENT_TOKEN_DAYS') or 365))
    except ValueError:
        return 365


def expiry_from(now):
    days = token_days()
    return now + timedelta(days=days) if days else None


def issue(user, label: str = '', days: int | None = None) -> tuple[str, ApiToken]:
    """새 키를 만들어 (키, 토큰) 을 돌려준다. 같은 이름(label)의 이전 토큰만 바로 못 쓰게 된다.
    label 이 빈칸이면 개인 토큰(API 연동 화면). days 를 주면 그만큼만 쓴다."""
    key = secrets.token_hex(20)
    now = timezone.now()
    expires = (now + timedelta(days=days) if days else None) if days is not None else expiry_from(now)
    with transaction.atomic():
        ApiToken.objects.filter(user=user, label=label).delete()
        t = ApiToken.objects.create(user=user, label=label, key_hash=hash_key(key), prefix=key[:6],
                                    created_at=now, expires_at=expires)
    return key, t


def revoke(user) -> None:
    """개인 토큰만 지운다 (이름 붙인 토큰은 그대로)"""
    ApiToken.objects.filter(user=user, label='').delete()


def info(user) -> dict:
    t = ApiToken.objects.filter(user=user, label='').first()
    if t is None:
        return {'key': None, 'exists': False}
    return {'key': None, 'exists': True, 'prefix': t.prefix, 'created_at': t.created_at,
            'expires_at': t.expires_at, 'last_used_at': t.last_used_at,
            'expired': bool(t.expires_at and t.expires_at <= timezone.now())}


class HashedTokenAuthentication(TokenAuthentication):
    """DRF TokenAuthentication 과 같은 헤더(Token <키>)지만, 해시로 찾고 만료를 본다."""

    def authenticate_credentials(self, key):
        t = ApiToken.objects.select_related('user').filter(key_hash=hash_key(key)).first()
        if t is None:
            raise exceptions.AuthenticationFailed('토큰이 올바르지 않습니다.')
        now = timezone.now()
        if t.expires_at and t.expires_at <= now:
            raise exceptions.AuthenticationFailed('토큰이 만료되었습니다. API 연동 화면에서 다시 발급해 주세요.')
        if not t.user.is_active:
            raise exceptions.AuthenticationFailed('사용할 수 없는 계정입니다.')
        if t.last_used_at is None or now - t.last_used_at > LAST_USED_EVERY:
            ApiToken.objects.filter(pk=t.pk).update(last_used_at=now)
        return t.user, t
