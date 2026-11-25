"""외부 에이전트 API.

- 모듈 목록: /api/agent/modules/            (화면의 'API 연동' 페이지용)
- API 토큰: /api/agent/token/               (지식 베이스의 /api/kb/token/ 과 같다)
- 모듈별:   /api/agent/<모듈>/mcp · tools/ · tools/<이름>/ · guide/
  모듈은 all(통합)과 각 앱이 등록한 것 (apps.agent.modules.register). 지식 베이스는 /api/kb/… 로도 된다.
에이전트는 API 토큰(Authorization: Token <키>)으로 인증한다. 토큰은 해시만 저장하고 만료가 있다 (apps.core.tokens).
"""
import json

from django.conf import settings
from django.http import Http404, HttpResponse, JsonResponse
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, authentication_classes
from rest_framework.negotiation import DefaultContentNegotiation
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core import lockout, tokens
from apps.core.models import AuthEvent
from apps.core.tokens import HashedTokenAuthentication

from . import mcp, modules
from .modules import Module, registry

# 외부 에이전트 엔드포인트는 토큰을 먼저 본다 (인증 실패 시 401 + WWW-Authenticate: Token)
AGENT_AUTH = [HashedTokenAuthentication, SessionAuthentication]


def _module(key: str) -> Module:
    m = modules.get(key)
    if m is None:
        raise Http404(f"'{key}' 모듈이 없습니다. 가능한 모듈: {', '.join(modules.order())}")
    return m


# ---------------------------------------------------------------- 화면용
@api_view(['GET'])
def module_list(request):
    out = []
    for key in modules.order():
        m = modules.get(key)
        defs = registry(key, request.user).names()
        read_only = m.read_only()
        out.append({
            'key': key, 'title': m.title, 'description': m.description, 'server_name': m.server_name,
            'paths': m.paths(), 'tool_count': len(defs), 'read_only_count': len([n for n in defs if n in read_only]),
            'stats': m.stats(),
        })
    return Response(out)


@api_view(['GET', 'POST', 'DELETE'])
def token(request):
    """내 API 토큰. 모든 모듈에 같은 토큰을 쓴다.

    GET: 있는지·앞 6자리·만든 때·만료·마지막 사용 (키 자체는 저장하지 않아 다시 보여 줄 수 없다 — key 는 늘 null).
    POST: 새로 발급 (기존 토큰은 무효). 비밀번호를 다시 받는다(password). 키는 이 응답에서 한 번만 준다.
    DELETE: 폐기.
    """
    if request.method == 'POST':
        pw = request.data.get('password') if hasattr(request.data, 'get') else None
        name = request.user.get_username()
        if lockout.guard(request, name, AuthEvent.Source.APP):
            return Response({'detail': lockout.LOCKED_MESSAGE}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        if not isinstance(pw, str) or not pw or not request.user.check_password(pw):
            lockout.failed(request, name, AuthEvent.Source.APP)
            return Response({'detail': '비밀번호가 맞지 않습니다.', 'code': 'password'}, status=status.HTTP_400_BAD_REQUEST)
        key, _ = tokens.issue(request.user)
        return Response({**tokens.info(request.user), 'key': key}, status=status.HTTP_201_CREATED)
    if request.method == 'DELETE':
        tokens.revoke(request.user)
        return Response({'key': None, 'exists': False})
    return Response(tokens.info(request.user))


# ---------------------------------------------------------------- 외부 에이전트 (HTTP 도구 API · MCP)
@api_view(['GET'])
@authentication_classes(AGENT_AUTH)
def guide(request, module):
    return HttpResponse(_module(module).guide(), content_type='text/plain; charset=utf-8')


class JSONOnlyNegotiation(DefaultContentNegotiation):
    """?format= 을 DRF 렌더러 선택이 아니라 도구 목록 형식(anthropic/openai)으로 쓰기 위해 항상 JSON 으로 답한다."""

    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type


class ToolListView(APIView):
    """도구 목록과 JSON 스키마. format=anthropic | openai 로 받으면 각 API의 tools 인자에 그대로 넣을 수 있다."""

    authentication_classes = AGENT_AUTH
    content_negotiation_class = JSONOnlyNegotiation

    def get(self, request, module):
        m = _module(module)
        defs = registry(module, request.user).definitions()
        fmt = request.query_params.get('format', 'plain')
        if fmt == 'anthropic':
            return Response([{'name': d['name'], 'description': d['description'], 'input_schema': d['parameters']}
                             for d in defs])
        if fmt == 'openai':
            return Response([{'type': 'function', 'function': d} for d in defs])
        if fmt != 'plain':
            return Response({'detail': 'format 은 plain, anthropic, openai 중 하나입니다.'}, status=400)
        read_only = m.read_only()
        return Response([{**d, 'read_only': d['name'] in read_only} for d in defs])


@api_view(['POST'])
@authentication_classes(AGENT_AUTH)
def tool_call(request, module, name):
    """도구 실행. 오류도 에이전트가 읽고 고칠 수 있는 문장으로 돌려준다 (ok=false)."""
    _module(module)
    args = request.data if isinstance(request.data, dict) else {}
    text = registry(module, request.user).call(name, dict(args))
    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        result = text
    return Response({'ok': not (isinstance(result, str) and result.startswith('오류')), 'result': result})


class MCPView(APIView):
    """MCP Streamable HTTP 엔드포인트. POST 로 JSON-RPC 를 받고 JSON 으로 답한다 (SSE 스트림은 쓰지 않는다)."""

    authentication_classes = AGENT_AUTH

    def post(self, request, module):
        m = _module(module)
        try:
            payload = json.loads(request.body or b'null')
        except json.JSONDecodeError:
            return JsonResponse(mcp._error(None, -32700, 'Parse error'), status=400)
        server_info = {'name': m.server_name, 'title': f'{settings.PIKO_SITE_NAME} · {m.title}', 'version': '0.3'}
        out = mcp.handle_payload(payload, registry(module, request.user), m.guide(), server_info)
        if out is None:
            return HttpResponse(status=202)
        return JsonResponse(out, safe=False, json_dumps_params={'ensure_ascii': False})

    def get(self, request, module):
        # 서버가 먼저 보내는 알림 스트림(SSE)은 제공하지 않는다
        resp = HttpResponse(status=405)
        resp['Allow'] = 'POST'
        return resp

    def delete(self, request, module):
        return HttpResponse(status=405)
