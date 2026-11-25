"""로그인 무차별 대입 막기: 아이디·IP 마다 실패를 세어 잠근다 (DB 에 둔다 — 다시 켜도 남는다).

- 같은 아이디로 PIKO_LOGIN_USER_LIMIT(기본 5)번, 같은 IP 에서 PIKO_LOGIN_IP_LIMIT(기본 20)번
  PIKO_LOGIN_WINDOW_MIN(기본 15)분 안에 틀리면 PIKO_LOGIN_LOCK_MIN(기본 15)분 잠근다.
- 잠긴 동안에는 비밀번호를 확인하지도 않는다 (맞는 비밀번호여도 거부). 오류 글은 아이디가 있는지 드러내지 않는다.
- 성공하면 그 아이디의 실패 수만 지운다 (IP 는 그대로 — 한 계정으로 성공해 IP 잠금을 풀지 못하게).
- 시도는 모두 AuthEvent 와 로그(apps.core.auth)에 남긴다.
- 화면 로그인(apps.core.views.login_view)과 관리자 로그인(admin.site.login, protect_admin_login)에 같이 쓴다.
"""
import logging
import os
from datetime import timedelta
from functools import wraps

from django.db import IntegrityError, transaction
from django.http import HttpResponse
from django.utils import timezone

from .ip import client_ip
from .models import AuthEvent, LoginLock

log = logging.getLogger('apps.core.auth')

GENERIC_FAIL = '아이디 또는 비밀번호가 올바르지 않습니다.'
LOCKED_MESSAGE = '로그인 시도가 너무 많습니다. 잠시 뒤 다시 시도해 주세요.'


def _int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name) or default))
    except ValueError:
        return default


def user_limit() -> int:
    return _int_env('PIKO_LOGIN_USER_LIMIT', 5)


def ip_limit() -> int:
    return _int_env('PIKO_LOGIN_IP_LIMIT', 20)


def window() -> timedelta:
    return timedelta(minutes=_int_env('PIKO_LOGIN_WINDOW_MIN', 15))


def lock_time() -> timedelta:
    return timedelta(minutes=_int_env('PIKO_LOGIN_LOCK_MIN', 15))


def _keys(username: str, ip: str | None) -> list[tuple[str, int]]:
    keys = []
    name = (username or '').strip().lower()[:150]
    if name:
        keys.append((f'u:{name}', user_limit()))
    if ip:
        keys.append((f'ip:{ip}', ip_limit()))
    return keys


def is_locked(username: str, ip: str | None) -> bool:
    now = timezone.now()
    return LoginLock.objects.filter(key__in=[k for k, _ in _keys(username, ip)], locked_until__gt=now).exists()


def _bump(key: str, limit: int, now) -> None:
    with transaction.atomic():
        row = LoginLock.objects.select_for_update().filter(key=key).first()
        if row is None:
            try:
                with transaction.atomic():
                    row = LoginLock.objects.create(key=key, failures=0, window_start=now)
            except IntegrityError:  # 동시에 만들어졌다
                row = LoginLock.objects.select_for_update().get(key=key)
        if row.window_start <= now - window() and not (row.locked_until and row.locked_until > now):
            row.failures, row.window_start = 0, now
        row.failures += 1
        if row.failures >= limit:
            row.locked_until = now + lock_time()
            row.failures, row.window_start = 0, now
            log.warning('로그인 잠금: %s (%s분)', key, int(lock_time().total_seconds() // 60))
        row.save()


def record_failure(username: str, ip: str | None) -> None:
    now = timezone.now()
    for key, limit in _keys(username, ip):
        _bump(key, limit, now)


def record_success(username: str) -> None:
    keys = [k for k, _ in _keys(username, None)]
    LoginLock.objects.filter(key__in=keys).delete()


def audit(request, username: str, result: str, source: str) -> None:
    ip = client_ip(request)
    ua = request.META.get('HTTP_USER_AGENT', '')[:300]
    AuthEvent.objects.create(username=(username or '')[:150], ip=ip, result=result, source=source, user_agent=ua)
    if result != AuthEvent.Result.OK:
        log.warning('로그인 %s: 아이디=%r ip=%s (%s)', result, (username or '')[:150], ip, source)


def guard(request, username: str, source: str) -> bool:
    """잠겨 있으면 기록하고 True (요청을 거부해야 함)."""
    if is_locked(username, client_ip(request)):
        audit(request, username, AuthEvent.Result.LOCKED, source)
        return True
    return False


def failed(request, username: str, source: str) -> None:
    record_failure(username, client_ip(request))
    audit(request, username, AuthEvent.Result.FAIL, source)


def succeeded(request, username: str, source: str) -> None:
    record_success(username)
    audit(request, username, AuthEvent.Result.OK, source)


def protect_admin_login(login_view):
    """admin.site.login 을 감싼다: 잠겼으면 429, POST 뒤 로그인이 안 됐으면 실패로 센다."""
    @wraps(login_view)
    def inner(request, *args, **kwargs):
        if request.method != 'POST':
            return login_view(request, *args, **kwargs)
        username = str(request.POST.get('username') or '')
        if guard(request, username, AuthEvent.Source.ADMIN):
            resp = HttpResponse(LOCKED_MESSAGE, status=429, content_type='text/plain; charset=utf-8')
            resp['Retry-After'] = str(int(lock_time().total_seconds()))
            return resp
        resp = login_view(request, *args, **kwargs)
        user = getattr(request, 'user', None)
        if user is not None and user.is_authenticated and user.is_staff and resp.status_code in (301, 302):
            succeeded(request, user.get_username(), AuthEvent.Source.ADMIN)
        else:
            failed(request, username, AuthEvent.Source.ADMIN)
        return resp
    return inner
