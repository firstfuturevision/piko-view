"""홈 카드: 오늘 일정·다가오는 일정 (원래 홈 요약과 같은 기준).

- 오늘: 오늘에 걸친 일정 (하루 종일 먼저, 시작 순). 반복 일정은 발생분으로 펼친다.
- 다가오는: 내일부터 시작하는 안 끝낸 일정 UPCOMING 개. 반복은 하나당 가장 가까운 발생분 하나만.
"""
from django.utils import timezone

from .models import Schedule
from .repeat import as_of, expand, next_start, series_q
from .views import in_range

UPCOMING = 5        # 다가오는 일정
TODAY_MAX = 50      # 오늘 일정 (보통 몇 개지만 상한)
URL = '/schedules'


def _when(s: Schedule, with_date: bool) -> str:
    a = timezone.localtime(s.start_at)
    day = f'{a.month}/{a.day} ' if with_date else ''
    if s.is_all_day:
        return f'{day}종일'.strip() if with_date else '종일'
    text = f'{day}{a:%H:%M}'
    if s.end_at:
        b = timezone.localtime(s.end_at)
        text += f'–{b:%H:%M}' if b.date() == a.date() else f'–{b.month}/{b.day} {b:%H:%M}'
    return text


def _item(s: Schedule, with_date: bool) -> dict:
    from apps.view.registry import item
    tag = '완료' if s.is_done else (s.category.name if s.category else '')
    return item(s.title, _when(s, with_date), tag, URL)


def today(ctx) -> dict:
    sched = Schedule.objects.select_related('category')
    rows = expand(in_range(sched, ctx.day_start, ctx.day_end), ctx.day_start, ctx.day_end)
    todays = sorted((as_of(s, a, b) for s, a, b in rows[:TODAY_MAX]), key=lambda s: (not s.is_all_day, s.start_at))
    return {'value': len(rows), 'items': [_item(s, False) for s in todays]}


def upcoming_rows(day_end) -> list[Schedule]:
    open_ = Schedule.objects.select_related('category').filter(is_done=False)
    soon = list(open_.filter(repeat='', start_at__gte=day_end).order_by('start_at')[:UPCOMING])
    soon += [as_of(s, *n) for s in open_.filter(series_q(day_end)) if (n := next_start(s, day_end))]
    return sorted(soon, key=lambda s: s.start_at)[:UPCOMING]


def upcoming(ctx) -> dict:
    rows = upcoming_rows(ctx.day_end)
    return {'value': len(rows), 'items': [_item(s, True) for s in rows]}


def register():
    from apps.view.registry import register_card
    register_card('schedules.today', '오늘 일정', today)
    register_card('schedules.upcoming', '다가오는 일정', upcoming)
