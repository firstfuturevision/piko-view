"""홈 카드: 살펴볼 문제 (원래 홈 요약과 같은 기준).

결정 기한 지남 | 이틀 넘게 그대로(막힘) | 오너 없음 인 아직 끝나지 않은 문제.
"""
from datetime import timedelta

from django.db.models import Q

from .models import Problem

ATTENTION = 6       # 목록에 보일 개수
STALE_DAYS = 2      # 이 날 수 넘게 그대로인 미해결·해결 중 문제는 '막힘'
ACTIVE = [Problem.Status.OPEN, Problem.Status.SOLVING, Problem.Status.ON_HOLD]
MOVING = [Problem.Status.OPEN, Problem.Status.SOLVING]
TAGS = {'overdue': '기한 지남', 'idle': '막힘', 'no_owner': '오너 없음'}
URL = '/problems'


def attention_qs(today, now):
    return Problem.objects.filter(
        Q(status__in=ACTIVE, due_date__lt=today)
        | Q(status__in=MOVING, updated_at__lte=now - timedelta(days=STALE_DAYS))
        | Q(status__in=MOVING, assignee__isnull=True))


def reason(p: Problem, today, now) -> tuple[str, str]:
    """(이유 코드, 설명 글)"""
    days_left = (p.due_date - today).days if p.due_date and p.status in ACTIVE else None
    idle = (now - p.updated_at).days if p.status in MOVING else None
    if days_left is not None and days_left < 0:
        return 'overdue', f'기한 {-days_left}일 지남'
    if idle is not None and idle >= STALE_DAYS:
        return 'idle', f'{idle}일째 그대로'
    return 'no_owner', '오너 없음'


def attention(ctx) -> dict:
    from apps.view.registry import item
    qs = attention_qs(ctx.today, ctx.now)
    items = []
    for p in qs.select_related('assignee')[:ATTENTION]:
        code, text = reason(p, ctx.today, ctx.now)
        who = (p.assignee.first_name or p.assignee.username) if p.assignee else ''
        items.append(item(p.definition, f'{text} · {who}' if who else text, TAGS[code], URL))
    return {'value': qs.count(), 'items': items}


def register():
    from apps.view.registry import register_card
    register_card('problems.attention', '살펴볼 문제', attention)
