"""모듈 도구들이 함께 쓰는 도우미: DRF 시리얼라이저로 검증·저장, 부분 수정 값 고르기, 사용자 찾기."""
from django.contrib.auth import get_user_model

from apps.core.models import role_of
from apps.core.system_users import humans

from .tools import tool

# 결과 목록이 너무 길면 모델 컨텍스트만 차지하므로 자른다
LIST_LIMIT = 50


def _errors_text(errors) -> str:
    if isinstance(errors, dict):
        return '; '.join(f'{k}: {_errors_text(v)}' for k, v in errors.items())
    if isinstance(errors, list):
        return ' '.join(_errors_text(e) for e in errors)
    return str(errors)


def save(serializer_cls, *, data: dict, instance=None, partial: bool = False, **save_kwargs) -> dict:
    """화면과 같은 시리얼라이저로 검증해 저장한다. 실패하면 에이전트가 고칠 수 있는 문장으로 알린다."""
    s = serializer_cls(instance, data=data, partial=partial)
    if not s.is_valid():
        raise ValueError(f'입력값을 확인하세요 — {_errors_text(s.errors)}')
    s.save(**save_kwargs)
    return s.data


def changes(clearable: tuple[str, ...] = (), **fields) -> dict:
    """부분 수정용: None 인 항목은 바꾸지 않는다. clearable 항목은 '' 를 주면 값을 지운다(null)."""
    out = {}
    for k, v in fields.items():
        if v is None:
            continue
        out[k] = None if (k in clearable and v == '') else v
    return out


def get_or_fail(model, pk: int, label: str, hint: str):
    obj = model.objects.filter(pk=pk).first()
    if obj is None:
        raise LookupError(f'{label} {pk}번이 없습니다. {hint}')
    return obj


def truncated(items: list, total: int) -> dict:
    return {'total': total, 'shown': len(items), 'items': items,
            **({'note': f'{total}건 중 {len(items)}건만 보여 줍니다. 조건을 좁혀 다시 찾으세요.'} if total > len(items) else {})}


def user_label(user) -> str | None:
    if user is None:
        return None
    return user.first_name or user.username


def find_user(name: str):
    """아이디(username) 또는 닉네임으로 사용자를 찾는다."""
    User = get_user_model()
    user = User.objects.filter(is_active=True, username=name).first() or \
        User.objects.filter(is_active=True, first_name=name).first()
    if user is None:
        names = ', '.join(user_label(u) for u in humans(User.objects.filter(is_active=True)).order_by('username'))
        raise LookupError(f"'{name}' 사용자가 없습니다. 등록된 사용자: {names}")
    return user


@tool
def user_list() -> list[dict]:
    """등록된 사용자 목록. 담당자를 지정할 때 이 이름(닉네임 또는 아이디)을 쓴다.
    role 은 본인이 내 정보에 적은 역할(맡는 일·잘하는 것·맡지 않는 것). 누가 맡을지 고를 때 참고하고, 비어 있으면 모른다고 한다."""
    User = get_user_model()
    return [{'username': u.username, 'nickname': u.first_name or None, 'role': role_of(u) or None}
            for u in humans(User.objects.filter(is_active=True)).select_related('member_role').order_by('username')]
