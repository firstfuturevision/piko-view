from django.contrib import admin

from .models import KBDocument, KBGlossary


@admin.register(KBDocument)
class KBDocumentAdmin(admin.ModelAdmin):
    list_display = ['title', 'doc_type', 'status', 'created_by', 'author', 'parent_id']
    list_filter = ['status', 'doc_type', 'created_by']
    search_fields = ['title', 'text']
    # 본문·트리·색인은 KB 화면과 서비스 계층이 함께 관리한다 (여기서 고치면 검색 색인이 맞지 않게 된다)
    readonly_fields = [f.name for f in KBDocument._meta.fields]

    def has_add_permission(self, request):
        return False


@admin.register(KBGlossary)
class KBGlossaryAdmin(admin.ModelAdmin):
    list_display = ['term', 'synonyms', 'definition']
    search_fields = ['term', 'synonyms']
