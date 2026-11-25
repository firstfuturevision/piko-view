"""키워드 검색용 토큰화. '견적서를' → '견적서' 처럼 조사를 떼어 키워드 검색이 맞도록 한다.

kiwipiepy(형태소 분석, `uv sync --extra search`)가 있으면 그것을 쓰고,
없으면 정규식으로 낱말을 나누고 흔한 조사·어미 꼬리만 떼는 간단한 방식으로 대신한다 (오류 없이 동작).
"""
import re
import threading

# 명사, 동사/형용사 어간, 어근, 외국어, 숫자, 한자
_KEEP_TAGS = ('NN', 'VV', 'VA', 'XR', 'SL', 'SN', 'SH')
_kiwi = None
_kiwi_missing = False
_lock = threading.Lock()

_WORD = re.compile(r'[0-9A-Za-z]+|[가-힣]+|[一-鿿]+')
# 긴 것부터 떼어 본다 (한 번만)
_SUFFIXES = sorted([
    '에서부터', '으로부터', '로부터', '에게서', '한테서', '이라고', '라고', '이라는', '라는',
    '에서는', '에서도', '에서', '에게', '한테', '께서', '으로', '부터', '까지', '처럼', '보다', '마다', '이나',
    '이랑', '하고', '에는', '에도', '와는', '과는', '으론', '로는',
    '은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '도', '만', '로', '나', '랑',
    '입니다', '합니다', '했다', '한다', '하다', '하는', '했던', '해서', '하며', '되는', '된다',
], key=len, reverse=True)


def _get_kiwi():
    global _kiwi, _kiwi_missing
    with _lock:
        if _kiwi is None and not _kiwi_missing:
            try:
                from kiwipiepy import Kiwi
            except ImportError:
                _kiwi_missing = True
                return None
            _kiwi = Kiwi()
        return _kiwi


def has_morph() -> bool:
    """형태소 분석기(kiwipiepy)를 쓰는지."""
    return _get_kiwi() is not None


def _strip(word: str) -> str:
    if not ('가' <= word[0] <= '힣'):
        return word
    for suf in _SUFFIXES:
        if len(word) > len(suf) + 1 and word.endswith(suf):
            return word[:-len(suf)]
    return word


def simple_tokens(text: str) -> list[str]:
    return [_strip(w).lower() for w in _WORD.findall(text or '')]


def tokens(text: str) -> list[str]:
    kiwi = _get_kiwi()
    if kiwi is None:
        return simple_tokens(text)
    with _lock:
        toks = kiwi.tokenize(text)
    return [t.form.lower() for t in toks if t.tag.startswith(_KEEP_TAGS)]


def fts_query(text: str) -> str:
    """FTS5 MATCH 식. 토큰을 OR로 묶는다 (순위는 BM25가 정한다)."""
    uniq = dict.fromkeys(t.replace('"', '') for t in tokens(text))
    return ' OR '.join(f'"{t}"' for t in uniq if t)
