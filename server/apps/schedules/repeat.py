"""반복 일정의 발생분 계산.

반복 일정은 원본 한 줄만 저장한다. 기준은 start_at(서버 시간대)의 요일·날짜이고,
매주는 7일마다, 매월은 매월 같은 날(그 달에 그 날이 없으면 그 달은 건너뜀)이다.
여러 날에 걸친 일정(end_at)은 발생분도 같은 길이다. repeat_until 이 있으면 그날까지 시작하는 것만.
완료(is_done)는 원본 전체 기준이라 발생분도 원본 값을 그대로 쓴다.
"""
import copy
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from .models import Repeat


def _starts(s, until):
    """s 의 발생 시작 시각들 (서버 시간대 기준으로 날짜를 옮긴다). until 이전 것만."""
    base = timezone.localtime(s.start_at).replace(tzinfo=None)
    last = s.repeat_until
    k = 0
    while True:
        if s.repeat == Repeat.WEEKLY:
            d = base + timedelta(days=7 * k)
        else:
            y, m = divmod(base.month - 1 + k, 12)
            try:
                d = base.replace(year=base.year + y, month=m + 1)
            except ValueError:  # 그 달에 그 날이 없다 (31일·29일 등)
                k += 1
                continue
        aware = timezone.make_aware(d)
        if aware >= until or (last and d.date() > last):
            return
        yield aware
        k += 1


def occurrences(s, start, end):
    """일정 s 중 [start, end) 와 겹치는 발생분 [(시작, 끝)]. 반복 아닌 일정은 자기 자신 하나(겹칠 때).
    겹침 기준은 in_range 와 같다: 끝이 없으면 시작이 범위 안, 있으면 시작 < end 이고 끝 >= start."""
    length = s.end_at - s.start_at if s.end_at else None
    starts = _starts(s, end) if s.repeat else ([s.start_at] if s.start_at < end else [])
    out = []
    for a in starts:
        b = a + length if length is not None else None
        if (b if b is not None else a) >= start:
            out.append((a, b))
    return out


def series_q(start=None, end=None):
    """반복 일정 중 [start, end) 에 발생분이 있을 수 있는 것 (대강 거른다 — 정확한 판단은 occurrences)."""
    q = ~Q(repeat=Repeat.NONE)
    if end is not None:
        q &= Q(start_at__lt=end)
    if start is not None:
        # 여러 날 일정이 앞에서 걸쳐 올 수 있으니 한 달 여유를 둔다
        q &= Q(repeat_until__isnull=True) | Q(repeat_until__gte=timezone.localdate(start) - timedelta(days=31))
    return q


def expand(qs, start, end):
    """qs(이미 in_range 로 거른 것) 의 [start, end) 발생분을 시작 순으로 [(일정, 시작, 끝)]."""
    rows = [(s, a, b) for s in qs for a, b in occurrences(s, start, end)]
    rows.sort(key=lambda r: r[1])
    return rows


def next_start(s, after):
    """after 이후(포함) 처음 시작하는 발생분의 (시작, 끝). 없으면 None."""
    length = s.end_at - s.start_at if s.end_at else None
    if not s.repeat:
        return (s.start_at, s.end_at) if s.start_at >= after else None
    # 반복이면 after 부터 넉넉히(13개월) 살펴 첫 것을 쓴다
    for a in _starts(s, after + timedelta(days=400)):
        if a >= after:
            return a, (a + length if length is not None else None)
    return None


def as_of(s, a, b):
    """발생분 시각을 얹은 일정 사본 (DB 에 저장하지 않는다). id 는 원본 그대로."""
    if a == s.start_at:
        return s
    c = copy.copy(s)
    c.start_at, c.end_at = a, b
    return c
