"""외부 에이전트 API 테스트: 모듈별·통합 엔드포인트, 토큰, 각 앱 도구의 동작."""
import json
import shutil
import tempfile
from pathlib import Path

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.core import tokens as api_tokens
from apps.kb.services import runtime
from apps.schedules.models import Category, Schedule

from . import modules

TMP = Path(tempfile.mkdtemp())


@override_settings(MEDIA_ROOT=str(TMP / 'media'), KB_EMBED='none',
                   KB_DATA_DIR=TMP / 'kb_data', KB_PAGES_DIR=TMP / 'kb_pages')
class AgentTestBase(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TMP, ignore_errors=True)

    def setUp(self):
        for reset in (modules.clear_cache, runtime.registry_for.cache_clear):
            reset()
            self.addCleanup(reset)
        runtime._kb = None
        self.addCleanup(setattr, runtime, '_kb', None)
        self.user = User.objects.create_user('tester', password='pw-1234-test', first_name='테스터')
        self.c = APIClient()
        self.c.credentials(HTTP_AUTHORIZATION=f'Token {api_tokens.issue(self.user)[0]}')

    def call(self, module, tool, /, **args):
        r = self.c.post(f'/api/agent/{module}/tools/{tool}/', args, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def ok(self, module, tool, /, **args):
        r = self.call(module, tool, **args)
        self.assertTrue(r['ok'], r['result'])
        return r['result']

    def fails(self, module, tool, text, /, **args):
        r = self.call(module, tool, **args)
        self.assertFalse(r['ok'])
        self.assertIn(text, r['result'])


class EndpointTests(AgentTestBase):
    def test_module_list_and_paths(self):
        c = APIClient()
        c.force_authenticate(self.user)
        mods = {m['key']: m for m in c.get('/api/agent/modules/').json()}
        self.assertEqual(list(mods), ['all', 'schedules', 'problems', 'kb'])
        self.assertEqual(mods['kb']['paths']['mcp'], '/kb/mcp')
        self.assertEqual(mods['schedules']['paths']['tools'], '/agent/schedules/tools/')
        parts = sum(m['tool_count'] for k, m in mods.items() if k != 'all')
        # user_list 는 두 모듈(일정·문제)에 있지만 통합에서는 하나로 합쳐진다
        self.assertEqual(mods['all']['tool_count'], parts - 1)

    def test_auth_and_unknown_module(self):
        self.assertEqual(APIClient().get('/api/agent/schedules/tools/').status_code, 401)
        self.assertEqual(self.c.get('/api/agent/nope/tools/').status_code, 404)

    def test_register_custom_module(self):
        from .tools import tool

        @tool
        def hello(name: str) -> str:
            """인사한다.

            Args:
                name: 이름
            """
            return f'안녕 {name}'

        modules.register(modules.Module('demo', '데모', '시험용', 'piko-demo', '/agent/demo',
                                        lambda user: [hello], lambda: {'hello'}, lambda: '데모 지침', lambda: []))
        self.addCleanup(lambda: (modules._PARTS.pop('demo', None), modules.clear_cache()))
        self.assertEqual(self.ok('demo', 'hello', name='piko'), '안녕 piko')
        self.assertIn('hello', {t['name'] for t in self.c.get('/api/agent/all/tools/').json()})
        with self.assertRaises(ValueError):
            modules.register(modules.Module('all', '', '', '', '', None, None, None, None))

    def test_token_shared_with_kb(self):
        c = APIClient()
        c.force_authenticate(self.user)
        res = c.post('/api/agent/token/', {'password': 'pw-1234-test'}, format='json')
        self.assertEqual(res.status_code, 201)
        key = res.json()['key']
        got = c.get('/api/kb/token/').json()
        self.assertEqual((got['exists'], got['prefix'], got['key']), (True, key[:6], None))
        self.assertEqual(c.delete('/api/kb/token/').json()['key'], None)
        self.assertFalse(c.get('/api/agent/token/').json()['exists'])

    def test_token_shown_once_hashed_password_and_expiry(self):
        from datetime import timedelta

        from django.utils import timezone

        from apps.core.models import ApiToken
        c = APIClient()
        c.force_authenticate(self.user)
        # 비밀번호를 다시 받는다
        self.assertEqual(c.post('/api/agent/token/', {}, format='json').status_code, 400)
        self.assertEqual(c.post('/api/agent/token/', {'password': 'nope'}, format='json').status_code, 400)
        key = c.post('/api/agent/token/', {'password': 'pw-1234-test'}, format='json').json()['key']
        # 키는 저장하지 않고 해시만, 다시 볼 수 없다
        t = ApiToken.objects.get(user=self.user)
        self.assertEqual(t.key_hash, api_tokens.hash_key(key))
        self.assertNotIn(key, str(ApiToken.objects.values().first()))
        self.assertNotIn(key, c.get('/api/agent/token/').content.decode())
        self.assertIsNotNone(t.expires_at)
        # 새 키로 인증, 이전 키(setUp)는 무효
        api = APIClient()
        api.credentials(HTTP_AUTHORIZATION=f'Token {key}')
        self.assertEqual(api.get('/api/agent/schedules/tools/').status_code, 200)
        self.assertEqual(self.c.get('/api/agent/schedules/tools/').status_code, 401)
        self.assertIsNotNone(ApiToken.objects.get(user=self.user).last_used_at)
        # 만료되면 401
        ApiToken.objects.filter(user=self.user).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(api.get('/api/agent/schedules/tools/').status_code, 401)
        self.assertTrue(c.get('/api/agent/token/').json()['expired'])

    def test_no_delete_tools_and_read_only_flags(self):
        tools = self.c.get('/api/agent/all/tools/').json()
        names = {t['name'] for t in tools}
        self.assertFalse([n for n in names if 'delete' in n or 'remove' in n or 'convert' in n])
        flags = {t['name']: t['read_only'] for t in tools}
        self.assertTrue(flags['schedule_list'] and flags['kb_search'] and flags['user_list'])
        self.assertFalse(flags['schedule_update'] or flags['problem_create'])
        anth = self.c.get('/api/agent/problems/tools/?format=anthropic').json()
        self.assertEqual({'name', 'description', 'input_schema'}, set(anth[0]))

    def test_mcp_all(self):
        def rpc(body):
            r = self.c.post('/api/agent/all/mcp', json.dumps(body), content_type='application/json')
            return r.json()

        init = rpc({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-06-18'}})
        self.assertEqual(init['result']['serverInfo']['name'], 'piko')
        self.assertEqual(init['result']['serverInfo']['title'], 'Piko · 통합')
        for title in ('지식 베이스', '일정 관리', '문제 해결', '공통 규칙'):
            self.assertIn(title, init['result']['instructions'])
        names = {t['name'] for t in rpc({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'})['result']['tools']}
        for prefix in ('kb_', 'schedule_', 'problem_', 'category_', 'process_'):
            self.assertTrue(any(n.startswith(prefix) for n in names), prefix)
        res = rpc({'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call',
                   'params': {'name': 'category_create', 'arguments': {'name': 'MCP 분류'}}})
        self.assertFalse(res['result']['isError'])
        self.assertEqual(Category.objects.get(name='MCP 분류').owner, self.user)

    def test_module_mcp_and_guide(self):
        r = self.c.post('/api/agent/schedules/mcp', json.dumps(
            {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {}}), content_type='application/json')
        self.assertEqual(r.json()['result']['serverInfo']['name'], 'piko-schedules')
        guide = self.c.get('/api/agent/problems/guide/').content.decode()
        self.assertIn('가장 위험한 가정', guide)
        self.assertIn('삭제 도구는 없다', guide)


class ScheduleToolTests(AgentTestBase):
    def test_schedule_flow(self):
        Category.objects.create(name='회의', owner=self.user)
        allday = self.ok('schedules', 'schedule_create', title='워크숍', start='2026-10-01', end='2026-10-03',
                         all_day=True, category='회의')
        self.assertEqual((allday['start'], allday['end'], allday['category']), ('2026-10-01', '2026-10-03', '회의'))
        timed = self.ok('schedules', 'schedule_create', title='미팅', start='2026-10-02T14:00', end='2026-10-02T15:30')
        self.assertEqual(timed['start'], '2026-10-02 14:00')
        # 10/3 하루만 보면 여러 날 종일 일정이 걸리고, 10/2 시간 일정은 빠진다
        day = self.ok('schedules', 'schedule_list', start='2026-10-03', end='2026-10-03')
        self.assertEqual([s['title'] for s in day['schedules']['items']], ['워크숍'])
        self.assertNotIn('tasks', day)
        done = self.ok('schedules', 'schedule_update', schedule_id=timed['id'], done=True, category='회의')
        self.assertTrue(done['done'])
        moved = self.ok('schedules', 'schedule_update', schedule_id=timed['id'], all_day=True)
        self.assertEqual((moved['start'], moved['end']), ('2026-10-02', '2026-10-02'))
        self.assertEqual(Schedule.objects.get(pk=timed['id']).owner, self.user)

    def test_schedule_repeat(self):
        s = self.ok('schedules', 'schedule_create', title='주간 회의', start='2026-10-05T10:00', repeat='weekly',
                    repeat_until='2026-10-26')
        self.assertEqual((s['repeat'], str(s['repeat_until'])), ('weekly', '2026-10-26'))
        # 반복 일정은 발생분마다 한 줄 (id 는 원본), 끝나는 날 뒤로는 없다
        month = self.ok('schedules', 'schedule_list', start='2026-10-01', end='2026-11-30')
        self.assertEqual([x['start'] for x in month['schedules']['items']],
                         ['2026-10-05 10:00', '2026-10-12 10:00', '2026-10-19 10:00', '2026-10-26 10:00'])
        self.assertEqual({x['id'] for x in month['schedules']['items']}, {s['id']})
        off = self.ok('schedules', 'schedule_update', schedule_id=s['id'], repeat='none')
        self.assertIsNone(off['repeat'])

    def test_schedule_errors(self):
        self.fails('schedules', 'schedule_create', '시각이 없습니다', title='x', start='2026-10-01')
        self.fails('schedules', 'schedule_create', '카테고리가 없습니다', title='x', start='2026-10-01',
                   all_day=True, category='없는카테고리')
        self.fails('schedules', 'schedule_create', '종료 시각', title='x', start='2026-10-02T10:00',
                   end='2026-10-02T09:00')
        self.fails('schedules', 'schedule_list', '끝 날짜', start='2026-10-05', end='2026-10-01')


class CategoryToolTests(AgentTestBase):
    def test_create_and_update_category(self):
        self.ok('schedules', 'category_create', name='출장', color='orange')
        self.assertEqual(Category.objects.get(name='출장').color, 'orange')
        self.fails('schedules', 'category_create', '이미 같은 이름', name='출장')
        self.ok('schedules', 'category_update', name='출장', new_name='외근', color='green')
        c = Category.objects.get(name='외근')
        self.assertEqual(c.color, 'green')
        self.fails('schedules', 'category_update', '카테고리가 없습니다', name='없는거', color='red')
        self.fails('schedules', 'category_update', '바꿀 항목', name='외근')
        self.assertEqual(self.ok('schedules', 'category_list')[0]['name'], '외근')


class ProblemToolTests(AgentTestBase):
    def test_problem_flow(self):
        p = self.ok('problems', 'problem_create', definition='견적 회신이 늦다', assignee='테스터',
                    unknowns=[{'text': '고객이 기다려 줄까', 'riskiest': True}])
        self.assertEqual(p['assignee_name'], '테스터')
        self.fails('problems', 'problem_update', '하나만', problem_id=p['id'],
                   unknowns=[{'text': 'a', 'riskiest': True}, {'text': 'b', 'riskiest': True}])
        self.fails('problems', 'problem_create', '등록된 사용자', definition='x', assignee='없는사람')
        p = self.ok('problems', 'problem_update', problem_id=p['id'], status='solving', assignee='')
        self.assertIsNone(p['assignee'])
        items = self.ok('problems', 'problem_list', status='solving')['items']
        self.assertEqual(items[0]['riskiest_unknown'], '고객이 기다려 줄까')
        self.assertEqual(self.ok('problems', 'user_list')[0]['nickname'], '테스터')

    def test_process_map(self):
        from apps.problems.process import seed_default
        seed_default(self.user)
        nodes = self.ok('problems', 'process_list')['items']
        self.assertEqual([n['path'] for n in nodes[:3]], ['영업', '영업 › 문의 응답', '영업 › 요구사항 정리'])
        p = self.ok('problems', 'problem_create', definition='빌드가 자주 깨진다', process='제작 > 개발')
        self.assertEqual(p['process_path'], '제작 › 개발')
        self.fails('problems', 'problem_create', '찾지 못했습니다', definition='x', process='없는 단계')
        self.assertEqual(len(self.ok('problems', 'problem_list', process='제작')['items']), 1)
        self.assertEqual(self.ok('problems', 'problem_list')['items'][0]['process'], '제작 › 개발')
        dev = next(n for n in self.ok('problems', 'process_list')['items'] if n['path'] == '제작 › 개발')
        self.assertEqual(dev['open'], 1)
        edges = self.ok('problems', 'process_list')['edges']
        self.assertIn('영업 → 제작 (흐름)', edges)
        self.assertIn('제작 › QA → 제작 › 개발 (되돌아감: 수정 요청)', edges)
        p = self.ok('problems', 'problem_update', problem_id=p['id'], process='')
        self.assertIsNone(p['process'])

    def test_process_map_groups_and_colors(self):
        from apps.problems.models import ProcessGroup, ProcessNode
        from apps.problems.process import seed_default
        seed_default(self.user)
        dev = ProcessNode.objects.get(title='개발')
        dev.color = 'rose'
        dev.save()
        g = ProcessGroup.objects.create(title='만드는 일', color='teal')
        ProcessNode.objects.filter(title__in=['개발', 'QA']).update(group=g)
        self.ok('problems', 'problem_create', definition='빌드가 자주 깨진다', process='제작 > 개발')
        out = self.ok('problems', 'process_list')
        items = {n['path']: n for n in out['items']}
        self.assertEqual((items['제작 › 개발']['color'], items['제작 › 개발']['group']), ('rose', '만드는 일'))
        self.assertEqual((items['제작']['color'], items['제작']['group']), ('violet', None))
        self.assertIsNone(items['제작 › 기획']['color'])
        self.assertEqual(out['groups'], [{
            'id': g.id, 'title': '만드는 일', 'color': 'teal', 'members': ['제작 › 개발', '제작 › QA'],
            'open_with_children': 1, 'overdue_with_children': 0,
        }])
