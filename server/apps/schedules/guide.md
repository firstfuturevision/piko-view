이 서버는 **일정 관리** 데이터다. 함께 쓰는 공유 달력의 일정과 카테고리를 다룬다.

## 데이터
- 일정: 제목, 설명, 시작·끝, 종일 여부, 카테고리, 완료(`done`), 목록 고정(`pinned`).
  - 종일 일정은 날짜만 쓴다. 여러 날 종일 일정의 `end`는 **마지막 날짜**다 (예: 10/1~10/3 → start 2026-10-01, end 2026-10-03).
  - 시간 일정은 `YYYY-MM-DDTHH:MM` (서버 시간대). 끝 시각은 없어도 된다.
- 카테고리: 이름과 색(red·orange·yellow·green·blue·navy·purple·black). `category_create`·`category_update` 로 만들고 고친다. 일정을 만들 때 `category`에 `category_list`의 이름을 쓴다. 없으면 미분류(회색).
- 반복 일정(`repeat`: weekly·monthly)은 원본 하나만 저장된다. `schedule_list`는 발생분마다 한 줄씩 주고 id 는 원본 id 다.

## 요령
- "이번 주 일정" 같은 질문은 날짜 범위를 계산해 `schedule_list`에 준다. 오늘 날짜를 모르면 사람에게 확인한다.
- 일정을 만들기 전에 같은 기간에 비슷한 일정이 이미 있는지 `schedule_list`로 확인해 중복을 피한다.
- 지난 일정을 정리할 때는 지우지 말고 `done`으로 완료 표시한다.
