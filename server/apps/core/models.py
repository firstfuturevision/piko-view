from django.conf import settings
from django.db import models


class LoginLock(models.Model):
    """로그인 실패 수와 잠금 (키 하나에 한 줄). 'u:<아이디>' 또는 'ip:<IP>'. 재시작해도 남게 DB 에 둔다."""

    key = models.CharField(max_length=200, unique=True)
    failures = models.PositiveIntegerField(default=0)
    window_start = models.DateTimeField()
    locked_until = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = '로그인 잠금'
        verbose_name_plural = '로그인 잠금'

    def __str__(self):
        return self.key


class AuthEvent(models.Model):
    """로그인 시도 기록 (실패·잠김·성공). 화면·관리자 로그인 모두. 비밀번호는 남기지 않는다."""

    class Result(models.TextChoices):
        OK = 'ok', '성공'
        FAIL = 'fail', '실패'
        LOCKED = 'locked', '잠겨서 거부'

    class Source(models.TextChoices):
        APP = 'app', '화면 로그인'
        ADMIN = 'admin', '관리자(/admin/) 로그인'

    username = models.CharField(max_length=150, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    result = models.CharField(max_length=8, choices=Result.choices)
    source = models.CharField(max_length=8, choices=Source.choices)
    user_agent = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at', '-id']
        verbose_name = '로그인 기록'
        verbose_name_plural = '로그인 기록'

    def __str__(self):
        return f'{self.username} {self.result}'


class ApiToken(models.Model):
    """외부 에이전트용 API 토큰. 키 자체는 저장하지 않고 SHA-256 해시만 둔다.

    사람마다 개인 토큰 하나(label 빈칸)와, 이름(label)을 붙인 토큰을 따로 가질 수 있다.
    키는 만들 때 한 번만 보여 준다.
    """

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='api_tokens')
    label = models.CharField(max_length=60, blank=True, default='')
    key_hash = models.CharField(max_length=64, unique=True)
    # 화면에서 어떤 토큰인지 알아보는 앞 6자리 (나머지는 모른다)
    prefix = models.CharField(max_length=8, blank=True)
    created_at = models.DateTimeField()
    expires_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'API 토큰'
        verbose_name_plural = 'API 토큰'
        constraints = [models.UniqueConstraint(fields=['user', 'label'], name='api_token_user_label')]

    def __str__(self):
        return f'{self.user} {self.prefix}…'


class MemberRole(models.Model):
    """내 정보의 '역할': 맡는 일·잘하는 것·맡지 않는 것을 두세 줄로. 담당자를 고를 때 이름 옆에 보인다.
    보여 주기만 한다 — 이 글로 권한을 나누지 않는다. 본인이 쓰고, 관리자(스태프)는 다른 사람 것도 고친다."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='member_role')
    role = models.TextField('역할', blank=True, max_length=500)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='+')

    def __str__(self):
        return f'{self.user} 역할'


def role_of(user) -> str:
    """사용자의 역할 글 (없으면 빈 글). select_related('member_role') 로 불러 두면 쿼리가 늘지 않는다."""
    try:
        return user.member_role.role
    except MemberRole.DoesNotExist:
        return ''


def set_role(user, text, by) -> str:
    text = str(text or '').strip()[:500]
    MemberRole.objects.update_or_create(user=user, defaults={'role': text, 'updated_by': by})
    return text
