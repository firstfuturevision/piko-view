import time
from pathlib import Path

import yaml
from django.conf import settings
from django.core.management.base import BaseCommand

from apps.kb.services.runtime import get_kb
from apps.kb.services.seed import evaluate

K = 5


class Command(BaseCommand):
    help = '검색 품질 측정 (recall@5 · MRR). 기본 평가 파일: apps/kb/sample_docs/eval.yaml'

    def add_arguments(self, parser):
        parser.add_argument('path', nargs='?', default=None)

    def handle(self, *args, **opts):
        path = Path(opts['path']) if opts['path'] else Path(settings.KB_SAMPLE_DIR) / 'eval.yaml'
        kb = get_kb()
        while kb.embedder.enabled and kb.embedder.state in ('idle', 'loading'):
            time.sleep(1)  # 의미 검색까지 재려면 모델이 준비돼야 한다
        cases = yaml.safe_load(path.read_text(encoding='utf-8'))
        for mode, r in evaluate(kb, cases, K).items():
            self.stdout.write(f"{mode:<8} recall@{K}={r['recall']:.0%}  MRR={r['mrr']:.2f}")
            for q in r['misses']:
                self.stdout.write(f'         못 찾음: {q}')
