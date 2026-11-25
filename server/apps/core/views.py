"""로그인·로그아웃·내 정보·CSRF·사용자 목록 (화면 공통). 주소와 응답 모양은 원래 화면과 같다."""
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import lockout
from .models import AuthEvent, role_of, set_role
from .system_users import humans


@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    # 아이디·IP 마다 실패를 세어 잠근다 (apps.core.lockout). 오류 글은 아이디가 있는지 드러내지 않는다.
    username = request.data.get('username')
    password = request.data.get('password')
    username = username if isinstance(username, str) else ''
    if lockout.guard(request, username, AuthEvent.Source.APP):
        return Response({'detail': lockout.LOCKED_MESSAGE}, status=status.HTTP_429_TOO_MANY_REQUESTS,
                        headers={'Retry-After': str(int(lockout.lock_time().total_seconds()))})
    user = None
    if username and isinstance(password, str) and password:
        user = authenticate(request, username=username, password=password)
    if user is None:
        lockout.failed(request, username, AuthEvent.Source.APP)
        return Response({'detail': lockout.GENERIC_FAIL}, status=status.HTTP_400_BAD_REQUEST)
    login(request, user)
    lockout.succeeded(request, user.get_username(), AuthEvent.Source.APP)
    # 로그인 시 Django 가 CSRF 토큰을 회전시키므로 새 토큰을 본문으로 내려준다.
    # (화면과 도메인이 다르면 쿠키를 JS 에서 읽을 수 없어 본문 전달이 필요)
    return Response({
        'username': user.username,
        'is_staff': user.is_staff,
        'csrftoken': get_token(request),
    })


@api_view(['POST'])
def logout_view(request):
    logout(request)
    # 로그아웃한 사람(익명)에게는 토큰을 본문으로 주지 않는다 (다음 로그인 응답이 새 토큰을 준다)
    return Response({'ok': True})


@ensure_csrf_cookie
@api_view(['GET'])
@permission_classes([AllowAny])
def me_view(request):
    # CSRF 토큰은 로그인한 사람에게만 본문으로 준다. 로그인 전에는 쿠키(csrftoken)만 심는다
    # (로그인 요청은 익명이라 DRF 가 CSRF 를 보지 않고, 로그인 응답이 새 토큰을 준다).
    if not request.user.is_authenticated:
        return Response({'username': None, 'is_staff': False})
    return Response({
        'username': request.user.username,
        'is_staff': request.user.is_staff,
        'csrftoken': get_token(request),
    })


@ensure_csrf_cookie
@api_view(['GET'])
@permission_classes([AllowAny])
def csrf_view(request):
    """CSRF 쿠키만 심는다 (본문은 비움). 화면이 처음 열릴 때 /auth/me/ 대신 써도 된다."""
    return Response({'ok': True})


@api_view(['GET', 'PATCH'])
def users_view(request):
    """등록된 사용자 목록 (담당자/오너 선택 드롭다운용). 이름 옆에 보일 역할(role)을 함께 준다.
    PATCH {id, role}: 관리자(스태프)가 다른 사람의 역할을 고친다 (본인 것은 /auth/profile/ 에서)."""
    User = get_user_model()
    if request.method == 'PATCH':
        target = humans(User.objects.filter(is_active=True)).filter(pk=request.data.get('id')).first() \
            if str(request.data.get('id', '')).isdigit() else None
        if target is None:
            return Response({'detail': '사용자를 찾을 수 없습니다.'}, status=status.HTTP_404_NOT_FOUND)
        if target != request.user and not request.user.is_staff:
            return Response({'detail': '다른 사람의 역할은 관리자만 고칠 수 있습니다.'}, status=status.HTTP_403_FORBIDDEN)
        role = set_role(target, request.data.get('role'), request.user)
        return Response({'id': target.id, 'username': target.username, 'nickname': target.first_name, 'role': role})
    users = humans(User.objects.filter(is_active=True)).select_related('member_role').order_by('username')
    return Response([
        {'id': u.id, 'username': u.username, 'nickname': u.first_name, 'role': role_of(u)}
        for u in users
    ])


@api_view(['GET', 'PATCH'])
def profile_view(request):
    user = request.user
    if request.method == 'PATCH':
        # 닉네임은 User.first_name 필드에 저장한다
        if 'nickname' in request.data:
            user.first_name = str(request.data['nickname']).strip()[:150]
            user.save(update_fields=['first_name'])
        if 'role' in request.data:
            set_role(user, request.data['role'], user)
    return Response({
        'role': role_of(user),
        'username': user.username,
        'nickname': user.first_name,
        'date_joined': user.date_joined,
        'last_login': user.last_login,
        'is_staff': user.is_staff,
    })
