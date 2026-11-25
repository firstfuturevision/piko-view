from django.contrib import admin

from .models import Problem, ProcessEdge, ProcessGroup, ProcessNode


@admin.register(Problem)
class ProblemAdmin(admin.ModelAdmin):
    list_display = ['definition', 'status', 'assignee', 'time_budget', 'owner']
    list_filter = ['status', 'assignee', 'owner', 'process']
    search_fields = ['definition', 'impact', 'resolve_condition']


@admin.register(ProcessNode)
class ProcessNodeAdmin(admin.ModelAdmin):
    list_display = ['title', 'parent', 'order', 'color', 'group', 'is_support']
    list_filter = ['parent', 'is_support', 'group']
    search_fields = ['title', 'description']


@admin.register(ProcessEdge)
class ProcessEdgeAdmin(admin.ModelAdmin):
    list_display = ['source', 'target', 'kind', 'label', 'bidirectional']
    list_filter = ['kind', 'bidirectional']
    search_fields = ['label', 'source__title', 'target__title']


@admin.register(ProcessGroup)
class ProcessGroupAdmin(admin.ModelAdmin):
    list_display = ['title', 'color', 'created_by', 'created_at']
    search_fields = ['title']
