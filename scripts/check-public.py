#!/usr/bin/env python3
"""공개 레포에 올리기 전 검사: 올라갈 파일(커밋할 것 + 아직 안 넣은 새 파일)에 data/public-deny.txt 의 말(회사·고객 이름 등)이 있으면 막는다.
목록은 data/ 라 레포에 안 올라간다. 대소문자 무시. 그림 · 잠금 파일은 건너뛴다."""
import pathlib, subprocess, sys
root = pathlib.Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip())
deny_file = root / 'data' / 'public-deny.txt'
if not deny_file.exists():
    sys.exit('data/public-deny.txt 가 없음 — 금지어 목록을 먼저 두세요')
deny = [l.strip().lower() for l in deny_file.read_text(encoding='utf-8').splitlines() if l.strip() and not l.startswith('#')]
files = subprocess.check_output(['git', 'ls-files', '-co', '--exclude-standard'], cwd=root, text=True).splitlines()
skip = ('.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.woff', '.woff2', '.lock')
hits = []
for f in files:
    if f.endswith(skip) or f.endswith('package-lock.json'):
        continue
    try:
        text = (root / f).read_text(encoding='utf-8')
    except (UnicodeDecodeError, FileNotFoundError):
        continue
    for n, line in enumerate(text.splitlines(), 1):
        low = line.lower()
        for w in deny:
            if w in low:
                hits.append(f'{f}:{n}: "{w}"')
if hits:
    print('\n'.join(hits[:200]))
    sys.exit(f'공개 검사 실패: {len(hits)}곳')
print(f'공개 검사 통과 (금지어 {len(deny)}개, 파일 {len(files)}개)')
