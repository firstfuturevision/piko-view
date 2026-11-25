import math
import re

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Problem, ProcessEdge, ProcessGroup, ProcessNode
from .process import Tree, drop_empty_groups, group_counts, group_members, node_counts, process_paths

COLOR_RE = re.compile(r'^[a-z0-9-]*$')


def clean_color(value):
    """색 이름: 'blue'·'violet' 같은 짧은 영문 소문자 이름. 빈 글이면 기본색 (물려받기)"""
    value = (value or '').strip().lower()
    if not COLOR_RE.match(value):
        raise serializers.ValidationError('색 이름은 영문 소문자로 적습니다 (예: blue).')
    return value


class ProblemSerializer(serializers.ModelSerializer):
    owner_username = serializers.ReadOnlyField(source='owner.username')
    assignee = serializers.PrimaryKeyRelatedField(
        queryset=get_user_model().objects.all(), allow_null=True, required=False,
    )
    assignee_name = serializers.SerializerMethodField()
    process = serializers.PrimaryKeyRelatedField(
        queryset=ProcessNode.objects.all(), allow_null=True, required=False,
    )
    # '제작 › 개발' 처럼 맨 위 단계부터 이은 이름. 목록에서는 view 가 한 번에 계산해 context 로 넘긴다
    process_path = serializers.SerializerMethodField()

    class Meta:
        model = Problem
        fields = [
            'id', 'definition', 'impact', 'resolve_condition', 'result', 'time_budget', 'due_date',
            'status', 'unknowns', 'assignee', 'assignee_name', 'process', 'process_path',
            'owner_username', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'assignee_name', 'process_path', 'owner_username', 'created_at', 'updated_at',
        ]

    def get_process_path(self, obj):
        if not obj.process_id:
            return None
        paths = self.context.get('process_paths')
        if paths is None:
            paths = process_paths([obj.process_id])
        return paths.get(obj.process_id)

    def get_assignee_name(self, obj):
        if obj.assignee is None:
            return None
        # 닉네임(first_name)이 있으면 닉네임, 없으면 아이디
        return obj.assignee.first_name or obj.assignee.username

    def validate_unknowns(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('모르는 부분은 리스트여야 합니다.')
        cleaned = []
        riskiest_count = 0
        for item in value:
            if not isinstance(item, dict) or not str(item.get('text', '')).strip():
                raise serializers.ValidationError('모르는 부분에는 내용이 필요합니다.')
            riskiest = bool(item.get('riskiest', False))
            if riskiest:
                riskiest_count += 1
            cleaned.append({
                'text': str(item['text']).strip(),
                'riskiest': riskiest,
            })
        if riskiest_count > 1:
            raise serializers.ValidationError(
                '가장 위험한 가정은 하나만 지정할 수 있습니다.',
            )
        return cleaned


class ProcessNodeSerializer(serializers.ModelSerializer):
    """회사 프로세스 단계. 목록은 평평하게 (parent id 로 나무를 짓는다), 문제 수는 context 의 tree·counts 로"""

    parent = serializers.PrimaryKeyRelatedField(
        queryset=ProcessNode.objects.all(), allow_null=True, required=False,
    )
    order = serializers.IntegerField(required=False, min_value=0)
    # 맵에서 함께 묶어 보이는 그룹 (하나만). null 이면 그룹 없음
    group = serializers.PrimaryKeyRelatedField(
        queryset=ProcessGroup.objects.all(), allow_null=True, required=False,
    )
    path = serializers.SerializerMethodField()
    depth = serializers.SerializerMethodField()
    counts = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ProcessNode
        fields = [
            'id', 'title', 'description', 'parent', 'order', 'color', 'is_support', 'group', 'x', 'y',
            'path', 'depth', 'counts', 'created_by_name', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'path', 'depth', 'counts', 'created_by_name', 'created_at', 'updated_at']

    def _tree(self):
        if 'tree' not in self.context:
            self.context['tree'] = Tree()
        return self.context['tree']

    def get_path(self, obj):
        return self._tree().path(obj.pk)

    def get_depth(self, obj):
        return self._tree().depth(obj.pk)

    def get_counts(self, obj):
        if 'counts' not in self.context:
            self.context['counts'] = node_counts(self._tree())
        return self.context['counts'].get(obj.pk)

    def get_created_by_name(self, obj):
        return _user_name(obj.created_by)

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('단계 이름이 필요합니다.')
        return value

    def validate_color(self, value):
        return clean_color(value)

    def validate_x(self, value):
        return finite(value)

    def validate_y(self, value):
        return finite(value)

    def validate(self, attrs):
        # 부모 바꾸기는 move 로만 (고리가 생기지 않는지 거기서 본다)
        if self.instance is not None and 'parent' in attrs and attrs['parent'] != self.instance.parent:
            raise serializers.ValidationError({'parent': '다른 단계 밑으로 옮기려면 move 를 쓰세요.'})
        return attrs


def finite(value):
    if value is not None and not math.isfinite(value):
        raise serializers.ValidationError('자리는 유한한 숫자여야 합니다.')
    return value


def _user_name(u):
    return (u.first_name or u.username) if u else None


class ProcessGroupSerializer(serializers.ModelSerializer):
    """단계 그룹. nodes 는 멤버 단계 id 목록: 만들 때 그 단계들을 묶고(다른 그룹에 있던 단계는 옮겨 온다),
    PATCH 로 주면 멤버를 그 목록으로 바꾼다. counts 는 멤버와 그 하위 단계에 매달린 문제 수"""

    nodes = serializers.PrimaryKeyRelatedField(
        queryset=ProcessNode.objects.all(), many=True, required=False, write_only=True,
    )
    counts = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ProcessGroup
        fields = ['id', 'title', 'color', 'nodes', 'counts', 'created_by_name', 'created_at', 'updated_at']
        read_only_fields = ['id', 'counts', 'created_by_name', 'created_at', 'updated_at']

    def _get(self, key, make):
        if key not in self.context:
            self.context[key] = make()
        return self.context[key]

    def _members(self):
        return self._get('members', group_members)

    def _tree(self):
        return self._get('tree', Tree)

    def to_representation(self, obj):
        data = super().to_representation(obj)
        data['nodes'] = self._members().get(obj.pk, [])
        return data

    def get_counts(self, obj):
        counts = self._get('counts', lambda: node_counts(self._tree()))
        return group_counts(self._tree(), counts, self._members().get(obj.pk, []))

    def get_created_by_name(self, obj):
        return _user_name(obj.created_by)

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('그룹 이름이 필요합니다.')
        return value

    def validate_color(self, value):
        return clean_color(value)

    def validate_nodes(self, value):
        if not value:
            raise serializers.ValidationError('묶을 단계를 하나 이상 고르세요. 그룹을 없애려면 그룹 풀기(삭제)를 쓰세요.')
        return value

    def validate(self, attrs):
        if self.instance is None and not attrs.get('nodes'):
            raise serializers.ValidationError({'nodes': '묶을 단계를 하나 이상 고르세요.'})
        return attrs

    def _set_members(self, group, nodes):
        ids = [n.pk for n in nodes]
        ProcessNode.objects.filter(group=group).exclude(pk__in=ids).update(group=None)
        ProcessNode.objects.filter(pk__in=ids).update(group=group)
        # 다른 그룹에서 모두 옮겨 와 빈 그룹이 생겼으면 지운다
        drop_empty_groups()

    def create(self, validated_data):
        nodes = validated_data.pop('nodes')
        group = super().create(validated_data)
        self._set_members(group, nodes)
        return group

    def update(self, instance, validated_data):
        nodes = validated_data.pop('nodes', None)
        group = super().update(instance, validated_data)
        if nodes is not None:
            self._set_members(group, nodes)
        return group


class BulkUpdateSerializer(serializers.Serializer):
    """여러 단계를 한꺼번에 고친다: 색(빈 글이면 기본 색으로)이나 그룹(null 이면 그룹에서 빼기)"""

    ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)
    color = serializers.CharField(max_length=20, allow_blank=True, required=False)
    group = serializers.PrimaryKeyRelatedField(queryset=ProcessGroup.objects.all(), allow_null=True, required=False)

    def validate_color(self, value):
        return clean_color(value)

    def validate(self, attrs):
        if 'color' not in attrs and 'group' not in attrs:
            raise serializers.ValidationError('바꿀 항목(color·group)을 주세요.')
        return attrs


class ProcessEdgeSerializer(serializers.ModelSerializer):
    """단계 사이 연결. 잇는 두 단계(source·target)는 만들 때만 정하고, 방향은 PATCH {reverse: true} 로 뒤집는다.
    source_side·target_side: 선이 나가고 들어오는 카드 변 ('left'·'right'·'top'·'bottom', '' 은 자동)"""

    source = serializers.PrimaryKeyRelatedField(queryset=ProcessNode.objects.all())
    target = serializers.PrimaryKeyRelatedField(queryset=ProcessNode.objects.all())
    # 쓰기 전용: true 면 방향(source ↔ target)을 뒤집는다
    reverse = serializers.BooleanField(write_only=True, required=False, default=False)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ProcessEdge
        fields = [
            'id', 'source', 'target', 'label', 'kind', 'bidirectional', 'source_side', 'target_side', 'reverse',
            'created_by_name', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_by_name', 'created_at', 'updated_at']
        # 같은 짝 검사는 아래 validate 에서 (뒤집기까지 보고) 알아듣기 쉬운 말로 한다
        validators = []

    def get_created_by_name(self, obj):
        return _user_name(obj.created_by)

    def validate_label(self, value):
        return value.strip()

    def validate(self, attrs):
        inst = self.instance
        if inst is not None:
            for key in ('source', 'target'):
                if key in attrs and attrs[key] != getattr(inst, key):
                    raise serializers.ValidationError({key: '잇는 단계는 바꿀 수 없습니다. 지우고 새로 이으세요.'})
            source, target = inst.source, inst.target
            if attrs.get('reverse'):
                source, target = target, source
                # 시작점·끝점도 함께 바꾼다. 같은 요청에 변을 함께 보내면 그것은 뒤집은 뒤의 방향 기준
                attrs['source_side'], attrs['target_side'] = (
                    attrs.get('source_side', inst.target_side), attrs.get('target_side', inst.source_side),
                )
        else:
            attrs.pop('reverse', None)
            source, target = attrs['source'], attrs['target']
        if source.pk == target.pk:
            raise serializers.ValidationError({'target': '같은 단계끼리는 이을 수 없습니다.'})
        dup = ProcessEdge.objects.filter(source=source, target=target)
        if inst is not None:
            dup = dup.exclude(pk=inst.pk)
        if dup.exists():
            raise serializers.ValidationError(
                {'target': f"'{source.title}' → '{target.title}' 연결이 이미 있습니다."},
            )
        attrs['source'], attrs['target'] = source, target
        attrs.pop('reverse', None)
        return attrs
