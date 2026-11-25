"""ASGI 진입점. `manage.py runserver` 가 Daphne 로 이 application 을 띄운다.

- http      → Django (REST API·어드민)
- websocket → 문서 실시간 공동 편집 (/ws/collab/doc/<id>, apps.docs.collab)
"""
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

# Django 를 먼저 준비한 뒤에 모델을 쓰는 라우팅을 불러온다.
django_asgi_app = get_asgi_application()

from channels.auth import AuthMiddlewareStack  # noqa: E402
from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402

from apps.docs.routing import websocket_urlpatterns as collab_urls  # noqa: E402

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    # 다른 사이트에서 세션 쿠키로 붙는 것을 막는다 (Origin 이 ALLOWED_HOSTS 안이어야 한다).
    'websocket': AllowedHostsOriginValidator(AuthMiddlewareStack(URLRouter(collab_urls))),
})
