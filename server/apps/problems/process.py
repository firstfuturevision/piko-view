"""회사 프로세스 맵 계산: 경로 글자, 하위 단계, 단계별 문제 수, 단계 사이 연결, 기본 프로세스.

단계 수는 많아야 수십 개라 한 번에 다 읽어 파이썬에서 계산한다 (질의 수가 단계 수에 따라 늘지 않게).
"""
from collections import defaultdict

from django.db import transaction
from django.db.models import Count
from django.utils import timezone

from .models import Problem, ProcessEdge, ProcessGroup, ProcessNode

PATH_SEP = ' › '

# 기본 회사 프로세스: (이름, 색, 지원 단계, [하위 단계])
DEFAULT_PROCESS = [
    ('영업', 'blue', False, ['문의 응답', '요구사항 정리', '견적', '계약']),
    ('제작', 'violet', False, ['기획', '디자인', '3D·에셋', '개발', 'QA']),
    ('납품', 'emerald', False, ['설치·시연', '인수인계']),
    ('사후관리', 'amber', False, ['유지보수', '고객 피드백']),
    ('회사 운영', 'slate', True, ['일정·인력', '회계·계약서', '장비·도구']),
]

# 기본 프로세스의 되돌아가는 고리: (맨 위 단계, 하위 단계) → (맨 위 단계, 하위 단계), 이름
DEFAULT_LOOPS = [
    (('제작', 'QA'), ('제작', '개발'), '수정 요청'),
]

EDGE_KIND_LABEL = dict(ProcessEdge.Kind.choices)


class Tree:
    """단계 전체를 한 번 읽어 둔 것: id → (이름, 부모 id), 부모 id → 자식 id 목록"""

    def __init__(self, rows=None):
        if rows is None:
            rows = ProcessNode.objects.values_list('id', 'title', 'parent_id', 'order')
        self.title = {}
        self.parent = {}
        self.children = defaultdict(list)
        for pk, title, parent_id, order in sorted(rows, key=lambda r: (r[3], r[0])):
            self.title[pk] = title
            self.parent[pk] = parent_id
            self.children[parent_id].append(pk)

    def ancestors(self, pk):
        """위로 올라가며 (자기 자신 포함, 뿌리 쪽이 앞)"""
        chain = []
        seen = set()
        while pk is not None and pk in self.title and pk not in seen:
            seen.add(pk)
            chain.append(pk)
            pk = self.parent[pk]
        return list(reversed(chain))

    def path(self, pk):
        return PATH_SEP.join(self.title[i] for i in self.ancestors(pk))

    def subtree(self, pk):
        """자기 자신과 모든 하위 단계 id"""
        out = []
        stack = [pk]
        while stack:
            cur = stack.pop()
            out.append(cur)
            stack.extend(self.children.get(cur, []))
        return out

    def depth(self, pk):
        return len(self.ancestors(pk)) - 1


def process_paths(ids):
    """단계 id 들 → '제작 › 개발' 같은 경로 글자. 없으면 단계를 읽지 않는다"""
    ids = {i for i in ids if i}
    if not ids:
        return {}
    tree = Tree()
    return {i: tree.path(i) for i in ids if i in tree.title}


def node_counts(tree):
    """단계마다 문제 수: 자기 단계만(own)과 하위 단계까지 합친 것(total).

    open = 아직 끝나지 않은 문제 (미해결·해결 중·보류), overdue = 그중 결정 기한이 지난 것.
    """
    statuses = [s for s, _ in Problem.Status.choices]
    own_status = defaultdict(lambda: dict.fromkeys(statuses, 0))
    for pid, status, n in (Problem.objects.filter(process__isnull=False)
                           .values_list('process_id', 'status').annotate(n=Count('id'))):
        own_status[pid][status] = n
    own_overdue = dict(Problem.objects.filter(
        process__isnull=False, status__in=Problem.ACTIVE_STATUSES, due_date__lt=timezone.localdate(),
    ).values_list('process_id').annotate(n=Count('id')))

    result = {}
    for pk in tree.title:
        by_status = dict(own_status[pk]) if pk in own_status else dict.fromkeys(statuses, 0)
        by_status_total = dict.fromkeys(statuses, 0)
        overdue_total = 0
        for sub in tree.subtree(pk):
            for s, n in own_status.get(sub, {}).items():
                by_status_total[s] += n
            overdue_total += own_overdue.get(sub, 0)
        result[pk] = {
            'by_status': by_status,
            'by_status_total': by_status_total,
            'open_count': sum(by_status[s] for s in Problem.ACTIVE_STATUSES),
            'open_total': sum(by_status_total[s] for s in Problem.ACTIVE_STATUSES),
            'problem_count': sum(by_status.values()),
            'problem_total': sum(by_status_total.values()),
            'overdue_count': own_overdue.get(pk, 0),
            'overdue_total': overdue_total,
        }
    return result


def group_scope(tree, member_ids):
    """그룹 멤버 단계와 그 하위 단계 id 전부 (멤버끼리 위아래로 겹쳐도 한 번씩)"""
    scope = set()
    for pk in member_ids:
        if pk in tree.title:
            scope.update(tree.subtree(pk))
    return scope


def group_counts(tree, counts, member_ids):
    """그룹의 문제 수: 멤버 단계와 그 하위 단계에 매달린 것 (끝나지 않은 것·기한 지남·전체)"""
    scope = group_scope(tree, member_ids)
    return {
        'open': sum(counts[pk]['open_count'] for pk in scope),
        'overdue': sum(counts[pk]['overdue_count'] for pk in scope),
        'problem_total': sum(counts[pk]['problem_count'] for pk in scope),
    }


def group_members():
    """그룹 id → 멤버 단계 id 목록 (순서대로)"""
    members = defaultdict(list)
    for pk, gid in ProcessNode.objects.filter(group__isnull=False).order_by('order', 'id').values_list('id', 'group_id'):
        members[gid].append(pk)
    return members


def drop_empty_groups():
    """멤버가 하나도 없게 된 그룹을 지운다 (다른 그룹으로 다 옮겨 갔거나 단계를 지웠을 때). 지운 수"""
    deleted, _ = ProcessGroup.objects.filter(members__isnull=True).delete()
    return deleted


def renumber(parent_id, moving=None, index=None):
    """같은 부모 아래 단계들의 order 를 0,1,2… 로 다시 매긴다. moving 을 index 자리에 끼운다"""
    siblings = list(ProcessNode.objects.filter(parent_id=parent_id).order_by('order', 'id'))
    if moving is not None:
        siblings = [n for n in siblings if n.pk != moving.pk]
        if index is None or index > len(siblings):
            index = len(siblings)
        siblings.insert(max(0, index), moving)
    for i, node in enumerate(siblings):
        if node.order != i or (moving is not None and node.pk == moving.pk):
            node.order = i
            node.save(update_fields=['order', 'parent', 'updated_at'])


def next_order(parent_id):
    last = ProcessNode.objects.filter(parent_id=parent_id).order_by('-order').values_list('order', flat=True).first()
    return 0 if last is None else last + 1


def link_flow_in_order(node_model=ProcessNode, edge_model=ProcessEdge, user=None):
    """맨 위 흐름 단계(지원 단계 아님)를 order 순서대로 앞 → 뒤 '흐름' 연결로 잇는다. 만든 연결 수.

    예전에는 맨 위 단계의 순서가 곧 흐름이었다. 연결 그래프로 바꾸며 그 흐름을 연결로 옮겨 두는 데 쓴다
    (마이그레이션에서는 그때의 모델을 넘긴다). 이미 있는 연결은 건드리지 않는다.
    """
    tops = list(node_model.objects.filter(parent__isnull=True, is_support=False).order_by('order', 'id'))
    made = 0
    for a, b in zip(tops, tops[1:]):
        _, created = edge_model.objects.get_or_create(
            source_id=a.pk, target_id=b.pk, defaults={'kind': 'flow', 'created_by_id': getattr(user, 'pk', None)},
        )
        made += created
    return made


def edge_text(edge, tree):
    """'영업 → 제작 (흐름)', 'QA ↔ 개발 (되돌아감: 수정 요청)' 처럼 사람이 읽는 한 줄"""
    arrow = '↔' if edge.bidirectional else '→'
    kind = EDGE_KIND_LABEL.get(edge.kind, edge.kind)
    tail = f'{kind}: {edge.label}' if edge.label else kind
    return f'{tree.path(edge.source_id)} {arrow} {tree.path(edge.target_id)} ({tail})'


@transaction.atomic
def seed_default(user):
    """기본 회사 프로세스를 만든다. 단계가 하나라도 있으면 만들지 않고 False

    맨 위 흐름 단계는 차례로 '흐름' 연결로 잇고, QA → 개발 '수정 요청' 같은 되돌아가는 고리도 하나 둔다.
    """
    if ProcessNode.objects.exists():
        return False
    made = {}
    for i, (title, color, support, children) in enumerate(DEFAULT_PROCESS):
        top = ProcessNode.objects.create(title=title, color=color, is_support=support, order=i, created_by=user)
        made[(title, None)] = top
        for j, child in enumerate(children):
            made[(title, child)] = ProcessNode.objects.create(title=child, parent=top, order=j, created_by=user)
    link_flow_in_order(user=user)
    for src, dst, label in DEFAULT_LOOPS:
        ProcessEdge.objects.create(source=made[src], target=made[dst], kind=ProcessEdge.Kind.LOOP, label=label,
                                   created_by=user)
    return True
