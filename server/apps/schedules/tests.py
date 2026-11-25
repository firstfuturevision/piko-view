from datetime import datetime

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Category, Schedule


def at(s: str):
    return timezone.make_aware(datetime.fromisoformat(s))


class ScheduleListTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('u', password='pw')
        self.client.force_authenticate(self.user)
        self.cat = Category.objects.create(owner=self.user, name='회의', color='blue')

    def add(self, title, start, end=None):
        return Schedule.objects.create(owner=self.user, title=title, start_at=at(start),
                                       end_at=at(end) if end else None, category=self.cat)

    def test_list_query_count_does_not_grow(self):
        self.add('a', '2026-11-01T10:00')
        with self.assertNumQueries(1):
            self.client.get('/api/schedules/')
        for i in range(5):
            other = User.objects.create_user(f'o{i}')
            Schedule.objects.create(owner=other, title=f'b{i}', start_at=at('2026-11-02T10:00'),
                                    category=Category.objects.create(owner=other, name=f'c{i}', color='red'))
        with self.assertNumQueries(1):
            r = self.client.get('/api/schedules/')
        self.assertEqual(len(r.json()), 6)
        self.assertEqual(r.json()[0]['category_name'], '회의')

    def test_without_range_returns_all(self):
        self.add('옛날', '2020-01-01T10:00')
        self.add('나중', '2030-01-01T10:00')
        self.assertEqual(len(self.client.get('/api/schedules/').json()), 2)

    def test_range_filter_overlaps(self):
        self.add('전', '2026-10-30T10:00')
        self.add('걸침', '2026-10-31T10:00', '2026-11-02T09:00')  # 여러 날 일정은 겹치면 포함
        self.add('안', '2026-11-03T23:00')
        self.add('끝날', '2026-11-05T12:00')
        self.add('후', '2026-11-06T00:00')
        r = self.client.get('/api/schedules/', {'start': '2026-11-01', 'end': '2026-11-05'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual([s['title'] for s in r.json()], ['걸침', '안', '끝날'])
        r = self.client.get('/api/schedules/', {'start': '2026-11-05'})
        self.assertEqual([s['title'] for s in r.json()], ['끝날', '후'])
        r = self.client.get('/api/schedules/', {'end': '2026-10-31T00:00:00'})
        self.assertEqual([s['title'] for s in r.json()], ['전'])

    def test_bad_range_is_400(self):
        self.assertEqual(self.client.get('/api/schedules/', {'start': '어제'}).status_code, 400)


class RepeatTests(APITestCase):
    """반복 일정: 원본 하나만 저장하고, 날짜 범위로 고르는 곳(목록 ?start=&end=·홈 카드·에이전트 도구)에서 발생분을 펼친다."""

    def setUp(self):
        self.user = User.objects.create_user('u', password='pw')
        self.client.force_authenticate(self.user)

    def add(self, title, start, end=None, **kw):
        return Schedule.objects.create(owner=self.user, title=title, start_at=at(start),
                                       end_at=at(end) if end else None, **kw)

    def starts(self, s, lo, hi):
        from .repeat import occurrences
        return [timezone.localtime(a).strftime('%m-%d %H:%M') for a, _ in occurrences(s, at(lo), at(hi))]

    def test_weekly(self):
        s = self.add('주간', '2026-11-02T10:00', repeat='weekly')  # 월요일
        self.assertEqual(self.starts(s, '2026-11-01T00:00', '2026-12-01T00:00'),
                         ['11-02 10:00', '11-09 10:00', '11-16 10:00', '11-23 10:00', '11-30 10:00'])
        self.assertEqual(self.starts(s, '2026-10-01T00:00', '2026-11-01T00:00'), [])  # 시작 전은 없다
        s.repeat_until = datetime(2026, 11, 16).date()
        self.assertEqual(self.starts(s, '2026-11-01T00:00', '2026-12-01T00:00'),
                         ['11-02 10:00', '11-09 10:00', '11-16 10:00'])

    def test_monthly_skips_missing_day(self):
        s = self.add('말일', '2026-01-31T09:00', repeat='monthly')
        self.assertEqual(self.starts(s, '2026-01-01T00:00', '2026-08-01T00:00'),
                         ['01-31 09:00', '03-31 09:00', '05-31 09:00', '07-31 09:00'])

    def test_multi_day_keeps_length_and_overlaps(self):
        from .repeat import occurrences
        s = self.add('워크숍', '2026-11-06T09:00', '2026-11-08T18:00', repeat='weekly')  # 금~일
        rows = occurrences(s, at('2026-11-15T00:00'), at('2026-11-16T00:00'))  # 일요일 하루
        self.assertEqual([(timezone.localtime(a).day, timezone.localtime(b).day) for a, b in rows], [(13, 15)])

    def test_api_fields_and_validation(self):
        r = self.client.post('/api/schedules/', {'title': '회의', 'start_at': '2026-11-02T10:00:00+09:00',
                                                 'repeat': 'weekly', 'repeat_until': '2026-12-31'})
        self.assertEqual(r.status_code, 201)
        self.assertEqual((r.json()['repeat'], r.json()['repeat_until']), ('weekly', '2026-12-31'))
        r = self.client.post('/api/schedules/', {'title': 'x', 'start_at': '2026-11-02T10:00:00+09:00',
                                                 'repeat': 'daily'})
        self.assertEqual(r.status_code, 400)
        r = self.client.post('/api/schedules/', {'title': 'x', 'start_at': '2026-11-02T10:00:00+09:00',
                                                 'repeat': 'weekly', 'repeat_until': '2026-11-01'})
        self.assertEqual(r.status_code, 400)
        # 목록 범위 필터: 원본이 범위 앞에 있어도 발생분이 있으면 원본이 하나 들어온다
        r = self.client.get('/api/schedules/', {'start': '2026-12-01', 'end': '2026-12-10'})
        self.assertEqual([s['title'] for s in r.json()], ['회의'])
        r = self.client.get('/api/schedules/', {'start': '2027-02-01', 'end': '2027-02-10'})
        self.assertEqual(r.json(), [])
