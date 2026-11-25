from django.apps import AppConfig


class ViewConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.view'
    label = 'view'
    verbose_name = 'View (템플릿·홈 카드)'
