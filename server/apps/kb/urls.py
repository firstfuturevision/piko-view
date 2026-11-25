from django.urls import path

from apps.agent import views as agent

from . import views

KB = {'module': 'kb'}

urlpatterns = [
    path('status/', views.kb_status),
    path('embed/retry/', views.kb_embed_retry),
    path('tree/', views.kb_tree),
    path('recent/', views.kb_recent),
    path('catalog/', views.kb_catalog),
    path('documents/<str:doc_id>/', views.kb_document),
    path('documents/<str:doc_id>/content/', views.kb_document_content),
    path('documents/<str:doc_id>/raw/', views.kb_document_raw),
    path('documents/<str:doc_id>/move/', views.kb_move),
    path('documents/<str:doc_id>/tags/', views.kb_tags),
    path('documents/<str:doc_id>/related/', views.kb_related),
    path('documents/<str:doc_id>/graph/', views.kb_local_graph),
    path('notes/', views.kb_create_note),
    path('similar/', views.kb_similar_draft),
    path('graph/', views.kb_graph),
    path('search/', views.kb_search),
    path('upload/', views.kb_upload),
    path('ingest/', views.kb_ingest),
    path('attachments/', views.kb_upload_attachments),
    path('files/<str:h>/<str:name>', views.kb_attachment),
    path('wiki/', views.kb_wiki),
    path('wiki/<str:doc_id>/review/', views.kb_wiki_review),
    path('glossary/', views.kb_glossary),
    # 외부 에이전트 (다른 모듈과 같은 처리, 기존 주소 유지)
    path('token/', agent.token),
    path('guide/', agent.guide, KB),
    path('tools/', agent.ToolListView.as_view(), KB),
    path('tools/<str:name>/', agent.tool_call, KB),
    path('mcp', agent.MCPView.as_view(), KB),
    path('mcp/', agent.MCPView.as_view(), KB),
]
