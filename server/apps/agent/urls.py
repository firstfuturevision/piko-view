from django.urls import path

from . import views

urlpatterns = [
    path('modules/', views.module_list),
    path('token/', views.token),
    path('<str:module>/guide/', views.guide),
    path('<str:module>/tools/', views.ToolListView.as_view()),
    path('<str:module>/tools/<str:name>/', views.tool_call),
    path('<str:module>/mcp', views.MCPView.as_view()),
    path('<str:module>/mcp/', views.MCPView.as_view()),
]
