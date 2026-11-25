"""프로세스당 하나의 KnowledgeBase (임베딩 모델·벡터 캐시를 공유한다)."""
import threading
from functools import lru_cache
from pathlib import Path

from django.conf import settings
from django.db import connection

from .agent_tools import build_registry
from .core import KnowledgeBase
from .db import DB
from .embed import make_embedder

_kb: KnowledgeBase | None = None
_lock = threading.Lock()


def data_dir() -> Path:
    return Path(settings.KB_DATA_DIR)


def inbox_dir() -> Path:
    return data_dir() / 'inbox'


def allowed_roots() -> list[Path]:
    """경로 가져오기(ingest)를 허용하는 폴더."""
    return [Path(settings.KB_SAMPLE_DIR), inbox_dir(), *map(Path, settings.KB_ALLOWED_ROOTS)]


def _backfill(kb: KnowledgeBase):
    """임베딩 모델이 준비되면 (별도 스레드에서) 빠진 벡터를 채운다."""
    try:
        kb.reembed()
    finally:
        connection.close()  # 이 스레드가 연 DB 연결 정리


def get_kb() -> KnowledgeBase:
    global _kb
    with _lock:
        if _kb is None:
            embedder = make_embedder(settings.KB_EMBED, settings.KB_EMBED_THREADS,
                                     str(data_dir() / 'models'), settings.KB_EMBED_BATCH,
                                     getattr(settings, 'KB_EMBED_IDLE_MIN', 20))
            kb = KnowledgeBase(DB(), embedder, data_dir() / 'raw', Path(settings.KB_PAGES_DIR),
                               data_dir() / 'files')
            if hasattr(embedder, 'start_loading'):
                # 여기서 미리 불러오지 않는다: 트리·최근 문서·키워드 검색만 쓰는 요청이 2GB 모델을 올리지 않도록
                # 실제로 encode() 가 필요할 때 불러오고, 준비되면 빠진 벡터를 채운다.
                embedder.on_ready = lambda: _backfill(kb)
            _kb = kb
        return _kb


@lru_cache(maxsize=64)
def registry_for(author: str):
    """외부 에이전트용 KB 도구 레지스트리. author 는 도구를 부른 사용자(API 토큰 주인)."""
    return build_registry(get_kb(), allowed_roots(), author)
