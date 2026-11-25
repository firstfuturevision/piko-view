from django.urls import path

from . import views

urlpatterns = [
    path('auth/login/', views.login_view),
    path('auth/logout/', views.logout_view),
    path('auth/me/', views.me_view),
    path('auth/csrf/', views.csrf_view),
    path('auth/profile/', views.profile_view),
    path('auth/users/', views.users_view),
]
