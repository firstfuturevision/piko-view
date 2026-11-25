from django.urls import path

from . import views

urlpatterns = [
    path('template', views.template_view),
    path('template/', views.template_view),
    path('home', views.home_view),
    path('home/', views.home_view),
]
