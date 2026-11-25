from django.conf import settings
from django.db import models
from django.db.models import F, Q


class ProcessGroup(models.Model):
    """맵 위에서 여러 단계를 한 테두리로 묶어 보이는 그룹 (예: '고객 접점').

    나무(parent)와 상관없이 아무 단계나 묶는다. 한 단계는 그룹 하나에만 든다.
    그룹을 풀면(지우면) 단계는 그대로 남고 그룹만 없어진다.
    """

    title = models.CharField('이름', max_length=60)
    # 단계 color 와 같은 짧은 색 이름 (blue, violet …). 비우면 회색
    color = models.CharField('색', max_length=20, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return self.title


class ProcessNode(models.Model):
    """회사 프로세스의 한 단계. 문제는 이 단계 중 하나에 매달아 어느 부분에서 막히는지 추적한다.

    parent 는 '하위 단계' 묶음 (제작 › 개발): 문제 수를 하위 포함으로 셀 때 쓴다.
    단계 사이의 일 흐름은 방향이 자유로운 연결(ProcessEdge)로 따로 잇는다 (되돌아가는 고리도 된다).
    is_support 가 켜진 맨 위 단계(회사 운영 같은 것)는 흐름 밖에서 회사를 받치는 일이다.
    """

    title = models.CharField('이름', max_length=100)
    description = models.TextField('설명', blank=True)
    parent = models.ForeignKey(
        'self', on_delete=models.CASCADE, null=True, blank=True, related_name='children',
    )
    order = models.IntegerField('순서', default=0)
    # 맵에서 쓰는 짧은 색 이름 (blue, violet, emerald …). 비우면 기본색
    color = models.CharField('색', max_length=20, blank=True)
    # 흐름 밖 지원 단계 (회사 운영 등): 맵에서 화살표 흐름 옆에 따로 놓는다
    is_support = models.BooleanField('지원 단계', default=False)
    # 맵에서 함께 묶어 보이는 그룹 (하나만). 그룹을 지우면 비워진다
    group = models.ForeignKey(
        ProcessGroup, on_delete=models.SET_NULL, null=True, blank=True, related_name='members',
        verbose_name='그룹',
    )
    # 그래프에 놓인 자리 (끌어 옮기거나 자동 정리한 결과). 비어 있으면 화면이 자동으로 놓고 저장한다
    x = models.FloatField(null=True, blank=True)
    y = models.FloatField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self):
        return self.title


class ProcessEdge(models.Model):
    """두 단계를 잇는 화살표. 흐름(다음 단계로), 되돌아감(앞 단계로 돌아가는 고리), 관련(방향 없는 이어짐)"""

    class Kind(models.TextChoices):
        FLOW = 'flow', '흐름'
        LOOP = 'loop', '되돌아감'
        RELATED = 'related', '관련'

    class Side(models.TextChoices):
        AUTO = '', '자동'
        LEFT = 'left', '왼쪽'
        RIGHT = 'right', '오른쪽'
        TOP = 'top', '위'
        BOTTOM = 'bottom', '아래'

    source = models.ForeignKey(ProcessNode, on_delete=models.CASCADE, related_name='out_edges')
    target = models.ForeignKey(ProcessNode, on_delete=models.CASCADE, related_name='in_edges')
    label = models.CharField('이름', max_length=60, blank=True)
    kind = models.CharField('종류', max_length=10, choices=Kind.choices, default=Kind.FLOW)
    # 양쪽 다 화살표 (서로 주고받는 일)
    bidirectional = models.BooleanField('양방향', default=False)
    # 선이 카드의 어느 변 가운데에서 나가고(source_side) 들어오는지(target_side). 비우면 두 카드 자리를 보고 자동
    source_side = models.CharField('시작점', max_length=6, choices=Side.choices, blank=True, default='')
    target_side = models.CharField('끝점', max_length=6, choices=Side.choices, blank=True, default='')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']
        constraints = [
            models.UniqueConstraint(fields=['source', 'target'], name='problems_edge_unique_pair'),
            models.CheckConstraint(condition=~Q(source=F('target')), name='problems_edge_no_self_loop'),
        ]

    def __str__(self):
        return f'{self.source} → {self.target}'


class Problem(models.Model):
    """회사가 당면한 문제. 구체적일 수도, 추상적일 수도 있다."""

    # 아직 끝나지 않은 상태 (해결 완료·중단이 아닌 것)
    ACTIVE_STATUSES = ('open', 'solving', 'on_hold')

    class Status(models.TextChoices):
        OPEN = 'open', '미해결'
        SOLVING = 'solving', '해결 중'
        SOLVED = 'solved', '해결 완료'
        ON_HOLD = 'on_hold', '보류'
        PAUSED = 'paused', '중단'

    # 작성자 (기록용)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='problems',
    )
    # 문제의 오너 (담당자) — 서버에 등록된 사용자 중 선택
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assigned_problems',
    )
    # 지금 무엇이 어떻게 막혀 있는지에 대한 현상 (한 문장 정도)
    definition = models.CharField('문제의 정의', max_length=300)
    # 풀지 않았을 때 어떻게 되는지 (그대로 두면 막히는 것들)
    impact = models.TextField('방치 시 영향', blank=True)
    # 어떻게 하면 문제가 없어지는지
    resolve_condition = models.TextField('끝나는 조건', blank=True)
    time_budget = models.CharField('들일 시간', max_length=100, blank=True)
    # 해결·중단할 때 어떻게 풀었는지(또는 왜 멈췄는지). 같은 문제가 다시 나면 찾아본다
    result = models.TextField('어떻게 풀었나', blank=True)
    # 들일 시간이 끝나는 날. 지나면 '시간 끝 — 결정할 때'로 표시한다
    due_date = models.DateField('결정 기한', null=True, blank=True)
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.OPEN,
    )
    # 모르는 부분 목록: [{"text": str, "riskiest": bool}, ...]
    # riskiest(가장 위험한 가정)는 최대 1개만 허용
    unknowns = models.JSONField('모르는 부분', default=list, blank=True)
    # 이 문제가 생긴 회사 프로세스 단계. 단계를 지우면 서버가 윗단계로 옮겨 둔다 (그래도 없으면 미지정)
    process = models.ForeignKey(
        ProcessNode, on_delete=models.SET_NULL, null=True, blank=True, related_name='problems',
        verbose_name='프로세스 단계',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.definition
