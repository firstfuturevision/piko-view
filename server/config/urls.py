"""Piko View server URL. 기능 묶음(앱)마다 api/ 아래에 붙는다."""
from django.contrib import admin
from django.urls import include, path

from apps.core.lockout import protect_admin_login

# 관리자 로그인도 화면 로그인과 같이 아이디·IP 별 실패 잠금 (apps.core.lockout)
admin.site.login = protect_admin_login(admin.site.login)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('apps.core.urls')),
    path('api/view/', include('apps.view.urls')),
    path('api/', include('apps.schedules.urls')),
    path('api/', include('apps.problems.urls')),
    path('api/', include('apps.docs.urls')),
    path('api/kb/', include('apps.kb.urls')),
    path('api/agent/', include('apps.agent.urls')),
]

# 업로드 파일(MEDIA)은 직접 서빙하지 않는다. 인증을 거치는 API(/api/doc-assets/<id>/file/ 등)로만 준다.
