"""홈 카드 등록소. 각 앱이 AppConfig.ready() 에서 register_card() 로 자기 카드를 등록한다.

카드 함수는 HomeContext 를 받아 {'value': 숫자, 'items': [{title, sub, tag, url?}]} 를 돌려준다.
키는 '<모듈>.<이름>' (예: schedules.today) — 템플릿의 home.stats·panels 에 이 키를 적는다.
"""
from dataclasses import dataclass
from datetime import date, datetime
from typing import Callable


@dataclass(frozen=True)
class HomeContext:
    user: object
    now: datetime
    today: date
    day_start: datetime   # 오늘 0시 (서버 시간대)
    day_end: datetime     # 내일 0시


@dataclass(frozen=True)
class Card:
    key: str
    label: str
    fn: Callable[[HomeContext], dict]

    @property
    def module(self) -> str:
        return self.key.split('.', 1)[0]


_CARDS: dict[str, Card] = {}


def register_card(key: str, label: str, fn: Callable[[HomeContext], dict]) -> None:
    if '.' not in key:
        raise ValueError("카드 키는 '<모듈>.<이름>' 모양이어야 합니다.")
    _CARDS[key] = Card(key, label, fn)


def unregister_card(key: str) -> None:
    _CARDS.pop(key, None)


def cards() -> list[Card]:
    return list(_CARDS.values())


def card_keys() -> set[str]:
    return set(_CARDS)


def item(title, sub='', tag='', url=None) -> dict:
    """카드 목록 한 줄. url 은 있을 때만 넣는다."""
    out = {'title': title, 'sub': sub or '', 'tag': tag or ''}
    if url:
        out['url'] = url
    return out
