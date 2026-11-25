"""문서·슬라이드의 JSON 모양과 기본 템플릿.

편집기(프론트)가 지켜야 할 약속이다. 서버는 내용을 해석하지 않고 그대로 저장한다.

## 1. 실시간 공동 편집 (Yjs)

- 주소: ws(s)://<host>/ws/collab/doc/<id>   (슬라이드도 'doc')
  y-websocket 으로는 `new WebsocketProvider(`${origin}/ws/collab`, `doc/12`, ydoc)`.
- 서버는 방마다 Y.Doc 하나를 메모리에 두고, 몇 초마다(그리고 마지막 사람이 나갈 때)
  CollabState 에 저장한다. 다음에 열면 그 상태로 시작한다.
- 권장 Y 구조 (편집기마다 하나로 정해 지킨다):
    문서(doc)      : ydoc.getXmlFragment('default')      ← TipTap Collaboration 기본값
    슬라이드(slides): ydoc.getArray('slides') 등 슬라이드 편집기가 정한다
- 첫 불러오기: 서버의 Yjs 상태가 비어 있으면 (`has_ystate: false`) 편집기가 snapshot
  을 Yjs 로 옮긴다. 여럿이 동시에 열어도 겹치지 않게 clientID 0 으로 같은 내용을 만들어 한 번만 들어가게 한다.
- 편집기는 몇 초~수십 초마다 보통 JSON 사본을 REST 로 보낸다:
    문서·슬라이드 PATCH /api/docs/<id>/ {snapshot, thumbnail}
- 댓글이 바뀌면 서버가 같은 방에 메시지 종류 100 으로 JSON 을 보낸다:
    {"type": "comments", "action": "created|updated|deleted", "id": 3}
  받으면 댓글 목록을 다시 불러오면 된다.

## 2. snapshot / 템플릿 content 모양

### 문서 (kind='doc') — TipTap(ProseMirror) JSON
    {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "제목"}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "본문"}]},
        {"type": "bulletList", "content": [
            {"type": "listItem", "content": [{"type": "paragraph"}]}]},
        {"type": "taskList", "content": [
            {"type": "taskItem", "attrs": {"checked": false}, "content": [{"type": "paragraph"}]}]}
    ]}
  StarterKit 노드(heading, paragraph, bulletList, orderedList, listItem, blockquote, codeBlock,
  horizontalRule, hardBreak)와 taskList/taskItem, table 계열을 쓸 수 있다고 본다.
  차트 블록: {"type": "chartBlock", "attrs": {"chart": "<JSON 글>"}} — 글 안은
  {"chart": {type, encoding, ...}, "data": {columns, rows}, "title"}.

### 슬라이드 (kind='slides')
    {"version": 1,
     "size": {"width": 1280, "height": 720},
     "slides": [
        {"id": "s1", "background": "#ffffff", "notes": "",
         "elements": [
            {"id": "e1", "type": "text", "role": "title",
             "x": 80, "y": 260, "width": 1120, "height": 120,
             "text": "제목", "fontSize": 56, "bold": true, "align": "center", "color": "#111827"},
            {"id": "e2", "type": "text", "role": "body", ...},
            {"id": "e3", "type": "image", "x": ..., "assetId": 4, "src": "/api/doc-assets/4/file/"},
            {"id": "e4", "type": "shape", "shape": "rect", "fill": "#2563eb", ...}
         ]}
     ]}
  좌표는 슬라이드 왼쪽 위 기준 px. text 의 줄바꿈은 '\\n'. role 은 title | body | free.

## 3. 댓글 anchor 모양
    문서         : {"mark": "<댓글 마크 id>"} 또는 {"relpos": <Y.relativePositionToJSON>, "quote": "..."}
    슬라이드      : {"page": "<slide id>", "x": 120, "y": 80, "node": "<노드 id, 없어도 됨>"}
"""


def _text(t):
    return [{'type': 'text', 'text': t}] if t else []


def _h(level, t):
    return {'type': 'heading', 'attrs': {'level': level}, 'content': _text(t)}


def _p(t=''):
    node = {'type': 'paragraph'}
    if t:
        node['content'] = _text(t)
    return node


def _bullets(*items):
    return {'type': 'bulletList', 'content': [{'type': 'listItem', 'content': [_p(i)]} for i in items]}


def _tasks(*items):
    return {'type': 'taskList', 'content': [
        {'type': 'taskItem', 'attrs': {'checked': False}, 'content': [_p(i)]} for i in items]}


def _doc(*blocks):
    return {'type': 'doc', 'content': list(blocks)}


# ---- 표가 들어간 양식용 (문서 폭 약 660px 기준 colwidth)
# 표 색: 진한 녹색 제목 띠(흰 글자), 녹색 머리글 줄, 연녹색 항목 칸
DARK = '#34584a'      # 제목 띠·표 머리글(제목 띠가 없을 때)
HEAD_BG = '#dce7e0'   # 머리글 줄·합계 줄
LABEL_BG = '#edf2ee'  # 항목 이름 칸
WHITE = '#ffffff'


def _t(text, bold=False, color=None, size=None):
    """글 조각: 굵게·글자색·글자 크기(pt)"""
    if not text:
        return []
    marks = []
    if bold:
        marks.append({'type': 'bold'})
    style = {}
    if color:
        style['color'] = color
    if size:
        style['fontSize'] = f'{size}pt'
    if style:
        marks.append({'type': 'textStyle', 'attrs': style})
    node = {'type': 'text', 'text': text}
    if marks:
        node['marks'] = marks
    return [node]


def _para(*parts, align=None):
    """여러 글 조각으로 된 문단. parts 는 글(그냥) 또는 _t() 결과"""
    content = []
    for part in parts:
        content += _text(part) if isinstance(part, str) else part
    node = {'type': 'paragraph'}
    if align:
        node['attrs'] = {'textAlign': align}
    if content:
        node['content'] = content
    return node


def _cell(text='', header=False, width=None, bg=None, bold=False, align=None, colspan=1, rowspan=1,
          color=None, borderless=False, paras=None, size=None):
    """표 칸. text 의 줄바꿈은 문단으로 나눈다. paras 를 주면 그 문단들을 그대로 넣는다.
    width 는 colspan 만큼의 너비 목록도 받는다"""
    if paras is None:
        lines = text.split('\n') if isinstance(text, str) else [text]
        paras = [_para(_t(line, bold=bold or header, color=color, size=size) if isinstance(line, str) else line, align=align)
                 for line in lines]
    # 문서 글 폭(약 657px)보다 넓으면 오른쪽 테두리가 잘린다: 합이 660 인 너비를 640 안에 들게 줄인다
    ws = width if isinstance(width, (list, tuple)) else ([width] * colspan if width else None)
    attrs = {'colspan': colspan, 'rowspan': rowspan, 'colwidth': [round(w * 0.97) for w in ws] if ws else None}
    if bg:
        attrs['backgroundColor'] = bg
    if borderless:
        attrs['borderless'] = True
    return {'type': 'tableHeader' if header else 'tableCell', 'attrs': attrs, 'content': paras}


def _row(*cells):
    return {'type': 'tableRow', 'content': list(cells)}


def _bar_row(title, widths, size=None):
    """표 맨 위의 진한 녹색 제목 띠 (흰 굵은 글자)"""
    return _row(_cell(title, header=True, width=list(widths), colspan=len(widths), bg=DARK, color=WHITE, size=size))


def _table(widths, head=None, rows=(), total=None, label_col=False, aligns=None, title=None, size=None):
    """표: title(제목 띠) · head(머리글 줄) · rows · total(합계 줄). label_col 이면 첫 열을 항목 이름 칸으로.
    제목 띠가 있으면 머리글 줄은 녹색, 없으면 진한 녹색에 흰 글자. aligns 는 열마다 'left'|'center'|'right'."""
    aligns = aligns or [None] * len(widths)
    out = [_bar_row(title, widths, size)] if title else []
    if head:
        hb, hc = (HEAD_BG, None) if title else (DARK, WHITE)
        out.append(_row(*[_cell(h, header=True, width=w, bg=hb, color=hc, align='center', size=size) for h, w in zip(head, widths)]))
    for r in rows:
        cells = []
        for i, (v, w) in enumerate(zip(r, widths)):
            if label_col and i == 0:
                cells.append(_cell(v, header=True, width=w, bg=LABEL_BG, align='center', size=size))
            else:
                cells.append(_cell(v, width=w, align=aligns[i], size=size))
        out.append(_row(*cells))
    if total:
        # None 칸은 앞 칸에 합친다 (합계 글자를 여러 열에 걸쳐 쓸 때)
        cells, i = [], 0
        while i < len(widths):
            j = i + 1
            while j < len(widths) and total[j] is None:
                j += 1
            cells.append(_cell(total[i], header=True, width=list(widths[i:j]), colspan=j - i, bg=HEAD_BG,
                               align=aligns[i] or 'center', size=size))
            i = j
        out.append(_row(*cells))
    return {'type': 'table', 'content': out}


def _kv(rows, widths=None, title=None):
    """항목 이름 · 내용 표 (머리 정보용). rows: [(이름, 내용)] 또는 [(이름, 내용, 이름, 내용)]"""
    four = bool(rows) and len(rows[0]) == 4
    widths = widths or ((110, 220, 110, 220) if four else (140, 520))
    out = [_bar_row(title, widths)] if title else []
    for r in rows:
        cells = []
        for i, v in enumerate(r):
            cells.append(_cell(v, header=True, width=widths[i], bg=LABEL_BG, align='center') if i % 2 == 0
                         else _cell(v, width=widths[i]))
        out.append(_row(*cells))
    return {'type': 'table', 'content': out}


def _list_box(title, items, numbered=True, size=None):
    """제목 띠 아래에 한 줄씩 칸으로 된 목록 (특기사항·안건·결정 사항)"""
    w = [660]
    rows = [_row(_cell(f'{i}. {t}' if numbered else t, width=w, size=size)) for i, t in enumerate(items, 1)]
    return {'type': 'table', 'content': [_bar_row(title, w, size), *rows]}


def _box(text, title=None, size=None):
    """연녹색 안내 칸 (한 칸 표)"""
    w = [660]
    out = [_bar_row(title, w, size)] if title else []
    out.append(_row(_cell(text, width=w, bg=LABEL_BG, size=size)))
    return {'type': 'table', 'content': out}


def _ipara(*parts, indent=1):
    """들여 쓴 문단 (계약서 하위 항목)"""
    node = _para(*parts)
    node['attrs'] = {**node.get('attrs', {}), 'indent': indent}
    return node


def _ol(*items):
    return {'type': 'orderedList', 'attrs': {'start': 1}, 'content': [{'type': 'listItem', 'content': [_p(i)]} for i in items]}


def _note(*lines):
    """안내 상자 (인용)"""
    return {'type': 'blockquote', 'content': [_p(line) for line in lines]}


def _hr():
    return {'type': 'horizontalRule'}


GRAY = '#64748b'


def _tbox(eid, role, x, y, w, h, text, size, bold=False, align='left', color='#111827'):
    return {'id': eid, 'type': 'text', 'role': role, 'x': x, 'y': y, 'width': w, 'height': h,
            'text': text, 'fontSize': size, 'bold': bold, 'align': align, 'color': color}


def _slide(sid, *elements, background='#ffffff'):
    return {'id': sid, 'background': background, 'notes': '', 'elements': list(elements)}


def _deck(*slides):
    return {'version': 1, 'size': {'width': 1280, 'height': 720}, 'slides': list(slides)}


BUILTIN_TEMPLATES = [
    {
        'kind': 'doc', 'name': '빈 문서', 'description': '아무것도 없는 문서',
        'content': _doc(_p()),
    },
    {
        'kind': 'doc', 'name': '회의록', 'description': '회의 정보·안건·논의·결정·할 일 표',
        'content': _doc(
            _h(1, '회의록'),
            _para(_t('회의가 끝나면 결정 사항과 할 일부터 채웁니다.', color=GRAY)),
            _kv([('일시', '2026년  월  일 (  )  :  ~  :', '장소', ''),
                 ('참석자', '', '작성자', ''),
                 ('회의 종류', '정기 · 수시 · 고객 미팅', '관련 프로젝트', '')], title='회의 정보'),
            _list_box('안건', ['', '']),
            _table([150, 330, 180], head=['안건', '논의 내용', '결론'], rows=[['', '', ''], ['', '', '']],
                   label_col=True, title='논의 내용'),
            _list_box('결정 사항', ['', '']),
            _table([40, 300, 110, 110, 100], head=['No', '할 일', '담당', '기한', '상태'],
                   rows=[['1', '', '', '', '예정'], ['2', '', '', '', '예정'], ['3', '', '', '', '예정']],
                   aligns=['center', None, 'center', 'center', 'center'], title='할 일'),
            _kv([('일시', ''), ('안건(예정)', '')], title='다음 회의'),
        ),
    },
    {
        'kind': 'doc', 'name': '기획서', 'description': '개요·배경·목표·범위·기능·일정·예산·위험 표',
        'content': _doc(
            _h(1, '프로젝트 기획서'),
            _para(_t('작성일 2026.  .  .   |   작성자   |   버전 v1.0', color=GRAY)),
            _kv([('프로젝트명', '', '발주처', ''),
                 ('수행 기간', '2026.  .  . ~   .  .  (  주)', '예산', '₩            (VAT 별도)'),
                 ('담당 (PM)', '', '결과물', '')], title='1. 프로젝트 개요'),
            _kv([('배경', '왜 이 일을 하게 되었는지 적습니다.'), ('목적', '이 일이 끝나면 무엇이 달라지는지 적습니다.')],
                title='2. 배경과 목적'),
            _table([200, 280, 180], head=['목표', '측정 기준', '목표값'], rows=[['', '', ''], ['', '', '']], title='3. 목표'),
            _table([110, 275, 275], head=['구분', '포함', '제외'],
                   rows=[['기능', '', ''], ['콘텐츠', '', ''], ['운영·지원', '', '']], label_col=True, title='4. 범위'),
            _table([40, 150, 370, 100], head=['No', '기능', '설명', '우선순위'],
                   rows=[['1', '', '', '필수'], ['2', '', '', '필수'], ['3', '', '', '선택']],
                   aligns=['center', None, None, 'center'], title='5. 주요 기능'),
            _table([110, 150, 250, 150], head=['단계', '기간', '하는 일', '산출물'],
                   rows=[['기획', '', '요구사항 정리 · 화면 설계', '기획서 · 화면 설계서'],
                         ['디자인', '', '시안 · 확정', '디자인 시안'],
                         ['개발', '', '기능 구현 · 중간 공유', '중간 빌드'],
                         ['검수·납품', '', '테스트 · 수정 · 납품', '최종 결과물']], label_col=True, title='6. 일정'),
            _table([200, 160, 300], head=['항목', '금액 (원)', '비고'],
                   rows=[['기획', '', ''], ['디자인', '', ''], ['개발', '', ''], ['검수·운영', '', '']],
                   total=['합계', '', 'VAT 별도'], label_col=True, aligns=[None, 'right', None], title='7. 예산'),
            _table([220, 120, 320], head=['위험 요소', '영향', '대응'],
                   rows=[['', '높음 · 보통 · 낮음', ''], ['', '', '']], aligns=[None, 'center', None], title='8. 위험 요소와 대응'),
            _table([220, 220, 220], head=['작성', '검토', '승인'], rows=[['\n\n', '\n\n', '\n\n']],
                   aligns=['center'] * 3, title='9. 확인'),
        ),
    },
    {
        'kind': 'doc', 'name': '주간 보고', 'description': '한 줄 요약·지난주 한 일·이번 주 할 일·지표·이슈 표',
        'content': _doc(
            _h(1, '주간 보고'),
            _kv([('기간', '2026.  .  .(월) ~   .  .(금)', '작성자', ''),
                 ('부서 · 프로젝트', '', '보고 대상', '')]),
            _box('가장 중요한 결과와 다음 주 핵심을 한두 줄로 적습니다.', title='이번 주 한 줄 요약'),
            _table([200, 90, 370], head=['업무', '진행률', '결과 · 산출물'],
                   rows=[['', '100%', ''], ['', '  %', ''], ['', '  %', '']], aligns=[None, 'center', None], title='1. 지난주 한 일'),
            _table([260, 120, 120, 160], head=['업무', '담당', '기한', '목표'],
                   rows=[['', '', '', ''], ['', '', '', ''], ['', '', '', '']], aligns=[None, 'center', 'center', None],
                   title='2. 이번 주 할 일'),
            _table([200, 140, 140, 180], head=['항목', '지난주', '이번 주', '변화'],
                   rows=[['매출 · 수주', '', '', ''], ['문의 · 영업 건', '', '', ''], ['진행 프로젝트', '', '', '']],
                   label_col=True, aligns=[None, 'right', 'right', 'center'], title='3. 주요 지표'),
            _table([220, 140, 300], head=['이슈', '영향', '필요한 도움'], rows=[['', '', ''], ['', '', '']],
                   aligns=[None, 'center', None], title='4. 이슈 · 도움 필요'),
        ),
    },
    {
        'kind': 'slides', 'name': '기본', 'description': '제목 슬라이드 하나',
        'content': _deck(
            _slide('s1',
                   _tbox('e1', 'title', 80, 250, 1120, 120, '제목을 입력하세요', 56, True, 'center'),
                   _tbox('e2', 'body', 80, 390, 1120, 60, '부제목', 28, False, 'center', '#6b7280')),
        ),
    },
    {
        'kind': 'slides', 'name': '발표', 'description': '표지·목차·본문·마무리',
        'content': _deck(
            _slide('s1',
                   _tbox('e1', 'title', 80, 240, 1120, 120, '발표 제목', 60, True, 'center', '#ffffff'),
                   _tbox('e2', 'body', 80, 380, 1120, 60, '발표자 · 날짜', 26, False, 'center', '#dbeafe'),
                   background='#1e3a8a'),
            _slide('s2',
                   _tbox('e1', 'title', 80, 60, 1120, 90, '목차', 44, True),
                   _tbox('e2', 'body', 80, 180, 1120, 460, '1. 배경\n2. 내용\n3. 정리', 30)),
            _slide('s3',
                   _tbox('e1', 'title', 80, 60, 1120, 90, '본문 제목', 44, True),
                   _tbox('e2', 'body', 80, 180, 1120, 460, '• 핵심 내용\n• 근거\n• 예시', 30)),
            _slide('s4',
                   _tbox('e1', 'title', 80, 270, 1120, 120, '감사합니다', 56, True, 'center')),
        ),
    },
]
