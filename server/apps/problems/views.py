from django.db import transaction
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Problem, ProcessEdge, ProcessGroup, ProcessNode
from .process import Tree, drop_empty_groups, group_scope, next_order, process_paths, renumber
from .process import seed_default as create_default_process
from .serializers import (
    BulkUpdateSerializer,
    ProblemSerializer,
    ProcessEdgeSerializer,
    ProcessGroupSerializer,
    ProcessNodeSerializer,
    finite,
)


def _truthy(value):
    return str(value).lower() in ('1', 'true', 'yes', 'on')


# 전체 공유: 로그인한 모든 사용자가 모든 데이터를 조회/편집한다.
class ProblemViewSet(viewsets.ModelViewSet):
    serializer_class = ProblemSerializer

    def get_queryset(self):
        qs = Problem.objects.select_related('owner', 'assignee')  # owner_username·assignee_name
        process = self.request.query_params.get('process')
        if process in ('none', 'null'):
            # 프로세스 미지정
            qs = qs.filter(process__isnull=True)
        elif process:
            try:
                pk = int(process)
            except ValueError:
                return qs.none()
            if _truthy(self.request.query_params.get('include_children')):
                qs = qs.filter(process_id__in=Tree().subtree(pk))
            else:
                qs = qs.filter(process_id=pk)
        group = self.request.query_params.get('group')
        if group:
            # 그룹 멤버 단계와 그 하위 단계의 문제
            try:
                gid = int(group)
            except ValueError:
                return qs.none()
            members = ProcessNode.objects.filter(group_id=gid).values_list('id', flat=True)
            qs = qs.filter(process_id__in=group_scope(Tree(), members))
        return qs

    def list(self, request, *args, **kwargs):
        # 프로세스 경로는 단계 전체를 한 번만 읽어 계산한다 (문제마다 위 단계를 따라 읽지 않게)
        items = list(self.filter_queryset(self.get_queryset()))
        context = self.get_serializer_context()
        context['process_paths'] = process_paths(p.process_id for p in items)
        return Response(self.get_serializer(items, many=True, context=context).data)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)


class ProcessMoveSerializer(serializers.Serializer):
    parent = serializers.PrimaryKeyRelatedField(queryset=ProcessNode.objects.all(), allow_null=True)
    order = serializers.IntegerField(required=False, min_value=0, allow_null=True)


class PositionSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    x = serializers.FloatField(validators=[finite])
    y = serializers.FloatField(validators=[finite])


class PositionsSerializer(serializers.Serializer):
    positions = PositionSerializer(many=True, allow_empty=True)


class ProcessNodeViewSet(viewsets.ModelViewSet):
    """회사 프로세스 맵의 단계. 목록은 평평하게(부모 id 포함) 얕은 단계부터 순서대로 준다"""

    serializer_class = ProcessNodeSerializer
    queryset = ProcessNode.objects.select_related('created_by')
    pagination_class = None

    def _list_response(self, http_status=status.HTTP_200_OK):
        tree = Tree()
        nodes = sorted(self.get_queryset(), key=lambda n: (tree.depth(n.pk), n.order, n.pk))
        context = {**self.get_serializer_context(), 'tree': tree}
        return Response(self.get_serializer(nodes, many=True, context=context).data, status=http_status)

    def list(self, request, *args, **kwargs):
        return self._list_response()

    @transaction.atomic
    def perform_create(self, serializer):
        parent = serializer.validated_data.get('parent')
        parent_id = parent.pk if parent else None
        order = serializer.validated_data.pop('order', None)
        node = serializer.save(created_by=self.request.user, order=next_order(parent_id))
        if order is not None:
            renumber(parent_id, moving=node, index=order)

    @transaction.atomic
    def perform_update(self, serializer):
        order = serializer.validated_data.pop('order', None)
        node = serializer.save()
        if order is not None:
            renumber(node.parent_id, moving=node, index=order)
        if 'group' in serializer.validated_data:
            # 그룹에서 빼거나 옮겨 빈 그룹이 생겼으면 지운다
            drop_empty_groups()

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        """단계를 지운다. 하위 단계도 함께 지워지고, 거기 매달린 문제는 윗단계로 (맨 위였으면 미지정으로) 옮긴다"""
        node = self.get_object()
        ids = Tree().subtree(node.pk)
        target = node.parent
        moved = Problem.objects.filter(process_id__in=ids).update(process=target)
        parent_id, title = node.parent_id, node.title
        node.delete()
        renumber(parent_id)
        drop_empty_groups()
        if moved:
            where = f"'{target.title}' 단계" if target else '프로세스 미지정'
            message = f"'{title}' 단계를 지웠습니다. 매달린 문제 {moved}건은 {where}로 옮겼습니다."
        else:
            message = f"'{title}' 단계를 지웠습니다."
        return Response({
            'deleted': len(ids),
            'moved_problems': moved,
            'moved_to': {'id': target.pk, 'title': target.title} if target else None,
            'message': message,
        })

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def move(self, request, pk=None):
        """다른 단계 밑으로(parent: null 이면 맨 위로) 옮기고, 같은 부모 안 order 번째 자리에 놓는다"""
        node = self.get_object()
        ser = ProcessMoveSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        parent = ser.validated_data['parent']
        order = ser.validated_data.get('order')
        if parent is not None and parent.pk in Tree().subtree(node.pk):
            return Response(
                {'parent': ['자기 자신이나 하위 단계 밑으로는 옮길 수 없습니다.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        old_parent_id = node.parent_id
        node.parent = parent
        new_parent_id = parent.pk if parent else None
        renumber(new_parent_id, moving=node, index=order)
        if old_parent_id != new_parent_id:
            renumber(old_parent_id)
        node.refresh_from_db()
        return Response(self.get_serializer(node).data)

    @action(detail=False, methods=['post'])
    @transaction.atomic
    def positions(self, request):
        """그래프에서 끌어 옮기거나 자동 정리한 자리를 한 번에 저장한다: {positions: [{id, x, y}, ...]}.
        그사이 지워진 단계는 건너뛴다"""
        ser = PositionsSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        wanted = {p['id']: (p['x'], p['y']) for p in ser.validated_data['positions']}
        nodes = list(ProcessNode.objects.filter(pk__in=wanted))
        for n in nodes:
            n.x, n.y = wanted[n.pk]
        ProcessNode.objects.bulk_update(nodes, ['x', 'y'])
        return Response({'updated': len(nodes)})

    @action(detail=False, methods=['post'], url_path='bulk-update')
    @transaction.atomic
    def bulk_update(self, request):
        """고른 단계 여러 개를 한꺼번에: {ids: [...], color: 'blue'} (빈 글이면 기본 색으로),
        {ids, group: 3} (그 그룹으로) · {ids, group: null} (그룹에서 빼기). 그사이 지워진 단계는 건너뛴다"""
        ser = BulkUpdateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        fields = {k: ser.validated_data[k] for k in ('color', 'group') if k in ser.validated_data}
        updated = ProcessNode.objects.filter(pk__in=ser.validated_data['ids']).update(**fields)
        if 'group' in fields:
            drop_empty_groups()
        return Response({'updated': updated})

    @action(detail=False, methods=['post'], url_path='seed-default')
    def seed_default(self, request):
        """단계가 하나도 없을 때만 기본 회사 프로세스(영업 → 제작 → 납품 → 사후관리, 옆에 회사 운영)를 만든다"""
        if not create_default_process(request.user):
            return Response(
                {'detail': '이미 프로세스 단계가 있어 기본 프로세스를 만들지 않았습니다.'},
                status=status.HTTP_409_CONFLICT,
            )
        return self._list_response(status.HTTP_201_CREATED)


class ProcessEdgeViewSet(viewsets.ModelViewSet):
    """단계 사이 연결 (흐름·되돌아감·관련). 방향 뒤집기는 PATCH {reverse: true}"""

    serializer_class = ProcessEdgeSerializer
    queryset = ProcessEdge.objects.select_related('created_by')
    pagination_class = None
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class ProcessGroupViewSet(viewsets.ModelViewSet):
    """맵에서 여러 단계를 한 테두리로 묶는 그룹. POST {title, color, nodes: [단계 id]} 로 묶고,
    PATCH 로 이름·색·멤버(nodes)를 바꾸고, DELETE 로 푼다 (단계는 그대로 남는다)"""

    serializer_class = ProcessGroupSerializer
    queryset = ProcessGroup.objects.select_related('created_by')
    pagination_class = None
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    @transaction.atomic
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @transaction.atomic
    def perform_update(self, serializer):
        serializer.save()
