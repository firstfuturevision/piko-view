"""외부 에이전트가 쓰는 KB 도구 모음 (MCP 와 HTTP 도구 API 가 같은 레지스트리를 쓴다)."""
from pathlib import Path

from apps.agent.tools import ToolRegistry, tool

from .core import LINK_KINDS, KnowledgeBase

AGENT = 'agent'
GUIDE_PATH = Path(__file__).parent / 'guide.md'


def check_allowed(path: str, roots: list[Path]) -> Path:
    p = Path(path).expanduser().resolve()
    if not any(p.is_relative_to(r.resolve()) for r in roots):
        allowed = ', '.join(str(r) for r in roots)
        raise PermissionError(f'허용된 폴더 밖의 경로입니다. 허용 폴더: {allowed}')
    return p


def build_registry(kb: KnowledgeBase, allowed_roots: list[Path], author: str = '') -> ToolRegistry:
    """author: 이 도구를 호출하는 사용자(API 토큰 주인). 에이전트가 만든 문서에 기록된다."""

    @tool
    def kb_catalog() -> dict:
        """KB 목차를 본다: 문서 트리(상위/하위 문서), 자주 쓰인 태그, 용어집, 승인 대기 위키 수."""
        return kb.catalog()

    @tool
    def kb_search(query: str, under: str | None = None, limit: int = 6) -> list[dict]:
        """키워드와 의미를 함께 사용해 문서 조각을 검색한다. 결과가 부족하면 다른 표현으로 다시 검색하라.

        Args:
            query: 검색어 또는 질문 (자연어 가능)
            under: 이 문서와 그 하위 문서에서만 찾을 때 문서 ID
            limit: 최대 결과 수
        """
        return kb.search(query, under=under, limit=min(limit, 15))

    @tool
    def kb_read(doc_id: str, chunk_ord: int | None = None, window: int = 1) -> dict:
        """문서를 읽는다. chunk_ord를 주면 그 조각과 앞뒤 window개 조각만, 없으면 문서 앞부분을 준다.

        Args:
            doc_id: 문서 ID (예: d_1a2b3c4d5e)
            chunk_ord: 읽을 조각 번호 (검색 결과의 chunk_ord)
            window: 앞뒤로 함께 읽을 조각 수
        """
        return kb.read(doc_id, chunk_ord, window)

    @tool
    def kb_related(doc_id: str) -> dict:
        """문서에 연결된 문서와 내용이 비슷한 문서를 찾는다. 상위/하위 문서는 kb_read 결과의 path, children 을 본다.

        Args:
            doc_id: 기준 문서 ID
        """
        return kb.related(doc_id)

    @tool
    def kb_ingest(path: str, parent_id: str | None = None) -> list[dict]:
        """허용된 폴더의 파일이나 폴더를 KB에 가져온다 (md, txt, pdf, docx, xlsx, csv → 모두 Markdown으로 변환).
        폴더는 같은 이름의 문서가 되고, 안의 파일·폴더는 그 하위 문서가 된다.

        Args:
            path: 파일 또는 폴더 경로
            parent_id: 이 문서 아래에 넣는다 (비우면 최상위)
        """
        return kb.ingest_path(check_allowed(path, allowed_roots), parent_id, created_by=AGENT, author=author)

    @tool
    def kb_move(doc_id: str, parent_id: str | None = None, index: int | None = None) -> dict:
        """문서를 다른 문서 아래로 옮긴다 (그 하위 문서도 함께 옮겨진다).

        Args:
            doc_id: 옮길 문서 ID
            parent_id: 새 상위 문서 ID (비우면 최상위)
            index: 형제 문서 사이 순서 (0부터, 비우면 맨 끝)
        """
        return kb.move(doc_id, parent_id, index)

    @tool
    def kb_create_page(title: str, parent_id: str | None = None) -> dict:
        """하위 문서를 묶기 위한 빈 문서를 만든다 (예: '거래처' 아래에 고객 문서들을 모을 때). 본문은 kb_edit 로 쓴다.

        Args:
            title: 문서 제목
            parent_id: 상위 문서 ID (비우면 최상위)
        """
        return kb.create_note(title, '', parent_id, created_by=AGENT, author=author)

    @tool
    def kb_edit(doc_id: str, old_text: str = '', new_text: str = '', title: str | None = None) -> dict:
        """문서 본문을 고친다. old_text 를 new_text 로 바꾼다 (old_text 는 본문에 글자 그대로 정확히 한 번 있어야 한다).
        old_text 를 비우면 new_text 를 본문 끝에 덧붙인다. 고치기 전에 kb_read 로 본문을 읽는다.
        다른 문서와의 연결은 본문에 [[문서 제목]] 으로 쓴다. 가져온 파일의 원본은 바뀌지 않는다.

        Args:
            doc_id: 고칠 문서 ID
            old_text: 바꿀 기존 본문 조각 (글자 그대로). 비우면 끝에 덧붙이기
            new_text: 새 내용 (Markdown). 비우면 old_text 를 지운다
            title: 새 제목 (바꿀 때만)
        """
        return kb.edit(doc_id, old_text, new_text, title)

    @tool
    def kb_tag(doc_id: str, add: list[str] = [], remove: list[str] = []) -> dict:
        """문서에 태그를 붙이거나 뗀다. 태그는 짧은 명사로 (예: 가격, A사, 2026).

        Args:
            doc_id: 문서 ID
            add: 붙일 태그 목록
            remove: 뗄 태그 목록
        """
        if remove:
            kb.remove_tags(doc_id, remove)
        return kb.add_tags(doc_id, add)

    @tool
    def kb_propose_wiki(title: str, body: str, sources: list[str], parent_id: str | None = None) -> dict:
        """여러 문서에서 확인한 사실을 정리한 위키 페이지를 제안한다. 사람이 승인해야 검색에 반영된다.
        다른 문서와의 연결은 본문에 [[문서 제목]] 으로 쓴다 (따로 연결을 지정하는 방법은 없다).

        Args:
            title: 위키 제목
            body: Markdown 본문. 사실마다 근거 문서를 [[문서 제목]] 으로 인용
            sources: 근거 문서 ID 목록
            parent_id: 위키를 둘 상위 문서 ID (비우면 최상위)
        """
        return kb.propose_wiki(title, body, sources, parent_id, created_by=AGENT, author=author)

    @tool
    def kb_glossary_add(term: str, synonyms: list[str] = [], definition: str = '') -> dict:
        """사내 용어와 동의어/약어를 용어집에 추가한다. 검색할 때 동의어도 함께 찾게 된다.

        Args:
            term: 대표 용어
            synonyms: 같은 뜻의 다른 표현, 약어
            definition: 뜻 한 줄
        """
        return kb.add_glossary(term, synonyms, definition)

    tools = [kb_catalog, kb_search, kb_read, kb_related, kb_ingest, kb_move, kb_create_page, kb_edit, kb_tag,
             kb_propose_wiki, kb_glossary_add]
    assert set(LINK_KINDS) == {'references', 'supersedes'}
    return ToolRegistry(tools)


READ_ONLY_TOOLS = {'kb_catalog', 'kb_search', 'kb_read', 'kb_related'}
