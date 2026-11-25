from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from .models import Problem


class ProblemListTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('u', password='pw')
        self.client.force_authenticate(self.user)

    def test_list_query_count_does_not_grow(self):
        """행마다 주인·담당자를 따로 읽지 않는다."""
        Problem.objects.create(owner=self.user, definition='p0')
        with self.assertNumQueries(1):
            self.client.get('/api/problems/')
        for i in range(5):
            a = User.objects.create_user(f'a{i}', first_name=f'담당{i}')
            Problem.objects.create(owner=User.objects.create_user(f'o{i}'), assignee=a, definition=f'p{i + 1}')
        with self.assertNumQueries(1):
            r = self.client.get('/api/problems/')
        self.assertEqual(len(r.json()), 6)
        self.assertEqual(sorted(p['assignee_name'] or '' for p in r.json())[1:], [f'담당{i}' for i in range(5)])


class ProcessNodeTests(APITestCase):
    URL = '/api/problems/process-nodes/'

    def setUp(self):
        self.user = User.objects.create_user('u', password='pw')
        self.client.force_authenticate(self.user)

    def node(self, title, parent=None, **kw):
        r = self.client.post(self.URL, {'title': title, 'parent': parent and parent['id'], **kw}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def nodes(self):
        return {n['title']: n for n in self.client.get(self.URL).json()}

    def test_login_required(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.URL).status_code, (401, 403))

    def test_crud_and_order(self):
        a = self.node('영업')
        b = self.node('제작')
        c = self.node('견적', a)
        self.assertEqual((a['order'], b['order'], c['order']), (0, 1, 0))
        self.assertEqual(c['parent'], a['id'])
        self.assertEqual(c['path'], '영업 › 견적')
        self.assertEqual(c['depth'], 1)
        self.assertEqual(c['created_by_name'], 'u')
        # 맨 앞에 끼워 넣기
        z = self.node('기획', order=0)
        self.assertEqual([n['title'] for n in self.client.get(self.URL).json()], ['기획', '영업', '제작', '견적'])
        self.assertEqual(z['order'], 0)

        r = self.client.patch(f'{self.URL}{c["id"]}/', {'title': '견적서', 'description': '단가표로', 'color': 'blue'},
                              format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.json()['title'], r.json()['description'], r.json()['path']), ('견적서', '단가표로', '영업 › 견적서'))
        # 부모는 PATCH 로 못 바꾼다 (move 로)
        r = self.client.patch(f'{self.URL}{c["id"]}/', {'parent': b['id']}, format='json')
        self.assertEqual(r.status_code, 400)
        # 빈 이름 거절
        self.assertEqual(self.client.post(self.URL, {'title': '  '}, format='json').status_code, 400)

    def test_process_nodes_url_is_not_a_problem_id(self):
        self.assertEqual(self.client.get('/api/problems/').status_code, 200)
        self.assertEqual(self.client.get(self.URL).status_code, 200)

    def test_move_and_cycle_guard(self):
        a = self.node('영업')
        b = self.node('제작')
        a1 = self.node('견적', a)
        a2 = self.node('계약', a)
        a11 = self.node('단가', a1)
        # 자기 자신·하위 단계 밑으로는 못 간다
        for target in (a, a1, a11):
            r = self.client.post(f'{self.URL}{a["id"]}/move/', {'parent': target['id']}, format='json')
            self.assertEqual(r.status_code, 400, target)
        # 제작 밑 첫 자리로
        r = self.client.post(f'{self.URL}{a2["id"]}/move/', {'parent': b['id'], 'order': 0}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.json()['parent'], r.json()['path']), (b['id'], '제작 › 계약'))
        # 같은 부모 안에서 순서 바꾸기 (아래로)
        self.client.post(f'{self.URL}{b["id"]}/move/', {'parent': None, 'order': 0}, format='json')
        ns = self.nodes()
        self.assertEqual((ns['제작']['order'], ns['영업']['order']), (0, 1))
        # 맨 위로 꺼내기 (order 없으면 끝에)
        r = self.client.post(f'{self.URL}{a11["id"]}/move/', {'parent': None}, format='json')
        self.assertEqual((r.json()['parent'], r.json()['order']), (None, 2))

    def test_delete_moves_problems_to_parent(self):
        a = self.node('제작')
        a1 = self.node('개발', a)
        a11 = self.node('서버', a1)
        p1 = Problem.objects.create(owner=self.user, definition='느림', process_id=a1['id'])
        p2 = Problem.objects.create(owner=self.user, definition='배포', process_id=a11['id'])
        r = self.client.delete(f'{self.URL}{a1["id"]}/')
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual((body['deleted'], body['moved_problems'], body['moved_to']['id']), (2, 2, a['id']))
        self.assertIn('2건', body['message'])
        self.assertEqual(set(self.nodes()), {'제작'})
        p1.refresh_from_db()
        p2.refresh_from_db()
        self.assertEqual((p1.process_id, p2.process_id), (a['id'], a['id']))
        # 맨 위 단계를 지우면 미지정으로
        r = self.client.delete(f'{self.URL}{a["id"]}/')
        self.assertIsNone(r.json()['moved_to'])
        p1.refresh_from_db()
        self.assertIsNone(p1.process_id)
        self.assertTrue(Problem.objects.filter(pk=p1.pk).exists())

    def test_delete_renumbers_siblings(self):
        a, b, c = self.node('a'), self.node('b'), self.node('c')
        self.client.delete(f'{self.URL}{b["id"]}/')
        ns = self.nodes()
        self.assertEqual((ns['a']['order'], ns['c']['order']), (0, 1))
        self.assertTrue(a and c)

    def test_seed_default_only_once(self):
        r = self.client.post(f'{self.URL}seed-default/')
        self.assertEqual(r.status_code, 201)
        data = r.json()
        tops = [n['title'] for n in data if n['parent'] is None]
        self.assertEqual(tops, ['영업', '제작', '납품', '사후관리', '회사 운영'])
        by_title = {n['title']: n for n in data}
        self.assertTrue(by_title['회사 운영']['is_support'])
        self.assertFalse(by_title['영업']['is_support'])
        self.assertEqual(by_title['개발']['path'], '제작 › 개발')
        self.assertEqual(len(data), 5 + 4 + 5 + 2 + 2 + 3)
        r = self.client.post(f'{self.URL}seed-default/')
        self.assertEqual(r.status_code, 409)
        self.assertEqual(len(self.client.get(self.URL).json()), len(data))

    def test_seed_refused_when_any_node_exists(self):
        self.node('우리 방식')
        self.assertEqual(self.client.post(f'{self.URL}seed-default/').status_code, 409)
        self.assertEqual(len(self.client.get(self.URL).json()), 1)

    def test_counts(self):
        from datetime import date, timedelta
        a = self.node('제작')
        a1 = self.node('개발', a)
        self.node('QA', a)
        mk = lambda node, status, **kw: Problem.objects.create(  # noqa: E731
            owner=self.user, definition=status, status=status, process_id=node['id'], **kw)
        mk(a, 'open')
        mk(a1, 'solving', due_date=date.today() - timedelta(days=1))
        mk(a1, 'on_hold')
        mk(a1, 'solved', due_date=date.today() - timedelta(days=1))  # 끝난 문제는 기한 지남으로 세지 않는다
        mk(a1, 'paused')
        Problem.objects.create(owner=self.user, definition='미지정')
        ns = self.nodes()
        top, dev, qa = ns['제작']['counts'], ns['개발']['counts'], ns['QA']['counts']
        self.assertEqual((top['open_count'], top['open_total']), (1, 3))
        self.assertEqual((top['problem_count'], top['problem_total']), (1, 5))
        self.assertEqual((top['overdue_count'], top['overdue_total']), (0, 1))
        self.assertEqual(dev['by_status'], {'open': 0, 'solving': 1, 'solved': 1, 'on_hold': 1, 'paused': 1})
        self.assertEqual(top['by_status_total']['solving'], 1)
        self.assertEqual((dev['open_count'], dev['overdue_count']), (2, 1))
        self.assertEqual((qa['open_total'], qa['problem_total']), (0, 0))

    def test_list_query_count_does_not_grow(self):
        self.client.post(f'{self.URL}seed-default/')
        with self.assertNumQueries(4):  # 단계 · 나무 · 상태별 수 · 기한 지남 수
            r = self.client.get(self.URL)
        self.assertEqual(len(r.json()), 21)


class ProblemProcessTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('u', password='pw')
        self.client.force_authenticate(self.user)
        self.client.post('/api/problems/process-nodes/seed-default/')
        from .models import ProcessNode
        self.make = ProcessNode.objects.get(title='제작', parent=None)
        self.dev = ProcessNode.objects.get(title='개발')
        self.qa = ProcessNode.objects.get(title='QA')

    def test_create_with_process_and_path(self):
        r = self.client.post('/api/problems/', {'definition': '빌드 실패', 'process': self.dev.pk}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual((r.json()['process'], r.json()['process_path']), (self.dev.pk, '제작 › 개발'))
        pid = r.json()['id']
        r = self.client.patch(f'/api/problems/{pid}/', {'process': None}, format='json')
        self.assertEqual((r.json()['process'], r.json()['process_path']), (None, None))
        r = self.client.patch(f'/api/problems/{pid}/', {'process': 99999}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_filter_by_process(self):
        Problem.objects.create(owner=self.user, definition='상위', process=self.make)
        Problem.objects.create(owner=self.user, definition='개발', process=self.dev)
        Problem.objects.create(owner=self.user, definition='QA', process=self.qa)
        Problem.objects.create(owner=self.user, definition='미지정')
        names = lambda q: sorted(p['definition'] for p in self.client.get(f'/api/problems/{q}').json())  # noqa: E731
        self.assertEqual(names(f'?process={self.make.pk}'), ['상위'])
        self.assertEqual(names(f'?process={self.make.pk}&include_children=1'), ['QA', '개발', '상위'])
        self.assertEqual(names(f'?process={self.dev.pk}&include_children=1'), ['개발'])
        self.assertEqual(names('?process=none'), ['미지정'])
        self.assertEqual(names('?process=abc'), [])
        self.assertEqual(len(names('')), 4)

    def test_list_paths_without_extra_queries_per_row(self):
        for i in range(5):
            Problem.objects.create(owner=self.user, definition=f'p{i}', process=self.dev if i % 2 else self.qa)
        with self.assertNumQueries(2):  # 문제 · 단계 전체 한 번
            r = self.client.get('/api/problems/')
        self.assertEqual({p['process_path'] for p in r.json()}, {'제작 › 개발', '제작 › QA'})


class ProcessEdgeTests(APITestCase):
    URL = '/api/problems/process-edges/'
    NODES = '/api/problems/process-nodes/'

    def setUp(self):
        from .models import ProcessNode
        self.user = User.objects.create_user('u', password='pw')
        self.client.force_authenticate(self.user)
        self.a = ProcessNode.objects.create(title='영업')
        self.b = ProcessNode.objects.create(title='제작', order=1)
        self.c = ProcessNode.objects.create(title='납품', order=2)

    def edge(self, s, t, **kw):
        return self.client.post(self.URL, {'source': s.pk, 'target': t.pk, **kw}, format='json')

    def test_login_required(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.URL).status_code, (401, 403))

    def test_crud(self):
        r = self.edge(self.a, self.b)
        self.assertEqual(r.status_code, 201, r.content)
        e = r.json()
        self.assertEqual((e['source'], e['target'], e['kind'], e['bidirectional'], e['label']),
                         (self.a.pk, self.b.pk, 'flow', False, ''))
        self.assertEqual(e['created_by_name'], 'u')
        self.assertNotIn('reverse', e)
        r = self.edge(self.b, self.a, kind='loop', label='  다시 견적  ')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual((r.json()['kind'], r.json()['label']), ('loop', '다시 견적'))
        self.assertEqual(len(self.client.get(self.URL).json()), 2)

        url = f'{self.URL}{e["id"]}/'
        r = self.client.patch(url, {'label': '계약 후', 'kind': 'related', 'bidirectional': True}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.json()['label'], r.json()['kind'], r.json()['bidirectional']), ('계약 후', 'related', True))
        self.assertEqual(self.client.patch(url, {'kind': 'nope'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(url, {'label': 'x' * 61}, format='json').status_code, 400)
        # 잇는 단계는 바꿀 수 없다
        r = self.client.patch(url, {'target': self.c.pk}, format='json')
        self.assertEqual(r.status_code, 400)
        # PUT 은 열지 않는다
        self.assertEqual(self.client.put(url, {}, format='json').status_code, 405)
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertEqual(len(self.client.get(self.URL).json()), 1)

    def test_unique_and_no_self_loop(self):
        self.assertEqual(self.edge(self.a, self.b).status_code, 201)
        r = self.edge(self.a, self.b, kind='loop')
        self.assertEqual(r.status_code, 400)
        self.assertIn('이미 있습니다', str(r.json()))
        r = self.edge(self.a, self.a)
        self.assertEqual(r.status_code, 400)
        self.assertIn('같은 단계', str(r.json()))
        self.assertEqual(self.client.post(self.URL, {'source': self.a.pk, 'target': 9999}, format='json').status_code, 400)
        # DB 도 막는다
        from django.db import IntegrityError, transaction
        from .models import ProcessEdge
        for s, t in ((self.a, self.b), (self.c, self.c)):
            with self.assertRaises(IntegrityError), transaction.atomic():
                ProcessEdge.objects.create(source=s, target=t)

    def test_reverse(self):
        e = self.edge(self.a, self.b, label='넘김').json()
        url = f'{self.URL}{e["id"]}/'
        r = self.client.patch(url, {'reverse': True}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.json()['source'], r.json()['target'], r.json()['label']), (self.b.pk, self.a.pk, '넘김'))
        # reverse: false 는 그대로
        r = self.client.patch(url, {'reverse': False, 'label': '돌려줌'}, format='json')
        self.assertEqual((r.json()['source'], r.json()['label']), (self.b.pk, '돌려줌'))
        # 반대 방향 연결이 이미 있으면 뒤집을 수 없다
        self.assertEqual(self.edge(self.a, self.b).status_code, 201)
        r = self.client.patch(url, {'reverse': True}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('이미 있습니다', str(r.json()))

    def test_sides(self):
        # 만들 때 시작점·끝점을 정한다. 안 보내면 '' (자동)
        e = self.edge(self.a, self.b).json()
        self.assertEqual((e['source_side'], e['target_side']), ('', ''))
        r = self.edge(self.b, self.c, source_side='bottom', target_side='left')
        self.assertEqual(r.status_code, 201, r.content)
        e = r.json()
        self.assertEqual((e['source_side'], e['target_side']), ('bottom', 'left'))
        url = f'{self.URL}{e["id"]}/'
        # 하나만 바꿀 수도, 자동('')으로 되돌릴 수도
        r = self.client.patch(url, {'target_side': 'top'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.json()['source_side'], r.json()['target_side']), ('bottom', 'top'))
        r = self.client.patch(url, {'source_side': ''}, format='json')
        self.assertEqual((r.json()['source_side'], r.json()['target_side']), ('', 'top'))
        # 없는 변은 안 된다
        self.assertEqual(self.client.patch(url, {'source_side': 'middle'}, format='json').status_code, 400)
        self.assertEqual(self.edge(self.c, self.a, target_side='up').status_code, 400)

    def test_reverse_swaps_sides(self):
        e = self.edge(self.a, self.b, source_side='right', target_side='top').json()
        url = f'{self.URL}{e["id"]}/'
        r = self.client.patch(url, {'reverse': True}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        j = r.json()
        self.assertEqual((j['source'], j['target'], j['source_side'], j['target_side']),
                         (self.b.pk, self.a.pk, 'top', 'right'))
        # 같은 요청에 보낸 변은 뒤집은 뒤 기준으로 적용
        r = self.client.patch(url, {'reverse': True, 'target_side': 'left'}, format='json')
        j = r.json()
        self.assertEqual((j['source'], j['source_side'], j['target_side']), (self.a.pk, 'right', 'left'))
        # reverse: false 는 변을 건드리지 않는다
        r = self.client.patch(url, {'reverse': False}, format='json')
        self.assertEqual((r.json()['source_side'], r.json()['target_side']), ('right', 'left'))

    def test_node_delete_removes_edges(self):
        self.edge(self.a, self.b)
        self.edge(self.b, self.c)
        self.client.delete(f'{self.NODES}{self.b.pk}/')
        self.assertEqual(self.client.get(self.URL).json(), [])

    def test_edges_url_is_not_a_problem_id(self):
        self.assertEqual(self.client.get('/api/problems/').status_code, 200)
        self.assertEqual(self.client.get(self.URL).status_code, 200)


class ProcessPositionTests(APITestCase):
    URL = '/api/problems/process-nodes/'

    def setUp(self):
        from .models import ProcessNode
        self.user = User.objects.create_user('u', password='pw')
        self.client.force_authenticate(self.user)
        self.a = ProcessNode.objects.create(title='영업')
        self.b = ProcessNode.objects.create(title='제작', order=1)

    def test_list_has_positions_and_patch(self):
        n = self.client.get(self.URL).json()[0]
        self.assertEqual((n['x'], n['y']), (None, None))
        r = self.client.patch(f'{self.URL}{self.a.pk}/', {'x': 12.5, 'y': -40}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.json()['x'], r.json()['y']), (12.5, -40.0))
        r = self.client.patch(f'{self.URL}{self.a.pk}/', {'x': 'nan'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_bulk_positions(self):
        r = self.client.post(f'{self.URL}positions/', {'positions': [
            {'id': self.a.pk, 'x': 0, 'y': 10}, {'id': self.b.pk, 'x': 220.5, 'y': 10}, {'id': 9999, 'x': 1, 'y': 1},
        ]}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json(), {'updated': 2})
        got = {n['title']: (n['x'], n['y']) for n in self.client.get(self.URL).json()}
        self.assertEqual(got, {'영업': (0.0, 10.0), '제작': (220.5, 10.0)})
        for bad in ({}, {'positions': [{'id': self.a.pk, 'x': 1}]}, {'positions': [{'id': self.a.pk, 'x': 'inf', 'y': 0}]}):
            self.assertEqual(self.client.post(f'{self.URL}positions/', bad, format='json').status_code, 400, bad)
        self.assertEqual(self.client.post(f'{self.URL}positions/', {'positions': []}, format='json').json(),
                         {'updated': 0})


class ProcessFlowMigrationTests(APITestCase):
    """0004 마이그레이션이 쓰는 도우미: 맨 위 흐름 단계 순서를 '흐름' 연결로 옮긴다"""

    def test_link_flow_in_order(self):
        from .models import ProcessEdge, ProcessNode
        from .process import link_flow_in_order
        mk = ProcessNode.objects.create
        later = mk(title='사후관리', order=3)
        sales = mk(title='영업', order=0)
        make = mk(title='제작', order=1)
        mk(title='회사 운영', order=2, is_support=True)  # 지원 단계는 흐름에서 뺀다
        deliver = mk(title='납품', order=2)
        mk(title='개발', parent=make)  # 하위 단계는 잇지 않는다
        self.assertEqual(link_flow_in_order(ProcessNode, ProcessEdge), 3)
        pairs = list(ProcessEdge.objects.values_list('source__title', 'target__title', 'kind'))
        self.assertEqual(pairs, [('영업', '제작', 'flow'), ('제작', '납품', 'flow'), ('납품', '사후관리', 'flow')])
        # 두 번 돌려도 늘지 않는다
        self.assertEqual(link_flow_in_order(ProcessNode, ProcessEdge), 0)
        self.assertEqual(ProcessEdge.objects.count(), 3)
        self.assertEqual(ProcessNode.objects.get(title='개발').parent_id, make.pk)
        self.assertTrue(sales and deliver and later)

    def test_link_flow_with_one_or_no_nodes(self):
        from .models import ProcessEdge, ProcessNode
        from .process import link_flow_in_order
        self.assertEqual(link_flow_in_order(ProcessNode, ProcessEdge), 0)
        ProcessNode.objects.create(title='혼자')
        self.assertEqual(link_flow_in_order(ProcessNode, ProcessEdge), 0)

    def test_seed_default_creates_edges(self):
        user = User.objects.create_user('u', password='pw')
        self.client.force_authenticate(user)
        self.assertEqual(self.client.post('/api/problems/process-nodes/seed-default/').status_code, 201)
        edges = self.client.get('/api/problems/process-edges/').json()
        titles = {n['id']: n['title'] for n in self.client.get('/api/problems/process-nodes/').json()}
        got = [(titles[e['source']], titles[e['target']], e['kind'], e['label']) for e in edges]
        self.assertEqual(got, [
            ('영업', '제작', 'flow', ''), ('제작', '납품', 'flow', ''), ('납품', '사후관리', 'flow', ''),
            ('QA', '개발', 'loop', '수정 요청'),
        ])
        self.assertTrue(all(e['created_by_name'] == 'u' for e in edges))


class ProcessColorTests(APITestCase):
    URL = '/api/problems/process-nodes/'

    def setUp(self):
        self.user = User.objects.create_user('u', password='pw')
        self.client.force_authenticate(self.user)
        self.client.post(f'{self.URL}seed-default/')
        from .models import ProcessNode
        self.dev = ProcessNode.objects.get(title='개발')
        self.qa = ProcessNode.objects.get(title='QA')

    def test_patch_color_and_clear(self):
        r = self.client.patch(f'{self.URL}{self.dev.pk}/', {'color': 'rose'}, format='json')
        self.assertEqual((r.status_code, r.json()['color']), (200, 'rose'))
        r = self.client.patch(f'{self.URL}{self.dev.pk}/', {'color': ''}, format='json')
        self.assertEqual(r.json()['color'], '')
        # 색 이름이 아닌 것은 거절
        r = self.client.patch(f'{self.URL}{self.dev.pk}/', {'color': '#ff0000'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_bulk_color(self):
        r = self.client.post(f'{self.URL}bulk-update/', {'ids': [self.dev.pk, self.qa.pk, 99999], 'color': 'teal'},
                             format='json')
        self.assertEqual((r.status_code, r.json()['updated']), (200, 2))
        self.dev.refresh_from_db()
        self.qa.refresh_from_db()
        self.assertEqual((self.dev.color, self.qa.color), ('teal', 'teal'))
        r = self.client.post(f'{self.URL}bulk-update/', {'ids': [self.dev.pk], 'color': ''}, format='json')
        self.dev.refresh_from_db()
        self.assertEqual(self.dev.color, '')

    def test_bulk_validation(self):
        bulk = lambda data: self.client.post(f'{self.URL}bulk-update/', data, format='json')  # noqa: E731
        self.assertEqual(bulk({'ids': [self.dev.pk]}).status_code, 400)  # 바꿀 항목 없음
        self.assertEqual(bulk({'ids': [], 'color': 'blue'}).status_code, 400)
        self.assertEqual(bulk({'ids': [self.dev.pk], 'color': 'Not A Color'}).status_code, 400)
        self.client.force_authenticate(None)
        self.assertIn(bulk({'ids': [self.dev.pk], 'color': 'blue'}).status_code, (401, 403))


class ProcessGroupTests(APITestCase):
    URL = '/api/problems/process-groups/'
    NODES = '/api/problems/process-nodes/'

    def setUp(self):
        from .models import ProcessNode
        self.user = User.objects.create_user('u', password='pw')
        self.client.force_authenticate(self.user)
        self.client.post(f'{self.NODES}seed-default/')
        get = lambda title: ProcessNode.objects.get(title=title)  # noqa: E731
        self.sales = ProcessNode.objects.get(title='영업', parent=None)
        self.quote = get('견적')
        self.make = ProcessNode.objects.get(title='제작', parent=None)
        self.dev = get('개발')
        self.qa = get('QA')
        self.ops = ProcessNode.objects.get(title='회사 운영')

    def create(self, title='고객 접점', nodes=(), **kw):
        r = self.client.post(self.URL, {'title': title, 'nodes': [n.pk for n in nodes], **kw}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def groups(self):
        return {g['title']: g for g in self.client.get(self.URL).json()}

    def node_group(self, node):
        return next(n['group'] for n in self.client.get(self.NODES).json() if n['id'] == node.pk)

    def test_login_required(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.URL).status_code, (401, 403))

    def test_create_assigns_members(self):
        g = self.create(nodes=[self.sales, self.dev], color='rose')
        self.assertEqual((g['title'], g['color'], sorted(g['nodes'])), ('고객 접점', 'rose', sorted([self.sales.pk, self.dev.pk])))
        self.assertEqual(g['created_by_name'], 'u')
        self.assertEqual(self.node_group(self.sales), g['id'])
        self.assertEqual(self.node_group(self.dev), g['id'])
        self.assertIsNone(self.node_group(self.qa))
        # 그룹 목록은 페이지 없이
        self.assertEqual(len(self.client.get(self.URL).json()), 1)

    def test_create_validation(self):
        post = lambda data: self.client.post(self.URL, data, format='json')  # noqa: E731
        self.assertEqual(post({'title': '빈 그룹'}).status_code, 400)
        self.assertEqual(post({'title': '빈 그룹', 'nodes': []}).status_code, 400)
        self.assertEqual(post({'title': '  ', 'nodes': [self.dev.pk]}).status_code, 400)
        self.assertEqual(post({'title': 'x' * 61, 'nodes': [self.dev.pk]}).status_code, 400)
        self.assertEqual(post({'title': '없는 단계', 'nodes': [99999]}).status_code, 400)
        self.assertEqual(post({'title': '색', 'nodes': [self.dev.pk], 'color': '#fff'}).status_code, 400)

    def test_node_in_one_group_and_empty_group_removed(self):
        a = self.create('A', [self.dev, self.qa])
        b = self.create('B', [self.qa, self.sales])
        self.assertEqual(self.node_group(self.qa), b['id'])
        self.assertEqual(self.groups()['A']['nodes'], [self.dev.pk])
        # A 의 마지막 멤버를 데려가면 A 는 없어진다
        self.create('C', [self.dev])
        self.assertEqual(set(self.groups()), {'B', 'C'})
        self.assertEqual(self.client.get(f'{self.URL}{a["id"]}/').status_code, 404)

    def test_patch_title_color_members(self):
        g = self.create(nodes=[self.dev])
        url = f'{self.URL}{g["id"]}/'
        r = self.client.patch(url, {'title': ' 개발 묶음 ', 'color': 'teal'}, format='json')
        self.assertEqual((r.status_code, r.json()['title'], r.json()['color']), (200, '개발 묶음', 'teal'))
        self.assertEqual(r.json()['nodes'], [self.dev.pk])
        r = self.client.patch(url, {'nodes': [self.qa.pk, self.sales.pk]}, format='json')
        self.assertEqual(sorted(r.json()['nodes']), sorted([self.qa.pk, self.sales.pk]))
        self.assertIsNone(self.node_group(self.dev))
        # 멤버를 비울 수는 없다 (풀려면 DELETE)
        self.assertEqual(self.client.patch(url, {'nodes': []}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(url, {'title': ''}, format='json').status_code, 400)
        self.assertEqual(self.client.put(url, {'title': 'x', 'nodes': [self.qa.pk]}, format='json').status_code, 405)

    def test_delete_ungroups_and_keeps_nodes(self):
        from .models import ProcessNode
        g = self.create(nodes=[self.dev, self.qa])
        before = ProcessNode.objects.count()
        self.assertEqual(self.client.delete(f'{self.URL}{g["id"]}/').status_code, 204)
        self.assertEqual(ProcessNode.objects.count(), before)
        self.assertIsNone(self.node_group(self.dev))
        self.assertEqual(self.client.get(self.URL).json(), [])

    def test_remove_node_from_group(self):
        g = self.create(nodes=[self.dev, self.qa])
        r = self.client.patch(f'{self.NODES}{self.dev.pk}/', {'group': None}, format='json')
        self.assertEqual((r.status_code, r.json()['group']), (200, None))
        self.assertEqual(self.groups()['고객 접점']['nodes'], [self.qa.pk])
        # 마지막 멤버를 빼면 그룹도 없어진다
        self.client.patch(f'{self.NODES}{self.qa.pk}/', {'group': None}, format='json')
        self.assertEqual(self.client.get(self.URL).json(), [])
        # 단계 PATCH 로 그룹에 넣기
        g = self.create('다시', [self.sales])
        r = self.client.patch(f'{self.NODES}{self.dev.pk}/', {'group': g['id']}, format='json')
        self.assertEqual(r.json()['group'], g['id'])

    def test_bulk_group(self):
        g = self.create(nodes=[self.sales])
        r = self.client.post(f'{self.NODES}bulk-update/', {'ids': [self.dev.pk, self.qa.pk], 'group': g['id']},
                             format='json')
        self.assertEqual(r.json()['updated'], 2)
        self.assertEqual(len(self.groups()['고객 접점']['nodes']), 3)
        self.client.post(f'{self.NODES}bulk-update/', {'ids': [self.dev.pk, self.qa.pk, self.sales.pk], 'group': None},
                         format='json')
        self.assertEqual(self.client.get(self.URL).json(), [])

    def test_deleting_last_member_removes_group(self):
        self.create(nodes=[self.dev])
        self.client.delete(f'{self.NODES}{self.make.pk}/')  # 제작과 그 하위(개발 포함)를 지운다
        self.assertEqual(self.client.get(self.URL).json(), [])

    def test_counts_include_subtrees_once(self):
        from datetime import date, timedelta
        mk = lambda node, status='open', **kw: Problem.objects.create(  # noqa: E731
            owner=self.user, definition=f'{node.title}-{status}', status=status, process=node, **kw)
        mk(self.make)
        mk(self.dev, due_date=date.today() - timedelta(days=2))
        mk(self.qa, 'solved')
        mk(self.quote)
        mk(self.ops)
        # 제작과 그 하위인 개발을 함께 묶어도 개발의 문제는 한 번만 센다
        g = self.create(nodes=[self.make, self.dev, self.quote])
        c = self.groups()['고객 접점']['counts']
        self.assertEqual(c, {'open': 3, 'overdue': 1, 'problem_total': 4})
        self.assertEqual(g['counts']['open'], 3)

    def test_problem_filter_by_group(self):
        Problem.objects.create(owner=self.user, definition='제작', process=self.make)
        Problem.objects.create(owner=self.user, definition='개발', process=self.dev)
        Problem.objects.create(owner=self.user, definition='견적', process=self.quote)
        Problem.objects.create(owner=self.user, definition='운영', process=self.ops)
        Problem.objects.create(owner=self.user, definition='미지정')
        g = self.create(nodes=[self.make, self.quote])
        names = lambda q: sorted(p['definition'] for p in self.client.get(f'/api/problems/{q}').json())  # noqa: E731
        self.assertEqual(names(f'?group={g["id"]}'), ['개발', '견적', '제작'])
        self.assertEqual(names('?group=99999'), [])
        self.assertEqual(names('?group=abc'), [])

    def test_list_query_count_does_not_grow(self):
        self.create('A', [self.dev])
        with self.assertNumQueries(5):  # 그룹 · 멤버 · 나무 · 상태별 수 · 기한 지남 수
            self.client.get(self.URL)
        self.create('B', [self.qa, self.sales])
        self.create('C', [self.ops, self.quote])
        with self.assertNumQueries(5):
            r = self.client.get(self.URL)
        self.assertEqual(len(r.json()), 3)


class ProblemResultTests(APITestCase):
    """'어떻게 풀었나'를 저장하고, 에이전트 찾기에도 걸린다"""

    def setUp(self):
        self.user = User.objects.create_user('kim', password='x-test-pw')
        self.client.force_authenticate(self.user)

    def test_result_saved_and_searchable_by_agent_tool(self):
        from apps.agent.modules import registry

        r = self.client.post('/api/problems/', {'definition': '견적 요청이 너무 많이 나감'}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        pid = r.json()['id']
        r = self.client.patch(f'/api/problems/{pid}/', {'status': 'solved', 'result': '300만 원 미만 요청은 보내지 않게 바꿈'},
                              format='json')
        self.assertEqual(r.json()['result'], '300만 원 미만 요청은 보내지 않게 바꿈')
        found = registry('problems', self.user).call('problem_list', {'query': '300만 원'})
        self.assertIn('견적 요청', found)
