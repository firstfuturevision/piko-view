"""지식 베이스 테스트. 원본(knowledge_base/tests/test_kb.py)의 검증 항목을 그대로 옮기고,
서버로 옮기면서 생긴 부분(토큰 인증, Django 위의 MCP, 임베딩 백그라운드 로딩)을 더했다.

가짜 임베딩(형태소 해시)을 써서 모델 다운로드 없이 벡터 경로까지 검증한다.
"""
import hashlib
import json
import shutil
import tempfile
from pathlib import Path

import numpy as np
from django.conf import settings
from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.agent import modules as agent_modules
from apps.core import tokens as api_tokens

from . import views
from .services import extract as ex
from .services import runtime
from .services.agent_tools import build_registry
from .services.core import KnowledgeBase
from .services.db import DB
from .services.embed import Embedder, EmbedderNotReady, NoEmbedder
from .services.seed import seed
from .services.textproc import tokens
from apps.agent.tools import tool

SAMPLE_DIR = Path(settings.KB_SAMPLE_DIR)
PNG = b'\x89PNG\r\n\x1a\n' + b'\x00' * 64


class HashEmbedder(Embedder):
    """형태소 해시 기반 가짜 임베딩: 모델 다운로드 없이 벡터 경로를 검증한다."""

    name, enabled, state = 'test:hash', True, 'ready'

    def encode(self, texts, kind='passage'):
        m = np.zeros((len(texts), 256), dtype=np.float32)
        for i, t in enumerate(texts):
            for tok in tokens(t):
                m[i, int(hashlib.md5(tok.encode()).hexdigest(), 16) % 256] += 1
        n = np.linalg.norm(m, axis=1, keepdims=True)
        return m / np.where(n == 0, 1, n)


class LoadingEmbedder(HashEmbedder):
    """아직 모델을 받는 중인 임베더."""

    name, state = 'test:loading', 'loading'

    def encode(self, texts, kind='passage'):
        raise EmbedderNotReady('불러오는 중')


class KBTestBase(TestCase):
    embedder_cls = HashEmbedder

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.kb = KnowledgeBase(DB(), self.embedder_cls(), self.tmp / 'raw', self.tmp / 'pages', self.tmp / 'files')
        seed(self.kb, SAMPLE_DIR)

    def doc_id(self, title_part):
        return next(d['id'] for d in self.kb.db.q('SELECT id, title FROM kb_documents') if title_part in d['title'])

    def page_file(self, *parts):
        return self.kb.pages_dir.joinpath(*parts)


# ---------------------------------------------------------------- 변환: 모든 형식 → Markdown
class ExtractTests(TestCase):
    def test_markdown_title_and_sections(self):
        title, body = ex.take_title('# 제목\n\n## 가\n내용1\n\n### 나\n내용2\n## 다\n내용3', 'x')
        self.assertEqual(title, '제목')
        self.assertEqual([s.heading for s in ex.split_markdown(body)], ['가', '가 > 나', '다'])

    def test_docx_becomes_markdown(self):
        from docx import Document

        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        doc = Document()
        doc.add_heading('회의록', 0)
        doc.add_heading('결정 사항', 1)
        doc.add_paragraph('예산 확정', style='List Bullet')
        t = doc.add_table(rows=2, cols=2)
        t.cell(0, 0).text, t.cell(0, 1).text, t.cell(1, 0).text, t.cell(1, 1).text = '항목', '금액', '전시회', '500'
        doc.save(tmp / 'a.docx')
        title, body = ex.extract(tmp / 'a.docx')
        self.assertEqual(title, '회의록')
        self.assertIn('## 결정 사항', body)
        self.assertIn('- 예산 확정', body)
        self.assertIn('| 항목 | 금액 |\n|---|---|\n| 전시회 | 500 |', body)

    def test_xlsx_and_csv_become_markdown_tables(self):
        from openpyxl import Workbook

        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        wb = Workbook()
        ws = wb.active
        ws.title = '단가'
        ws.append(['제품', '가격'])
        ws.append(['센서', 130000])
        wb.save(tmp / 'p.xlsx')
        self.assertEqual(ex.extract(tmp / 'p.xlsx')[1], '| 제품 | 가격 |\n|---|---|\n| 센서 | 130000 |')
        (tmp / 'c.csv').write_text('이름,메모\n홍길동,a|b\n', encoding='utf-8')
        self.assertIn('| 홍길동 | a\\|b |', ex.extract(tmp / 'c.csv')[1])

    def test_long_table_chunks_repeat_header(self):
        table = ex.md_table([['제품', '가격']] + [[f'제품{i}', str(i)] for i in range(200)])
        chunks = ex.chunk_markdown(table)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(c.text.startswith('| 제품 | 가격 |\n|---|---|') for c in chunks))
        self.assertTrue(all(len(c.text) <= 900 for c in chunks))


# ---------------------------------------------------------------- 저장 · 트리 · pages
class StoreTests(KBTestBase):
    def test_folders_become_parent_documents(self):
        self.assertEqual([c['title'] for c in self.kb.children(None)], ['고객', '영업', '정책'])
        sales = self.doc_id('영업')
        self.assertEqual({c['title'] for c in self.kb.children(sales)},
                         {'제품 가격표 (2025년)', '제품 가격표 (2026년)', '견적 처리 절차'})
        self.assertEqual(self.kb.ancestors(self.doc_id('견적 처리')), [{'id': sales, 'title': '영업'}])

    def test_reimport_is_duplicate_and_reuses_folder_pages(self):
        again = self.kb.ingest_path(SAMPLE_DIR / '영업')
        self.assertEqual({r['status'] for r in again}, {'existing', 'duplicate'})
        self.assertEqual(len([d for d in self.kb.tree() if d['title'] == '영업']), 1)

    def test_csv_is_markdown_table(self):
        body = self.kb.document(self.doc_id('고객목록'))['body']
        self.assertTrue(body.startswith('| 고객명 | 약칭 |'))
        self.assertIn('| 대성물산 | A사 |', body)

    def test_md_original_is_kept(self):
        body = self.kb.document(self.doc_id('2026'))['body']
        self.assertIn('## 하드웨어', body)
        self.assertIn('| HB-300 | AI 분석모듈 | 890,000 |', body)

    def test_move_and_order(self):
        kb = self.kb
        a, b, sales = self.doc_id('견적 처리'), self.doc_id('환불'), self.doc_id('영업')
        kb.move(b, sales, 0)
        self.assertEqual(kb.children(sales)[0]['id'], b)
        kb.move(b, a)  # 문서 아래 문서
        self.assertEqual([x['title'] for x in kb.ancestors(b)], ['영업', '견적 처리 절차'])
        with self.assertRaisesRegex(ValueError, '하위 문서'):
            kb.move(sales, b)  # 자기 하위 문서 아래로는 불가
        kb.move(b, None)
        self.assertIn(b, [c['id'] for c in kb.children(None)])

    def test_changed_file_supersedes_and_keeps_place_and_children(self):
        kb, src = self.kb, self.tmp / '규정.md'
        src.write_text('# 휴가 규정\n\n연차는 15일이다.', encoding='utf-8')
        first = kb.ingest_file(src, self.doc_id('정책'))
        child = kb.create_note('휴가 FAQ', '반차 가능', first['doc_id'])
        src.write_text('# 휴가 규정\n\n연차는 16일이다.', encoding='utf-8')
        second = kb.ingest_file(src)
        self.assertEqual(second['status'], 'updated')
        self.assertEqual(second['parent_id'], self.doc_id('정책'))
        self.assertEqual(kb._doc(first['doc_id'])['status'], 'superseded')
        self.assertEqual(kb._doc(child['doc_id'])['parent_id'], second['doc_id'])
        self.assertTrue(all(r['doc_id'] != first['doc_id'] for r in kb.search('연차 며칠')))

    def test_pages_mirror_follow_tree(self):
        kb = self.kb
        f = self.page_file('영업', '견적 처리 절차.md')
        text = f.read_text(encoding='utf-8')
        self.assertTrue(text.startswith('---\nid: d_'))
        self.assertIn('source: 견적_처리_절차.md', text)
        self.assertTrue(self.page_file('영업.md').exists())
        kb.move(self.doc_id('견적 처리'), self.doc_id('정책'))
        self.assertFalse(f.exists())
        self.assertTrue(self.page_file('정책', '견적 처리 절차.md').exists())
        kb.update_content(self.doc_id('정책'), '사내 정책', '')  # 상위 제목이 바뀌면 하위 파일 경로도 바뀐다
        self.assertTrue(self.page_file('사내 정책', '견적 처리 절차.md').exists())
        self.assertFalse(self.page_file('정책').exists())

    def test_superseded_and_proposed_are_not_mirrored(self):
        kb, src = self.kb, self.tmp / '규정.md'
        src.write_text('# 휴가 규정\n\n연차는 15일이다.', encoding='utf-8')
        old = kb.ingest_file(src, self.doc_id('정책'))['doc_id']
        src.write_text('# 휴가 규정\n\n연차는 16일이다.', encoding='utf-8')
        new = kb.ingest_file(src)['doc_id']
        self.assertIsNone(kb._doc(old)['md_path'])
        self.assertIn('16일', self.page_file('정책', '휴가 규정.md').read_text(encoding='utf-8'))
        w = kb.propose_wiki('할인 정리', '최대 12% [' + new + ']', [new])
        self.assertFalse(kb._doc(w['doc_id'])['md_path'])
        kb.review_wiki(w['doc_id'], True)
        self.assertTrue(self.page_file('할인 정리.md').exists())

    def test_delete_moves_children_up_and_keeps_original(self):
        kb, src = self.kb, self.tmp / '원본.md'
        src.write_text('# 원본\n\n내용', encoding='utf-8')
        parent = kb.ingest_file(src, self.doc_id('정책'))['doc_id']
        child = kb.create_note('하위', '메모', parent)['doc_id']
        kb.add_tags(parent, ['삭제대상'])  # 태그·조각도 함께 지워지는지 확인한다
        kb.delete_document(parent)
        self.assertTrue(src.exists())
        self.assertEqual(kb._doc(child)['parent_id'], self.doc_id('정책'))
        self.assertTrue(self.page_file('정책', '하위.md').exists())
        self.assertIsNone(kb.db.one('SELECT 1 FROM kb_tags WHERE doc_id=?', (parent,)))
        self.assertIsNone(kb.db.one('SELECT 1 FROM kb_chunks WHERE doc_id=?', (parent,)))
        # 조각이 지워지면 트리거가 전문 검색 색인도 지운다
        n_chunks = kb.db.one('SELECT count(*) n FROM kb_chunks')['n']
        n_fts = kb.db.one('SELECT count(*) n FROM kb_chunks_fts')['n']
        self.assertEqual(n_chunks, n_fts)


# ---------------------------------------------------------------- 편집 · 연결
class EditTests(KBTestBase):
    def test_note_links_from_body(self):
        kb, price = self.kb, self.doc_id('2026')
        n = kb.create_note('영업 FAQ', '## 할인\n[[견적 처리 절차]] 참고. 가격은 [' + price + ']', self.doc_id('영업'))
        links = {(l['other_title'], l['kind']) for l in kb.links_of(n['doc_id'])}
        self.assertEqual(links, {('견적 처리 절차', 'references'), ('제품 가격표 (2026년)', 'references')})
        self.assertEqual(kb.search('영업 FAQ 할인')[0]['doc_id'], n['doc_id'])

    def test_links_follow_body_edits(self):
        kb = self.kb
        n = kb.create_note('회의록', '전시회 참가 결정. [[환불 및 교환 정책]] 확인')
        kb.update_content(n['doc_id'], '회의록 9월', '예산 500만원 확정. [[출장비 규정]] 적용')
        self.assertEqual(kb.search('예산 500만원')[0]['doc_id'], n['doc_id'])
        self.assertTrue(all('전시회' not in c['text'] for c in kb.document(n['doc_id'])['chunks']))
        self.assertEqual({(l['other_title'], l['kind']) for l in kb.links_of(n['doc_id'])},
                         {('출장비 규정', 'references')})

    def test_imported_file_editable_in_kb_only(self):
        kb, src = self.kb, self.tmp / '규정.md'
        src.write_text('# 휴가 규정\n\n연차는 15일이다.', encoding='utf-8')
        d = kb.ingest_file(src)['doc_id']
        kb.update_content(d, '휴가 규정', '연차는 15일, 반차 가능.')
        self.assertTrue(src.read_text(encoding='utf-8').endswith('15일이다.'))  # 원본 파일은 그대로
        self.assertTrue(kb.document(d)['edited_at'])
        self.assertEqual(kb.ingest_file(src)['status'], 'duplicate')  # 같은 원본을 다시 가져와도 편집 보존
        src.write_text('# 휴가 규정\n\n연차는 16일이다.', encoding='utf-8')
        self.assertEqual(kb.ingest_file(src)['status'], 'updated')  # 원본이 바뀌면 새 버전

    def test_no_manual_links(self):
        self.assertFalse(hasattr(self.kb, 'link') or hasattr(self.kb, 'unlink'))
        self.assertNotIn('kb_link', build_registry(self.kb, [SAMPLE_DIR]).names())

    def test_wiki_sources_are_written_in_body(self):
        kb = self.kb
        src, price = self.doc_id('대성물산'), self.doc_id('2026')
        w = kb.propose_wiki('A사 거래 요약', '결제는 30일 이내, 특별할인 8% [[대성물산(A사) 계약 요약]]', [src, price])
        body = kb.document(w['doc_id'])['body']
        self.assertEqual(body.count('[[대성물산(A사) 계약 요약]]'), 1)  # 이미 인용한 출처는 다시 쓰지 않는다
        self.assertIn('## 출처\n- [[제품 가격표 (2026년)]]', body)  # 인용 안 한 근거는 본문 끝에 덧붙인다
        self.assertEqual({l['other_id'] for l in kb.links_of(w['doc_id']) if l['kind'] == 'references'},
                         {src, price})
        self.assertTrue(all(r['doc_id'] != w['doc_id'] for r in kb.search('A사 거래 요약')))
        kb.review_wiki(w['doc_id'], approve=True)
        self.assertEqual(kb.search('A사 거래 요약')[0]['doc_id'], w['doc_id'])

    def test_agent_edit_tool(self):
        kb = self.kb
        reg = build_registry(kb, [SAMPLE_DIR])
        d = self.doc_id('환불')
        body = kb.document(d)['body']
        target = next(l for l in body.splitlines() if l.strip())
        self.assertIn('없습니다', reg.call('kb_edit', {'doc_id': d, 'old_text': '존재하지않는문장'}))
        reg.call('kb_edit', {'doc_id': d, 'old_text': target, 'new_text': target + ' (확인됨)'})
        self.assertIn('(확인됨)', kb.document(d)['body'])
        reg.call('kb_edit', {'doc_id': d, 'new_text': '참고: [[출장비 규정]]'})
        after = kb.document(d)['body']
        self.assertTrue(after.rstrip().endswith('참고: [[출장비 규정]]'))
        self.assertIn('출장비 규정', {l['other_title'] for l in kb.links_of(d) if l['kind'] == 'references'})
        self.assertIn('바꿀 내용이 없습니다', reg.call('kb_edit', {'doc_id': d}))


# ---------------------------------------------------------------- 검색 · 그래프 · 목차
class SearchTests(KBTestBase):
    def test_korean_particles_do_not_break_keyword_search(self):
        res = self.kb.search('견적서를 보내는 절차를', mode='keyword')
        self.assertTrue(res and '견적' in res[0]['title'])

    def test_glossary_expands_synonyms(self):
        self.assertIn('대성물산', self.kb.search('A사 결제 조건', mode='keyword')[0]['title'])

    def test_hybrid_uses_both_methods(self):
        res = self.kb.search('출장 숙박비 상한')
        self.assertIn('출장비', res[0]['title'])
        self.assertEqual(set(res[0]['via']), {'keyword', 'vector'})
        self.assertEqual(res[0]['path'], '정책')

    def test_similar_to_draft_warns_before_creating(self):
        # 이미 있는 문서와 같은 내용의 새 글은 비슷한 문서로 나오고, 엉뚱한 글은 나오지 않는다
        kb, sid = self.kb, self.doc_id('출장비')
        body = kb.document(sid)['body']
        got = kb.similar_to_draft('출장비 규정 정리', body)
        self.assertEqual(got['similar'][0]['doc_id'], sid)
        self.assertEqual(kb.similar_to_draft('', '')['similar'], [])
        self.assertNotIn(sid, [d['doc_id'] for d in kb.similar_to_draft('출장비', body, exclude=sid)['similar']])

    def test_search_under_subtree(self):
        res = self.kb.search('할인', under=self.doc_id('고객'))
        self.assertTrue(res and all(r['path'].startswith('고객') for r in res))

    def test_scoped_vector_search_is_computed_inside_scope(self):
        # 범위 밖 조각이 전체 상위 후보를 모두 차지해도 범위 안의 결과는 나와야 한다
        kb, scope = self.kb, self.doc_id('정책')
        for i in range(210):
            kb.create_note(f'잡음 {i}', '출장 숙박비 상한 출장 숙박비 상한')
        res = kb.search('출장 숙박비 상한', under=scope, mode='vector')
        self.assertTrue(res and res[0]['title'] == '출장비 규정')

    def test_search_is_logged_and_read_window(self):
        self.kb.search('존재하지않는단어쿼리', mode='keyword')   # 가짜 해시 벡터는 우연히 겹칠 수 있어 키워드로
        self.assertEqual(self.kb.stats()['empty_searches'], 1)
        out = self.kb.read(self.doc_id('견적 처리'), chunk_ord=0, window=1)
        self.assertEqual([c['ord'] for c in out['chunks']], [0, 1])

    def test_graph_has_tree_edges_and_local_graph(self):
        kb = self.kb
        g = kb.graph()
        ids = {n['id'] for n in g['nodes']}
        self.assertTrue(all(e['source'] in ids and e['target'] in ids for e in g['edges']))
        self.assertIn({'source': self.doc_id('영업'), 'target': self.doc_id('견적 처리')},
                      [{'source': e['source'], 'target': e['target']} for e in g['edges'] if e['kind'] == 'child'])
        n = kb.create_note('메모', '[[견적 처리 절차]]')
        one = {x['id'] for x in kb.local_graph(n['doc_id'], depth=1)['nodes']}
        two = {x['id'] for x in kb.local_graph(n['doc_id'], depth=2)['nodes']}
        self.assertIn(self.doc_id('견적 처리'), one)
        self.assertNotIn(self.doc_id('영업'), one)
        self.assertIn(self.doc_id('영업'), two)

    def test_catalog_outline(self):
        text = self.kb.catalog_text()
        self.assertIn('\n  - [', text)  # 하위 문서는 들여쓴다
        self.assertLess(text.index('영업'), text.index('견적 처리 절차'))


class NoEmbeddingTests(KBTestBase):
    embedder_cls = NoEmbedder

    def test_graph_without_embeddings_uses_keyword_similarity(self):
        self.assertEqual(self.kb.graph()['similarity'], 'keyword')
        self.assertEqual(self.kb.search('출장 숙박비')[0]['title'], '출장비 규정')


class EmbedderLoadingTests(KBTestBase):
    """임베딩 모델을 받는 동안에도 저장·키워드 검색은 동작하고, 준비되면 빠진 벡터를 채운다."""

    embedder_cls = LoadingEmbedder

    def test_keyword_search_works_while_model_loads_then_backfills(self):
        kb = self.kb
        self.assertEqual(kb.stats()['embedded_chunks'], 0)
        res = kb.search('출장 숙박비 상한')
        self.assertEqual(res[0]['title'], '출장비 규정')
        self.assertEqual(res[0]['via'], ['keyword'])
        kb.embedder = HashEmbedder()  # 모델 준비 완료
        self.assertEqual(kb.reembed(), kb.stats()['chunks'])
        self.assertEqual(set(kb.search('출장 숙박비 상한')[0]['via']), {'keyword', 'vector'})


# ---------------------------------------------------------------- 도구
class ToolTests(KBTestBase):
    def test_tool_schema_from_type_hints(self):
        @tool
        def f(query: str, limit: int = 5, tags: list[str] = []) -> str:
            """설명입니다.

            Args:
                query: 검색어
            """
            return query

        d = f.definition()
        self.assertEqual(d['description'], '설명입니다.')
        self.assertEqual(d['parameters']['required'], ['query'])
        self.assertEqual(d['parameters']['properties']['query']['description'], '검색어')
        self.assertEqual(d['parameters']['properties']['tags']['type'], 'array')

    def test_registry_tools(self):
        kb = self.kb
        reg = build_registry(kb, [SAMPLE_DIR])
        self.assertIn('혹시 kb_search', reg.call('kb_serch', {}))
        self.assertIn('인자가 올바르지 않습니다', reg.call('kb_read', {}))
        self.assertIn('문서가 없습니다', reg.call('kb_read', {'doc_id': 'd_없음'}))
        self.assertIn('허용된 폴더 밖', reg.call('kb_ingest', {'path': 'C:/Windows'}))
        page = kb.db.one("SELECT id FROM kb_documents WHERE title='고객'")['id']
        reg.call('kb_move', {'doc_id': self.doc_id('환불'), 'parent_id': page})
        self.assertEqual(kb._doc(self.doc_id('환불'))['parent_id'], page)

    def test_agent_documents_record_author(self):
        reg = build_registry(self.kb, [SAMPLE_DIR], author='범무')
        out = json.loads(reg.call('kb_create_page', {'title': '거래처'}))
        d = self.kb._doc(out['doc_id'])
        self.assertEqual((d['created_by'], d['author']), ('agent', '범무'))


# ---------------------------------------------------------------- HTTP API (화면 · 외부 에이전트)
class APITestBase(KBTestBase):
    def setUp(self):
        super().setUp()
        self.override = override_settings(KB_DATA_DIR=self.tmp / 'data')
        self.override.enable()
        self.addCleanup(self.override.disable)
        runtime._kb = self.kb
        views.registry_for.cache_clear()
        self.addCleanup(views.registry_for.cache_clear)
        agent_modules.clear_cache()
        self.addCleanup(agent_modules.clear_cache)
        self.addCleanup(setattr, runtime, '_kb', None)
        self.user = User.objects.create_user('tester', password='pw-1234-test')
        self.client_ = APIClient()
        self.client_.force_authenticate(self.user)

    def token_client(self):
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION=f'Token {api_tokens.issue(self.user)[0]}')
        return c


class HTTPAPITests(APITestBase):
    def test_api_end_to_end(self):
        c = self.client_
        self.assertIn('documents', c.get('/api/kb/status/').json())
        tree = c.get('/api/kb/tree/').json()
        sales = next(d['id'] for d in tree if d['title'] == '영업')
        hits = c.post('/api/kb/search/', {'query': '파일럿 조건'}, format='json').json()
        d = hits[0]['doc_id']
        doc = c.get(f'/api/kb/documents/{d}/').json()
        self.assertTrue(doc['chunks'] and doc['ancestors'] and 'body' in doc)
        self.assertEqual(c.post(f'/api/kb/documents/{d}/tags/', {'add': ['테스트']}, format='json').json()['tags'],
                         ['테스트'])
        self.assertEqual(c.post(f'/api/kb/documents/{d}/move/', {'parent_id': sales, 'index': 0},
                                format='json').json()['index'], 0)
        self.assertEqual(c.post(f'/api/kb/documents/{sales}/move/', {'parent_id': d}, format='json').status_code, 400)
        self.assertEqual(c.get('/api/kb/documents/d_없음/').status_code, 404)
        self.assertEqual(c.post('/api/kb/ingest/', {'path': str(self.tmp)}, format='json').status_code, 400)
        note = c.post('/api/kb/notes/', {'title': '하위 메모', 'body': '내용', 'parent_id': sales}, format='json').json()
        self.assertEqual(c.get(f"/api/kb/documents/{note['doc_id']}/").json()['ancestors'][-1]['title'], '영업')
        self.assertEqual(self.kb._doc(note['doc_id'])['author'], 'tester')

        from django.core.files.uploadedfile import SimpleUploadedFile

        up = c.post('/api/kb/upload/', {'files': [SimpleUploadedFile('메모.txt', '# 회의 메모\n\n다음 주 전시회 참가'.encode())],
                                         'parent_id': sales}, format='multipart').json()
        self.assertEqual((up[0]['status'], up[0]['parent_id']), ('added', sales))
        bad = c.post('/api/kb/upload/', {'files': [SimpleUploadedFile('x.exe', b'MZ')]}, format='multipart').json()
        self.assertIn('지원하지 않는 형식', bad[0]['error'])
        # 올린 원본 파일: 문서 화면에서 열고(iframe 은 같은 사이트만) 내려받는다
        raw = c.get(f"/api/kb/documents/{up[0]['doc_id']}/raw/")
        self.assertEqual((raw.status_code, raw['X-Frame-Options']), (200, 'SAMEORIGIN'))
        self.assertIn('attachment', raw['Content-Disposition'])            # PDF 가 아니면 내려받기
        self.assertEqual(b''.join(raw.streaming_content).decode(), '# 회의 메모\n\n다음 주 전시회 참가')
        self.assertEqual(c.get(f"/api/kb/documents/{note['doc_id']}/raw/").status_code, 404)   # 쓴 문서는 원본 없음
        self.assertIn(APIClient().get(f"/api/kb/documents/{up[0]['doc_id']}/raw/").status_code, (401, 403))

    def test_login_required(self):
        anon = APIClient()
        for url in ['/api/kb/tree/', '/api/kb/tools/', '/api/kb/guide/']:
            self.assertIn(anon.get(url).status_code, (401, 403), url)
        self.assertEqual(anon.post('/api/kb/mcp', {}, format='json').status_code, 401)

    def test_http_tool_api_with_token(self):
        c = self.token_client()
        self.assertIn('kb_catalog', c.get('/api/kb/guide/').content.decode())
        names = {t['name'] for t in c.get('/api/kb/tools/').json()}
        self.assertTrue({'kb_search', 'kb_read', 'kb_propose_wiki'} <= names and 'kb_link' not in names)
        r = c.post('/api/kb/tools/kb_search/', {'query': 'A사 결제 조건'}, format='json').json()
        self.assertTrue(r['ok'] and '대성물산' in r['result'][0]['title'])
        anth = c.get('/api/kb/tools/?format=anthropic').json()
        self.assertEqual({'name', 'description', 'input_schema'}, set(anth[0]))
        oai = c.get('/api/kb/tools/?format=openai').json()
        self.assertEqual(oai[0]['type'], 'function')
        self.assertEqual(c.get('/api/kb/tools/?format=xml').status_code, 400)
        bad = c.post('/api/kb/tools/kb_read/', {'doc_id': 'd_없음'}, format='json').json()
        self.assertFalse(bad['ok'])
        self.assertIn('문서가 없습니다', bad['result'])

    def test_mcp_over_http(self):
        c = self.token_client()

        def rpc(body):
            r = c.post('/api/kb/mcp', json.dumps(body), content_type='application/json',
                       HTTP_ACCEPT='application/json, text/event-stream')
            self.assertIn(r.status_code, (200, 202), r.content)
            return r.json() if r.status_code == 200 else None

        init = rpc({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
            'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'test', 'version': '0'}}})
        self.assertEqual(init['result']['serverInfo']['name'], 'knowledge-base')
        self.assertEqual(init['result']['protocolVersion'], '2025-06-18')
        self.assertIn('kb_catalog', init['result']['instructions'])
        self.assertIsNone(rpc({'jsonrpc': '2.0', 'method': 'notifications/initialized'}))
        tools = rpc({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'})['result']['tools']
        by_name = {t['name']: t for t in tools}
        self.assertEqual(set(by_name), set(build_registry(self.kb, [SAMPLE_DIR]).names()))
        self.assertIn('하위 문서', by_name['kb_search']['inputSchema']['properties']['under']['description'])
        res = rpc({'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call',
                   'params': {'name': 'kb_search', 'arguments': {'query': '출장 숙박비'}}})
        self.assertIn('출장비 규정', res['result']['content'][0]['text'])
        self.assertFalse(res['result']['isError'])
        err = rpc({'jsonrpc': '2.0', 'id': 4, 'method': 'tools/call',
                   'params': {'name': 'kb_read', 'arguments': {'doc_id': 'd_없음'}}})
        self.assertTrue(err['result']['isError'])
        self.assertEqual(rpc({'jsonrpc': '2.0', 'id': 5, 'method': 'nope'})['error']['code'], -32601)
        self.assertEqual(c.get('/api/kb/mcp').status_code, 405)

    def test_token_issue_and_revoke(self):
        c = self.client_
        self.assertIsNone(c.get('/api/kb/token/').json()['key'])
        pw = {'password': 'pw-1234-test'}
        key = c.post('/api/kb/token/', pw, format='json').json()['key']
        got = c.get('/api/kb/token/').json()   # 키는 한 번만 보여 준다 (해시만 저장)
        self.assertEqual((got['key'], got['exists'], got['prefix']), (None, True, key[:6]))
        self.assertNotEqual(c.post('/api/kb/token/', pw, format='json').json()['key'], key)  # 다시 발급하면 이전 키는 무효
        c.delete('/api/kb/token/')
        self.assertFalse(c.get('/api/kb/token/').json()['exists'])


# ---------------------------------------------------------------- 첨부 파일
class AttachmentTests(APITestBase):
    def test_attachment_saved_once_with_markdown(self):
        kb = self.kb
        a = kb.save_attachment('회의 사진 (1).png', PNG)
        self.assertEqual(a['kind'], 'image')
        self.assertEqual(a['markdown'], f"![회의 사진 (1)]({a['url']})")
        self.assertTrue(a['url'].startswith('files/') and ' ' not in a['url'] and '(' not in a['url'])
        self.assertEqual(kb.save_attachment('다른이름.png', PNG)['url'].split('/')[1], a['url'].split('/')[1])
        pdf = kb.save_attachment('견적서.pdf', b'%PDF-1.4 test')
        self.assertEqual(pdf['kind'], 'file')
        self.assertTrue(pdf['markdown'].startswith('[견적서.pdf](files/'))

    def test_attachment_rejects_unsafe(self):
        kb = self.kb
        for name in ['x.svg', 'x.html', 'x.exe', 'noext']:
            with self.assertRaisesRegex(ValueError, '첨부할 수 없는 형식'):
                kb.save_attachment(name, b'<svg onload=alert(1)>')
        with self.assertRaisesRegex(ValueError, '너무 큽니다'):
            kb.save_attachment('big.png', b'0' * (26 * 1024 * 1024))
        h = kb.save_attachment('a.png', PNG)['url'].split('/')[1]
        for bad in [('../../etc', 'passwd'), (h, '..\\..\\kb.sqlite'), ('zzzz', 'a.png'), (h, '없음.png')]:
            with self.assertRaises(KeyError):
                kb.attachment_path(*bad)

    def test_attachments_copied_to_pages_with_relative_links(self):
        kb = self.kb
        img = kb.save_attachment('도면.png', PNG)
        n = kb.create_note('현장 사진', f"설치 전\n\n{img['markdown']}", self.doc_id('영업'))
        md = self.page_file('영업', '현장 사진.md').read_text(encoding='utf-8')
        h = img['url'].split('/')[1]
        self.assertIn(f'](../_files/{h}/', md)
        self.assertNotIn('](files/', md)
        self.assertEqual((kb.pages_dir / '_files' / h / '도면.png').read_bytes(), PNG)
        self.assertIn('](files/', kb.document(n['doc_id'])['body'])

    def test_attachment_too_big_is_rejected_before_reading(self):
        from unittest import mock

        from django.core.files.uploadedfile import SimpleUploadedFile

        from .services import core

        f = SimpleUploadedFile('큰.png', PNG)
        # 크기 검사가 f.read() 보다 먼저라 save_attachment(…, f.read()) 까지 가지 않는다
        with mock.patch.object(views, 'MAX_ATTACH_BYTES', 10), \
                mock.patch.object(core.KnowledgeBase, 'save_attachment', side_effect=AssertionError):
            up = self.client_.post('/api/kb/attachments/', {'files': [f]}, format='multipart').json()
        self.assertIn('너무 큽니다', up[0]['error'])

    def test_attachment_http(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        c = self.client_
        up = c.post('/api/kb/attachments/', {'files': [
            SimpleUploadedFile('표지.png', PNG), SimpleUploadedFile('악성.svg', b'<svg/>'),
            SimpleUploadedFile('자료.docx', b'PK\x03\x04')]}, format='multipart').json()
        self.assertEqual(up[0]['kind'], 'image')
        self.assertIn('error', up[1])
        self.assertEqual(up[2]['kind'], 'file')
        r = c.get('/api/kb/' + up[0]['url'])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(b''.join(r.streaming_content), PNG)
        self.assertEqual(r['Content-Type'], 'image/png')
        self.assertEqual(r['X-Content-Type-Options'], 'nosniff')
        self.assertTrue(r['Content-Disposition'].startswith('inline'))
        self.assertTrue(c.get('/api/kb/' + up[2]['url'])['Content-Disposition'].startswith('attachment'))
        self.assertEqual(c.get('/api/kb/files/000000000000/x.png').status_code, 404)
        self.assertIn(APIClient().get('/api/kb/' + up[0]['url']).status_code, (401, 403))  # 로그인 필요


class MaterializeSymlinkTests(__import__('unittest').TestCase):
    def test_symlinks_in_snapshots_become_files(self):
        import os
        import tempfile
        import unittest
        from pathlib import Path

        from apps.kb.services.embed import materialize_symlinks
        root = Path(tempfile.mkdtemp())
        blob = root / 'models--x' / 'blobs' / 'abc'
        blob.parent.mkdir(parents=True)
        blob.write_bytes(b'weights')
        snap = root / 'models--x' / 'snapshots' / '29'
        snap.mkdir(parents=True)
        try:
            os.symlink(blob, snap / 'model.onnx_data')
        except (OSError, NotImplementedError):
            raise unittest.SkipTest('이 OS 에서는 심볼릭 링크를 만들 수 없습니다')
        self.assertEqual(materialize_symlinks(str(root)), 1)
        f = snap / 'model.onnx_data'
        self.assertFalse(f.is_symlink())
        self.assertEqual(f.read_bytes(), b'weights')
        self.assertEqual(materialize_symlinks(str(root)), 0)  # 두 번 해도 괜찮다


class FastEmbedderBatchTests(__import__('unittest').TestCase):
    def test_encode_embeds_in_small_batches(self):
        """한 번에 많이 넣으면 ONNX 가 조각 수만큼 메모리를 잡아 서버가 죽는다 (64조각 4.7GB → 8개씩 2.3GB)"""
        from apps.kb.services.embed import FastEmbedder

        class FakeModel:
            def __init__(self):
                self.batch_sizes = []

            def embed(self, texts, batch_size=256):
                self.batch_sizes.append(batch_size)
                return [np.ones(4, dtype=np.float32) for _ in texts]

        e = FastEmbedder('intfloat/multilingual-e5-large')
        e._model = FakeModel()
        self.assertEqual(e.encode(['가'] * 20).shape, (20, 4))
        self.assertEqual(e._model.batch_sizes, [e.batch_size])
        self.assertLessEqual(e.batch_size, 16)


class _FakeModel:
    def __init__(self):
        self.batch_sizes = []

    def embed(self, texts, batch_size=256):
        self.batch_sizes.append(batch_size)
        return [np.ones(4, dtype=np.float32) for _ in texts]


class FastEmbedderIdleTests(__import__('unittest').TestCase):
    """2GB 모델은 encode() 가 필요할 때만 올리고, 오래 안 쓰면 내렸다가 다음에 다시 올린다."""

    def make(self, idle=1):
        from apps.kb.services.embed import FastEmbedder

        e = FastEmbedder('intfloat/multilingual-e5-large', idle_minutes=idle)
        e.loads = 0

        def fake_start():  # 실제 모델 대신: 잠깐 뒤 다른 스레드에서 준비 완료
            e.loads += 1
            e._ready.clear()
            import threading

            def done():
                with e._lock:
                    e._model, e._loaded_once, e._last_used = _FakeModel(), True, __import__('time').monotonic()
                e._ready.set()
            threading.Timer(0.05, done).start()
        e.start_loading = fake_start
        return e

    def loaded(self, e):
        import time

        e._model, e._loaded_once, e._last_used = _FakeModel(), True, time.monotonic()
        return e._last_used

    def test_first_encode_starts_loading_and_raises_not_ready(self):
        e = self.make()
        with self.assertRaises(EmbedderNotReady):
            e.encode(['가'])
        self.assertEqual(e.loads, 1)

    def test_unload_after_idle_only_when_not_busy(self):
        e = self.make(idle=1)
        t = self.loaded(e)
        self.assertFalse(e.unload_if_idle(now=t + 30))  # 아직 1분 안 지남
        e._busy = 1
        self.assertFalse(e.unload_if_idle(now=t + 120))  # 쓰는 중이면 내리지 않는다
        e._busy = 0
        self.assertTrue(e.unload_if_idle(now=t + 120))
        self.assertEqual(e.state, 'idle')
        self.assertIsNone(e._model)

    def test_idle_zero_never_unloads(self):
        e = self.make(idle=0)
        t = self.loaded(e)
        self.assertFalse(e.unload_if_idle(now=t + 10 ** 6))

    def test_reload_after_unload_waits_and_keeps_batch_size(self):
        e = self.make(idle=1)
        t = self.loaded(e)
        self.assertTrue(e.unload_if_idle(now=t + 120))
        out = e.encode(['가'] * 20)  # 한 번 불러온 적이 있으면 다시 불러오는 동안 기다린다
        self.assertEqual(out.shape, (20, 4))
        self.assertEqual(e.loads, 1)
        self.assertEqual(e._model.batch_sizes, [e.batch_size])
        self.assertEqual(e._busy, 0)

    def test_ensure_ready_waits_for_first_load(self):
        """백그라운드 작업(여론 시뮬레이션 그래프 구축)은 처음 불러올 때도 기다렸다 쓴다."""
        e = self.make()
        self.assertTrue(e.ensure_ready(5))
        self.assertEqual(e.encode(['가']).shape, (1, 4))

    def test_concurrent_encode_and_unload(self):
        """여러 스레드가 encode 하는 동안 내리기가 끼어도 깨지지 않는다."""
        import threading
        import time

        e = self.make(idle=1)
        self.loaded(e)
        errors = []

        def work():
            for _ in range(50):
                try:
                    e.encode(['가'])
                except EmbedderNotReady:
                    pass
                except Exception as ex:  # noqa: BLE001
                    errors.append(ex)
        threads = [threading.Thread(target=work) for _ in range(4)]
        for th in threads:
            th.start()
        for _ in range(50):
            e.unload_if_idle(now=time.monotonic() + 120)
        for th in threads:
            th.join()
        self.assertEqual(errors, [])
        self.assertEqual(e._busy, 0)


class LazyEmbedderLoadTests(KBTestBase):
    """트리·최근 문서·키워드 검색은 임베딩 모델을 올리지 않는다."""

    def fast(self):
        from apps.kb.services.embed import FastEmbedder

        e = FastEmbedder('intfloat/multilingual-e5-large', idle_minutes=20)
        e.loads = 0

        def fake_start():
            e.loads += 1
        e.start_loading = fake_start
        return e

    def test_get_kb_does_not_start_loading(self):
        from unittest import mock

        from apps.kb.services.embed import FastEmbedder

        runtime._kb = None
        self.addCleanup(setattr, runtime, '_kb', None)
        # fastembed 가 깔려 있지 않아도 (선택 설치) 늦게 불러오기 동작은 본다
        with override_settings(KB_EMBED='fastembed:intfloat/multilingual-e5-large', KB_DATA_DIR=self.tmp / 'd'), \
                mock.patch('apps.kb.services.embed._installed', return_value=True), \
                mock.patch.object(FastEmbedder, 'start_loading') as start:
            kb = runtime.get_kb()
            kb.tree()
            kb.recent()
            kb.search('출장 숙박비', mode='keyword', log_query=False)
            start.assert_not_called()
            self.assertEqual(kb.embedder.idle_seconds, 20 * 60)

    def test_keyword_calls_never_encode(self):
        e = self.fast()
        self.kb.embedder = e
        self.kb.tree()
        self.kb.recent()
        self.kb.stats()
        self.assertEqual(self.kb.search('출장 숙박비', mode='keyword')[0]['title'], '출장비 규정')
        self.assertEqual(e.loads, 0)
        self.kb.create_note('새 글', '본문 내용')  # 저장은 임베딩이 필요하다 → 이때 불러오기 시작
        self.assertEqual(e.loads, 1)


class AttachmentTokenTests(APITestBase):
    """첨부 올리기·내려받기: API 토큰으로도 되고, 로그인 안 한 사람은 막힌다."""

    def test_token_upload_and_download(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        c = self.token_client()
        r = c.post('/api/kb/attachments/', {'files': SimpleUploadedFile('단가표.pdf', b'%PDF-1.4 price')}, format='multipart')
        self.assertEqual(r.status_code, 200, r.content)
        url = r.json()[0]['url']
        got = c.get(f'/api/kb/{url}')
        self.assertEqual(got.status_code, 200)
        self.assertEqual(b''.join(got.streaming_content), b'%PDF-1.4 price')
        anon = APIClient()
        self.assertIn(anon.get(f'/api/kb/{url}').status_code, (401, 403))
        self.assertIn(anon.post('/api/kb/attachments/', {}, format='multipart').status_code, (401, 403))
        bad = APIClient()
        bad.credentials(HTTP_AUTHORIZATION='Token wrong-token')
        self.assertEqual(bad.post('/api/kb/attachments/', {}, format='multipart').status_code, 401)


class OptionalSearchDepsTests(TestCase):
    """fastembed·kiwipiepy 가 없어도 죽지 않고 키워드 검색으로 동작한다."""

    def test_simple_tokens_strip_particles(self):
        from .services.textproc import simple_tokens
        self.assertEqual(simple_tokens('견적서를 보냈다 A사에서 2026년'), ['견적서', '보냈다', 'a', '사에서', '2026', '년'])  # 너무 짧은 낱말은 떼지 않는다
        self.assertEqual(simple_tokens('출장비는'), ['출장비'])

    def test_missing_fastembed_falls_back_to_no_embedder(self):
        from unittest import mock

        from .services.embed import make_embedder
        with mock.patch('apps.kb.services.embed._installed', return_value=False):
            e = make_embedder('fastembed:intfloat/multilingual-e5-large')
        self.assertIsInstance(e, NoEmbedder)
        self.assertFalse(e.enabled)

    def test_missing_kiwi_uses_simple_tokens(self):
        from unittest import mock

        from .services import textproc
        with mock.patch.object(textproc, '_get_kiwi', return_value=None):
            self.assertEqual(textproc.tokens('견적서를'), ['견적서'])
            self.assertEqual(textproc.fts_query('견적서를 보냈다'), '"견적서" OR "보냈다"')
