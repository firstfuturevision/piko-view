from pathlib import Path

from django.apps import AppConfig, apps


class SchedulesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.schedules'
    label = 'schedules'
    verbose_name = '일정'

    def ready(self):
        if apps.is_installed('apps.view'):
            from . import cards
            cards.register()
        if apps.is_installed('apps.agent'):
            from apps.agent.modules import app_module, register

            from .models import Schedule
            register(app_module('schedules', '일정 관리', '공유 달력 일정·카테고리', 'apps.schedules.agent_tools',
                                Path(__file__).parent / 'guide.md',
                                lambda: [{'label': '일정', 'value': Schedule.objects.count()}]))
