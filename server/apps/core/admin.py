from django.contrib import admin

from .models import ApiToken, AuthEvent, LoginLock, MemberRole


@admin.register(LoginLock)
class LoginLockAdmin(admin.ModelAdmin):
    list_display = ['key', 'failures', 'window_start', 'locked_until', 'updated_at']
    search_fields = ['key']


@admin.register(AuthEvent)
class AuthEventAdmin(admin.ModelAdmin):
    list_display = ['created_at', 'username', 'ip', 'result', 'source']
    list_filter = ['result', 'source']
    search_fields = ['username', 'ip']
    readonly_fields = [f.name for f in AuthEvent._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(ApiToken)
class ApiTokenAdmin(admin.ModelAdmin):
    list_display = ['user', 'label', 'prefix', 'created_at', 'expires_at', 'last_used_at']
    readonly_fields = ['key_hash', 'prefix', 'created_at', 'last_used_at']
    search_fields = ['user__username', 'label']


@admin.register(MemberRole)
class MemberRoleAdmin(admin.ModelAdmin):
    list_display = ['user', 'role', 'updated_at']
    search_fields = ['user__username', 'role']
