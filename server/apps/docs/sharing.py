"""문서 파일 공통: 주인·공유 표시, 공유하기/풀기, 연결 대상 옮기기 권한, 템플릿으로 저장."""

from django.contrib.auth import get_user_model
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from . import access
from .collab import recheck_access
from .models import CollabState, Template


def display_name(u):
    return (u.first_name or u.username) if u else ''


class OwnershipFields(serializers.Serializer):
    """목록·상세 응답에 붙는 주인·공유 정보."""

    owner_name = serializers.SerializerMethodField()
    shared_with_users = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()

    def get_owner_name(self, obj):
        return display_name(obj.owner)

    def get_shared_with_users(self, obj):
        return [{'id': u.id, 'name': display_name(u)} for u in obj.shared_with.all()]

    def get_can_manage(self, obj):
        req = self.context.get('request')
        return bool(req and access.is_owner(obj, req.user))


def has_ystate(kind, pk) -> bool:
    row = CollabState.objects.filter(kind=kind, object_id=pk).only('state').first()
    return bool(row and len(row.state) > 2)


def copy_ystate(kind, src_pk, dst_pk):
    row = CollabState.objects.filter(kind=kind, object_id=src_pk).first()
    if row:
        CollabState.objects.create(kind=kind, object_id=dst_pk, state=row.state)


class SharingMixin:
    """ModelViewSet 에 섞는다. collab_kind 와 template_kind(obj) 를 정한다."""

    collab_kind = ''
    summary_serializer = None   # 목록용 (가벼운) 시리얼라이저

    def summary(self, obj):
        return self.summary_serializer(obj, context=self.get_serializer_context()).data

    def template_content(self, obj):
        raise NotImplementedError

    def template_kind(self, obj):
        return self.collab_kind

    def check_ref_change(self, obj, data):
        """개인 파일을 연결 대상(예: 프로젝트)으로 내보내거나 연결 파일을 개인 파일로 가져오는 것은 주인만.
        돌려주는 dict 는 save() 에 함께 넘길 값."""
        if 'ref_id' not in data:
            return {}
        new_id = data.get('ref_id') or None
        if (obj.ref_id is None) == (new_id is None):
            return {}
        user = self.request.user
        if not access.is_owner(obj, user):
            raise PermissionDenied('개인 파일은 만든 사람만 옮길 수 있습니다.')
        return {'owner': user} if new_id is None and obj.owner_id is None else {}

    def after_ref_change(self, obj, before_ref_id):
        if before_ref_id and not obj.ref_id:
            recheck_access(self.collab_kind, obj.pk)

    def perform_destroy(self, instance):
        if instance.ref_id is None and not access.is_owner(instance, self.request.user):
            raise PermissionDenied('개인 파일은 만든 사람만 지울 수 있습니다.')
        for a in instance.assets.all():
            a.file.delete(save=False)
        pk = instance.pk
        instance.delete()
        recheck_access(self.collab_kind, pk)

    def _user_ids(self, request):
        ids = request.data.get('user_ids')
        if not isinstance(ids, list) or not all(str(i).isdigit() for i in ids):
            return None
        return get_user_model().objects.filter(pk__in=[int(i) for i in ids], is_active=True)

    @action(detail=True, methods=['post'])
    def share(self, request, pk=None):
        """{user_ids: [..]} 를 공유 대상에 더한다."""
        obj = self.get_object()
        if not access.is_owner(obj, request.user):
            raise PermissionDenied('만든 사람만 공유할 수 있습니다.')
        users = self._user_ids(request)
        if users is None:
            return Response({'detail': 'user_ids 목록이 필요합니다.'}, status=status.HTTP_400_BAD_REQUEST)
        obj.shared_with.add(*users.exclude(pk=obj.owner_id))
        return Response(self.summary(obj))

    @action(detail=True, methods=['post'])
    def unshare(self, request, pk=None):
        """{user_ids: [..]} 를 공유 대상에서 뺀다. 그 사람의 편집 연결도 끊긴다."""
        obj = self.get_object()
        if not access.is_owner(obj, request.user):
            raise PermissionDenied('만든 사람만 공유를 바꿀 수 있습니다.')
        users = self._user_ids(request)
        if users is None:
            return Response({'detail': 'user_ids 목록이 필요합니다.'}, status=status.HTTP_400_BAD_REQUEST)
        obj.shared_with.remove(*users)
        recheck_access(self.collab_kind, obj.pk)
        return Response(self.summary(obj))

    @action(detail=True, methods=['post'], url_path='save-template')
    def save_template(self, request, pk=None):
        """지금 내용(snapshot·data)으로 템플릿을 만든다. {name, description?}"""
        obj = self.get_object()
        name = str(request.data.get('name') or '').strip()[:100]
        if not name:
            return Response({'detail': '템플릿 이름을 입력해 주세요.'}, status=status.HTTP_400_BAD_REQUEST)
        t = Template.objects.create(kind=self.template_kind(obj), name=name,
                                    description=str(request.data.get('description') or '')[:300],
                                    content=self.template_content(obj), owner=request.user,
                                    thumbnail=obj.thumbnail)
        from .views import TemplateSerializer
        return Response(TemplateSerializer(t, context={'request': request}).data, status=status.HTTP_201_CREATED)
