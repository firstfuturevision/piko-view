"""문서·슬라이드를 누가 보고 고칠 수 있는지.

- 연결 대상이 있는 파일(ref_id 있음, 예: 프로젝트 문서): 로그인한 모든 사람이 보고 고친다 (팀 공유).
- 개인 파일(ref_id 없음): 주인(owner)과 공유받은 사람(shared_with)만.
  주인이 없는 옛 개인 파일은 모두에게 보인다.
- 공유 대상 바꾸기·개인 파일 지우기·개인 파일을 연결 대상으로 옮기기: 주인(또는 관리자)만.
"""

from django.db.models import Q
from django.http import Http404


def visible_q(model, user) -> Q:
    shared = model.shared_with.through.objects.filter(user_id=user.pk)
    fk = f'{model._meta.model_name}_id'
    return (Q(ref_id__isnull=False) | Q(owner__isnull=True) | Q(owner_id=user.pk)
            | Q(pk__in=shared.values(fk)))


def visible(model, user, qs=None):
    qs = model.objects.all() if qs is None else qs
    return qs.filter(visible_q(model, user))


def scoped(model, request, qs):
    """목록 필터: ?scope=mine (내 개인 파일 + 공유받은 파일), ?ref_type=&ref_id=,
    ?project=<id> (= ref_type 'project'), 없으면 볼 수 있는 전부."""
    qs = visible(model, request.user, qs)
    p = request.query_params
    if p.get('scope') == 'mine':
        qs = qs.filter(ref_id__isnull=True).exclude(owner__isnull=True)
    ref_type, ref_id = p.get('ref_type'), p.get('ref_id')
    if str(p.get('project') or '').isdigit():
        ref_type, ref_id = 'project', p.get('project')
    if ref_type:
        qs = qs.filter(ref_type=ref_type)
    if str(ref_id or '').isdigit():
        qs = qs.filter(ref_id=ref_id)
    return qs


def can_view(obj, user) -> bool:
    if not (user and user.is_authenticated):
        return False
    if obj.ref_id or obj.owner_id is None or obj.owner_id == user.pk:
        return True
    return obj.shared_with.filter(pk=user.pk).exists()


def is_owner(obj, user) -> bool:
    return obj.owner_id is None or obj.owner_id == user.pk or user.is_staff


def get_target(kind: str, pk, user):
    """댓글·공동 편집 대상 파일. 없거나 볼 수 없으면 Http404."""
    from .models import Doc

    if kind != 'doc' or not str(pk).isdigit():
        raise Http404
    obj = Doc.objects.filter(pk=pk).first()
    if obj is None or not can_view(obj, user):
        raise Http404
    return obj
