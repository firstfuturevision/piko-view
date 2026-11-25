from django.core.management.base import BaseCommand, CommandError

from apps.kb.services.runtime import get_kb
from apps.kb.services.seed import load_glossary


class Command(BaseCommand):
    help = ('서버의 파일이나 폴더를 지식 베이스로 가져온다 (md, txt, pdf, docx, xlsx, csv → Markdown). '
            '폴더는 같은 이름의 문서가 되고 안의 파일이 하위 문서가 된다.')

    def add_arguments(self, parser):
        parser.add_argument('path', help='가져올 파일 또는 폴더')
        parser.add_argument('--parent', default=None, help='이 문서 ID 아래에 넣는다 (비우면 최상위)')
        parser.add_argument('--glossary', default=None, help='함께 넣을 용어집 YAML (term / synonyms / definition)')

    def handle(self, *args, **opts):
        kb = get_kb()
        try:
            results = kb.ingest_path(opts['path'], opts['parent'])
        except (FileNotFoundError, KeyError) as e:
            raise CommandError(str(e))
        for r in results:
            icon = '📁 ' if r.get('folder') else '   '
            self.stdout.write(f"{r['status']:<10} {icon}{r.get('title', r.get('path'))}  {r.get('error', '')}")
        if opts['glossary']:
            from pathlib import Path

            self.stdout.write(f"용어 {load_glossary(kb, Path(opts['glossary']))}개를 넣었습니다.")
