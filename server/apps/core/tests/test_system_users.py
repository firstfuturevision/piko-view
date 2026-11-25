"""시스템 계정: 사람 고르기 목록에서는 빠지고, 계정과 토큰은 그대로 동작한다."""
from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.core.tokens import issue


@override_settings(SYSTEM_USERNAMES=['bot'], SYSTEM_USER_PREFIX='svc-')
class SystemUserTests(APITestCase):
    def setUp(self):
        U = get_user_model()
        self.me = U.objects.create_user('kim', password='x-test-pw', first_name='김')
        self.bot = U.objects.create_user('bot', password='x-test-pw', first_name='Bot')
        U.objects.create_user('svc-sync', password='x-test-pw')
        self.client.force_authenticate(self.me)

    def names(self, rows):
        return {r['username'] for r in rows}

    def test_hidden_from_people_pickers(self):
        names = self.names(self.client.get('/api/auth/users/').data)
        self.assertEqual(names, {'kim'})

    def test_account_and_token_still_work(self):
        key, _ = issue(self.bot)
        self.client.force_authenticate(None)
        r = self.client.get('/api/agent/all/tools/', HTTP_AUTHORIZATION=f'Token {key}')
        self.assertEqual(r.status_code, 200)
        self.bot.refresh_from_db()
        self.assertTrue(self.bot.is_active)

    @override_settings(SYSTEM_USERNAMES=[], SYSTEM_USER_PREFIX='')
    def test_no_system_users_by_default(self):
        self.assertEqual(self.names(self.client.get('/api/auth/users/').data), {'kim', 'bot', 'svc-sync'})
