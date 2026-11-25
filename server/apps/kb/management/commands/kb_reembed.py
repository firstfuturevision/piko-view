import time

from django.core.management.base import BaseCommand

from apps.kb.services.runtime import get_kb


class Command(BaseCommand):
    help = '임베딩 모델을 바꿨거나 벡터가 빠진 조각을 다시 계산한다 (모델이 없으면 먼저 내려받는다).'

    def handle(self, *args, **opts):
        kb = get_kb()
        if not kb.embedder.enabled:
            self.stdout.write('임베딩이 꺼져 있습니다 (PIKO_KB_EMBED=none).')
            return
        self.stdout.write(f'모델 준비 중: {kb.embedder.name} (처음이면 내려받습니다)')
        while kb.embedder.state in ('idle', 'loading'):
            time.sleep(1)
        if kb.embedder.state == 'error':
            self.stderr.write(f'모델을 불러오지 못했습니다: {kb.embedder.error}')
            return
        self.stdout.write(f'다시 계산한 조각: {kb.reembed()}개')
