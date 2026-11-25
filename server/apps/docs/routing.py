from django.urls import re_path

from .collab import CollabConsumer

# y-websocket 은 `${serverUrl}/${room}` 으로 붙는다 (끝 / 없음). 둘 다 받는다.
websocket_urlpatterns = [
    re_path(r'^ws/collab/(?P<kind>doc)/(?P<pk>\d+)/?$', CollabConsumer.as_asgi()),
]
