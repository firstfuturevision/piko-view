from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.kb.services.runtime import get_kb
from apps.kb.services.seed import seed


class Command(BaseCommand):
    help = '샘플 문서와 용어집을 지식 베이스에 넣는다 (apps/kb/sample_docs).'

    def handle(self, *args, **opts):
        for r in seed(get_kb(), Path(settings.KB_SAMPLE_DIR)):
            icon = '📁 ' if r.get('folder') else '   '
            self.stdout.write(f"{r['status']:<10} {icon}{r.get('title', r.get('path'))}  {r.get('error', '')}")
