from django.apps import AppConfig, apps


class KbConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.kb'
    label = 'kb'
    verbose_name = '지식 베이스'

    def ready(self):
        if apps.is_installed('apps.agent'):
            from apps.agent.modules import Module, register
            register(Module('kb', '지식 베이스', '문서 검색·정리·위키 제안', 'knowledge-base', '/kb',
                            _tools, _read_only, _guide, _stats))


def _tools(user):
    from .services.runtime import registry_for
    return registry_for(user.username).tools()


def _read_only():
    from .services.agent_tools import READ_ONLY_TOOLS
    return set(READ_ONLY_TOOLS)


def _guide():
    from .services.agent_tools import GUIDE_PATH
    return GUIDE_PATH.read_text(encoding='utf-8')


def _stats():
    from .models import KBDocument
    return [{'label': '문서', 'value': KBDocument.objects.filter(status='active').count()}]
