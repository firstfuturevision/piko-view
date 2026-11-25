"""요청한 사람 IP 하나로 모으기.

리버스 프록시(터널·nginx·Vite 등) 뒤에서는 REMOTE_ADDR 이 늘 127.0.0.1 이고, 진짜 IP 는 프록시가 넘긴 헤더에 있다.

- REMOTE_ADDR 이 믿는 프록시(루프백·사설 주소, PIKO_TRUSTED_PROXIES 로 더할 수 있음)일 때만 헤더를 본다.
  밖에서 바로 붙은 요청(REMOTE_ADDR 이 공인 IP)이면 헤더는 무시한다 (누구나 써 넣을 수 있다).
- CF-Connecting-IP: Cloudflare 가 직접 채우는 값(클라이언트가 보낸 같은 이름 헤더는 Cloudflare 가 덮어쓴다)이라 먼저 믿는다.
  Cloudflare 를 거치지 않는 배포는 PIKO_TRUST_CF_HEADER=0.
- X-Forwarded-For: 맨 왼쪽은 클라이언트가 마음대로 넣을 수 있으므로, 오른쪽부터 보며 믿는 프록시가 아닌 첫 주소를 쓴다.
"""
import ipaddress
import os
from functools import lru_cache


def _valid(v) -> str | None:
    try:
        return str(ipaddress.ip_address(str(v or '').strip().split('%')[0]))
    except ValueError:
        return None


@lru_cache(maxsize=1)
def _extra_trusted() -> tuple:
    nets = []
    for part in (os.environ.get('PIKO_TRUSTED_PROXIES') or '').split(','):
        part = part.strip()
        if part:
            try:
                nets.append(ipaddress.ip_network(part, strict=False))
            except ValueError:
                pass
    return tuple(nets)


# 믿는 프록시: 루프백·사설망(RFC 1918)·IPv6 사설(ULA)·링크 로컬. (ipaddress 의 is_private 는 문서용 주소까지 넣어 쓰지 않는다)
_TRUSTED_NETS = tuple(ipaddress.ip_network(n) for n in (
    '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16',
    '::1/128', 'fc00::/7', 'fe80::/10'))


def is_trusted_proxy(ip: str | None) -> bool:
    if not ip:
        return False
    a = ipaddress.ip_address(ip)
    if isinstance(a, ipaddress.IPv6Address) and a.ipv4_mapped:
        a = a.ipv4_mapped
    return any(a.version == n.version and a in n for n in _TRUSTED_NETS + _extra_trusted())


def client_ip(request) -> str | None:
    """요청한 사람 IP (문자열). 알 수 없으면 None. DRF Request·Django HttpRequest 둘 다 된다."""
    meta = request.META
    remote = _valid(meta.get('REMOTE_ADDR'))
    if remote is not None and not is_trusted_proxy(remote):
        return remote
    if os.environ.get('PIKO_TRUST_CF_HEADER', '1') != '0':
        cf = _valid(meta.get('HTTP_CF_CONNECTING_IP'))
        if cf:
            return cf
    hops = [h.strip() for h in (meta.get('HTTP_X_FORWARDED_FOR') or '').split(',') if h.strip()]
    for hop in reversed(hops):
        ip = _valid(hop)
        if ip is None:
            break  # 깨진 값부터는 믿지 않는다
        if not is_trusted_proxy(ip):
            return ip
    return remote


def throttle_ident(self, request) -> str:
    """DRF BaseThrottle.get_ident 대신 (apps.core.apps 에서 바꿔 끼운다)."""
    return client_ip(request) or 'unknown'
