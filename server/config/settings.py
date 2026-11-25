"""Piko View server 설정.

이름·주소 같은 회사 값은 모두 환경변수로 받는다 (기본값은 중립). README 의 '환경변수' 참고.
"""

import os
import secrets
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent          # server/
REPO_DIR = BASE_DIR.parent                                 # 저장소 루트 (templates/, data/)


def env_list(name: str, default: str) -> list[str]:
    """콤마로 구분된 환경변수를 리스트로."""
    return [v.strip() for v in os.environ.get(name, default).split(',') if v.strip()]


def env_flag(name: str, default: str = '0') -> bool:
    return os.environ.get(name, default).strip().lower() in ('1', 'true', 'yes', 'on')


TESTING = len(sys.argv) > 1 and sys.argv[1] == 'test'

PIKO_SITE_NAME = os.environ.get('PIKO_SITE_NAME', '').strip() or 'Piko'
# 환경변수로 이름을 정했으면 템플릿의 brand 보다 먼저 쓴다
PIKO_SITE_NAME_SET = bool(os.environ.get('PIKO_SITE_NAME', '').strip())
# 데이터 폴더: DB·비밀 키·지식 베이스·업로드 파일 (git 에 올리지 않는다)
PIKO_DATA_DIR = Path(os.environ.get('PIKO_DATA_DIR') or (REPO_DIR / 'data'))
# View 템플릿: data/templates/<이름>.json 먼저, 없으면 templates/<이름>.json
PIKO_TEMPLATE = os.environ.get('PIKO_TEMPLATE', '').strip() or 'default'
PIKO_TEMPLATE_DIRS = [PIKO_DATA_DIR / 'templates', REPO_DIR / 'templates']

DEBUG = env_flag('PIKO_DEBUG')
# https 로만 들어오는 운영(리버스 프록시 뒤)이면 1: 보안 쿠키·HSTS·X-Forwarded-Proto
PIKO_HTTPS = env_flag('PIKO_HTTPS')


def _secret_key() -> str:
    """PIKO_SECRET_KEY 가 없으면 data/secret_key 를 읽고, 그것도 없으면 만들어 저장한다."""
    key = os.environ.get('PIKO_SECRET_KEY', '').strip()
    if key:
        return key
    if TESTING:
        return 'test-only-' + 'x' * 50
    path = PIKO_DATA_DIR / 'secret_key'
    try:
        key = path.read_text(encoding='utf-8').strip()
    except FileNotFoundError:
        key = ''
    if not key:
        path.parent.mkdir(parents=True, exist_ok=True)
        key = secrets.token_urlsafe(50)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(key + '\n')
    return key


SECRET_KEY = _secret_key()
SECRET_KEY_FALLBACKS = env_list('PIKO_SECRET_KEY_FALLBACKS', '')

ALLOWED_HOSTS = env_list('PIKO_ALLOWED_HOSTS', 'localhost,127.0.0.1,[::1]')
_DEV_ORIGINS = ','.join(f'http://{h}:{p}' for p in (5173, 8100) for h in ('localhost', '127.0.0.1'))
CSRF_TRUSTED_ORIGINS = env_list('PIKO_CSRF_TRUSTED_ORIGINS', _DEV_ORIGINS)

INSTALLED_APPS = [
    # runserver 를 ASGI(Daphne)로 띄운다: 문서 실시간 공동 편집(웹소켓)용. 맨 앞.
    'daphne',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'channels',
    'apps.core',
    'apps.agent',
    'apps.view',
    'apps.schedules',
    'apps.problems',
    'apps.kb',
    'apps.docs',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

# 실시간 공동 편집(apps.docs.collab). 서버 프로세스 하나 기준이라 메모리 채널 레이어로 충분하다.
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels.layers.InMemoryChannelLayer',
        'CONFIG': {'capacity': 1000},
    },
}
# 공동 편집 내용을 DB 에 저장하는 간격(초). 마지막 사람이 나가면 바로 저장한다.
COLLAB_SAVE_DELAY = float(os.environ.get('PIKO_COLLAB_SAVE_DELAY', '3'))

# DB: 기본 <저장소>/data/view.sqlite3
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': Path(os.environ.get('PIKO_DB_PATH') or (PIKO_DATA_DIR / 'view.sqlite3')),
        # 지식 베이스 임베딩이 백그라운드 스레드에서 쓰므로 잠금 대기를 늘리고 WAL 을 쓴다.
        'OPTIONS': {
            'timeout': 20,
            'init_command': 'PRAGMA journal_mode=WAL;',
            'transaction_mode': 'IMMEDIATE',
        },
    }
}
if not TESTING:
    DATABASES['default']['NAME'].parent.mkdir(parents=True, exist_ok=True)

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = os.environ.get('PIKO_LANGUAGE', 'ko-kr')
TIME_ZONE = os.environ.get('PIKO_TIME_ZONE', 'Asia/Seoul')
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
# 업로드 파일(문서 이미지). 주소로 바로 열지 않고 인증을 거치는 API 로만 준다.
MEDIA_URL = '/media/'
MEDIA_ROOT = Path(os.environ.get('PIKO_MEDIA_DIR') or (PIKO_DATA_DIR / 'media'))

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
}

# 지식 베이스 (apps.kb)
#   PIKO_KB_DATA_DIR : 원본 사본(raw)·업로드(inbox)·첨부(files)·임베딩 모델(models)
#   PIKO_KB_PAGES_DIR: 활성 문서의 Markdown 사본 (KB → 파일 한 방향)
KB_DATA_DIR = Path(os.environ.get('PIKO_KB_DATA_DIR') or (PIKO_DATA_DIR / 'kb'))
KB_PAGES_DIR = Path(os.environ.get('PIKO_KB_PAGES_DIR') or (PIKO_DATA_DIR / 'kb_pages'))
KB_SAMPLE_DIR = BASE_DIR / 'apps' / 'kb' / 'sample_docs'


def _default_embed() -> str:
    """fastembed 가 깔려 있으면(uv sync --extra search) 로컬 의미 검색, 아니면 키워드 검색만."""
    try:
        import importlib.util
        if importlib.util.find_spec('fastembed') is not None:
            return 'fastembed:intfloat/multilingual-e5-large'
    except (ImportError, ValueError):
        pass
    return 'none'


# 임베딩: none | fastembed:<모델> | litellm:<모델>. 바꾼 뒤에는 `manage.py kb_reembed`.
KB_EMBED = os.environ.get('PIKO_KB_EMBED') or ('none' if TESTING else _default_embed())
KB_EMBED_THREADS = int(os.environ.get('PIKO_KB_EMBED_THREADS', '0')) or None
KB_EMBED_BATCH = int(os.environ.get('PIKO_KB_EMBED_BATCH', '0')) or None
# 이 시간(분) 동안 임베딩을 안 쓰면 모델을 내려 메모리를 돌려준다. 0 이면 내리지 않는다.
KB_EMBED_IDLE_MIN = float(os.environ.get('PIKO_KB_EMBED_IDLE_MIN', '20') or 0)
# 경로 가져오기(ingest)를 추가로 허용할 서버 폴더 (여러 개는 ; 로 구분)
KB_ALLOWED_ROOTS = [p for p in os.environ.get('PIKO_KB_ALLOWED_ROOTS', '').split(';') if p.strip()]

# 사람이 아닌 시스템 계정 (사람 고르기 목록에서 뺀다 — apps.core.system_users)
SYSTEM_USERNAMES = env_list('PIKO_SYSTEM_USERNAMES', '')
SYSTEM_USER_PREFIX = os.environ.get('PIKO_SYSTEM_USER_PREFIX', '').strip()

if PIKO_HTTPS:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(os.environ.get('PIKO_HSTS_SECONDS') or 31536000)
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = 'same-origin'
SESSION_COOKIE_HTTPONLY = True

DATA_UPLOAD_MAX_MEMORY_SIZE = int(os.environ.get('PIKO_DATA_UPLOAD_MAX', 25 * 1024 * 1024))
FILE_UPLOAD_MAX_MEMORY_SIZE = int(os.environ.get('PIKO_FILE_UPLOAD_MEMORY', 1024 * 1024))
