"""외부 에이전트용 문제 해결 도구. 삭제는 사람이 할 일이라 도구로 열지 않는다."""
from typing import Literal

from django.db.models import Q
from django.utils import timezone

from apps.agent.common import LIST_LIMIT, find_user, get_or_fail, save, truncated, user_label
from apps.agent.tools import tool

from .models import Problem, ProcessEdge, ProcessGroup, ProcessNode
from .process import Tree, edge_text, group_counts, group_members, node_counts
from .serializers import ProblemSerializer

ProblemStatus = Literal['open', 'solving', 'on_hold', 'solved', 'paused']

PROBLEM_HINT = 'problem_list 로 ID를 확인하세요.'

READ_ONLY = {'problem_list', 'problem_get', 'process_list'}


def find_process(value: str) -> int | None:
    """프로세스 단계: id·이름·'제작 › 개발' 경로 중 하나로 찾는다. '' 이면 미지정(None)"""
    value = str(value).strip()
    if not value:
        return None
    tree = Tree()
    if value.isdigit() and int(value) in tree.title:
        return int(value)
    wanted = value.replace('>', '›').replace(' ', '')
    by_path = [pk for pk in tree.title if tree.path(pk).replace(' ', '') == wanted]
    by_title = [pk for pk in tree.title if tree.title[pk].replace(' ', '') == wanted]
    found = by_path or by_title
    if len(found) == 1:
        return found[0]
    raise LookupError(
        f"프로세스 단계 '{value}' 를 {'하나로 정할 수 없습니다' if found else '찾지 못했습니다'}. "
        'process_list 로 id 나 경로를 확인하세요.'
    )


def build(user) -> list:
    @tool
    def problem_list(status: ProblemStatus | None = None, assignee: str | None = None,
                     query: str | None = None, process: str | None = None) -> dict:
        """회사가 당면한 문제 목록을 최신순으로 본다.

        Args:
            status: open(미해결) | solving(해결 중) | on_hold(보류 — 오너가 없거나 기다리는 중) | solved(해결 완료) | paused(중단)
            assignee: 문제 오너(담당자)의 아이디 또는 닉네임
            query: 정의·영향·끝나는 조건·어떻게 풀었나에 들어간 글자 (예전에 푼 방법 찾기)
            process: 프로세스 단계 (id·이름·경로) — 그 단계와 하위 단계의 문제만. 'none' 이면 미지정만
        """
        qs = Problem.objects.select_related('assignee')
        tree = Tree()
        if process == 'none':
            qs = qs.filter(process__isnull=True)
        elif process:
            qs = qs.filter(process_id__in=tree.subtree(find_process(process)))
        if status:
            qs = qs.filter(status=status)
        if assignee:
            qs = qs.filter(assignee=find_user(assignee))
        if query:
            qs = qs.filter(Q(definition__icontains=query) | Q(impact__icontains=query)
                           | Q(resolve_condition__icontains=query) | Q(result__icontains=query))
        items = [{
            'id': p.id, 'definition': p.definition, 'status': p.status, 'assignee': user_label(p.assignee),
            'time_budget': p.time_budget or None, 'due_date': p.due_date,
            'idle_days': (timezone.now() - p.updated_at).days,
            'riskiest_unknown': next((u['text'] for u in p.unknowns if u.get('riskiest')), None),
            'process': tree.path(p.process_id) if p.process_id in tree.title else None,
        } for p in qs[:LIST_LIMIT]]
        return truncated(items, qs.count())

    @tool
    def problem_get(problem_id: int) -> dict:
        """문제 하나를 자세히 본다: 정의, 방치 시 영향, 모르는 부분(가장 위험한 가정), 끝나는 조건, 들일 시간.

        Args:
            problem_id: 문제 ID
        """
        return ProblemSerializer(get_or_fail(Problem, problem_id, '문제', PROBLEM_HINT)).data

    @tool
    def problem_create(definition: str, impact: str = '', resolve_condition: str = '', time_budget: str = '',
                       due_date: str | None = None,
                       status: ProblemStatus = 'open', assignee: str | None = None,
                       unknowns: list[dict] = [], process: str | None = None) -> dict:
        """새 문제를 등록한다. 작성자는 API 토큰 주인으로 기록된다.

        Args:
            definition: 문제의 정의 — 지금 무엇이 어떻게 막혀 있는지 한 문장
            impact: 풀지 않고 두면 어떻게 되는지
            resolve_condition: 어떻게 되면 문제가 없어진 것인지 (끝나는 조건)
            time_budget: 들일 시간 (예: 2주, 10시간)
            due_date: 결정 기한 YYYY-MM-DD — 들일 시간이 끝나는 날
            status: open | solving | on_hold | solved | paused
            assignee: 문제 오너의 아이디 또는 닉네임 (user_list 참고)
            unknowns: 모르는 부분 [{"text": str, "riskiest": bool}, ...]. riskiest(가장 위험한 가정)는 최대 하나
            process: 문제가 생긴 회사 프로세스 단계 (id·이름·'제작 › 개발' 경로, process_list 참고)
        """
        data = {'definition': definition, 'impact': impact, 'resolve_condition': resolve_condition,
                'time_budget': time_budget, 'due_date': due_date, 'status': status, 'unknowns': unknowns,
                'assignee': find_user(assignee).id if assignee else None,
                'process': find_process(process) if process else None}
        return save(ProblemSerializer, data=data, owner=user)

    @tool
    def problem_update(problem_id: int, definition: str | None = None, impact: str | None = None,
                       resolve_condition: str | None = None, time_budget: str | None = None,
                       due_date: str | None = None,
                       status: ProblemStatus | None = None, assignee: str | None = None,
                       unknowns: list[dict] | None = None, process: str | None = None,
                       result: str | None = None) -> dict:
        """문제를 고친다. 바꿀 항목만 준다. unknowns 는 목록 전체를 바꾸므로 problem_get 으로 받아 고친 뒤 준다.

        Args:
            problem_id: 문제 ID
            definition: 문제의 정의
            impact: 방치 시 영향
            resolve_condition: 끝나는 조건
            time_budget: 들일 시간
            due_date: 결정 기한 YYYY-MM-DD. '' 이면 비운다
            status: open | solving | on_hold | solved | paused
            assignee: 문제 오너의 아이디 또는 닉네임. '' 이면 비운다
            unknowns: [{"text": str, "riskiest": bool}, ...]
            process: 회사 프로세스 단계 (id·이름·경로). '' 이면 미지정으로
            result: 어떻게 풀었나 (해결·중단할 때 푼 방법이나 멈춘 이유. 다음에 같은 문제가 나면 찾아본다)
        """
        p = get_or_fail(Problem, problem_id, '문제', PROBLEM_HINT)
        data = {k: v for k, v in {
            'definition': definition, 'impact': impact, 'resolve_condition': resolve_condition,
            'time_budget': time_budget, 'status': status, 'unknowns': unknowns, 'result': result,
        }.items() if v is not None}
        if due_date is not None:
            data['due_date'] = due_date or None
        if assignee is not None:
            data['assignee'] = find_user(assignee).id if assignee else None
        if process is not None:
            data['process'] = find_process(process)
        return save(ProblemSerializer, instance=p, data=data, partial=True)

    @tool
    def process_list() -> dict:
        """회사 프로세스 맵을 본다: 단계(하위 단계 나무, 경로와 끝나지 않은 문제 수 — 하위 포함, 자기 색 color —
        비어 있으면 윗단계 색을 물려받음, 든 그룹 group)와 단계 사이 연결(edges: '영업 → 제작 (흐름)',
        '제작 › QA → 제작 › 개발 (되돌아감: 수정 요청)', ↔ 는 양방향), 맵에서 여러 단계를 한 테두리로 묶은
        그룹(groups: 이름·색·멤버 경로·멤버와 그 하위 단계의 끝나지 않은 문제 수).
        연결 종류: 흐름(다음 단계로) · 되돌아감(앞 단계로 돌아가는 고리) · 관련(방향 없는 이어짐)."""
        tree = Tree()
        counts = node_counts(tree)
        nodes = {n.id: n for n in ProcessNode.objects.all()}
        groups = {g.id: g for g in ProcessGroup.objects.all()}
        order = []
        stack = list(reversed(tree.children.get(None, [])))
        while stack:  # 나무 순서 (위 단계 바로 밑에 하위 단계)
            pk = stack.pop()
            order.append(pk)
            stack.extend(reversed(tree.children.get(pk, [])))
        items = [{
            'id': pk, 'path': tree.path(pk), 'parent': tree.parent[pk], 'support': nodes[pk].is_support,
            'description': nodes[pk].description or None,
            'color': nodes[pk].color or None,
            'group': groups[nodes[pk].group_id].title if nodes[pk].group_id in groups else None,
            'open': counts[pk]['open_count'], 'open_with_children': counts[pk]['open_total'],
            'overdue_with_children': counts[pk]['overdue_total'],
        } for pk in order]
        edges = [edge_text(e, tree) for e in ProcessEdge.objects.all()]
        members = group_members()
        group_items = []
        for g in groups.values():
            c = group_counts(tree, counts, members.get(g.id, []))
            group_items.append({
                'id': g.id, 'title': g.title, 'color': g.color or None,
                'members': [tree.path(pk) for pk in members.get(g.id, []) if pk in tree.title],
                'open_with_children': c['open'], 'overdue_with_children': c['overdue'],
            })
        return {'items': items, 'edges': edges, 'groups': group_items}

    return [problem_list, problem_get, problem_create, problem_update, process_list]
