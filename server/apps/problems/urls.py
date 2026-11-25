from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
# problems/<pk>/ 보다 먼저 맞춰 봐야 'process-nodes'·'process-edges'·'process-groups' 가 문제 id 로 잡히지 않는다
router.register('problems/process-nodes', views.ProcessNodeViewSet, basename='process-node')
router.register('problems/process-edges', views.ProcessEdgeViewSet, basename='process-edge')
router.register('problems/process-groups', views.ProcessGroupViewSet, basename='process-group')
router.register('problems', views.ProblemViewSet, basename='problem')

urlpatterns = [
    path('', include(router.urls)),
]
