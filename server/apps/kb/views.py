"""지식 베이스 API (화면용, 세션 로그인).

외부 에이전트용 주소(/api/kb/mcp, /api/kb/tools/, /api/kb/guide/, /api/kb/token/)는
다른 모듈과 함께 apps.agent 가 처리한다 (urls.py 참고).
"""
from pathlib import Path

from django.http import FileResponse
from django.views.decorators.clickjacking import xframe_options_sameorigin
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, authentication_classes
from rest_framework.response import Response

from apps.core.tokens import HashedTokenAuthentication

from .services import extract as ex
from .services.agent_tools import check_allowed
from .services.core import MAX_ATTACH_BYTES, MAX_UPLOAD_BYTES
from .services.runtime import allowed_roots, get_kb, inbox_dir, registry_for
from .services.textproc import has_morph


def guard(fn, *args, **kwargs):
    """서비스 예외를 HTTP 오류로 바꾼다."""
    try:
        return Response(fn(*args, **kwargs))
    except KeyError as e:
        return Response({'detail': str(e).strip("'")}, status=status.HTTP_404_NOT_FOUND)
    except (ValueError, PermissionError, FileNotFoundError) as e:
        return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)


def _user(request) -> str:
    return request.user.username


# ---------------------------------------------------------------- 상태 · 트리 · 문서
@api_view(['GET'])
def kb_status(request):
    kb = get_kb()
    return Response({**kb.stats(), 'allowed_roots': [str(r) for r in allowed_roots()],
                     'tools': len(registry_for(_user(request)).names()), 'morph': has_morph()})


@api_view(['POST'])
def kb_embed_retry(request):
    """임베딩 모델 불러오기를 다시 시도한다 (실패하면 서버를 다시 켤 때까지 키워드 검색만 쓰던 것을 화면에서 풀기)."""
    kb = get_kb()
    if hasattr(kb.embedder, 'start_loading'):
        kb.embedder.start_loading()
    return Response(kb.stats())


@api_view(['GET'])
def kb_tree(request):
    return Response(get_kb().tree())


@api_view(['GET'])
def kb_recent(request):
    return Response(get_kb().recent(int(request.query_params.get('limit', 8))))


@api_view(['GET'])
def kb_catalog(request):
    return Response(get_kb().catalog())


@api_view(['GET', 'DELETE'])
def kb_document(request, doc_id):
    kb = get_kb()
    if request.method == 'DELETE':
        return guard(kb.delete_document, doc_id)
    return guard(kb.document, doc_id)


RAW_MIME = {'pdf': 'application/pdf', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'csv': 'text/csv',
            'txt': 'text/plain', 'md': 'text/markdown'}


@xframe_options_sameorigin   # 문서 화면 안 미리보기(iframe)로 연다
@api_view(['GET'])
def kb_document_raw(request, doc_id):
    """가져온 문서(PDF·Word 등)의 원본 파일. PDF 는 화면 안에서 보이게(inline), 나머지는 내려받기."""
    from .models import KBDocument
    d = KBDocument.objects.filter(pk=doc_id).first()
    kb = get_kb()
    raw = Path(d.raw_path) if d and d.raw_path else None
    root = kb.raw_dir.resolve()
    if raw is None or not raw.is_file() or root not in raw.resolve().parents:
        return Response({'detail': '원본 파일이 없습니다.'}, status=404)
    ext = raw.suffix.lower().lstrip('.')
    name = d.title if d.title.lower().endswith('.' + ext) else f'{d.title}.{ext}'
    resp = FileResponse(raw.open('rb'), content_type=RAW_MIME.get(ext, 'application/octet-stream'),
                        as_attachment=ext != 'pdf' or request.query_params.get('download') == '1', filename=name)
    resp['X-Content-Type-Options'] = 'nosniff'
    resp['Cache-Control'] = 'private, max-age=300'
    return resp


@api_view(['PUT'])
def kb_document_content(request, doc_id):
    return guard(get_kb().update_content, doc_id, str(request.data.get('title', '')), str(request.data.get('body', '')))


@api_view(['POST'])
def kb_create_note(request):
    d = request.data
    return guard(get_kb().create_note, str(d.get('title', '')), str(d.get('body', '')), d.get('parent_id') or None,
                 'human', _user(request))


@api_view(['POST'])
def kb_move(request, doc_id):
    index = request.data.get('index')
    return guard(get_kb().move, doc_id, request.data.get('parent_id') or None,
                 None if index is None else int(index))


@api_view(['POST'])
def kb_tags(request, doc_id):
    kb = get_kb()

    def apply():
        kb.remove_tags(doc_id, list(request.data.get('remove', [])))
        return kb.add_tags(doc_id, list(request.data.get('add', [])))

    return guard(apply)


@api_view(['GET'])
def kb_related(request, doc_id):
    return guard(get_kb().related, doc_id)


@api_view(['POST'])
def kb_similar_draft(request):
    """저장 전 글과 비슷한 문서 (새 문서 중복 경고)."""
    d = request.data
    return guard(get_kb().similar_to_draft, str(d.get('title', '')), str(d.get('body', '')),
                 d.get('exclude') or None)


@api_view(['GET'])
def kb_local_graph(request, doc_id):
    depth = int(request.query_params.get('depth', 1))
    similar = request.query_params.get('similar', '1') != '0'
    return guard(get_kb().local_graph, doc_id, depth, similar)


@api_view(['GET'])
def kb_graph(request):
    similar = request.query_params.get('similar', '1') != '0'
    return Response(get_kb().graph(show_similar=similar))


@api_view(['POST'])
def kb_search(request):
    d = request.data
    mode = d.get('mode', 'hybrid')
    if mode not in ('hybrid', 'keyword', 'vector'):
        return Response({'detail': 'mode 는 hybrid, keyword, vector 중 하나입니다.'}, status=400)
    return Response(get_kb().search(str(d.get('query', '')), d.get('under') or None,
                                    min(int(d.get('limit', 8)), 30), mode))


# ---------------------------------------------------------------- 가져오기 · 첨부
@api_view(['POST'])
def kb_upload(request):
    """컴퓨터의 파일을 문서로 변환해 가져온다 (사이드바에 끌어다 놓기)."""
    kb, parent_id = get_kb(), request.data.get('parent_id') or None
    inbox = inbox_dir()
    inbox.mkdir(parents=True, exist_ok=True)
    results = []
    for f in request.FILES.getlist('files'):
        name = Path(f.name or 'upload').name
        if Path(name).suffix.lower() not in ex.SUPPORTED:
            results.append({'status': 'error', 'path': name,
                            'error': f"지원하지 않는 형식입니다. 가능: {', '.join(sorted(ex.SUPPORTED))}"})
            continue
        if f.size > MAX_UPLOAD_BYTES:
            results.append({'status': 'error', 'path': name,
                            'error': f'파일이 너무 큽니다. {MAX_UPLOAD_BYTES // 1024 // 1024}MB까지 가져올 수 있습니다.'})
            continue
        dest = inbox / name  # 같은 이름으로 다시 올리면 같은 원본의 새 버전이 된다
        with dest.open('wb') as out:
            for part in f.chunks():
                out.write(part)
        try:
            results.append(kb.ingest_file(dest, parent_id, 'human', _user(request)))
        except Exception as e:
            results.append({'status': 'error', 'path': name, 'error': str(e)})
    return Response(results)


@api_view(['POST'])
def kb_ingest(request):
    kb = get_kb()
    return guard(lambda: kb.ingest_path(check_allowed(str(request.data.get('path', '')), allowed_roots()),
                                        request.data.get('parent_id') or None, 'human', _user(request)))


# 첨부 올리기·내려받기는 화면 로그인과 API 토큰(외부 에이전트) 둘 다 받는다. 권한은 토큰 주인 계정 그대로
TOKEN_OR_SESSION = [HashedTokenAuthentication, SessionAuthentication]


@api_view(['POST'])
@authentication_classes(TOKEN_OR_SESSION)
def kb_upload_attachments(request):
    kb, out = get_kb(), []
    for f in request.FILES.getlist('files'):
        if f.size > MAX_ATTACH_BYTES:  # 다 읽기 전에 크기부터 본다 (큰 파일을 메모리에 올리지 않게)
            out.append({'name': f.name, 'error': f'파일이 너무 큽니다 ({f.size // 1024 // 1024}MB). '
                                                 f'{MAX_ATTACH_BYTES // 1024 // 1024}MB까지 첨부할 수 있습니다.'})
            continue
        try:
            out.append(kb.save_attachment(f.name, f.read()))
        except ValueError as e:
            out.append({'name': f.name, 'error': str(e)})
    return Response(out)


@api_view(['GET'])
@authentication_classes(TOKEN_OR_SESSION)
def kb_attachment(request, h, name):
    try:
        path, mime = get_kb().attachment_path(h, name)
    except KeyError as e:
        return Response({'detail': str(e).strip("'")}, status=404)
    inline = mime.startswith('image/') or mime == 'application/pdf'  # 그 외 형식은 내려받기로
    resp = FileResponse(path.open('rb'), content_type=mime, as_attachment=not inline, filename=path.name)
    resp['X-Content-Type-Options'] = 'nosniff'
    resp['Cache-Control'] = 'private, max-age=31536000, immutable'
    return resp


# ---------------------------------------------------------------- 위키 · 용어집
@api_view(['GET'])
def kb_wiki(request):
    return Response(get_kb().pending_wiki(request.query_params.get('status', 'proposed')))


@api_view(['POST'])
def kb_wiki_review(request, doc_id):
    return guard(get_kb().review_wiki, doc_id, bool(request.data.get('approve')))


@api_view(['GET', 'POST'])
def kb_glossary(request):
    kb = get_kb()
    if request.method == 'POST':
        d = request.data
        return guard(kb.add_glossary, str(d.get('term', '')), list(d.get('synonyms', [])), str(d.get('definition', '')))
    return Response(kb.glossary())
