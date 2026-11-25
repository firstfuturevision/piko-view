"""외부 에이전트용 일정 관리 도구.

시각은 모두 서버 시간대(TIME_ZONE) 기준이다. 종일 일정은 날짜만, 그 외는 'YYYY-MM-DDTHH:MM'.
일정 삭제는 사람이 할 일이라 도구로 열지 않는다 (필요하면 done 으로 완료 표시).
"""
from datetime import date, datetime, time, timedelta
from typing import Literal

from django.db.models import Count, Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from apps.agent.common import LIST_LIMIT, get_or_fail, save, truncated
from apps.agent.tools import tool

from .models import Category, Schedule
from .repeat import as_of, expand
from .serializers import CategorySerializer, ScheduleSerializer
from .views import in_range

SCHEDULE_HINT = 'schedule_list 로 ID를 확인하세요.'
RepeatKind = Literal['none', 'weekly', 'monthly']
CategoryColor = Literal['red', 'orange', 'yellow', 'green', 'blue', 'navy', 'purple', 'black']

READ_ONLY = {'schedule_list', 'schedule_get', 'category_list'}


def _date(value: str, label: str) -> date:
    d = parse_date(value.strip()[:10])
    if d is None:
        raise ValueError(f'{label} 날짜 형식이 올바르지 않습니다: {value!r} (YYYY-MM-DD)')
    return d


def _midnight(d: date) -> datetime:
    return timezone.make_aware(datetime.combine(d, time.min))


def _to_dt(value: str, all_day: bool, label: str) -> datetime:
    """종일 일정은 그날 0시(서버 시간대), 아니면 주어진 시각. 화면에서 저장하는 방식과 같다."""
    if all_day:
        return _midnight(_date(value, label))
    v = value.strip()
    # parse_datetime 은 날짜만 있어도 0시로 받아들이므로, 시각이 빠진 입력은 따로 막는다
    dt = parse_datetime(v.replace(' ', 'T')) if len(v) > 10 else None
    if dt is None:
        if parse_date(v):
            raise ValueError(f'{label}에 시각이 없습니다. 종일 일정이면 all_day=true, 아니면 YYYY-MM-DDTHH:MM 으로 주세요.')
        raise ValueError(f'{label} 형식이 올바르지 않습니다: {value!r} (YYYY-MM-DDTHH:MM)')
    return dt if timezone.is_aware(dt) else timezone.make_aware(dt)


def _repeat(kind: str) -> str:
    return '' if kind in ('none', '') else kind


def _category_id(name: str) -> int | None:
    if name == '':
        return None
    c = Category.objects.filter(name=name).first()
    if c is None:
        names = ', '.join(Category.objects.values_list('name', flat=True)) or '(없음)'
        raise LookupError(f"'{name}' 카테고리가 없습니다. 있는 카테고리: {names}")
    return c.id


def _fmt(s: Schedule) -> dict:
    local = timezone.localtime
    if s.is_all_day:
        start = local(s.start_at).date().isoformat()
        end = local(s.end_at).date().isoformat() if s.end_at else None
    else:
        start = local(s.start_at).strftime('%Y-%m-%d %H:%M')
        end = local(s.end_at).strftime('%Y-%m-%d %H:%M') if s.end_at else None
    return {
        'id': s.id, 'title': s.title, 'all_day': s.is_all_day, 'start': start, 'end': end,
        'category': s.category.name if s.category else None, 'description': s.description or None,
        'done': s.is_done, 'pinned': s.is_pinned, 'created_by': s.owner.username,
        'repeat': s.repeat or None, 'repeat_until': s.repeat_until,
    }


def build(user) -> list:
    @tool
    def schedule_list(start: str, end: str, category: str | None = None, query: str | None = None) -> dict:
        """기간 안에 걸친 일정을 본다 (여러 날 일정은 기간과 겹치면 포함). 반복 일정은 발생분마다 한 줄.

        Args:
            start: 시작 날짜 (YYYY-MM-DD, 이날 포함)
            end: 끝 날짜 (YYYY-MM-DD, 이날 포함)
            category: 이 카테고리 이름의 일정만
            query: 제목·설명에 들어간 글자
        """
        d1, d2 = _date(start, '시작'), _date(end, '끝')
        if d2 < d1:
            raise ValueError('끝 날짜가 시작 날짜보다 빠릅니다.')
        lo, hi = _midnight(d1), _midnight(d2 + timedelta(days=1))
        qs = in_range(Schedule.objects.select_related('category', 'owner'), lo, hi)
        if category is not None:
            qs = qs.filter(category_id=_category_id(category))
        if query:
            qs = qs.filter(Q(title__icontains=query) | Q(description__icontains=query))
        rows = expand(qs, lo, hi)  # 반복 일정은 발생분마다 한 줄 (id 는 원본)
        out = {'range': [d1.isoformat(), d2.isoformat()],
               'schedules': truncated([_fmt(as_of(s, a, b)) for s, a, b in rows[:LIST_LIMIT]], len(rows))}
        return out

    @tool
    def schedule_get(schedule_id: int) -> dict:
        """일정 하나를 본다.

        Args:
            schedule_id: 일정 ID
        """
        return _fmt(get_or_fail(Schedule, schedule_id, '일정', SCHEDULE_HINT))

    @tool
    def schedule_create(title: str, start: str, end: str | None = None, all_day: bool = False,
                        category: str | None = None, description: str = '', pinned: bool = False,
                        repeat: RepeatKind = 'none', repeat_until: str | None = None) -> dict:
        """새 일정을 만든다. 만든 사람은 API 토큰 주인으로 기록된다.

        Args:
            title: 제목
            start: 시작. 종일이면 YYYY-MM-DD, 아니면 YYYY-MM-DDTHH:MM (서버 시간대)
            end: 끝. 형식은 start 와 같다. 여러 날 종일 일정은 마지막 날짜
            all_day: 종일 일정인지
            category: 카테고리 이름 (category_list 참고). 비우면 미분류
            description: 설명
            pinned: 목록 위에 고정(별표)
            repeat: none | weekly(매주 시작 요일) | monthly(매월 시작 날짜, 그 날이 없는 달은 건너뜀)
            repeat_until: 반복이 끝나는 날 (YYYY-MM-DD, 비우면 계속)
        """
        data = {'repeat': _repeat(repeat), 'repeat_until': _date(repeat_until, '반복 끝') if repeat_until else None,
                'title': title, 'description': description, 'is_all_day': all_day, 'is_pinned': pinned,
                'start_at': _to_dt(start, all_day, '시작'),
                'end_at': _to_dt(end, all_day, '끝') if end else None,
                'category': _category_id(category) if category else None}
        s = save(ScheduleSerializer, data=data, owner=user)
        return _fmt(Schedule.objects.get(pk=s['id']))

    @tool
    def schedule_update(schedule_id: int, title: str | None = None, start: str | None = None,
                        end: str | None = None, all_day: bool | None = None, category: str | None = None,
                        description: str | None = None, done: bool | None = None,
                        pinned: bool | None = None, repeat: RepeatKind | None = None,
                        repeat_until: str | None = None) -> dict:
        """일정을 고친다. 바꿀 항목만 준다 (예: 완료 표시는 done=true 만).

        Args:
            schedule_id: 일정 ID
            title: 제목
            start: 시작. 종일이면 YYYY-MM-DD, 아니면 YYYY-MM-DDTHH:MM
            end: 끝. '' 이면 끝 시각을 지운다
            all_day: 종일 일정인지 (바꾸면 시작·끝을 그 형식에 맞춰 다시 해석한다)
            category: 카테고리 이름. '' 이면 미분류로
            description: 설명
            done: 완료 여부
            pinned: 목록 위 고정 여부
            repeat: none | weekly | monthly
            repeat_until: 반복이 끝나는 날 (YYYY-MM-DD). '' 이면 계속
        """
        s = get_or_fail(Schedule, schedule_id, '일정', SCHEDULE_HINT)
        is_all_day = s.is_all_day if all_day is None else all_day
        local = timezone.localtime
        data: dict = {}
        if title is not None:
            data['title'] = title
        if description is not None:
            data['description'] = description
        if done is not None:
            data['is_done'] = done
        if pinned is not None:
            data['is_pinned'] = pinned
        if category is not None:
            data['category'] = _category_id(category)
        if repeat is not None:
            data['repeat'] = _repeat(repeat)
        if repeat_until is not None:
            data['repeat_until'] = _date(repeat_until, '반복 끝') if repeat_until else None
        if all_day is not None:
            data['is_all_day'] = all_day
        if start is not None:
            data['start_at'] = _to_dt(start, is_all_day, '시작')
        elif all_day:  # 종일로 바꾸면 기존 시작 날짜의 0시로
            data['start_at'] = _midnight(local(s.start_at).date())
        if end is not None:
            data['end_at'] = _to_dt(end, is_all_day, '끝') if end else None
        elif all_day and s.end_at:
            data['end_at'] = _midnight(local(s.end_at).date())
        save(ScheduleSerializer, instance=s, data=data, partial=True)
        return _fmt(Schedule.objects.get(pk=s.id))

    @tool
    def category_list() -> list[dict]:
        """일정 카테고리 목록 (이름, 색, 일정 수). 일정을 만들 때 category 에 이 이름을 쓴다."""
        return [{'name': c.name, 'color': c.color, 'schedules': c.n}
                for c in Category.objects.annotate(n=Count('schedules'))]

    @tool
    def category_create(name: str, color: CategoryColor = 'blue') -> dict:
        """새 일정 카테고리를 만든다. 달력에서 이 색으로 표시된다. 먼저 category_list 로 비슷한 것이 있는지 본다.

        Args:
            name: 카테고리 이름 (전체에서 겹치면 안 된다)
            color: red | orange | yellow | green | blue | navy | purple | black
        """
        return save(CategorySerializer, data={'name': name, 'color': color}, owner=user)

    @tool
    def category_update(name: str, new_name: str | None = None,
                        color: CategoryColor | None = None) -> dict:
        """카테고리의 이름이나 색을 바꾼다. 그 카테고리의 일정에 모두 반영된다.

        Args:
            name: 지금 카테고리 이름
            new_name: 새 이름
            color: 새 색
        """
        c = Category.objects.get(pk=_category_id(name))
        data = {k: v for k, v in {'name': new_name, 'color': color}.items() if v is not None}
        if not data:
            raise ValueError('바꿀 항목(new_name 또는 color)을 주세요.')
        return save(CategorySerializer, instance=c, data=data, partial=True)

    return [schedule_list, schedule_get, schedule_create, schedule_update,
            category_list, category_create, category_update]
