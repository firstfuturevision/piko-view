from datetime import datetime, time, timedelta

from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError

from .models import Category, Schedule
from .repeat import series_q
from .serializers import CategorySerializer, ScheduleSerializer


# 전체 공유: 로그인한 모든 사용자가 모든 데이터를 조회/편집한다.
# owner는 작성자 표시용으로만 기록한다.
class CategoryViewSet(viewsets.ModelViewSet):
    serializer_class = CategorySerializer
    queryset = Category.objects.all()

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)


def parse_bound(value: str, end: bool = False):
    """날짜(YYYY-MM-DD) 또는 시각(ISO). 날짜로 준 end 는 그날 끝까지(다음 날 0시 미만)로 본다. 틀리면 ValidationError."""
    try:
        # 날짜만 준 경우를 먼저 본다 (parse_datetime 은 날짜만 줘도 그날 0시로 읽는다)
        day = parse_date(value) if len(value) == 10 else None
        d = datetime.combine(day + timedelta(days=1) if end else day, time.min) if day else parse_datetime(value)
    except ValueError:
        d = None
    if d is None:
        raise ValidationError({'end' if end else 'start': '날짜(YYYY-MM-DD) 또는 시각(ISO 8601) 형식이어야 합니다.'})
    return timezone.make_aware(d) if timezone.is_naive(d) else d


def in_range(qs, start=None, end=None):
    """[start, end) 와 겹치는 일정. 끝 시각이 없는 일정은 시작 시각만 본다.
    반복 일정은 그 기간에 발생분이 있을 수 있으면 원본이 들어온다 (발생분 시각은 repeat.expand)."""
    q = Q()
    if end is not None:
        q &= Q(start_at__lt=end)
    if start is not None:
        q &= Q(end_at__gte=start) | Q(end_at__isnull=True, start_at__gte=start)
    return qs.filter(q | series_q(start, end)) if q else qs


class ScheduleViewSet(viewsets.ModelViewSet):
    serializer_class = ScheduleSerializer

    def get_queryset(self):
        # 작성자·카테고리 이름/색을 한 번에 (행마다 쿼리하지 않게)
        qs = Schedule.objects.select_related('owner', 'category')
        params = self.request.query_params
        category = params.get('category')
        if category:
            qs = qs.filter(category_id=category)
        # ?start=&end= 를 주면 그 기간과 겹치는 일정만 (안 주면 전부 — 일정 화면이 전체를 받아 달력을 넘긴다)
        if self.action == 'list' and (params.get('start') or params.get('end')):
            qs = in_range(qs, parse_bound(params['start']) if params.get('start') else None,
                          parse_bound(params['end'], end=True) if params.get('end') else None)
        return qs

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)
