"""문서·슬라이드, 공동 편집 상태, 댓글, 템플릿.

내용의 원본은 Yjs 상태(CollabState.state)다. snapshot 은 편집기가 가끔 REST 로 보내는
보통 JSON 사본으로, 목록 미리보기·검색·내보내기와 첫 불러오기에 쓴다.
JSON 모양은 apps/docs/formats.py 를 본다.
"""

from django.conf import settings
from django.db import models


class Doc(models.Model):
    """문서(doc) 또는 슬라이드(slides) 파일 하나."""

    class Kind(models.TextChoices):
        DOC = 'doc', '문서'
        SLIDES = 'slides', '슬라이드'

    kind = models.CharField('종류', max_length=10, choices=Kind.choices, default=Kind.DOC)
    title = models.CharField('제목', max_length=200)
    # 연결 대상이 있는 파일(ref_id 있음, 예: 프로젝트 문서)은 모두가 보고 고친다.
    # 개인 파일(ref_id 없음)은 owner 와 shared_with 만.
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name='owned_docs', verbose_name='주인')
    # 일반 연결 대상: 다른 기능 묶음의 무엇(ref_type, 예: 'project')의 id. 외래 키가 아니라 그 묶음이 없어도 된다.
    ref_type = models.CharField('연결 종류', max_length=30, blank=True, default='')
    ref_id = models.PositiveBigIntegerField('연결 id', null=True, blank=True)
    shared_with = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name='shared_docs',
                                         verbose_name='공유 대상')
    snapshot = models.JSONField('내용 사본', default=dict, blank=True)
    thumbnail = models.TextField('미리보기', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='+')

    class Meta:
        ordering = ['-updated_at']
        indexes = [models.Index(fields=['ref_type', 'ref_id'])]

    def __str__(self):
        return self.title


class DocAsset(models.Model):
    """문서·슬라이드에 넣은 이미지 파일."""

    doc = models.ForeignKey(Doc, on_delete=models.CASCADE, related_name='assets')
    name = models.CharField(max_length=200, blank=True)
    file = models.FileField(upload_to='docs/%Y/%m/')
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name or self.file.name


class TargetKind(models.TextChoices):
    """공동 편집·댓글 대상. 슬라이드도 Doc 이라 'doc' 이다."""

    DOC = 'doc', '문서·슬라이드'


class CollabState(models.Model):
    """공동 편집 방(kind/id)의 Yjs 상태 (update 형식으로 인코딩한 전체 상태)."""

    kind = models.CharField(max_length=10, choices=TargetKind.choices)
    object_id = models.PositiveBigIntegerField()
    state = models.BinaryField(default=b'')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['kind', 'object_id'], name='collab_state_unique')]


class Comment(models.Model):
    """문서·슬라이드에 다는 댓글. 권한은 대상 파일과 같다.

    anchor 예)
      문서: {"mark": "c-1a2b"} 또는 {"relpos": <Y.RelativePosition JSON>, "quote": "가리킨 글"}
      슬라이드: {"page": "p1", "x": 120, "y": 80, "node": "n3"}  (slide id 는 page 에)
    """

    target_kind = models.CharField(max_length=10, choices=TargetKind.choices)
    target_id = models.PositiveBigIntegerField()
    anchor = models.JSONField(default=dict, blank=True)
    body = models.TextField('내용')
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
                               related_name='doc_comments')
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='replies')
    resolved = models.BooleanField(default=False)
    resolved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name='+')
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at', 'id']
        indexes = [models.Index(fields=['target_kind', 'target_id'])]


class Template(models.Model):
    """새 파일을 만들 때 고르는 틀. content 는 그 종류의 snapshot 과 같은 모양이다."""

    class Kind(models.TextChoices):
        DOC = 'doc', '문서'
        SLIDES = 'slides', '슬라이드'

    kind = models.CharField(max_length=10, choices=Kind.choices)
    name = models.CharField('이름', max_length=100)
    description = models.CharField('설명', max_length=300, blank=True)
    content = models.JSONField('내용', default=dict, blank=True)
    builtin = models.BooleanField('기본 제공', default=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name='doc_templates')
    thumbnail = models.TextField('미리보기', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-builtin', 'kind', 'name']

    def __str__(self):
        return self.name
