"""지식 베이스(KB) 스키마.

검색 핵심 경로(FTS5 전문 검색, 벡터 행렬, 트리 재귀)는 services/core.py 가 SQL 로 직접 다루므로
문서 참조는 FK 대신 문자열 ID 로 둔다 (삭제 순서를 서비스 계층이 책임진다).
FTS5 가상 테이블과 조각 삭제 트리거는 마이그레이션(0002)에서 만든다.
"""
from django.db import models


class KBDocument(models.Model):
    class Status(models.TextChoices):
        ACTIVE = 'active', '활성'
        SUPERSEDED = 'superseded', '구버전'
        PROPOSED = 'proposed', '승인 대기'
        REJECTED = 'rejected', '반려'

    # d_(가져온 파일) · n_(노트) · w_(위키) + uuid 10자리
    id = models.CharField(primary_key=True, max_length=20)
    title = models.CharField('제목', max_length=300)
    doc_type = models.CharField('형식', max_length=10)  # md|txt|pdf|docx|xlsx|csv|note|wiki
    parent_id = models.CharField('상위 문서', max_length=20, null=True, blank=True)
    position = models.FloatField(default=0)
    source_path = models.TextField('원본 경로', null=True, blank=True)
    raw_path = models.TextField(null=True, blank=True)
    md_path = models.TextField(null=True, blank=True)
    content_hash = models.CharField(max_length=64, db_index=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)
    created_by = models.CharField(max_length=10, default='system')  # human | agent | system
    author = models.CharField('작성자', max_length=150, blank=True, default='')
    created_at = models.FloatField()
    updated_at = models.FloatField()
    edited_at = models.FloatField(null=True, blank=True)  # 가져온 문서를 KB 안에서 고친 시각
    text = models.TextField('본문', blank=True, default='')

    class Meta:
        db_table = 'kb_documents'
        indexes = [
            models.Index(fields=['parent_id', 'position'], name='kb_doc_parent_idx'),
            models.Index(fields=['source_path'], name='kb_doc_source_idx'),
        ]

    def __str__(self):
        return self.title


class KBChunk(models.Model):
    # id 가 FTS5 의 rowid 로 쓰인다
    id = models.BigAutoField(primary_key=True)
    doc_id = models.CharField(max_length=20)
    ord = models.IntegerField()
    heading = models.TextField(default='', blank=True)
    text = models.TextField()
    embedding = models.BinaryField(null=True, blank=True)  # float32 벡터
    embed_model = models.CharField(max_length=200, null=True, blank=True)

    class Meta:
        db_table = 'kb_chunks'
        indexes = [models.Index(fields=['doc_id', 'ord'], name='kb_chunk_doc_idx')]


class KBTag(models.Model):
    doc_id = models.CharField(max_length=20)
    tag = models.CharField(max_length=100)

    class Meta:
        db_table = 'kb_tags'
        constraints = [models.UniqueConstraint(fields=['doc_id', 'tag'], name='kb_tag_unique')]


class KBLink(models.Model):
    """references: 본문의 [[ ]] 에서 자동 생성 / supersedes: 새 버전 → 이전 버전."""

    src = models.CharField(max_length=20)
    dst = models.CharField(max_length=20)
    kind = models.CharField(max_length=20)
    note = models.CharField(max_length=200, default='', blank=True)
    created_by = models.CharField(max_length=10, default='system')
    created_at = models.FloatField()

    class Meta:
        db_table = 'kb_links'
        constraints = [models.UniqueConstraint(fields=['src', 'dst', 'kind'], name='kb_link_unique')]
        indexes = [models.Index(fields=['dst'], name='kb_link_dst_idx')]


class KBGlossary(models.Model):
    term = models.CharField('용어', primary_key=True, max_length=100)
    synonyms = models.TextField('동의어(JSON)', default='[]')
    definition = models.TextField('뜻', default='', blank=True)

    class Meta:
        db_table = 'kb_glossary'
        verbose_name = '용어'
        verbose_name_plural = '용어집'


class KBSearchLog(models.Model):
    ts = models.FloatField()
    query = models.TextField()
    scope = models.CharField(max_length=20, null=True, blank=True)
    n = models.IntegerField()
    top_doc = models.CharField(max_length=20, null=True, blank=True)

    class Meta:
        db_table = 'kb_search_log'
