"""MCP(Model Context Protocol) 서버 — Streamable HTTP, 상태 없는(stateless) JSON 응답 방식.

Django 서버 안에서 바로 동작하도록 JSON-RPC 메시지를 직접 처리한다.
모듈(등록된 앱마다, 또는 통합)마다 도구 레지스트리와 사용 지침이 다르다.
지원: initialize · notifications/* · ping · tools/list · tools/call (일괄 요청 포함)
"""
from .tools import ToolRegistry

SUPPORTED_VERSIONS = ('2025-06-18', '2025-03-26', '2024-11-05')


def _error(msg_id, code: int, message: str) -> dict:
    return {'jsonrpc': '2.0', 'id': msg_id, 'error': {'code': code, 'message': message}}


def handle_message(message, registry: ToolRegistry, instructions: str, server_info: dict) -> dict | None:
    """JSON-RPC 메시지 하나를 처리한다. 알림(id 없음)과 응답 메시지면 None."""
    if not isinstance(message, dict) or message.get('jsonrpc') != '2.0':
        return _error(message.get('id') if isinstance(message, dict) else None, -32600, 'Invalid Request')
    method, msg_id = message.get('method'), message.get('id')
    if method is None or 'id' not in message:  # 알림 또는 클라이언트가 보낸 응답
        return None
    params = message.get('params') or {}

    if method == 'initialize':
        requested = params.get('protocolVersion')
        result = {
            'protocolVersion': requested if requested in SUPPORTED_VERSIONS else SUPPORTED_VERSIONS[0],
            'capabilities': {'tools': {'listChanged': False}},
            'serverInfo': server_info,
            'instructions': instructions,
        }
    elif method == 'ping':
        result = {}
    elif method == 'tools/list':
        result = {'tools': [
            {'name': d['name'], 'description': d['description'], 'inputSchema': d['parameters']}
            for d in registry.definitions()
        ]}
    elif method == 'tools/call':
        name = params.get('name')
        if not isinstance(name, str):
            return _error(msg_id, -32602, 'params.name 이 필요합니다.')
        # 레지스트리를 거치면 인자 검증과 '오류 → 고칠 방법' 안내 문구가 HTTP API 와 똑같이 동작한다
        text = registry.call(name, params.get('arguments') or {})
        result = {'content': [{'type': 'text', 'text': text}], 'isError': text.startswith('오류')}
    else:
        return _error(msg_id, -32601, f'Method not found: {method}')
    return {'jsonrpc': '2.0', 'id': msg_id, 'result': result}


def handle_payload(payload, registry: ToolRegistry, instructions: str, server_info: dict):
    """요청 본문 전체(메시지 하나 또는 배열). 돌려줄 응답이 없으면 None."""
    if isinstance(payload, list):
        if not payload:
            return _error(None, -32600, 'Invalid Request')
        out = [r for r in (handle_message(m, registry, instructions, server_info) for m in payload) if r is not None]
        return out or None
    return handle_message(payload, registry, instructions, server_info)
