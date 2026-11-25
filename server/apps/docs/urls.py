from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register('docs', views.DocViewSet, basename='doc')
router.register('doc-assets', views.DocAssetViewSet, basename='doc-asset')
router.register('comments', views.CommentViewSet, basename='comment')
router.register('templates', views.TemplateViewSet, basename='template')

urlpatterns = [
    path('', include(router.urls)),
]
