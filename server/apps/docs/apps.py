from django.apps import AppConfig


class DocsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.docs'
    label = 'docs'
    verbose_name = '문서·공동 편집'

    def ready(self):
        from . import signals  # noqa: F401
