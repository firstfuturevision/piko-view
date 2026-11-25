from pathlib import Path

from django.apps import AppConfig, apps


class ProblemsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.problems'
    label = 'problems'
    verbose_name = '문제 해결'

    def ready(self):
        if apps.is_installed('apps.view'):
            from . import cards
            cards.register()
        if apps.is_installed('apps.agent'):
            from apps.agent.modules import app_module, register

            from .models import Problem
            register(app_module('problems', '문제 해결', '당면한 문제와 해결 과정', 'apps.problems.agent_tools',
                                Path(__file__).parent / 'guide.md',
                                lambda: [{'label': '문제', 'value': Problem.objects.count()}]))
