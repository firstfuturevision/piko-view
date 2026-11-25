"""임베딩 어댑터. 모델은 설정 문자열로 교체하고, 조각마다 사용한 모델명을 기록한다.

로컬 모델(fastembed)은 처음 쓸 때 수백 MB~수 GB를 내려받으므로 **백그라운드로 불러온다**.
불러오는 동안 encode() 는 EmbedderNotReady 를 던지고, KB 는 키워드 색인만 저장한다.
모델이 준비되면 on_ready 콜백(KB.reembed)으로 빠진 벡터를 채운다.

모델은 **encode() 가 처음 불릴 때** 불러온다 (트리·최근 문서·키워드 검색만 쓰면 올리지 않는다).
idle_minutes 동안 쓰지 않으면 내려서(약 2GB) 메모리를 돌려주고, 다음 encode() 때 다시 불러온다.
"""
import gc
import logging
import os
import threading
import time
from pathlib import Path
from typing import Callable

import numpy as np

log = logging.getLogger(__name__)


class EmbedderNotReady(RuntimeError):
    pass


def materialize_symlinks(cache_dir: str | None) -> int:
    """내려받은 모델 폴더(snapshots)의 바로가기(symlink)를 실제 파일로 바꾼다.

    리눅스에서 Hugging Face 캐시는 snapshots/ 에 blobs/ 를 가리키는 바로가기를 둔다. 새 ONNX Runtime 은
    모델 옆의 큰 가중치 파일(model.onnx_data)이 모델 폴더 밖(blobs/)을 가리키면 거절하므로,
    가리키는 파일을 그 자리로 옮겨 온다 (복사하지 않아 디스크를 두 배로 쓰지 않는다). 바꾼 개수를 돌려준다.
    """
    if not cache_dir or not Path(cache_dir).is_dir():
        return 0
    moved = 0
    for link in Path(cache_dir).rglob('*'):
        if not link.is_symlink() or 'snapshots' not in link.parts:
            continue
        target = link.resolve()
        if not target.is_file():
            continue
        link.unlink()
        os.replace(target, link)
        moved += 1
    return moved


class Embedder:
    name = 'none'
    enabled = False
    state = 'disabled'  # disabled | idle | loading | ready | error

    def encode(self, texts: list[str], kind: str = 'passage') -> np.ndarray:
        """kind: 'passage'(문서 조각) 또는 'query'(검색어). 일부 모델은 둘을 구분해야 성능이 난다."""
        raise NotImplementedError


class NoEmbedder(Embedder):
    def encode(self, texts, kind='passage'):
        return np.zeros((len(texts), 0), dtype=np.float32)


def _normalize(m: np.ndarray) -> np.ndarray:
    m = np.asarray(m, dtype=np.float32)
    norms = np.linalg.norm(m, axis=1, keepdims=True)
    return m / np.where(norms == 0, 1, norms)


class FastEmbedder(Embedder):
    """로컬 ONNX 모델 (외부 전송 없음)."""

    enabled = True

    # 한 번 불러온 적이 있으면(모델 파일이 디스크에 있다) 다시 불러올 때 이만큼 기다렸다가 쓴다
    RELOAD_WAIT = 60

    def __init__(self, model: str, threads: int | None = None, cache_dir: str | None = None,
                 batch_size: int | None = None, idle_minutes: float | None = None):
        self.model_name = model
        self.name = f'fastembed:{model}'
        # 코어를 전부 쓰면 오히려 느려진다 (22코어 PC에서 22스레드 1.5초, 8스레드 0.05초)
        self.threads = threads or min(8, os.cpu_count() or 1)
        # fastembed 기본값(256)이면 긴 문서의 조각을 한 번에 넣어 메모리가 조각 수만큼 커진다.
        # e5-large 900자 조각 64개: 한 번에 4.7GB, 8개씩 2.3GB (속도는 같다)
        self.batch_size = batch_size or 8
        self.cache_dir = cache_dir
        self.on_ready: Callable[[], None] | None = None
        self.error: str | None = None
        self._model = None
        self._loading = False
        self._lock = threading.Lock()
        # 유휴 내리기: 0 이면 내리지 않는다. 쓰는 중(_busy)에는 내리지 않는다.
        self.idle_seconds = max(0.0, float(idle_minutes or 0)) * 60
        self._last_used = 0.0
        self._busy = 0
        self._loaded_once = False
        self._ready = threading.Event()
        self._reaper: threading.Thread | None = None

    @property
    def state(self) -> str:
        if self._model is not None:
            return 'ready'
        if self._loading:
            return 'loading'
        return 'error' if self.error else 'idle'

    def start_loading(self):
        with self._lock:
            if self._model is not None or self._loading:
                return
            self._loading = True
            self.error = None
            self._ready.clear()

        def run():
            try:
                from fastembed import TextEmbedding

                try:
                    model = TextEmbedding(model_name=self.model_name, threads=self.threads,
                                          cache_dir=self.cache_dir)
                except Exception as e:
                    # 모델 파일이 바로가기라 거절당했으면 실제 파일로 바꾼 뒤 한 번 더
                    if 'External data path' not in str(e) or not materialize_symlinks(self.cache_dir):
                        raise
                    log.info('모델 파일 바로가기를 실제 파일로 바꾸고 다시 불러옵니다.')
                    model = TextEmbedding(model_name=self.model_name, threads=self.threads,
                                          cache_dir=self.cache_dir)
                self._set_model(model)
                log.info('임베딩 모델 준비 완료: %s', self.model_name)
            except Exception as e:  # 다운로드 실패 등 — 키워드 검색은 계속 동작한다
                self.error = str(e)
                log.warning('임베딩 모델을 불러오지 못했습니다: %s', e)
            finally:
                self._loading = False
                self._ready.set()  # 기다리는 encode() 를 깨운다 (실패해도)
            if self._model is not None and self.on_ready:
                try:
                    self.on_ready()
                except Exception as e:
                    log.warning('빠진 벡터 채우기 실패: %s', e)

        threading.Thread(target=run, name='kb-embed-loader', daemon=True).start()

    def _set_model(self, model):
        with self._lock:
            self._model = model
            self._loaded_once = True
            self._last_used = time.monotonic()
            start = bool(self.idle_seconds) and not (self._reaper and self._reaper.is_alive())
            if start:
                self._reaper = threading.Thread(target=self._reap, name='kb-embed-idle', daemon=True)
        if start:
            self._reaper.start()

    def _reap(self):
        """유휴 감시. 모델을 내리면 끝난다 (다시 불러오면 새로 띄운다)."""
        interval = max(1.0, min(60.0, self.idle_seconds / 4))
        while self._model is not None:
            time.sleep(interval)
            self.unload_if_idle()

    def unload_if_idle(self, now: float | None = None) -> bool:
        """idle_seconds 넘게 안 썼으면 모델을 내린다. 쓰는 중·불러오는 중이면 그대로 둔다. 내렸으면 True."""
        if not self.idle_seconds:
            return False
        now = time.monotonic() if now is None else now
        with self._lock:
            if (self._model is None or self._busy or self._loading
                    or now - self._last_used < self.idle_seconds):
                return False
            self._model = None
            self._ready.clear()
        gc.collect()
        _trim_heap()
        log.info('임베딩 모델을 %d분 동안 안 써서 내렸습니다: %s', self.idle_seconds // 60, self.model_name)
        return True

    def _acquire(self):
        """쓸 모델을 잡는다 (쓰는 동안 내려가지 않게 _busy 를 올린다). 없으면 불러오기를 시작한다."""
        with self._lock:
            if self._model is not None:
                self._busy += 1
                self._last_used = time.monotonic()
                return self._model
            wait = self._loaded_once
        self.start_loading()
        # 유휴로 내렸다가 다시 부르는 경우: 디스크에서 다시 올리는 몇 초는 기다린다
        if wait and self._ready.wait(self.RELOAD_WAIT):
            with self._lock:
                if self._model is not None:
                    self._busy += 1
                    self._last_used = time.monotonic()
                    return self._model
        raise EmbedderNotReady('임베딩 모델을 불러오는 중입니다.')

    def ensure_ready(self, timeout: float) -> bool:
        """불러오기를 시작하고 준비될 때까지 기다린다 (백그라운드 작업용: 요청 스레드에서는 쓰지 않는다)."""
        if self._model is not None:
            return True
        self.start_loading()
        self._ready.wait(timeout)
        return self._model is not None

    def _release(self):
        with self._lock:
            self._busy -= 1
            self._last_used = time.monotonic()

    def encode(self, texts, kind='passage'):
        model = self._acquire()
        try:
            if 'e5' in self.model_name.lower():  # e5 계열은 'query: ' / 'passage: ' 접두어로 학습됐다
                texts = [f'{kind}: {t}' for t in texts]
            return _normalize(np.array(list(model.embed(texts, batch_size=self.batch_size))))
        finally:
            self._release()


def _trim_heap():
    """내린 모델의 메모리를 운영체제에 돌려준다 (glibc 는 free 만으로는 RSS 가 안 줄 때가 많다)."""
    try:
        import ctypes

        ctypes.CDLL('libc.so.6').malloc_trim(0)
    except Exception:  # noqa: BLE001 — 리눅스(glibc)가 아니면 그냥 둔다
        pass


class LiteLLMEmbedder(Embedder):
    """외부 임베딩 API (예: litellm:voyage/voyage-3, litellm:text-embedding-3-small)."""

    enabled = True
    state = 'ready'

    def __init__(self, model: str):
        self.model_name = model
        self.name = f'litellm:{model}'

    def encode(self, texts, kind='passage'):
        import litellm

        resp = litellm.embedding(model=self.model_name, input=texts)
        return _normalize(np.array([d['embedding'] for d in resp.data]))


def _installed(module: str) -> bool:
    import importlib.util
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


def make_embedder(spec: str, threads: int | None = None, cache_dir: str | None = None,
                  batch_size: int | None = None, idle_minutes: float | None = None) -> Embedder:
    """설정한 패키지가 없으면 경고만 남기고 의미 검색을 끈다 (키워드 검색은 그대로)."""
    kind, _, model = spec.partition(':')
    if kind == 'fastembed' and model:
        if not _installed('fastembed'):
            log.warning('fastembed 가 없어 의미 검색을 끕니다 (uv sync --extra search 로 설치).')
            return NoEmbedder()
        return FastEmbedder(model, threads, cache_dir, batch_size, idle_minutes)
    if kind == 'litellm' and model:
        if not _installed('litellm'):
            log.warning('litellm 이 없어 의미 검색을 끕니다.')
            return NoEmbedder()
        return LiteLLMEmbedder(model)
    if kind != 'none':
        log.warning('알 수 없는 임베딩 설정 %r — 의미 검색을 끕니다.', spec)
    return NoEmbedder()
