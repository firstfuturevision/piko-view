"""샘플 문서·용어집 적재와 검색 품질 측정 (관리 명령과 테스트가 함께 쓴다)."""
from pathlib import Path

import yaml

from .core import KnowledgeBase


def seed(kb: KnowledgeBase, sample_dir: Path) -> list[dict]:
    """sample_dir 의 하위 폴더(영업, 고객, 정책)가 최상위 문서가 되고, 그 안의 파일이 하위 문서가 된다."""
    results = []
    for folder in sorted(p for p in sample_dir.iterdir() if p.is_dir()):
        results += kb.ingest_path(folder)
    load_glossary(kb, sample_dir / 'glossary.yaml')
    return results


def load_glossary(kb: KnowledgeBase, path: Path) -> int:
    if not path.exists():
        return 0
    items = yaml.safe_load(path.read_text(encoding='utf-8')) or []
    for g in items:
        kb.add_glossary(g['term'], g.get('synonyms', []), g.get('definition', ''))
    return len(items)


def evaluate(kb: KnowledgeBase, cases: list[dict], k: int = 5) -> dict:
    """평가 파일 형식: - q: 질문 / expect: 정답 문서 제목에 들어 있는 문자열. recall@k 와 MRR."""
    modes = ['keyword', 'vector', 'hybrid'] if kb.embedder.enabled else ['keyword']
    report = {}
    for mode in modes:
        hits, rr, misses = 0, 0.0, []
        for c in cases:
            res = kb.search(c['q'], limit=k, mode=mode, log_query=False)
            expect = str(c['expect'])  # YAML이 2026 같은 값을 숫자로 읽으므로 문자열로 맞춘다
            rank = next((i for i, r in enumerate(res, 1) if expect in r['title']), None)
            if rank:
                hits += 1
                rr += 1 / rank
            else:
                misses.append(c['q'])
        report[mode] = {'recall': hits / len(cases), 'mrr': rr / len(cases), 'misses': misses}
    return report
