import json

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.response import Response

from . import access
from .collab import notify_comments
from .files import serve_document_file
from .models import Comment, Doc, DocAsset, Template
from .sharing import OwnershipFields, SharingMixin, copy_ystate, display_name, has_ystate

MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024
MAX_THUMBNAIL = 400_000


def _check_thumbnail(value):
    if value and (not value.startswith('data:image/') or len(value) > MAX_THUMBNAIL):
        raise serializers.ValidationError('미리보기 이미지가 올바르지 않거나 너무 큽니다.')
    return value


def _check_json(value, label='내용'):
    if not isinstance(value, dict):
        raise serializers.ValidationError(f'{label} 형식이 올바르지 않습니다.')
    if len(json.dumps(value)) > MAX_SNAPSHOT_BYTES:
        raise serializers.ValidationError(f'{label}이 너무 큽니다 (20MB 초과). 이미지는 파일로 넣어 주세요.')
    return value


# ---------------------------------------------------------------- 문서·슬라이드


class DocListSerializer(OwnershipFields, serializers.ModelSerializer):
    updated_by_name = serializers.SerializerMethodField()
    # 예전 화면 호환: project=<id> 는 ref_type='project', ref_id=<id> 와 같다 (null 이면 개인 파일로)
    project = serializers.IntegerField(required=False, allow_null=True, min_value=1)

    class Meta:
        model = Doc
        fields = ['id', 'kind', 'title', 'owner', 'owner_name', 'ref_type', 'ref_id', 'project', 'shared_with_users',
                  'can_manage', 'thumbnail', 'updated_by_name', 'created_at', 'updated_at']
        read_only_fields = ['id', 'owner', 'created_at', 'updated_at']

    def to_representation(self, obj):
        data = super().to_representation(obj)
        data['project'] = obj.ref_id if obj.ref_type == 'project' else None
        data['project_name'] = None   # 프로젝트 묶음이 없으므로 이름은 모른다 (화면 호환용 칸)
        return data

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if 'project' in attrs:
            project = attrs.pop('project')
            if 'ref_id' not in attrs:
                attrs['ref_type'], attrs['ref_id'] = ('project', project) if project else ('', None)
        if 'ref_id' in attrs and attrs['ref_id'] is None:
            attrs['ref_type'] = ''
        return attrs

    def get_updated_by_name(self, obj):
        return display_name(obj.updated_by)

    def validate_thumbnail(self, value):
        return _check_thumbnail(value)


class DocSerializer(DocListSerializer):
    has_ystate = serializers.SerializerMethodField()

    class Meta(DocListSerializer.Meta):
        fields = DocListSerializer.Meta.fields + ['snapshot', 'has_ystate']

    def get_has_ystate(self, obj):
        return has_ystate('doc', obj.pk)

    def validate_snapshot(self, value):
        return _check_json(value)

    def validate(self, attrs):
        if self.instance is not None and 'kind' in attrs and attrs['kind'] != self.instance.kind:
            raise serializers.ValidationError({'kind': '종류는 바꿀 수 없습니다.'})
        return super().validate(attrs)


class DocViewSet(SharingMixin, viewsets.ModelViewSet):
    """문서·슬라이드. ?kind=doc|slides, ?scope=mine, ?ref_type=&ref_id= (?project=<id>)"""

    collab_kind = 'doc'
    summary_serializer = DocListSerializer

    def get_queryset(self):
        qs = Doc.objects.select_related('owner', 'updated_by').prefetch_related('shared_with')
        qs = access.scoped(Doc, self.request, qs)
        kind = self.request.query_params.get('kind')
        if kind in Doc.Kind.values:
            qs = qs.filter(kind=kind)
        if self.action == 'list':
            qs = qs.defer('snapshot')
        return qs

    def get_serializer_class(self):
        return DocListSerializer if self.action == 'list' else DocSerializer

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        obj = serializer.instance
        before = obj.ref_id
        extra = self.check_ref_change(obj, serializer.validated_data)
        serializer.save(updated_by=self.request.user, **extra)
        self.after_ref_change(obj, before)

    def template_kind(self, obj):
        return obj.kind

    def template_content(self, obj):
        return obj.snapshot

    @action(detail=True, methods=['post'])
    def duplicate(self, request, pk=None):
        src = self.get_object()
        with transaction.atomic():
            copy = Doc.objects.create(kind=src.kind, title=f'{src.title} 사본', ref_type=src.ref_type, ref_id=src.ref_id,
                                      owner=request.user, snapshot=src.snapshot, thumbnail=src.thumbnail,
                                      updated_by=request.user)
            copy_ystate('doc', src.pk, copy.pk)
        return Response(self.summary(copy), status=status.HTTP_201_CREATED)


class AssetSerializerBase(serializers.ModelSerializer):
    file = serializers.FileField(write_only=True)
    url = serializers.SerializerMethodField()
    url_prefix = ''

    def get_url(self, obj):
        return f'{self.url_prefix}{obj.id}/file/'

    def validate_file(self, f):
        if f.size > 30 * 1024 * 1024:
            raise serializers.ValidationError('이미지는 30MB 까지 넣을 수 있습니다.')
        if not (f.content_type or '').startswith('image/'):
            raise serializers.ValidationError('이미지 파일만 넣을 수 있습니다.')
        return f

    def create(self, validated_data):
        if not validated_data.get('name'):
            validated_data['name'] = validated_data['file'].name
        return super().create(validated_data)


class DocAssetSerializer(AssetSerializerBase):
    url_prefix = '/api/doc-assets/'

    class Meta:
        model = DocAsset
        fields = ['id', 'doc', 'name', 'file', 'url', 'width', 'height', 'uploaded_at']
        read_only_fields = ['id', 'url', 'uploaded_at']


class DocAssetViewSet(viewsets.ModelViewSet):
    serializer_class = DocAssetSerializer
    http_method_names = ['get', 'post', 'delete']

    def get_queryset(self):
        qs = DocAsset.objects.filter(doc__in=access.visible(Doc, self.request.user))
        doc = self.request.query_params.get('doc')
        if str(doc or '').isdigit():
            qs = qs.filter(doc_id=doc)
        return qs

    def perform_create(self, serializer):
        if not access.can_view(serializer.validated_data['doc'], self.request.user):
            raise NotFound()
        serializer.save()

    def perform_destroy(self, instance):
        instance.file.delete(save=False)
        instance.delete()

    @action(detail=True, methods=['get'], url_path='file')
    def file(self, request, pk=None):
        return serve_document_file(self.get_object().file, request.query_params.get('download') == '1')


# ---------------------------------------------------------------- 댓글


class CommentSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    resolved_by_name = serializers.SerializerMethodField()
    is_mine = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = ['id', 'target_kind', 'target_id', 'anchor', 'body', 'author', 'author_name', 'is_mine',
                  'parent', 'resolved', 'resolved_by_name', 'resolved_at', 'created_at', 'updated_at']
        read_only_fields = ['id', 'author', 'resolved', 'resolved_at', 'created_at', 'updated_at']

    def get_author_name(self, obj):
        return display_name(obj.author)

    def get_resolved_by_name(self, obj):
        return display_name(obj.resolved_by)

    def get_is_mine(self, obj):
        req = self.context.get('request')
        return bool(req and obj.author_id == req.user.pk)

    def validate_body(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('내용을 입력해 주세요.')
        return value

    def validate_anchor(self, value):
        if not isinstance(value, dict) or len(json.dumps(value)) > 10_000:
            raise serializers.ValidationError('위치 정보가 올바르지 않습니다.')
        return value


class CommentViewSet(viewsets.ModelViewSet):
    """댓글. 목록은 ?kind=doc&id=<파일 id> 가 필요하다. 답글은 parent 로 단다 (한 단계).

    고치기·지우기는 쓴 사람만, 해결(resolve)·다시 열기(reopen)는 파일을 볼 수 있는 누구나.
    바뀌면 공동 편집 방에 알린다 (collab.notify_comments)."""

    serializer_class = CommentSerializer
    http_method_names = ['get', 'post', 'patch', 'delete']

    def get_queryset(self):
        qs = Comment.objects.select_related('author', 'resolved_by')
        if self.action == 'list':
            p = self.request.query_params
            access.get_target(p.get('kind'), p.get('id'), self.request.user)
            qs = qs.filter(target_kind=p.get('kind'), target_id=p.get('id'))
            if p.get('resolved') in ('0', '1'):
                qs = qs.filter(resolved=p.get('resolved') == '1')
        return qs

    def get_object(self):
        obj = get_object_or_404(self.get_queryset(), pk=self.kwargs['pk'])
        access.get_target(obj.target_kind, obj.target_id, self.request.user)
        return obj

    def perform_create(self, serializer):
        d = serializer.validated_data
        access.get_target(d.get('target_kind'), d.get('target_id'), self.request.user)
        parent = d.get('parent')
        if parent is not None:
            if (parent.target_kind, parent.target_id) != (d['target_kind'], d['target_id']):
                raise serializers.ValidationError({'parent': '같은 파일의 댓글에만 답글을 달 수 있습니다.'})
            d['parent'] = parent.parent or parent   # 답글의 답글은 원 댓글에 단다
        c = serializer.save(author=self.request.user)
        notify_comments(c.target_kind, c.target_id, 'created', c.id)

    def perform_update(self, serializer):
        c = serializer.instance
        if c.author_id != self.request.user.pk:
            raise PermissionDenied('내가 쓴 댓글만 고칠 수 있습니다.')
        data = serializer.validated_data
        for key in ('target_kind', 'target_id', 'parent'):
            data.pop(key, None)
        serializer.save()
        notify_comments(c.target_kind, c.target_id, 'updated', c.id)

    def perform_destroy(self, instance):
        if instance.author_id != self.request.user.pk:
            raise PermissionDenied('내가 쓴 댓글만 지울 수 있습니다.')
        kind, target, pk = instance.target_kind, instance.target_id, instance.id
        instance.delete()
        notify_comments(kind, target, 'deleted', pk)

    def _set_resolved(self, resolved: bool):
        c = self.get_object()
        c.resolved = resolved
        c.resolved_by = self.request.user if resolved else None
        c.resolved_at = timezone.now() if resolved else None
        c.save(update_fields=['resolved', 'resolved_by', 'resolved_at', 'updated_at'])
        notify_comments(c.target_kind, c.target_id, 'updated', c.id)
        return Response(self.get_serializer(c).data)

    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        return self._set_resolved(True)

    @action(detail=True, methods=['post'])
    def reopen(self, request, pk=None):
        return self._set_resolved(False)


# ---------------------------------------------------------------- 템플릿


class TemplateSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()

    class Meta:
        model = Template
        fields = ['id', 'kind', 'name', 'description', 'content', 'builtin', 'owner', 'owner_name', 'can_manage',
                  'thumbnail', 'created_at']
        read_only_fields = ['id', 'builtin', 'owner', 'created_at']

    def get_owner_name(self, obj):
        return display_name(obj.owner)

    def get_can_manage(self, obj):
        req = self.context.get('request')
        return bool(req and not obj.builtin and (obj.owner_id == req.user.pk or req.user.is_staff))

    def validate_content(self, value):
        return _check_json(value)

    def validate_thumbnail(self, value):
        return _check_thumbnail(value)


class TemplateListSerializer(TemplateSerializer):
    class Meta(TemplateSerializer.Meta):
        fields = [f for f in TemplateSerializer.Meta.fields if f != 'content']


class TemplateViewSet(viewsets.ModelViewSet):
    """템플릿. 모두가 함께 쓴다. ?kind=doc|slides.
    POST <id>/use/ {title?, ref_type?, ref_id?} (또는 project?) 로 새 파일을 만든다
    (내용은 snapshot 으로 복사, 편집기가 처음 열 때 Yjs 로 옮긴다)."""

    http_method_names = ['get', 'post', 'patch', 'delete']

    def get_queryset(self):
        qs = Template.objects.select_related('owner')
        kind = self.request.query_params.get('kind')
        if kind in Template.Kind.values:
            qs = qs.filter(kind=kind)
        if self.action == 'list':
            qs = qs.defer('content')
        return qs

    def get_serializer_class(self):
        return TemplateListSerializer if self.action == 'list' else TemplateSerializer

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user, builtin=False)

    def _check_manage(self, obj):
        if obj.builtin or not (obj.owner_id == self.request.user.pk or self.request.user.is_staff):
            raise PermissionDenied('내가 만든 템플릿만 바꿀 수 있습니다.')

    def perform_update(self, serializer):
        self._check_manage(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._check_manage(instance)
        instance.delete()

    @action(detail=True, methods=['post'])
    def use(self, request, pk=None):
        t = self.get_object()
        title = str(request.data.get('title') or '').strip()[:200] or t.name
        ref_type = str(request.data.get('ref_type') or '').strip()[:30]
        ref_id = request.data.get('ref_id') or None
        if request.data.get('project') and ref_id is None:
            ref_type, ref_id = 'project', request.data.get('project')
        if ref_id is not None:
            if not str(ref_id).isdigit() or int(ref_id) < 1:
                return Response({'detail': '연결 id 가 올바르지 않습니다.'}, status=status.HTTP_400_BAD_REQUEST)
            ref_id = int(ref_id)
        else:
            ref_type = ''
        user = request.user
        d = Doc.objects.create(kind=t.kind, title=title, ref_type=ref_type, ref_id=ref_id, snapshot=t.content,
                               thumbnail=t.thumbnail, owner=user, updated_by=user)
        data = DocListSerializer(d, context={'request': request}).data
        return Response(data, status=status.HTTP_201_CREATED)
