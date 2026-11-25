import json
import tempfile

from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TransactionTestCase, override_settings
from pycrdt import Doc as YDoc
from pycrdt import Text, YMessageType, YSyncMessageType, create_sync_message, create_update_message, handle_sync_message
from rest_framework.test import APIClient, APITestCase

from . import collab
from .models import CollabState, Comment, Doc, Template

User = get_user_model()
PNG = (b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89'
       b'\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82')


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class DocAccessTests(APITestCase):
    def setUp(self):
        self.me = User.objects.create_user('me', password='pw', first_name='나')
        self.you = User.objects.create_user('you', password='pw', first_name='너')
        self.they = User.objects.create_user('they', password='pw', first_name='그')
        # 연결 대상(예: 다른 묶음의 프로젝트)은 id 만 쓴다. project=<id> 는 ref_type 'project' 와 같다
        self.project_id = 7
        self.client.force_authenticate(self.me)

    def as_(self, user):
        self.client.force_authenticate(user)

    def ids(self, url):
        r = self.client.get(url)
        self.assertEqual(r.status_code, 200, r.content)
        return {x['id'] for x in r.json()}

    def test_doc_visibility_and_sharing(self):
        mine = self.client.post('/api/docs/', {'title': '내 메모'}, format='json').json()
        proj = self.client.post('/api/docs/', {'title': '회의', 'kind': 'slides', 'project': self.project_id},
                                format='json').json()
        self.assertEqual((mine['owner'], mine['owner_name'], mine['kind']), (self.me.id, '나', 'doc'))
        # 개인 파일은 남에게 안 보이고, 프로젝트 파일은 모두에게 보인다
        self.as_(self.you)
        self.assertEqual(self.ids('/api/docs/'), {proj['id']})
        self.assertEqual(self.client.get(f"/api/docs/{mine['id']}/").status_code, 404)
        self.assertEqual(self.client.patch(f"/api/docs/{mine['id']}/", {'title': 'x'}, format='json').status_code, 404)
        r = self.client.patch(f"/api/docs/{proj['id']}/", {'snapshot': {'type': 'doc'}}, format='json')
        self.assertEqual((r.status_code, r.json()['updated_by_name']), (200, '너'))
        # 공유는 주인만
        self.assertEqual(self.client.post(f"/api/docs/{mine['id']}/share/", {'user_ids': [self.you.id]},
                                          format='json').status_code, 404)
        self.as_(self.me)
        r = self.client.post(f"/api/docs/{mine['id']}/share/", {'user_ids': [self.you.id]}, format='json')
        self.assertEqual(r.json()['shared_with_users'], [{'id': self.you.id, 'name': '너'}])
        self.as_(self.you)
        self.assertEqual(self.ids('/api/docs/?scope=mine'), {mine['id']})
        self.assertEqual(self.ids('/api/docs/'), {mine['id'], proj['id']})
        self.assertEqual(self.ids('/api/docs/?kind=slides'), {proj['id']})
        self.assertEqual(self.ids(f'/api/docs/?project={self.project_id}'), {proj['id']})
        self.assertNotIn('snapshot', self.client.get('/api/docs/').json()[0])
        d = self.client.get(f"/api/docs/{mine['id']}/").json()
        self.assertEqual((d['can_manage'], d['has_ystate']), (False, False))
        # 공유받은 사람은 고칠 수 있지만 프로젝트로 옮기거나 지우거나 공유를 바꾸지는 못한다
        self.assertEqual(self.client.patch(f"/api/docs/{mine['id']}/", {'title': '고침'}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(f"/api/docs/{mine['id']}/", {'project': self.project_id},
                                           format='json').status_code, 403)
        self.assertEqual(self.client.delete(f"/api/docs/{mine['id']}/").status_code, 403)
        self.assertEqual(self.client.post(f"/api/docs/{mine['id']}/unshare/", {'user_ids': [self.you.id]},
                                          format='json').status_code, 403)
        self.as_(self.they)
        self.assertEqual(self.ids('/api/docs/'), {proj['id']})
        # 주인이 공유를 풀면 다시 안 보인다
        self.as_(self.me)
        self.client.post(f"/api/docs/{mine['id']}/unshare/", {'user_ids': [self.you.id]}, format='json')
        self.as_(self.you)
        self.assertEqual(self.ids('/api/docs/?scope=mine'), set())
        # 주인이 프로젝트로 옮기면 모두에게 보이고, 다른 사람이 다시 개인 파일로 가져갈 수는 없다
        self.as_(self.me)
        r = self.client.patch(f"/api/docs/{mine['id']}/", {'project': self.project_id}, format='json')
        self.assertEqual(r.status_code, 200)
        self.as_(self.they)
        self.assertIn(mine['id'], self.ids('/api/docs/'))
        self.assertEqual(self.client.patch(f"/api/docs/{mine['id']}/", {'project': None}, format='json').status_code,
                         403)
        # 프로젝트 파일은 누구나 지울 수 있다
        self.assertEqual(self.client.delete(f"/api/docs/{proj['id']}/").status_code, 204)

    def test_doc_duplicate_copies_yjs_state_and_cleanup(self):
        d = Doc.objects.create(title='원본', owner=self.me, snapshot={'type': 'doc'})
        CollabState.objects.create(kind='doc', object_id=d.id, state=b'\x01\x02\x03')
        Comment.objects.create(target_kind='doc', target_id=d.id, body='x', author=self.me)
        r = self.client.post(f'/api/docs/{d.id}/duplicate/')
        self.assertEqual((r.status_code, r.json()['title']), (201, '원본 사본'))
        self.assertTrue(self.client.get(f"/api/docs/{r.json()['id']}/").json()['has_ystate'])
        self.client.delete(f'/api/docs/{d.id}/')
        self.assertFalse(CollabState.objects.filter(kind='doc', object_id=d.id).exists())
        self.assertFalse(Comment.objects.exists())

    def test_generic_ref_fields(self):
        d = self.client.post('/api/docs/', {'title': '연결', 'ref_type': 'ticket', 'ref_id': 3}, format='json').json()
        self.assertEqual((d['ref_type'], d['ref_id'], d['project']), ('ticket', 3, None))
        p = self.client.post('/api/docs/', {'title': '프로젝트', 'project': 5}, format='json').json()
        self.assertEqual((p['ref_type'], p['ref_id'], p['project']), ('project', 5, 5))
        self.as_(self.you)
        self.assertEqual(self.ids('/api/docs/?ref_type=ticket'), {d['id']})
        self.assertEqual(self.ids('/api/docs/?ref_type=ticket&ref_id=3'), {d['id']})
        self.assertEqual(self.ids('/api/docs/?project=5'), {p['id']})
        self.assertEqual(self.ids('/api/docs/?ref_type=ticket&ref_id=4'), set())
        self.as_(self.me)
        r = self.client.patch(f"/api/docs/{p['id']}/", {'ref_id': None}, format='json').json()
        self.assertEqual((r['ref_type'], r['ref_id'], r['project']), ('', None, None))

    def test_doc_assets(self):
        d = Doc.objects.create(title='x', owner=self.me)
        r = self.client.post('/api/doc-assets/', {'doc': d.id, 'file': SimpleUploadedFile('a.png', PNG, 'image/png')},
                             format='multipart')
        self.assertEqual(r.status_code, 201, r.content)
        url = r.json()['url']
        res = self.client.get(url)
        self.assertEqual(res.status_code, 200)
        res.close()
        self.as_(self.you)
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_comments(self):
        d = Doc.objects.create(title='개인', owner=self.me)
        url = f'/api/comments/?kind=doc&id={d.id}'
        c = self.client.post('/api/comments/', {'target_kind': 'doc', 'target_id': d.id, 'body': '여기 확인',
                                                'anchor': {'mark': 'c1'}}, format='json')
        self.assertEqual(c.status_code, 201, c.content)
        c = c.json()
        self.assertEqual((c['author_name'], c['is_mine'], c['resolved']), ('나', True, False))
        # 볼 수 없는 파일의 댓글은 보지도 달지도 못한다
        self.as_(self.you)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.post('/api/comments/', {'target_kind': 'doc', 'target_id': d.id, 'body': 'x'},
                                          format='json').status_code, 404)
        self.assertEqual(self.client.post(f"/api/comments/{c['id']}/resolve/").status_code, 404)
        self.as_(self.me)
        d.shared_with.add(self.you)
        self.as_(self.you)
        r = self.client.post('/api/comments/', {'target_kind': 'doc', 'target_id': d.id, 'body': '답글',
                                                'parent': c['id']}, format='json')
        self.assertEqual(r.status_code, 201)
        reply = r.json()
        # 남의 댓글은 고치거나 지우지 못하지만 해결 표시는 할 수 있다
        self.assertEqual(self.client.patch(f"/api/comments/{c['id']}/", {'body': 'x'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(f"/api/comments/{c['id']}/").status_code, 403)
        r = self.client.post(f"/api/comments/{c['id']}/resolve/").json()
        self.assertEqual((r['resolved'], r['resolved_by_name']), (True, '너'))
        self.assertEqual(len(self.client.get(url + '&resolved=0').json()), 1)
        r = self.client.post(f"/api/comments/{c['id']}/reopen/").json()
        self.assertEqual((r['resolved'], r['resolved_by_name'], r['resolved_at']), (False, '', None))
        r = self.client.patch(f"/api/comments/{reply['id']}/", {'body': '고친 답글'}, format='json')
        self.assertEqual(r.json()['body'], '고친 답글')
        # 다른 파일의 댓글에 답글을 달 수 없다
        other = Doc.objects.create(title='프로젝트', ref_type='project', ref_id=self.project_id)
        r = self.client.post('/api/comments/', {'target_kind': 'doc', 'target_id': other.id, 'body': 'x',
                                                'parent': c['id']}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual([x['body'] for x in self.client.get(url).json()], ['여기 확인', '고친 답글'])
        self.as_(self.me)
        self.assertEqual(self.client.delete(f"/api/comments/{c['id']}/").status_code, 204)
        self.assertFalse(Comment.objects.filter(target_kind='doc').exists())   # 답글도 함께

    def test_templates(self):
        builtin = {(t['kind'], t['name']) for t in self.client.get('/api/templates/').json()}
        self.assertEqual({('doc', '빈 문서'), ('doc', '회의록'), ('doc', '기획서'), ('doc', '주간 보고'), ('slides', '기본'),
                          ('slides', '발표')}, builtin)
        lst = self.client.get('/api/templates/?kind=doc').json()
        self.assertTrue(all(t['kind'] == 'doc' for t in lst))
        self.assertNotIn('content', lst[0])
        meeting = Template.objects.get(builtin=True, name='회의록')
        r = self.client.post(f'/api/templates/{meeting.id}/use/', {'project': self.project_id}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        d = self.client.get(f"/api/docs/{r.json()['id']}/").json()
        self.assertEqual((d['title'], d['kind'], d['project'], d['has_ystate']), ('회의록', 'doc', self.project_id, False))
        self.assertEqual(d['snapshot'], meeting.content)
        r = self.client.post(f'/api/templates/{meeting.id}/use/', {'title': '개인 회의록'}, format='json').json()
        self.assertEqual((r['title'], r['owner'], r['ref_id']), ('개인 회의록', self.me.id, None))
        self.assertEqual(self.client.post(f'/api/templates/{meeting.id}/use/', {'ref_id': 'x'},
                                          format='json').status_code, 400)
        # 지금 파일을 템플릿으로 저장
        r = self.client.post(f"/api/docs/{d['id']}/save-template/", {'name': '우리 회의록'}, format='json')
        self.assertEqual((r.status_code, r.json()['kind'], r.json()['content']), (201, 'doc', meeting.content))
        mine = r.json()
        # 기본 템플릿과 남의 템플릿은 지우지 못한다
        self.assertEqual(self.client.delete(f'/api/templates/{meeting.id}/').status_code, 403)
        self.as_(self.you)
        self.assertEqual(self.client.delete(f"/api/templates/{mine['id']}/").status_code, 403)
        self.as_(self.me)
        self.assertEqual(self.client.delete(f"/api/templates/{mine['id']}/").status_code, 204)


# ---------------------------------------------------------------- 실시간 공동 편집 (웹소켓)


def _login_cookie(user) -> bytes:
    c = Client()
    c.force_login(user)
    return f"sessionid={c.cookies['sessionid'].value}".encode()


@override_settings(COLLAB_SAVE_DELAY=0.05)
class CollabSocketTests(TransactionTestCase):
    def setUp(self):
        from config.asgi import application
        self.app = application
        collab._rooms.clear()
        self.me = User.objects.create_user('me', password='pw')
        self.you = User.objects.create_user('you', password='pw')
        self.doc = Doc.objects.create(title='개인 문서', owner=self.me)

    async def open(self, user=None, path=None):
        headers = [(b'origin', b'http://localhost')]
        if user is not None:
            headers.append((b'cookie', await database_sync_to_async(_login_cookie)(user)))
        comm = WebsocketCommunicator(self.app, path or f'/ws/collab/doc/{self.doc.id}', headers=headers)
        connected, _ = await comm.connect()
        self.assertTrue(connected)
        return comm

    async def handshake(self, comm, ydoc):
        """서버의 step1 에 답하고, 내 step1 을 보내 서버 내용(step2)을 받는다."""
        msg = await comm.receive_from()
        self.assertEqual((msg[0], msg[1]), (YMessageType.SYNC, YSyncMessageType.SYNC_STEP1))
        await comm.send_to(bytes_data=handle_sync_message(msg[1:], ydoc))
        await comm.send_to(bytes_data=create_sync_message(ydoc))
        msg = await comm.receive_from()
        self.assertEqual((msg[0], msg[1]), (YMessageType.SYNC, YSyncMessageType.SYNC_STEP2))
        handle_sync_message(msg[1:], ydoc)

    async def test_rejects_anonymous_and_unauthorized(self):
        comm = await self.open(None)
        self.assertEqual((await comm.receive_output())['code'], collab.CLOSE_UNAUTHENTICATED)
        await comm.disconnect()
        comm = await self.open(self.you)
        self.assertEqual((await comm.receive_output())['code'], collab.CLOSE_FORBIDDEN)
        await comm.disconnect()
        comm = await self.open(self.me, '/ws/collab/doc/999999/')
        self.assertEqual((await comm.receive_output())['code'], collab.CLOSE_FORBIDDEN)
        await comm.disconnect()

    async def test_two_clients_sync_and_persist(self):
        await database_sync_to_async(self.doc.shared_with.add)(self.you)
        a, b = await self.open(self.me), await self.open(self.you)
        da, db = YDoc(), YDoc()
        await self.handshake(a, da)
        await self.handshake(b, db)
        # a 가 고치면 b 에게 그대로 간다
        ta = da.get('t', type=Text)
        before = da.get_state()
        ta += '안녕하세요'
        await a.send_to(bytes_data=create_update_message(da.get_update(before)))
        msg = await b.receive_from()
        self.assertEqual((msg[0], msg[1]), (YMessageType.SYNC, YSyncMessageType.SYNC_UPDATE))
        handle_sync_message(msg[1:], db)
        self.assertEqual(str(db.get('t', type=Text)), '안녕하세요')
        self.assertTrue(await a.receive_nothing(0.1))   # 보낸 사람에게는 되돌아오지 않는다
        # 커서(awareness)도 다른 사람에게 간다. 나가면 지워진다.
        aw = collab.encode_awareness({123: (1, json.dumps({'user': {'name': '나'}}))})
        await a.send_to(bytes_data=aw)
        self.assertEqual(await b.receive_from(), aw)
        self.assertEqual(await a.receive_from(), aw)   # 보낸 사람에게도 (y-websocket 연결 유지용)
        await a.disconnect()
        gone = collab.decode_awareness(collab.read_message((await b.receive_from())[1:]))
        self.assertEqual(gone, [(123, 2, 'null')])
        await b.disconnect()
        self.assertEqual(collab._rooms, {})
        # 모두 나가면 DB 에 저장되고, 다시 열면 그 내용으로 시작한다
        row = await database_sync_to_async(CollabState.objects.get)(kind='doc', object_id=self.doc.id)
        self.assertTrue(len(row.state) > 2)
        c, dc = await self.open(self.me), YDoc()
        await self.handshake(c, dc)
        self.assertEqual(str(dc.get('t', type=Text)), '안녕하세요')
        await c.disconnect()

    async def test_debounced_save_and_comment_notice(self):
        import asyncio
        a, da = await self.open(self.me), YDoc()
        await self.handshake(a, da)
        t = da.get('t', type=Text)
        t += 'x'
        await a.send_to(bytes_data=create_update_message(da.get_update()))
        await asyncio.sleep(0.3)   # 나가지 않아도 잠시 뒤 저장된다
        self.assertTrue(await database_sync_to_async(
            CollabState.objects.filter(kind='doc', object_id=self.doc.id).exists)())

        def post_comment():
            api = APIClient()
            api.force_authenticate(self.me)
            return api.post('/api/comments/', {'target_kind': 'doc', 'target_id': self.doc.id, 'body': '확인'},
                            format='json').json()['id']

        cid = await database_sync_to_async(post_comment)()
        msg = await a.receive_from()
        self.assertEqual(msg[0], collab.MSG_COMMENTS)
        self.assertEqual(json.loads(collab.Decoder(msg[1:]).read_var_string()),
                         {'type': 'comments', 'action': 'created', 'id': cid})

        # 공유가 풀리면 연결이 끊긴다
        await database_sync_to_async(self.doc.shared_with.add)(self.you)
        b, db = await self.open(self.you), YDoc()
        await self.handshake(b, db)

        def unshare():
            api = APIClient()
            api.force_authenticate(self.me)
            return api.post(f'/api/docs/{self.doc.id}/unshare/', {'user_ids': [self.you.id]}, format='json')

        await database_sync_to_async(unshare)()
        self.assertEqual((await b.receive_output())['code'], collab.CLOSE_FORBIDDEN)
        await b.disconnect()
        await a.disconnect()
