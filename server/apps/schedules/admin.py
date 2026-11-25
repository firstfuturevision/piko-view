from django.contrib import admin

from .models import Category, Schedule


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ['name', 'color', 'owner']
    list_filter = ['owner']
    search_fields = ['name']


@admin.register(Schedule)
class ScheduleAdmin(admin.ModelAdmin):
    list_display = [
        'title', 'owner', 'category', 'start_at', 'end_at',
        'is_all_day', 'is_done',
    ]
    list_filter = ['is_done', 'category', 'owner']
    search_fields = ['title', 'description']
