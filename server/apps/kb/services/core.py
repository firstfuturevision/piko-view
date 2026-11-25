"""Knowledge Base 서비스: 저장(ingest) · 정리(organize) · 불러오기(retrieve) · 그래프.

문서는 모두 Markdown이고, 문서 아래에 문서를 두는 트리(상위/하위 문서)로 관리한다.
활성 문서는 pages/ 아래에 트리와 같은 폴더 구조의 .md 파일로도 남긴다 (Git 관리용, KB → 파일 한 방향).
"""
import hashlib
import json
import logging
import re
import shutil
import time
import uuid
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import quote, unquote

import numpy as np

from . import extract as ex
from .db import DB
from .embed import Embedder, EmbedderNotReady
from .textproc import fts_query, tokens

log = logging.getLogger(__name__)

# 문서 사이 관계는 두 가지뿐이다. 둘 다 사람이 따로 지정하지 않는다.
#   references: 본문에 쓴 [[문서 제목]] / [문서ID] 에서 자동으로 생긴다 (본문을 고치면 바뀐다)
#   supersedes: 같은 원본 파일의 새 버전을 가져올 때 자동으로 생기는 버전 기록 (새 버전 → 이전 버전)
LINK_KINDS = {'references': '참조 (본문)', 'supersedes': '대체 (새 버전 → 이전 버전)'}
RRF_K = 60
# 작은 로컬 임베딩 모델은 엉뚱한 문서도 비슷하다고 보는 경우가 많아 키워드 쪽 비중을 높게 둔다
VIA_WEIGHT = {'keyword': 1.0, 'vector': 0.7}
MIN_REL_SCORE = 0.5  # 1위 점수의 절반에 못 미치는 결과는 버린다
WIKI_BOOST = 1.2
MAX_CHUNKS_PER_DOC = 2
MIN_VECTOR_SIM = 0.2
SIMILAR_THRESHOLD = {'vector': 0.4, 'keyword': 0.1}
CENTER_MIN_DOCS = 5
# 범위(under) 검색에서 벡터 후보를 전체 상위 N개로 자르면 큰 KB에서 하위 트리 조각이 빠진다.
# 범위를 준 경우에는 범위 안의 조각만으로 유사도를 계산한다.
VECTOR_CANDIDATES = 200
# 문서에 첨부할 수 있는 파일. SVG·HTML처럼 스크립트를 품을 수 있는 형식은 받지 않는다.
ATTACH_TYPES = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.hwp': 'application/x-hwp', '.hwpx': 'application/x-hwp+zip',
}
MAX_ATTACH_BYTES = 25 * 1024 * 1024
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 문서로 변환해 가져오는 파일 한 개의 최대 크기
_FILE_REF = re.compile(r'\(files/([0-9a-f]{12})/([^)\s]+)\)')  # 본문의 (files/<해시>/<파일명>)
AUTHORED_TYPES = ('note', 'wiki')  # KB 안에서 쓴 문서 (가져온 파일이 아닌 것)
_TITLE_REF = re.compile(r'\[\[([^\]\n]+)\]\]')
_ID_REF = re.compile(r'\[((?:d|w|n)_[0-9a-f]{10})\]')


def _now() -> float:
    return time.time()


def _new_id(prefix: str) -> str:
    return f'{prefix}_{uuid.uuid4().hex[:10]}'


def _safe_name(title: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', '_', title).strip().rstrip('.') or 'untitled'


def _remove_file(path: Path, stop: Path | None):
    """파일을 지우고, 비게 된 상위 폴더를 stop(pages/) 직전까지 정리한다."""
    path.unlink(missing_ok=True)
    parent = path.parent
    while stop and parent != stop and stop in parent.parents:
        try:
            parent.rmdir()  # 비어 있을 때만 지워진다
        except OSError:
            break
        parent = parent.parent


class KnowledgeBase:
    def __init__(self, db: DB, embedder: Embedder, raw_dir: Path, pages_dir: Path | None = None,
                 files_dir: Path | None = None):
        self.db = db
        self.embedder = embedder
        self.raw_dir = Path(raw_dir)
        self.pages_dir = Path(pages_dir).resolve() if pages_dir else None
        self.files_dir = Path(files_dir).resolve() if files_dir else self.raw_dir.parent.resolve() / 'files'
        self._vcache = None
        self._term_cache: dict[str, tuple[float, set[str]]] = {}

    def _encode(self, texts: list[str], kind: str = 'passage'):
        """임베딩. 모델이 준비 중이거나 실패하면 None (키워드 색인만 쓴다)."""
        if not self.embedder.enabled:
            return None
        try:
            return self.embedder.encode(texts, kind=kind)
        except EmbedderNotReady:
            return None
        except Exception as e:
            log.warning('임베딩 실패 — 키워드만 사용합니다: %s', e)
            return None

    # ================================================================ 트리
    def _doc(self, doc_id: str) -> dict:
        d = self.db.one('SELECT * FROM kb_documents WHERE id=?', (doc_id,))
        if not d:
            raise KeyError(f'문서가 없습니다: {doc_id}')
        return d

    def ancestors(self, doc_id: str) -> list[dict]:
        """최상위부터 바로 위 문서까지."""
        out, cur, seen = [], self._doc(doc_id)['parent_id'], set()
        while cur and cur not in seen:
            seen.add(cur)
            d = self.db.one('SELECT id, title, parent_id FROM kb_documents WHERE id=?', (cur,))
            if not d:
                break
            out.append({'id': d['id'], 'title': d['title']})
            cur = d['parent_id']
        return out[::-1]

    def descendants(self, doc_id: str) -> list[str]:
        rows = self.db.q(
            'WITH RECURSIVE sub(id) AS (SELECT id FROM kb_documents WHERE parent_id=? '
            'UNION SELECT d.id FROM kb_documents d JOIN sub ON d.parent_id=sub.id) SELECT id FROM sub',
            (doc_id,),
        )
        return [r['id'] for r in rows]

    def children(self, doc_id: str | None) -> list[dict]:
        return self.db.q(
            "SELECT id, title, doc_type, status FROM kb_documents WHERE parent_id IS ? AND status IN ('active','proposed') "
            'ORDER BY position, title',
            (doc_id,),
        )

    def _next_position(self, parent_id: str | None) -> float:
        return self.db.one('SELECT coalesce(max(position), -1) + 1 p FROM kb_documents WHERE parent_id IS ?',
                           (parent_id,))['p']

    def move(self, doc_id: str, parent_id: str | None = None, index: int | None = None) -> dict:
        """문서를 parent_id 아래 index 번째로 옮긴다 (parent_id=None 이면 최상위, index=None 이면 맨 끝)."""
        self._doc(doc_id)
        parent_id = parent_id or None
        if parent_id:
            self._doc(parent_id)
            if parent_id == doc_id or parent_id in self.descendants(doc_id):
                raise ValueError('문서를 자기 자신이나 자기 하위 문서 아래로 옮길 수 없습니다.')
        sibs = [r['id'] for r in self.db.q(
            "SELECT id FROM kb_documents WHERE parent_id IS ? AND id != ? AND status IN ('active','proposed') "
            'ORDER BY position, title',  # 화면 트리에 보이는 형제 기준으로 순서를 매긴다
            (parent_id, doc_id),
        )]
        index = len(sibs) if index is None else max(0, min(int(index), len(sibs)))
        sibs.insert(index, doc_id)
        with self.db.tx() as c:
            c.execute('UPDATE kb_documents SET parent_id=?, updated_at=? WHERE id=?', (parent_id, _now(), doc_id))
            c.executemany('UPDATE kb_documents SET position=? WHERE id=?', [(i, s) for i, s in enumerate(sibs)])
        self._mirror_tree(doc_id)
        return {'doc_id': doc_id, 'parent_id': parent_id, 'index': index}

    def get_or_create_page(self, title: str, parent_id: str | None = None, created_by: str = 'system',
                           author: str = '') -> tuple[str, bool]:
        """같은 위치에 같은 제목의 문서가 있으면 그것을, 없으면 빈 페이지를 만든다 (폴더를 가져올 때 사용)."""
        row = self.db.one(
            "SELECT id FROM kb_documents WHERE title=? AND parent_id IS ? AND status='active' "
            "ORDER BY doc_type='note' DESC LIMIT 1",
            (title, parent_id),
        )
        if row:
            return row['id'], False
        return self.create_note(title, '', parent_id, created_by, author)['doc_id'], True

    def tree(self) -> list[dict]:
        """사이드바용 문서 목록 (반려된 위키 제외)."""
        return self.db.q(
            'SELECT id, title, doc_type, parent_id, position, status, created_by, updated_at FROM kb_documents '
            "WHERE status != 'rejected' ORDER BY position, title"
        )

    def outline(self) -> list[dict]:
        """활성 문서를 트리 순서(깊이 우선)로 펼친 목록."""
        rows = self.db.q("SELECT id, title, doc_type, parent_id FROM kb_documents WHERE status='active' "
                         'ORDER BY position, title')
        by_parent, ids = defaultdict(list), {r['id'] for r in rows}
        for r in rows:
            by_parent[r['parent_id'] if r['parent_id'] in ids else None].append(r)
        out = []

        def walk(pid, depth):
            for r in by_parent.get(pid, []):
                out.append({'id': r['id'], 'title': r['title'], 'doc_type': r['doc_type'], 'depth': depth})
                walk(r['id'], depth + 1)

        walk(None, 0)
        return out

    # ================================================================ 저장
    def ingest_path(self, path: str | Path, parent_id: str | None = None, created_by: str = 'system',
                    author: str = '') -> list[dict]:
        """파일 또는 폴더를 가져온다. 폴더는 같은 이름의 문서가 되고, 그 안의 파일·폴더는 하위 문서가 된다."""
        p = Path(path)
        if not p.exists():
            raise FileNotFoundError(f'경로가 없습니다: {p}')
        if parent_id:
            self._doc(parent_id)
        if p.is_file():
            return [self.ingest_file(p, parent_id, created_by, author)]
        results: list[dict] = []
        self._ingest_folder(p, parent_id, created_by, author, results)
        return results

    def _ingest_folder(self, folder: Path, parent_id: str | None, created_by: str, author: str, results: list[dict]):
        page_id, created = self.get_or_create_page(folder.name, parent_id, created_by, author)
        results.append({'status': 'added' if created else 'existing', 'doc_id': page_id, 'title': folder.name,
                        'path': str(folder), 'folder': True})
        for f in sorted(folder.iterdir(), key=lambda x: (x.is_file(), x.name)):
            if f.name.startswith(('~$', '.')):
                continue
            if f.is_dir():
                self._ingest_folder(f, page_id, created_by, author, results)
            elif f.suffix.lower() in ex.SUPPORTED:
                try:
                    results.append(self.ingest_file(f, page_id, created_by, author))
                except Exception as e:  # 한 파일 실패가 전체를 멈추지 않게
                    results.append({'status': 'error', 'path': str(f), 'error': str(e)})

    def ingest_file(self, path: str | Path, parent_id: str | None = None, created_by: str = 'system',
                    author: str = '') -> dict:
        path = Path(path).resolve()
        if parent_id:
            self._doc(parent_id)
        title, body = ex.extract(path)
        h = ex.content_hash(title, body)
        dup = self.db.one("SELECT id, title FROM kb_documents WHERE content_hash=? AND status IN ('active','proposed')",
                          (h,))
        if dup:
            return {'status': 'duplicate', 'doc_id': dup['id'], 'title': dup['title'], 'path': str(path)}

        prev = self.db.q("SELECT id, parent_id, position FROM kb_documents WHERE source_path=? AND status='active'",
                         (str(path),))
        if prev and parent_id is None:  # 같은 파일의 새 버전은 이전 버전 자리에 들어간다
            parent_id = prev[0]['parent_id']
        position = prev[0]['position'] if prev and prev[0]['parent_id'] == parent_id else self._next_position(parent_id)
        doc_id = _new_id('d')
        prepared = self._prepare(title, ex.chunk_markdown(body))

        self.raw_dir.mkdir(parents=True, exist_ok=True)
        raw = self.raw_dir / f'{doc_id}{path.suffix.lower()}'
        shutil.copy2(path, raw)

        now = _now()
        try:
            with self.db.tx() as c:
                c.execute(
                    'INSERT INTO kb_documents(id,title,doc_type,parent_id,position,source_path,raw_path,content_hash,'
                    "status,created_by,author,created_at,updated_at,text) VALUES(?,?,?,?,?,?,?,?,'active',?,?,?,?,?)",
                    (doc_id, title, path.suffix.lower().lstrip('.'), parent_id, position, str(path), str(raw), h,
                     created_by, author, now, now, body),
                )
                self._write_chunks(c, doc_id, prepared)
                for old in prev:  # 이전 버전은 구버전으로, 그 아래 하위 문서는 새 버전 아래로
                    c.execute("UPDATE kb_documents SET status='superseded', updated_at=? WHERE id=?", (now, old['id']))
                    c.execute('UPDATE kb_documents SET parent_id=? WHERE parent_id=?', (doc_id, old['id']))
                    c.execute(
                        'INSERT OR IGNORE INTO kb_links(src,dst,kind,note,created_by,created_at) VALUES(?,?,?,?,?,?)',
                        (doc_id, old['id'], 'supersedes', '같은 파일의 새 버전', created_by, now),
                    )
        except Exception:
            raw.unlink(missing_ok=True)  # 저장에 실패하면 원본 사본도 남기지 않는다
            raise
        for old in prev:
            self._unmirror(old['id'])
        self._sync_refs(doc_id, body)
        self._mirror_tree(doc_id)
        return {'status': 'updated' if prev else 'added', 'doc_id': doc_id, 'title': title, 'parent_id': parent_id,
                'chunks': len(prepared), 'path': str(path), 'superseded': [o['id'] for o in prev]}

    def _prepare(self, title: str, chunks: list[ex.Chunk]):
        """조각마다 '[문서 제목 > 섹션]' 문맥을 붙여 색인한다. 임베딩은 트랜잭션 밖에서 계산한다."""
        ctx = [f"[{title}{' > ' + c.heading if c.heading else ''}]\n{c.text}" for c in chunks]
        toks = [' '.join(tokens(t)) for t in ctx]
        vecs = self._encode(ctx) if chunks else None
        return [(c, toks[i], None if vecs is None else vecs[i].tobytes()) for i, c in enumerate(chunks)]

    def _write_chunks(self, c, doc_id: str, prepared):
        for ch, tok, vec in prepared:
            cur = c.execute(
                'INSERT INTO kb_chunks(doc_id,ord,heading,text,embedding,embed_model) VALUES(?,?,?,?,?,?)',
                (doc_id, ch.ord, ch.heading, ch.text, vec, self.embedder.name if vec else None),
            )
            c.execute('INSERT INTO kb_chunks_fts(rowid, tokens) VALUES(?,?)', (cur.lastrowid, tok))

    def _reindex(self, c, doc_id: str, prepared):
        c.execute('DELETE FROM kb_chunks WHERE doc_id=?', (doc_id,))  # FTS 행은 삭제 트리거가 지운다
        self._write_chunks(c, doc_id, prepared)

    def reembed(self, batch: int = 64) -> int:
        """임베딩 모델을 바꿨거나 임베딩이 빠진 조각을 다시 계산한다."""
        if not self.embedder.enabled:
            return 0
        rows = self.db.q(
            'SELECT c.id, c.heading, c.text, d.title FROM kb_chunks c JOIN kb_documents d ON d.id=c.doc_id '
            'WHERE c.embed_model IS NULL OR c.embed_model != ?',
            (self.embedder.name,),
        )
        done = 0
        for i in range(0, len(rows), batch):
            part = rows[i: i + batch]
            vecs = self._encode(
                [f"[{r['title']}{' > ' + r['heading'] if r['heading'] else ''}]\n{r['text']}" for r in part]
            )
            if vecs is None:  # 모델이 아직 준비되지 않았다 — 준비되면 다시 불린다
                break
            with self.db.tx() as c:
                c.executemany(
                    'UPDATE kb_chunks SET embedding=?, embed_model=? WHERE id=?',
                    [(v.tobytes(), self.embedder.name, r['id']) for r, v in zip(part, vecs)],
                )
            done += len(part)
        return done

    def delete_document(self, doc_id: str) -> dict:
        """문서를 지운다. 하위 문서는 지우지 않고 한 단계 위로 올린다. 가져온 원본 파일은 건드리지 않는다."""
        d = self._doc(doc_id)
        kids = [r['id'] for r in self.db.q('SELECT id FROM kb_documents WHERE parent_id=? ORDER BY position, title',
                                           (doc_id,))]
        self._unmirror(doc_id)
        with self.db.tx() as c:
            start = self._next_position(d['parent_id'])
            c.executemany('UPDATE kb_documents SET parent_id=?, position=? WHERE id=?',
                          [(d['parent_id'], start + i, k) for i, k in enumerate(kids)])
            c.execute('DELETE FROM kb_chunks WHERE doc_id=?', (doc_id,))
            c.execute('DELETE FROM kb_tags WHERE doc_id=?', (doc_id,))
            c.execute('DELETE FROM kb_links WHERE src=? OR dst=?', (doc_id, doc_id))
            c.execute('DELETE FROM kb_documents WHERE id=?', (doc_id,))
        if d['raw_path']:
            Path(d['raw_path']).unlink(missing_ok=True)
        for k in kids:
            self._mirror_tree(k)
        return {'deleted': doc_id, 'title': d['title'], 'children_moved_up': len(kids)}

    # ================================================================ 쓰기 · 편집
    def _insert_authored(self, prefix: str, doc_type: str, status: str, title: str, body: str,
                         parent_id: str | None, created_by: str, author: str = '') -> str:
        title = title.strip()
        if not title:
            raise ValueError('제목이 필요합니다.')
        parent_id = parent_id or None
        if parent_id:
            self._doc(parent_id)
        prepared = self._prepare(title, ex.chunk_markdown(body))
        doc_id, now = _new_id(prefix), _now()
        with self.db.tx() as c:
            c.execute(
                'INSERT INTO kb_documents(id,title,doc_type,parent_id,position,content_hash,status,created_by,author,'
                'created_at,updated_at,text) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                (doc_id, title, doc_type, parent_id, self._next_position(parent_id), ex.content_hash(title, body),
                 status, created_by, author, now, now, body),
            )
            self._write_chunks(c, doc_id, prepared)
        return doc_id

    def create_note(self, title: str, body: str = '', parent_id: str | None = None, created_by: str = 'human',
                    author: str = '') -> dict:
        doc_id = self._insert_authored('n', 'note', 'active', title, body, parent_id, created_by, author)
        self._sync_refs(doc_id, body)
        self._mirror(doc_id)
        return {'doc_id': doc_id, 'title': title.strip(), 'parent_id': parent_id or None}

    def update_content(self, doc_id: str, title: str, body: str) -> dict:
        """본문을 고친다. 가져온 문서도 KB 안에서 고칠 수 있지만 원본 파일은 건드리지 않는다.

        가져온 문서는 content_hash(원본 기준)를 유지한다. 그래서 같은 원본을 다시 가져오면 '이미 있음'으로
        편집이 보존되고, 원본 자체가 바뀌어 다시 가져오면 그것이 새 버전이 된다.
        """
        d = self._doc(doc_id)
        title = title.strip() or d['title']
        prepared = self._prepare(title, ex.chunk_markdown(body))
        authored = d['doc_type'] in AUTHORED_TYPES
        now = _now()
        with self.db.tx() as c:
            self._reindex(c, doc_id, prepared)
            c.execute(
                'UPDATE kb_documents SET title=?, text=?, content_hash=?, updated_at=?, edited_at=? WHERE id=?',
                (title, body, ex.content_hash(title, body) if authored else d['content_hash'],
                 now, None if authored else now, doc_id),
            )
        self._sync_refs(doc_id, body)
        self._mirror_tree(doc_id)  # 제목이 바뀌면 하위 문서 파일 경로도 바뀐다
        return {'doc_id': doc_id, 'title': title}

    def edit(self, doc_id: str, old_text: str = '', new_text: str = '', title: str | None = None) -> dict:
        """본문 일부를 바꾼다 (에이전트용). 긴 문서를 통째로 다시 쓰다 내용을 잃지 않도록 바꿀 부분만 준다.

        old_text 가 본문에 정확히 한 번 있어야 한다. old_text 를 비우면 new_text 를 본문 끝에 덧붙인다.
        """
        d = self._doc(doc_id)
        if d['status'] in ('superseded', 'rejected'):
            raise ValueError(f"구버전이거나 반려된 문서는 고칠 수 없습니다 (상태: {d['status']}). 최신 문서를 고치세요.")
        body = d['text']
        if old_text:
            n = body.count(old_text)
            if n == 0:
                raise ValueError('old_text 가 본문에 없습니다. kb_read 로 본문을 다시 읽고 글자 그대로 넣으세요.')
            if n > 1:
                raise ValueError(f'old_text 가 본문에 {n}번 나옵니다. 앞뒤 문장을 더 넣어 한 곳만 가리키게 하세요.')
            body = body.replace(old_text, new_text)
        elif new_text:
            body = f'{body.rstrip()}\n\n{new_text.strip()}\n' if body.strip() else new_text
        elif title is None:
            raise ValueError('바꿀 내용이 없습니다. old_text/new_text 또는 title 을 주세요.')
        out = self.update_content(doc_id, title or d['title'], body)
        out['chars'] = len(body)
        return out

    def _sync_refs(self, doc_id: str, body: str):
        """본문의 [[문서 제목]] 과 [문서ID] 를 '참조' 연결로 맞춘다. 문서의 연결은 본문이 유일한 출처다."""
        targets = {i for i in _ID_REF.findall(body)
                   if i != doc_id and self.db.one('SELECT 1 FROM kb_documents WHERE id=?', (i,))}
        for t in _TITLE_REF.findall(body):
            row = self.db.one(
                "SELECT id FROM kb_documents WHERE title=? AND status IN ('active','proposed') "
                "ORDER BY status='active' DESC, updated_at DESC LIMIT 1",
                (t.strip(),),
            )
            if row and row['id'] != doc_id:
                targets.add(row['id'])
        with self.db.tx() as c:
            c.execute("DELETE FROM kb_links WHERE src=? AND kind='references'", (doc_id,))
            now = _now()
            c.executemany(
                'INSERT OR IGNORE INTO kb_links(src,dst,kind,note,created_by,created_at) '
                "VALUES(?,?,'references','본문에서 참조','auto',?)",
                [(doc_id, t, now) for t in sorted(targets)],
            )

    # ---------------------------------------------------------------- pages/ 파일
    def _md_path_for(self, d: dict) -> Path:
        parts = [_safe_name(a['title']) for a in self.ancestors(d['id'])]
        return self.pages_dir.joinpath(*parts, f"{_safe_name(d['title'])}.md")

    def _mirror(self, doc_id: str):
        """활성 문서를 pages/<상위 문서들>/<제목>.md 로 쓴다. 그 외 상태면 파일을 지운다."""
        if not self.pages_dir:
            return
        d = self._doc(doc_id)
        if d['status'] != 'active':
            return self._unmirror(doc_id)
        path = self._md_path_for(d)
        owner = self.db.one('SELECT id FROM kb_documents WHERE md_path=? AND id != ?', (str(path), doc_id))
        if owner:  # 같은 자리에 같은 제목의 다른 문서가 있으면 덮어쓰지 않는다
            path = path.with_name(f'{path.stem} ({doc_id}).md')
        front = ['---', f'id: {doc_id}', f"type: {d['doc_type']}"]
        if d['source_path']:
            front.append(f"source: {Path(d['source_path']).name}")
        path.parent.mkdir(parents=True, exist_ok=True)
        body = self._mirror_attachments(d['text'], depth=len(path.relative_to(self.pages_dir).parts) - 1)
        path.write_text('\n'.join(front + ['---', f"# {d['title']}", '', body, '']), encoding='utf-8')
        if d['md_path'] and d['md_path'] != str(path):
            _remove_file(Path(d['md_path']), self.pages_dir)
        with self.db.tx() as c:
            c.execute('UPDATE kb_documents SET md_path=? WHERE id=?', (str(path), doc_id))

    def _mirror_attachments(self, body: str, depth: int) -> str:
        """본문이 쓰는 첨부 파일을 pages/_files/ 에 복사하고, 링크를 그 .md 파일 기준 상대 경로로 바꾼다."""
        for h, qname in set(_FILE_REF.findall(body)):
            src = self.files_dir / h / unquote(qname)
            dst = self.pages_dir / '_files' / h / unquote(qname)
            if src.exists() and not dst.exists():
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
        return body.replace('(files/', '(' + '../' * depth + '_files/')

    # ---------------------------------------------------------------- 첨부 파일
    def save_attachment(self, filename: str, data: bytes) -> dict:
        """첨부 파일을 저장하고 본문에 넣을 Markdown을 돌려준다. 같은 내용의 파일은 한 번만 저장한다."""
        name = _safe_name(Path(filename or 'file').name)
        ext = Path(name).suffix.lower()
        if ext not in ATTACH_TYPES:
            raise ValueError(f"첨부할 수 없는 형식입니다: {ext or '(확장자 없음)'}. 가능: {', '.join(sorted(ATTACH_TYPES))}")
        if len(data) > MAX_ATTACH_BYTES:
            raise ValueError(f'파일이 너무 큽니다 ({len(data) // 1024 // 1024}MB). '
                             f'{MAX_ATTACH_BYTES // 1024 // 1024}MB까지 첨부할 수 있습니다.')
        h = hashlib.sha256(data).hexdigest()[:12]
        dest = self.files_dir / h / name
        if not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
        url = f'files/{h}/{quote(name)}'
        image = ATTACH_TYPES[ext].startswith('image/')
        markdown = f'![{Path(name).stem}]({url})' if image else f'[{name}]({url})'
        return {'name': name, 'url': url, 'size': len(data), 'kind': 'image' if image else 'file', 'markdown': markdown}

    def attachment_path(self, h: str, name: str) -> tuple[Path, str]:
        """첨부 파일 경로와 형식. 저장 폴더 밖을 가리키는 요청은 거부한다."""
        if not re.fullmatch(r'[0-9a-f]{12}', h) or name != Path(name).name:
            raise KeyError('첨부 파일이 없습니다.')
        path = (self.files_dir / h / name).resolve()
        if not path.is_relative_to(self.files_dir) or not path.is_file():
            raise KeyError('첨부 파일이 없습니다.')
        return path, ATTACH_TYPES.get(path.suffix.lower(), 'application/octet-stream')

    def _unmirror(self, doc_id: str):
        d = self._doc(doc_id)
        if d['md_path']:
            _remove_file(Path(d['md_path']), self.pages_dir)
            with self.db.tx() as c:
                c.execute('UPDATE kb_documents SET md_path=NULL WHERE id=?', (doc_id,))

    def _mirror_tree(self, doc_id: str):
        for i in [doc_id, *self.descendants(doc_id)]:
            self._mirror(i)

    # ================================================================ 정리
    def tags(self, doc_id: str) -> list[str]:
        return [r['tag'] for r in self.db.q('SELECT tag FROM kb_tags WHERE doc_id=? ORDER BY tag', (doc_id,))]

    def add_tags(self, doc_id: str, tags: list[str]) -> dict:
        self._doc(doc_id)
        clean = [t.strip().lstrip('#') for t in tags if t.strip().lstrip('#')]
        with self.db.tx() as c:
            c.executemany('INSERT OR IGNORE INTO kb_tags(doc_id, tag) VALUES(?,?)', [(doc_id, t) for t in clean])
        return {'doc_id': doc_id, 'tags': self.tags(doc_id)}

    def remove_tags(self, doc_id: str, tags: list[str]) -> dict:
        with self.db.tx() as c:
            c.executemany('DELETE FROM kb_tags WHERE doc_id=? AND tag=?', [(doc_id, t) for t in tags])
        return {'doc_id': doc_id, 'tags': self.tags(doc_id)}

    def propose_wiki(self, title: str, body: str, sources: list[str] = (), parent_id: str | None = None,
                     created_by: str = 'agent', author: str = '') -> dict:
        """정리된 지식(위키)을 제안한다. 사람이 승인하기 전에는 검색되지 않는다.

        출처도 문서 안에 둔다: 본문에 인용되지 않은 근거 문서는 맨 아래 '출처' 절에 [[제목]] 으로 덧붙인다."""
        if not body.strip():
            raise ValueError('본문이 필요합니다.')
        valid = [s for s in dict.fromkeys(sources) if self.db.one('SELECT 1 FROM kb_documents WHERE id=?', (s,))]
        cited = set(_ID_REF.findall(body)) | {t.strip() for t in _TITLE_REF.findall(body)}
        missing = [s for s in valid if s not in cited and self._doc(s)['title'] not in cited]
        if missing:
            body = body.rstrip() + '\n\n## 출처\n' + '\n'.join(f"- [[{self._doc(s)['title']}]]" for s in missing)
        doc_id = self._insert_authored('w', 'wiki', 'proposed', title, body, parent_id, created_by, author)
        self._sync_refs(doc_id, body)
        return {'doc_id': doc_id, 'title': title.strip(), 'status': 'proposed', 'sources': valid,
                'note': '사람이 승인하면 검색에 반영됩니다.'}

    def review_wiki(self, doc_id: str, approve: bool) -> dict:
        d = self._doc(doc_id)
        if d['doc_type'] != 'wiki' or d['status'] != 'proposed':
            raise ValueError('승인 대기 중인 위키가 아닙니다.')
        status = 'active' if approve else 'rejected'
        with self.db.tx() as c:
            c.execute('UPDATE kb_documents SET status=?, updated_at=? WHERE id=?', (status, _now(), doc_id))
        self._mirror(doc_id)
        return {'doc_id': doc_id, 'title': d['title'], 'status': status}

    def pending_wiki(self, status: str = 'proposed') -> list[dict]:
        return self.db.q(
            "SELECT id, title, created_by, author, created_at, text FROM kb_documents WHERE doc_type='wiki' AND status=? "
            'ORDER BY created_at DESC',
            (status,),
        )

    def add_glossary(self, term: str, synonyms: list[str] = (), definition: str = '') -> dict:
        term = term.strip()
        if not term:
            raise ValueError('용어가 비어 있습니다.')
        syn = [s.strip() for s in synonyms if s.strip() and s.strip() != term]
        with self.db.tx() as c:
            c.execute(
                'INSERT OR REPLACE INTO kb_glossary(term, synonyms, definition) VALUES(?,?,?)',
                (term, json.dumps(syn, ensure_ascii=False), definition),
            )
        return {'term': term, 'synonyms': syn, 'definition': definition}

    def glossary(self) -> list[dict]:
        return [
            {'term': r['term'], 'synonyms': json.loads(r['synonyms']), 'definition': r['definition']}
            for r in self.db.q('SELECT * FROM kb_glossary ORDER BY term')
        ]

    # ================================================================ 불러오기
    def catalog(self) -> dict:
        """KB 목차. 에이전트가 무엇이 있는지 알고 검색을 시작하게 한다."""
        top_tags = self.db.q(
            "SELECT t.tag, count(*) n FROM kb_tags t JOIN kb_documents d ON d.id=t.doc_id WHERE d.status='active' "
            'GROUP BY t.tag ORDER BY n DESC LIMIT 30'
        )
        counts = {r['status']: r['n'] for r in self.db.q('SELECT status, count(*) n FROM kb_documents GROUP BY status')}
        return {
            'outline': self.outline()[:300],
            'documents': counts.get('active', 0),
            'tags': [t['tag'] for t in top_tags],
            'glossary_terms': [g['term'] for g in self.glossary()],
            'pending_wiki': counts.get('proposed', 0),
            'superseded': counts.get('superseded', 0),
        }

    def catalog_text(self) -> str:
        cat = self.catalog()
        if not cat['outline']:
            return '(아직 문서가 없습니다)'
        lines = [f"{'  ' * o['depth']}- [{o['id']}] {o['title']}" for o in cat['outline']]
        if cat['documents'] > len(cat['outline']):
            lines.append(f"  … 외 {cat['documents'] - len(cat['outline'])}건")
        if cat['tags']:
            lines.append('태그: ' + ', '.join(cat['tags']))
        if cat['glossary_terms']:
            lines.append('용어집: ' + ', '.join(cat['glossary_terms']))
        lines.append(f"승인 대기 위키: {cat['pending_wiki']}건, 대체된 구버전 문서: {cat['superseded']}건")
        return '\n'.join(lines)

    def _path_text(self, doc_id: str) -> str:
        return ' › '.join(a['title'] for a in self.ancestors(doc_id))

    def _expand(self, query: str) -> tuple[str, list[str]]:
        """용어집의 용어나 동의어가 질문에 있으면 나머지 표현도 함께 검색한다."""
        extra, low = [], query.lower()
        for g in self.glossary():
            names = [g['term'], *g['synonyms']]
            if any(n and n.lower() in low for n in names):
                extra += [n for n in names if n.lower() not in low]
        return (f"{query} {' '.join(extra)}" if extra else query), extra

    def search(self, query: str, under: str | None = None, limit: int = 8, mode: str = 'hybrid',
               log_query: bool = True) -> list[dict]:
        """키워드(BM25) + 의미(벡터) 검색 결과를 RRF로 합친다. 활성 문서만, under를 주면 그 문서와 하위 문서만."""
        query = query.strip()
        if not query:
            return []
        expanded, _ = self._expand(query)
        scope = self._scope(under)
        fused: dict[int, dict] = {}

        def add(ids: list[int], via: str):
            for rank, cid in enumerate(ids):
                e = fused.setdefault(cid, {'score': 0.0, 'via': []})
                e['score'] += VIA_WEIGHT[via] / (RRF_K + rank + 1)
                e['via'].append(via)

        if mode in ('hybrid', 'keyword'):
            add(self._keyword(expanded, scope), 'keyword')
        if mode in ('hybrid', 'vector') and self.embedder.enabled:
            add(self._vector(expanded, scope, under), 'vector')

        results = []
        if fused:
            ph = ','.join('?' * len(fused))
            rows = self.db.q(
                f'SELECT c.id, c.doc_id, c.ord, c.heading, c.text, d.title, d.doc_type '
                f'FROM kb_chunks c JOIN kb_documents d ON d.id=c.doc_id WHERE c.id IN ({ph})',
                list(fused),
            )
            for r in rows:
                r['score'] = fused[r['id']]['score'] * (WIKI_BOOST if r['doc_type'] == 'wiki' else 1.0)
                r['via'] = fused[r['id']]['via']
            rows.sort(key=lambda r: -r['score'])
            cutoff = rows[0]['score'] * MIN_REL_SCORE if rows else 0
            per_doc = Counter()
            for r in rows:
                if r['score'] < cutoff:
                    break
                if per_doc[r['doc_id']] >= MAX_CHUNKS_PER_DOC:
                    continue
                per_doc[r['doc_id']] += 1
                results.append({
                    'doc_id': r['doc_id'], 'title': r['title'], 'path': self._path_text(r['doc_id']),
                    'doc_type': r['doc_type'], 'chunk_ord': r['ord'], 'heading': r['heading'],
                    'text': r['text'], 'score': round(r['score'] * 1000, 2), 'via': r['via'],
                })
                if len(results) >= limit:
                    break
        if log_query:
            with self.db.tx() as c:
                c.execute(
                    'INSERT INTO kb_search_log(ts, query, scope, n, top_doc) VALUES(?,?,?,?,?)',
                    (_now(), query, under, len(results), results[0]['doc_id'] if results else None),
                )
        return results

    def _scope(self, under: str | None) -> tuple[str, list]:
        if under:
            ids = [under, *self.descendants(under)]
            return f"d.status='active' AND d.id IN ({','.join('?' * len(ids))})", ids
        return "d.status='active'", []

    def _keyword(self, query: str, scope: tuple[str, list], k: int = 40) -> list[int]:
        expr = fts_query(query)
        if not expr:
            return []
        cond, args = scope
        rows = self.db.q(
            f'SELECT c.id FROM kb_chunks_fts f JOIN kb_chunks c ON c.id=f.rowid JOIN kb_documents d ON d.id=c.doc_id '
            f'WHERE kb_chunks_fts MATCH ? AND {cond} ORDER BY bm25(kb_chunks_fts) LIMIT {k}',
            [expr, *args],
        )
        return [r['id'] for r in rows]

    def _matrix(self):
        """현재 임베딩 모델로 만든 벡터 전체를 메모리에 캐시한다 (조각 수/최대 id가 바뀌면 갱신)."""
        name = self.embedder.name
        sig = self.db.one('SELECT count(*) n, coalesce(max(id),0) m FROM kb_chunks WHERE embed_model=?', (name,))
        key = (name, sig['n'], sig['m'])
        cache = self._vcache
        if cache and cache[0] == key:
            return cache[1:]
        rows = self.db.q('SELECT id, doc_id, embedding FROM kb_chunks WHERE embed_model=? ORDER BY id', (name,))
        ids = np.array([r['id'] for r in rows], dtype=np.int64)
        doc_ids = np.array([r['doc_id'] for r in rows], dtype=object)
        m = np.vstack([np.frombuffer(r['embedding'], dtype=np.float32) for r in rows]) if rows else None
        self._vcache = (key, ids, doc_ids, m)
        return ids, doc_ids, m

    def _vector(self, query: str, scope: tuple[str, list], under: str | None = None, k: int = 40) -> list[int]:
        ids, doc_ids, m = self._matrix()
        if m is None:
            return []
        q = self._encode([query], kind='query')
        if q is None:
            return []
        if under:  # 범위 안의 조각만으로 계산해야 큰 KB에서도 하위 트리 조각이 빠지지 않는다
            allowed = set(scope[1])
            mask = np.array([d in allowed for d in doc_ids], dtype=bool)
            ids, m = ids[mask], m[mask]
            if not len(ids):
                return []
        sims = m @ q[0]
        order = [i for i in np.argsort(-sims)[:VECTOR_CANDIDATES] if sims[i] >= MIN_VECTOR_SIM]
        if not order:
            return []
        cand = [int(ids[i]) for i in order]
        cond, args = scope
        ok = {r['id'] for r in self.db.q(
            f'SELECT c.id FROM kb_chunks c JOIN kb_documents d ON d.id=c.doc_id '
            f"WHERE c.id IN ({','.join('?' * len(cand))}) AND {cond}",
            [*cand, *args],
        )}
        return [c for c in cand if c in ok][:k]

    def read(self, doc_id: str, chunk_ord: int | None = None, window: int = 1, max_chars: int = 4000) -> dict:
        d = self._doc(doc_id)
        out = {k: d[k] for k in ('id', 'title', 'doc_type', 'status', 'created_by', 'parent_id')}
        out['path'] = self._path_text(doc_id)
        out['children'] = [{'id': c['id'], 'title': c['title']} for c in self.children(doc_id)]
        out['tags'] = self.tags(doc_id)
        out['links'] = self.links_of(doc_id)
        n = self.db.one('SELECT count(*) n FROM kb_chunks WHERE doc_id=?', (doc_id,))['n']
        out['total_chunks'] = n
        if chunk_ord is None:
            out['text'] = d['text'][:max_chars]
            if len(d['text']) > max_chars:
                out['note'] = f'문서가 길어 앞부분 {max_chars}자만 보여 줍니다. 필요한 부분은 chunk_ord(0~{n - 1})로 읽으세요.'
        else:
            out['chunks'] = self.db.q(
                'SELECT ord, heading, text FROM kb_chunks WHERE doc_id=? AND ord BETWEEN ? AND ? ORDER BY ord',
                (doc_id, chunk_ord - window, chunk_ord + window),
            )
        return out

    def links_of(self, doc_id: str) -> list[dict]:
        out = self.db.q(
            "SELECT 'out' direction, l.kind, l.dst other_id, d.title other_title, d.status other_status, l.note, "
            'l.created_by FROM kb_links l JOIN kb_documents d ON d.id=l.dst WHERE l.src=?',
            (doc_id,),
        )
        inc = self.db.q(
            "SELECT 'in' direction, l.kind, l.src other_id, d.title other_title, d.status other_status, l.note, "
            'l.created_by FROM kb_links l JOIN kb_documents d ON d.id=l.src WHERE l.dst=?',
            (doc_id,),
        )
        return out + inc

    def related(self, doc_id: str, limit: int = 5) -> dict:
        self._doc(doc_id)
        keys, sim, method = self._similarity()
        similar = []
        if doc_id in keys:
            i = keys.index(doc_id)
            for j in np.argsort(-sim[i]):
                if j != i and sim[i, j] >= SIMILAR_THRESHOLD[method] and len(similar) < limit:
                    similar.append({'doc_id': keys[j], 'title': self._doc(keys[j])['title'],
                                    'path': self._path_text(keys[j]), 'similarity': round(float(sim[i, j]), 3)})
        return {'links': self.links_of(doc_id), 'similar': similar, 'method': method}

    def _similarity(self) -> tuple[list[str], np.ndarray, str]:
        """활성 문서 간 유사도 행렬. 임베딩이 있으면 조각 벡터 평균, 없으면 명사 집합 자카드 유사도.

        본문이 없는 문서(하위 문서를 묶기만 하는 빈 페이지)는 제외한다."""
        docs = self._sim_docs()
        cents = self._centroids(docs)
        if cents:
            keys, c, _ = cents
            return keys, c @ c.T, 'vector'
        keys = [d['id'] for d in docs]
        sets = [self._terms(d) for d in docs]
        sim = np.zeros((len(keys), len(keys)))
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                u = len(sets[i] | sets[j])
                sim[i, j] = sim[j, i] = len(sets[i] & sets[j]) / u if u else 0
        return keys, sim, 'keyword'

    def _sim_docs(self) -> list[dict]:
        return self.db.q(
            "SELECT id, updated_at, title, text FROM kb_documents WHERE status='active' AND trim(text) != '' ORDER BY id")

    def _centroids(self, docs: list[dict]):
        """문서별 조각 벡터 평균 (정규화·중심화). 임베딩이 없으면 None. (keys, 행렬, 뺀 평균)"""
        _, doc_ids, m = self._matrix() if self.embedder.enabled else (None, None, None)
        if m is None:
            return None
        # 문서별 조각 위치를 한 번에 모아 평균을 낸다 (문서마다 전체 배열을 훑지 않도록)
        positions = defaultdict(list)
        for i, d in enumerate(doc_ids):
            positions[d].append(i)
        keys, cents = [], []
        for d in docs:
            idx = positions.get(d['id'])
            if idx:
                v = m[idx].mean(axis=0)
                keys.append(d['id'])
                cents.append(v / (np.linalg.norm(v) or 1))
        if not keys:
            return None
        c = np.vstack(cents)
        center = None
        if len(keys) >= CENTER_MIN_DOCS:
            # 모든 사내 문서가 공유하는 성분을 빼야 "비슷함"이 구분된다 (빼지 않으면 대부분 0.55~0.7)
            center = c.mean(axis=0)
            c = c - center
            c /= np.where((n := np.linalg.norm(c, axis=1, keepdims=True)) == 0, 1, n)
        return keys, c, center

    def similar_to_draft(self, title: str, body: str, exclude: str | None = None, limit: int = 5) -> dict:
        """아직 저장하지 않은 글과 비슷한 기존 문서. 새 문서를 만들기 전에 중복을 알리는 데 쓴다."""
        text = f'{title}\n{body}'.strip()
        if not text:
            return {'similar': [], 'method': 'keyword'}
        docs = [d for d in self._sim_docs() if d['id'] != exclude]
        scored, method = [], 'keyword'
        cents = self._centroids(docs)
        q = self._encode([text[:4000]]) if cents else None
        if q is not None:
            keys, c, center = cents
            v = q[0] / (np.linalg.norm(q[0]) or 1)
            if center is not None:
                v = v - center
                v = v / (np.linalg.norm(v) or 1)
            scored, method = list(zip(keys, (c @ v).tolist())), 'vector'
        else:
            counts = Counter(t for t in tokens(f'{title} {body[:4000]}') if len(t) > 1)
            mine = {t for t, _ in counts.most_common(60)}
            for d in docs:
                other = self._terms(d)
                u = len(mine | other)
                scored.append((d['id'], len(mine & other) / u if u else 0))
        scored.sort(key=lambda x: -x[1])
        similar = [{'doc_id': k, 'title': self._doc(k)['title'], 'path': self._path_text(k),
                    'similarity': round(float(s), 3)}
                   for k, s in scored[:limit] if s >= SIMILAR_THRESHOLD[method]]
        return {'similar': similar, 'method': method}

    def _terms(self, d: dict) -> set[str]:
        cached = self._term_cache.get(d['id'])
        if cached and cached[0] == d['updated_at']:
            return cached[1]
        counts = Counter(t for t in tokens(f"{d['title']} {d['text'][:4000]}") if len(t) > 1)
        terms = {t for t, _ in counts.most_common(60)}
        self._term_cache[d['id']] = (d['updated_at'], terms)
        return terms

    # ================================================================ 화면용
    def document(self, doc_id: str) -> dict:
        d = self._doc(doc_id)
        out = self.read(doc_id, max_chars=10**9)
        out.update({k: d[k] for k in ('source_path', 'md_path', 'created_at', 'updated_at', 'edited_at', 'author')})
        out['body'] = out.pop('text')
        out['ancestors'] = self.ancestors(doc_id)
        out['children'] = self.children(doc_id)
        out['chunks'] = self.db.q('SELECT ord, heading, text FROM kb_chunks WHERE doc_id=? ORDER BY ord', (doc_id,))
        return out

    def recent(self, limit: int = 8) -> list[dict]:
        return self.db.q(
            "SELECT id, title, doc_type, updated_at FROM kb_documents WHERE status='active' "
            'ORDER BY updated_at DESC LIMIT ?',
            (limit,),
        )

    def graph(self, show_tags: bool = False, show_similar: bool = True) -> dict:
        docs = self.db.q(
            "SELECT id, title, doc_type, parent_id, status, created_by FROM kb_documents WHERE status != 'rejected'")
        ids = {d['id'] for d in docs}
        nodes, edges = [], []
        for d in docs:
            nodes.append({'id': d['id'], 'label': d['title'], 'type': 'wiki' if d['doc_type'] == 'wiki' else 'doc',
                          'doc_type': d['doc_type'], 'status': d['status'], 'parent_id': d['parent_id'],
                          'created_by': d['created_by']})
            if d['parent_id'] in ids:
                edges.append({'source': d['parent_id'], 'target': d['id'], 'kind': 'child'})
        linked = set()
        for l in self.db.q('SELECT src, dst, kind, note, created_by FROM kb_links'):
            if l['src'] in ids and l['dst'] in ids:
                edges.append({'source': l['src'], 'target': l['dst'], 'kind': l['kind'], 'note': l['note'],
                              'created_by': l['created_by']})
                linked.add(frozenset((l['src'], l['dst'])))
        if show_tags:
            tag_rows = self.db.q('SELECT doc_id, tag FROM kb_tags')
            for tag in sorted({r['tag'] for r in tag_rows if r['doc_id'] in ids}):
                nodes.append({'id': f't:{tag}', 'label': f'#{tag}', 'type': 'tag'})
            edges += [{'source': r['doc_id'], 'target': f"t:{r['tag']}", 'kind': 'tagged'}
                      for r in tag_rows if r['doc_id'] in ids]
        method = None
        if show_similar:
            keys, sim, method = self._similarity()
            seen = set()
            for i, k in enumerate(keys):
                for j in np.argsort(-sim[i])[:3]:
                    pair = frozenset((k, keys[j]))
                    if j == i or sim[i, j] < SIMILAR_THRESHOLD[method] or pair in seen or pair in linked:
                        continue
                    seen.add(pair)
                    edges.append({'source': k, 'target': keys[j], 'kind': 'similar',
                                  'weight': round(float(sim[i, j]), 3)})
        for e in edges:
            e['id'] = f"{e['source']}|{e['target']}|{e['kind']}"
        return {'nodes': nodes, 'edges': edges, 'similarity': method}

    def local_graph(self, doc_id: str, depth: int = 1, show_similar: bool = True) -> dict:
        """한 문서를 중심으로 depth 단계까지 이어진 문서들 (상위·하위 문서 포함)."""
        self._doc(doc_id)
        g = self.graph(show_tags=False, show_similar=show_similar)
        adj = defaultdict(set)
        for e in g['edges']:
            adj[e['source']].add(e['target'])
            adj[e['target']].add(e['source'])
        seen, frontier = {doc_id}, {doc_id}
        for _ in range(max(1, min(depth, 3))):
            frontier = {n for f in frontier for n in adj[f]} - seen
            seen |= frontier
        return {
            'center': doc_id,
            'nodes': [n for n in g['nodes'] if n['id'] in seen],
            'edges': [e for e in g['edges'] if e['source'] in seen and e['target'] in seen],
        }

    def stats(self) -> dict:
        by_status = {r['status']: r['n'] for r in self.db.q('SELECT status, count(*) n FROM kb_documents GROUP BY status')}
        return {
            'documents': by_status,
            'chunks': self.db.one('SELECT count(*) n FROM kb_chunks')['n'],
            'embedded_chunks': self.db.one(
                'SELECT count(*) n FROM kb_chunks WHERE embed_model=?', (self.embedder.name,))['n'],
            'embedder': self.embedder.name,
            'embedder_state': self.embedder.state,
            # 모델을 못 불러온 이유 (화면에서 보고 '다시 시도'를 누를 수 있게)
            'embedder_error': getattr(self.embedder, 'error', None) or '',
            'searches': self.db.one('SELECT count(*) n FROM kb_search_log')['n'],
            'empty_searches': self.db.one('SELECT count(*) n FROM kb_search_log WHERE n=0')['n'],
        }
