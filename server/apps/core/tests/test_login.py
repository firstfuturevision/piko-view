"""로그인: 실패 잠금(아이디·IP, DB 에 남음)·일반 오류 글·기록, me 의 CSRF 토큰."""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import AuthEvent, LoginLock

User = get_user_model()
URL = '/api/auth/login/'


class LoginLockoutTests(TestCase):
    def setUp(self):
        self.u = User.objects.create_user('kim', password='right-pass-123')
        self.c = APIClient()

    def login(self, username='kim', password='wrong', ip='203.0.113.10'):
        return self.c.post(URL, {'username': username, 'password': password}, format='json',
                           HTTP_CF_CONNECTING_IP=ip)

    def test_generic_message_for_unknown_user_and_bad_password(self):
        a = self.login('nobody')
        b = self.login('kim')
        self.assertEqual((a.status_code, b.status_code), (400, 400))
        self.assertEqual(a.data['detail'], b.data['detail'])
        self.assertEqual(AuthEvent.objects.filter(result='fail', source='app').count(), 2)
        self.assertEqual(AuthEvent.objects.first().ip, '203.0.113.10')

    def test_five_failures_lock_username_even_with_right_password(self):
        for i in range(5):
            self.assertEqual(self.login(ip=f'203.0.113.{i}').status_code, 400)
        res = self.login(password='right-pass-123', ip='198.51.100.1')   # 다른 IP·맞는 비밀번호여도
        self.assertEqual(res.status_code, 429)
        self.assertIn('Retry-After', res)
        self.assertTrue(AuthEvent.objects.filter(result='locked').exists())
        # 잠금은 DB 에 있다 (재시작해도 남는다). 시간이 지나면 풀린다
        LoginLock.objects.filter(key='u:kim').update(locked_until=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.login(password='right-pass-123').status_code, 200)
        self.assertFalse(LoginLock.objects.filter(key='u:kim').exists())   # 성공하면 아이디 실패 수를 지운다

    def test_username_case_insensitive_key(self):
        for _ in range(5):
            self.login('KIM')
        self.assertEqual(self.login('kim', 'right-pass-123', ip='198.51.100.2').status_code, 429)

    def test_ip_lock_across_usernames(self):
        for i in range(20):
            self.login(f'user{i}', ip='203.0.113.99')
        User.objects.create_user('lee', password='lee-pass-123')
        self.assertEqual(self.login('lee', 'lee-pass-123', ip='203.0.113.99').status_code, 429)
        self.assertEqual(self.login('lee', 'lee-pass-123', ip='203.0.113.98').status_code, 200)

    def test_spoofed_xff_does_not_escape_ip_lock(self):
        for i in range(20):
            self.c.post(URL, {'username': f'x{i}', 'password': 'p'}, format='json',
                        HTTP_X_FORWARDED_FOR=f'{i}.{i}.{i}.{i}, 203.0.113.50')
        res = self.c.post(URL, {'username': 'kim', 'password': 'right-pass-123'}, format='json',
                          HTTP_X_FORWARDED_FOR='9.9.9.9, 203.0.113.50')
        self.assertEqual(res.status_code, 429)

    def test_window_resets_old_failures(self):
        for _ in range(4):
            self.login()
        LoginLock.objects.filter(key='u:kim').update(window_start=timezone.now() - timedelta(minutes=16))
        self.login()   # 15분이 지난 뒤의 실패는 1부터 다시 센다
        self.assertEqual(LoginLock.objects.get(key='u:kim').failures, 1)
        self.assertEqual(self.login(password='right-pass-123').status_code, 200)


class AdminLoginLockoutTests(TestCase):
    def setUp(self):
        User.objects.create_superuser('boss', 'b@example.com', 'boss-pass-123')

    def post(self, password, ip='203.0.113.20'):
        return self.client.post('/admin/login/', {'username': 'boss', 'password': password, 'next': '/admin/'},
                                HTTP_CF_CONNECTING_IP=ip)

    def test_admin_login_lockout_and_audit(self):
        for _ in range(5):
            self.assertEqual(self.post('nope').status_code, 200)   # 폼 다시 보여 줌
        self.assertEqual(AuthEvent.objects.filter(source='admin', result='fail').count(), 5)
        res = self.post('boss-pass-123', ip='198.51.100.3')
        self.assertEqual(res.status_code, 429)
        self.assertNotIn('_auth_user_id', self.client.session)

    def test_admin_login_success(self):
        res = self.post('boss-pass-123')
        self.assertEqual(res.status_code, 302)
        self.assertTrue(AuthEvent.objects.filter(source='admin', result='ok', username='boss').exists())


class MeCsrfTests(TestCase):
    def test_anonymous_gets_cookie_not_token(self):
        res = self.client.get('/api/auth/me/')
        self.assertEqual(res.json(), {'username': None, 'is_staff': False})
        self.assertIn('csrftoken', res.cookies)

    def test_logged_in_gets_token(self):
        User.objects.create_user('kim', password='right-pass-123')
        res = self.client.post(URL, {'username': 'kim', 'password': 'right-pass-123'}, content_type='application/json')
        self.assertTrue(res.json()['csrftoken'])
        me = self.client.get('/api/auth/me/').json()
        self.assertEqual(me['username'], 'kim')
        self.assertTrue(me['csrftoken'])
        out = self.client.post('/api/auth/logout/', HTTP_X_CSRFTOKEN=me['csrftoken'])
        self.assertNotIn('csrftoken', out.json())

    def test_csrf_endpoint_sets_cookie(self):
        res = self.client.get('/api/auth/csrf/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('csrftoken', res.cookies)


class MemberRoleTests(TestCase):
    """내 정보 역할: 본인이 쓰고, 관리자는 남의 것도 고치고, 사용자 목록·에이전트 user_list 에 실린다."""

    def setUp(self):
        self.me = User.objects.create_user('roleme', password='pw-123456789')
        self.other = User.objects.create_user('roleother', password='pw-123456789', first_name='다른이')
        self.boss = User.objects.create_user('roleboss', password='pw-123456789', is_staff=True)
        self.c = APIClient()

    def test_own_role_and_list(self):
        self.c.force_authenticate(self.me)
        r = self.c.patch('/api/auth/profile/', {'role': ' 3D 모델링 담당\n영업은 안 함 '}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['role'], '3D 모델링 담당\n영업은 안 함')
        users = {u['username']: u for u in self.c.get('/api/auth/users/').data}
        self.assertEqual(users['roleme']['role'], '3D 모델링 담당\n영업은 안 함')
        self.assertEqual(users['roleother']['role'], '')

    def test_nickname(self):
        self.c.force_authenticate(self.me)
        r = self.c.patch('/api/auth/profile/', {'nickname': ' 나 '}, format='json')
        self.assertEqual((r.data['nickname'], r.data['username']), ('나', 'roleme'))

    def test_only_staff_edits_others(self):
        self.c.force_authenticate(self.me)
        r = self.c.patch('/api/auth/users/', {'id': self.other.id, 'role': '지어낸 역할'}, format='json')
        self.assertEqual(r.status_code, 403)
        self.c.force_authenticate(self.boss)
        r = self.c.patch('/api/auth/users/', {'id': self.other.id, 'role': '디자인'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['role'], '디자인')

    def test_agent_user_list_has_role(self):
        from apps.agent.common import user_list
        from apps.core.models import set_role
        set_role(self.other, '기획', self.other)
        rows = {u['username']: u for u in user_list.fn() if u['username'].startswith('role')}
        self.assertEqual(rows['roleother']['role'], '기획')
        self.assertIsNone(rows['roleme']['role'])

    def test_login_required(self):
        self.assertEqual(self.c.get('/api/auth/users/').status_code, 403)
