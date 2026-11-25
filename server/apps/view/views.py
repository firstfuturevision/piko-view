"""View API: 활성 템플릿(GET /api/view/template)과 홈 카드(GET /api/view/home)."""
import logging
from datetime import datetime, time, timedelta

from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import templates
from .registry import HomeContext, cards

log = logging.getLogger(__name__)


@api_view(['GET'])
@permission_classes([AllowAny])
def template_view(request):
    """로그인 화면에서도 이름(brand)을 보여야 해서 로그인 없이 준다. 회사 데이터는 들어 있지 않다."""
    try:
        return Response(templates.load())
    except templates.TemplateNotFound as e:
        return Response({'detail': str(e)}, status=404)


@api_view(['GET'])
def home_view(request):
    """등록된 홈 카드를 모두 계산한다. ?date=YYYY-MM-DD 로 '오늘'을 바꿀 수 있다. ?cards=a,b 로 고를 수 있다."""
    now = timezone.now()
    today = parse_date(request.query_params.get('date') or '') or timezone.localdate(now)
    day_start = timezone.make_aware(datetime.combine(today, time.min))
    ctx = HomeContext(user=request.user, now=now, today=today, day_start=day_start,
                      day_end=day_start + timedelta(days=1))
    only = {k for k in (request.query_params.get('cards') or '').split(',') if k}
    out = {}
    for card in cards():
        if only and card.key not in only:
            continue
        try:
            data = card.fn(ctx)
        except Exception:  # 카드 하나가 깨져도 홈은 열린다
            log.exception('홈 카드 계산 실패: %s', card.key)
            continue
        out[card.key] = {'label': card.label, 'value': data.get('value', 0), 'items': data.get('items', [])}
    return Response({'date': today, 'cards': out})
