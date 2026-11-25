"""실시간 공동 편집 서버 (y-websocket 프로토콜).

주소: ws(s)://<host>/ws/collab/doc/<id>   (슬라이드도 doc)
  JS: new WebsocketProvider(`${origin}/ws/collab`, 'doc/12', ydoc)

- 방(kind/id)마다 Y.Doc 하나를 메모리에 둔다 (서버 프로세스가 하나라는 가정).
  첫 사람이 들어오면 CollabState 에서 불러오고, 고쳐지면 COLLAB_SAVE_DELAY 초 뒤에,
  마지막 사람이 나가면 바로 저장한다.
- 접속 시 세션 로그인과 파일 권한(apps.docs.access)을 확인한다. 안 되면 accept 후
  4401(로그인 필요)·4403(권한 없음)으로 닫는다.
- 커서·접속자(awareness)는 그대로 모두에게 넘기고 (보낸 사람 포함, y-websocket 서버와 같다), 새로 들어온 사람에게 지금 상태를
  보내며, 나간 사람의 커서는 지운다.
- 댓글이 바뀌면 notify_comments() 가 방에 메시지 종류 100 (JSON 글)을 보낸다.

pycrdt-websocket 의 YjsConsumer 는 연결마다 Y.Doc 을 따로 두고 받은 메시지를 보낸 사람에게도
되돌려 보내서, DB 저장·권한 확인을 붙이기 어렵다. 그래서 pycrdt 의 동기화 함수만 쓰고
방 관리는 여기서 한다.
"""

import asyncio
import json
import logging

from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.layers import get_channel_layer
from django.conf import settings
from django.http import Http404
from django.utils import timezone
from pycrdt import (
    Decoder,
    Doc,
    YMessageType,
    YSyncMessageType,
    create_sync_message,
    create_update_message,
    handle_sync_message,
    read_message,
    write_message,
    write_var_uint,
)

log = logging.getLogger(__name__)

MSG_QUERY_AWARENESS = 3
MSG_COMMENTS = 100   # 우리가 정한 메시지: 댓글 바뀜 (JSON 글)
CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403


def group_name(kind: str, pk: int) -> str:
    return f'collab.{kind}.{pk}'


# ---------------------------------------------------------------- DB


def _model(kind):
    from .models import Doc as DocModel
    return {'doc': DocModel}[kind]


def _load_state(kind, pk) -> bytes:
    from .models import CollabState
    row = CollabState.objects.filter(kind=kind, object_id=pk).first()
    return bytes(row.state) if row else b''


def _save_state(kind, pk, state: bytes, editor_id) -> None:
    from .models import CollabState
    if not _model(kind).objects.filter(pk=pk).exists():
        return   # 그사이 파일이 지워졌다
    CollabState.objects.update_or_create(kind=kind, object_id=pk, defaults={'state': state})
    _model(kind).objects.filter(pk=pk).update(updated_at=timezone.now(), updated_by_id=editor_id)


def _allowed(kind, pk, user) -> bool:
    from .access import get_target
    try:
        get_target(kind, pk, user)
        return True
    except Http404:
        return False


# ---------------------------------------------------------------- 방


class Room:
    def __init__(self, kind: str, pk: int):
        self.key = (kind, pk)
        self.kind, self.pk = kind, pk
        self.doc = Doc()
        self.clients = 0
        self.dirty = False
        self.editor_id = None
        # awareness: Yjs clientID → (clock, 상태 JSON 글)
        self.awareness: dict[int, tuple[int, str]] = {}
        self.ready = None
        self._save_task = None
        self._lock = asyncio.Lock()

    async def load(self):
        state = await database_sync_to_async(_load_state)(self.kind, self.pk)
        if state:
            self.doc.apply_update(state)

    def mark_dirty(self, user_id):
        self.dirty = True
        self.editor_id = user_id
        if self._save_task is None or self._save_task.done():
            self._save_task = asyncio.ensure_future(self._save_later())

    async def _save_later(self):
        while self.dirty:
            await asyncio.sleep(settings.COLLAB_SAVE_DELAY)
            await self.flush()

    async def flush(self):
        async with self._lock:
            if not self.dirty:
                return
            self.dirty = False
            state = self.doc.get_update()
            try:
                await database_sync_to_async(_save_state)(self.kind, self.pk, state, self.editor_id)
            except Exception:
                self.dirty = True
                log.exception('공동 편집 저장 실패: %s/%s', self.kind, self.pk)

    def awareness_message(self) -> bytes | None:
        if not self.awareness:
            return None
        return encode_awareness({cid: v for cid, v in self.awareness.items()})


_rooms: dict[tuple, Room] = {}


async def join(kind: str, pk: int) -> Room:
    key = (kind, pk)
    room = _rooms.get(key)
    if room is None:
        room = _rooms[key] = Room(kind, pk)
        room.ready = asyncio.ensure_future(room.load())
    room.clients += 1
    try:
        await asyncio.shield(room.ready)
    except Exception:
        room.clients -= 1
        if room.clients == 0 and _rooms.get(key) is room:
            del _rooms[key]
        raise
    return room


async def leave(room: Room):
    room.clients -= 1
    if room.clients > 0:
        return
    await room.flush()
    if room.clients == 0 and _rooms.get(room.key) is room:
        del _rooms[room.key]
        if room._save_task and not room._save_task.done():
            room._save_task.cancel()


# ---------------------------------------------------------------- awareness 인코딩


def _var_string(text: str) -> bytes:
    b = text.encode('utf-8')
    return write_var_uint(len(b)) + b


def encode_awareness(states: dict[int, tuple[int, str]]) -> bytes:
    body = write_var_uint(len(states)) + b''.join(
        write_var_uint(cid) + write_var_uint(clock) + _var_string(state) for cid, (clock, state) in states.items())
    return write_var_uint(YMessageType.AWARENESS) + write_message(body)


def decode_awareness(update: bytes) -> list[tuple[int, int, str]]:
    d = Decoder(update)
    return [(d.read_var_uint(), d.read_var_uint(), d.read_var_string()) for _ in range(d.read_var_uint())]


# ---------------------------------------------------------------- 연결


class CollabConsumer(AsyncWebsocketConsumer):
    room: Room | None = None

    async def connect(self):
        kw = self.scope['url_route']['kwargs']
        self.kind, self.pk = kw['kind'], int(kw['pk'])
        self.user = self.scope.get('user')
        self.client_ids: set[int] = set()
        if not (self.user and self.user.is_authenticated):
            await self.accept()
            await self.close(code=CLOSE_UNAUTHENTICATED)
            return
        if not await database_sync_to_async(_allowed)(self.kind, self.pk, self.user):
            await self.accept()
            await self.close(code=CLOSE_FORBIDDEN)
            return
        self.room = await join(self.kind, self.pk)
        self.group = group_name(self.kind, self.pk)
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.send(bytes_data=create_sync_message(self.room.doc))
        if (msg := self.room.awareness_message()) is not None:
            await self.send(bytes_data=msg)

    async def disconnect(self, code):
        room, self.room = self.room, None
        if room is None:
            return
        await self.channel_layer.group_discard(self.group, self.channel_name)
        gone = {cid: (room.awareness[cid][0] + 1, 'null') for cid in self.client_ids if cid in room.awareness}
        for cid in gone:
            room.awareness.pop(cid, None)
        if gone:
            await self._relay(encode_awareness(gone))
        await leave(room)

    async def receive(self, text_data=None, bytes_data=None):
        if not bytes_data or self.room is None:
            return
        try:
            await self._handle(bytes_data)
        except Exception:
            log.warning('공동 편집 메시지를 처리하지 못했습니다: %s/%s', self.kind, self.pk, exc_info=True)

    async def _handle(self, data: bytes):
        room = self.room
        kind = data[0]
        if kind == YMessageType.SYNC:
            sub = data[1]
            if sub == YSyncMessageType.SYNC_STEP1:
                await self.send(bytes_data=handle_sync_message(data[1:], room.doc))
            elif sub in (YSyncMessageType.SYNC_STEP2, YSyncMessageType.SYNC_UPDATE):
                update = read_message(data[2:])
                if update and update != b'\x00\x00':
                    room.doc.apply_update(update)
                    room.mark_dirty(self.user.pk)
                    await self._relay(create_update_message(update))
        elif kind == YMessageType.AWARENESS:
            for cid, clock, state in decode_awareness(read_message(data[1:])):
                self.client_ids.add(cid)
                if state == 'null':
                    room.awareness.pop(cid, None)
                else:
                    room.awareness[cid] = (clock, state)
            # 보낸 사람에게도 돌려준다: y-websocket 은 30초 동안 아무것도 못 받으면 다시 연결한다
            await self._relay(data, to_self=True)
        elif kind == MSG_QUERY_AWARENESS:
            if (msg := room.awareness_message()) is not None:
                await self.send(bytes_data=msg)

    async def _relay(self, data: bytes, to_self=False):
        """같은 방의 다른 사람들에게 (to_self 면 나에게도)."""
        await self.channel_layer.group_send(
            self.group, {'type': 'collab.relay', 'data': data, 'sender': None if to_self else self.channel_name})

    # ---- 채널 레이어 메시지

    async def collab_relay(self, event):
        if event['sender'] != self.channel_name:
            await self.send(bytes_data=event['data'])

    async def collab_comments(self, event):
        await self.send(bytes_data=write_var_uint(MSG_COMMENTS) + _var_string(json.dumps(event['payload'])))

    async def collab_recheck(self, event):
        """공유가 풀렸거나 파일이 지워졌으면 연결을 끊는다."""
        if not await database_sync_to_async(_allowed)(self.kind, self.pk, self.user):
            await self.close(code=CLOSE_FORBIDDEN)


# ---------------------------------------------------------------- REST 쪽에서 방에 알리기


def _group_send(kind, pk, message):
    layer = get_channel_layer()
    if layer is None:
        return
    try:
        async_to_sync(layer.group_send)(group_name(kind, pk), message)
    except Exception:
        log.warning('공동 편집 방에 알리지 못했습니다: %s/%s', kind, pk, exc_info=True)


def notify_comments(kind: str, pk: int, action: str, comment_id: int):
    _group_send(kind, pk, {'type': 'collab.comments',
                           'payload': {'type': 'comments', 'action': action, 'id': comment_id}})


def recheck_access(kind: str, pk: int):
    _group_send(kind, pk, {'type': 'collab.recheck'})
