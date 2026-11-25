"""View: 템플릿(설치 안 된 묶음 빼기·missing)과 홈 카드(원래 홈 요약과 같은 기준)."""
import json
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

from django.contrib.auth.models import User
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.problems.models import Problem
from apps.schedules.models import Category, Schedule

from . import registry


def at(s: str):
    return timezone.make_aware(datetime.fromisoformat(s))


class TemplateTests(APITestCase):
    def setUp(self):
        tmp = Path(tempfile.mkdtemp())
        self.data, self.repo = tmp / 'data', tmp / 'repo'
        self.data.mkdir()
        self.repo.mkdir()
        self.dirs = override_settings(PIKO_TEMPLATE_DIRS=[self.data, self.repo])
        self.dirs.enable()
        self.addCleanup(self.dirs.disable)
        self.write(self.repo, 'default', {
            'name': 'default', 'brand': 'Piko', 'modules': ['schedules', 'problems', 'kb', 'docs', 'projects', 'crm'],
            'nav': [{'title': '홈', 'items': [{'to': '/', 'label': '현황'}, {'module': 'schedules'}]},
                    {'title': '영업', 'items': [{'module': 'crm', 'page': 'leads'}]}],
            'home': {'stats': ['problems.attention', 'projects.active'], 'panels': ['schedules.today', 'crm.followups']},
        })

    def write(self, where, name, data):
        (where / f'{name}.json').write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')

    def test_filters_missing_modules(self):
        r = self.client.get('/api/view/template')   # 로그인 없이도 된다
        self.assertEqual(r.status_code, 200)
        t = r.json()
        self.assertEqual(t['modules'], ['schedules', 'problems', 'kb', 'docs'])
        self.assertEqual(t['missing'], ['projects', 'crm'])
        self.assertEqual([g['title'] for g in t['nav']], ['홈'])   # 비어 버린 묶음은 빠진다
        self.assertEqual(t['home'], {'stats': ['problems.attention'], 'panels': ['schedules.today']})
        self.assertEqual(t['missing_cards'], ['projects.active', 'crm.followups'])
        self.assertEqual(t['brand'], 'Piko')

    def test_data_dir_first_then_repo(self):
        self.write(self.data, 'default', {'name': 'default', 'title': '내 것', 'modules': ['schedules']})
        self.assertEqual(self.client.get('/api/view/template/').json()['title'], '내 것')

    def test_named_template_and_errors(self):
        self.write(self.repo, 'agency', {'name': 'agency', 'modules': ['kb', 'comms']})
        with override_settings(PIKO_TEMPLATE='agency'):
            t = self.client.get('/api/view/template').json()
            self.assertEqual((t['modules'], t['missing']), (['kb'], ['comms']))
        with override_settings(PIKO_TEMPLATE='nope'):
            self.assertEqual(self.client.get('/api/view/template').status_code, 404)
        with override_settings(PIKO_TEMPLATE='../etc/passwd'):
            self.assertEqual(self.client.get('/api/view/template').status_code, 404)

    @override_settings(PIKO_SITE_NAME='우리 팀', PIKO_SITE_NAME_SET=True)
    def test_site_name_overrides_brand(self):
        self.assertEqual(self.client.get('/api/view/template').json()['brand'], '우리 팀')

    def test_base_apps_are_not_modules(self):
        self.write(self.repo, 'default', {'modules': ['core', 'agent', 'view', 'kb']})
        t = self.client.get('/api/view/template').json()
        self.assertEqual((t['modules'], t['missing']), (['kb'], ['core', 'agent', 'view']))


class HomeCardTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('u', password='pw', first_name='김')
        self.client.force_authenticate(self.user)

    def home(self, d):
        r = self.client.get('/api/view/home', {'date': d})
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()['cards']

    def test_login_required(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/view/home').status_code, 403)

    def test_cards_match_source_rules(self):
        today = date(2026, 11, 4)
        cat = Category.objects.create(owner=self.user, name='회의', color='blue')
        Problem.objects.create(owner=self.user, definition='기한 지남', due_date=today - timedelta(days=1),
                               assignee=self.user)
        Problem.objects.create(owner=self.user, definition='오너 없음')
        Problem.objects.create(owner=self.user, definition='괜찮음', assignee=self.user)
        Problem.objects.create(owner=self.user, definition='해결됨', status='solved')
        stale = Problem.objects.create(owner=self.user, definition='오래됨', assignee=self.user)
        Problem.objects.filter(pk=stale.pk).update(updated_at=timezone.now() - timedelta(days=3))
        Schedule.objects.create(owner=self.user, title='종일', start_at=at('2026-11-04T00:00'), is_all_day=True,
                                category=cat)
        Schedule.objects.create(owner=self.user, title='걸침', start_at=at('2026-11-03T09:00'),
                                end_at=at('2026-11-04T09:00'))
        Schedule.objects.create(owner=self.user, title='어제', start_at=at('2026-11-03T09:00'))
        for d in range(5, 12):
            Schedule.objects.create(owner=self.user, title=f'{d}일', start_at=at(f'2026-11-{d:02d}T10:00'),
                                    is_done=d == 5)

        cards = self.home('2026-11-04')
        self.assertTrue({'schedules.today', 'schedules.upcoming', 'problems.attention'} <= set(cards))
        att = cards['problems.attention']
        self.assertEqual((att['label'], att['value']), ('살펴볼 문제', 3))
        tags = {i['title']: i['tag'] for i in att['items']}
        self.assertEqual(tags, {'기한 지남': '기한 지남', '오너 없음': '오너 없음', '오래됨': '막힘'})
        sub = {i['title']: i['sub'] for i in att['items']}
        self.assertEqual(sub['기한 지남'], '기한 1일 지남 · 김')
        t = cards['schedules.today']
        self.assertEqual(t['value'], 2)
        self.assertEqual([i['title'] for i in t['items']], ['종일', '걸침'])
        self.assertEqual((t['items'][0]['sub'], t['items'][0]['tag']), ('종일', '회의'))
        self.assertEqual(set(t['items'][0]), {'title', 'sub', 'tag', 'url'})
        up = cards['schedules.upcoming']
        self.assertEqual([i['title'] for i in up['items']], ['6일', '7일', '8일', '9일', '10일'])
        self.assertEqual(up['items'][0]['sub'], '11/6 10:00')

    def test_repeats_expanded(self):
        add = lambda title, start, **kw: Schedule.objects.create(owner=self.user, title=title,  # noqa: E731
                                                                  start_at=at(start), **kw)
        add('주간', '2026-10-05T10:00', repeat='weekly')  # 월요일마다
        add('끝남', '2026-10-05T11:00', repeat='weekly', repeat_until=date(2026, 10, 20))
        add('완료', '2026-10-06T10:00', repeat='weekly', is_done=True)
        add('하루', '2026-11-20T10:00')
        cards = self.home('2026-11-16')  # 월요일
        self.assertEqual([(i['title'], i['sub']) for i in cards['schedules.today']['items']], [('주간', '10:00')])
        self.assertEqual(cards['schedules.today']['value'], 1)
        # 다가오는 일정: 반복은 가장 가까운 발생분 하나만, 완료한 반복은 빠진다
        self.assertEqual([(i['title'], i['sub']) for i in cards['schedules.upcoming']['items']],
                         [('하루', '11/20 10:00'), ('주간', '11/23 10:00')])

    def test_broken_card_does_not_break_home_and_filter(self):
        def boom(ctx):
            raise RuntimeError('x')
        registry.register_card('test.boom', '깨짐', boom)
        self.addCleanup(registry.unregister_card, 'test.boom')
        cards = self.home('2026-11-04')
        self.assertNotIn('test.boom', cards)
        self.assertIn('schedules.today', cards)
        only = self.client.get('/api/view/home', {'cards': 'problems.attention'}).json()['cards']
        self.assertEqual(list(only), ['problems.attention'])
