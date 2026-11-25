from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.core'
    label = 'core'
    verbose_name = '계정·보안'

    def ready(self):
        # 모든 DRF 비율 제한(throttle)이 같은 '요청한 사람 IP'를 쓰게 한다 (위조된 X-Forwarded-For 로 피하지 못하게).
        from rest_framework.throttling import BaseThrottle

        from .ip import throttle_ident
        BaseThrottle.get_ident = throttle_ident
