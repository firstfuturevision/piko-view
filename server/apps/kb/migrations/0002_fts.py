"""FTS5 전문 검색 테이블. rowid = kb_chunks.id, tokens = 토큰화한 텍스트.

조각이 지워지면(문서 삭제·재색인) 트리거가 검색 색인도 함께 지운다.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('kb', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(
            sql=[
                'CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(tokens)',
                'CREATE TRIGGER IF NOT EXISTS kb_chunks_fts_delete AFTER DELETE ON kb_chunks '
                'BEGIN DELETE FROM kb_chunks_fts WHERE rowid = old.id; END',
            ],
            reverse_sql=[
                'DROP TRIGGER IF EXISTS kb_chunks_fts_delete',
                'DROP TABLE IF EXISTS kb_chunks_fts',
            ],
        ),
    ]
