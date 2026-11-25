import type { ReactNode } from 'react'
import ConfirmDialog from '../ConfirmDialog'
import { buttonClass } from './buttonClass'
import type { BulkSelect } from './useBulkSelect'

/** 카드 오른쪽 위 고르는 칸. 카드(li)에 group 클래스가 있어야 마우스를 올렸을 때 보인다 */
export function SelectBox<T extends { id: number }>({ bulk, item, label }: { bulk: BulkSelect<T>; item: T; label: string }) {
  const on = bulk.isSelected(item)
  const allowed = bulk.canSelect(item)
  if (!allowed && !bulk.selecting) return null
  return (
    <label
      data-bulk-skip
      data-tip={allowed ? (on ? '고른 것에서 뺍니다' : '고릅니다. Shift 를 누르고 고르면 사이에 있는 것까지 고릅니다') : '지울 권한이 없어 고를 수 없습니다'}
      onClick={(e) => e.stopPropagation()}
      className={`absolute top-2 right-2 z-10 grid h-7 w-7 place-items-center rounded-md bg-white/90 shadow-sm ring-1 ring-slate-200 transition ${
        on || bulk.selecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
      } ${allowed ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
    >
      <input
        type="checkbox"
        checked={on}
        disabled={!allowed}
        aria-label={`${label} 고르기`}
        onChange={() => {}}
        onClick={(e) => {
          e.stopPropagation()
          bulk.toggle(item, e.shiftKey)
        }}
        className="h-4 w-4 cursor-pointer accent-blue-600 disabled:cursor-not-allowed"
      />
    </label>
  )
}

/** 고른 카드가 있을 때 목록 위에 뜨는 줄: N개 선택됨 · 전체 선택 · 선택 해제 · 삭제. 고르기 전에는 '선택' 단추만 */
export function BulkBar<T extends { id: number }>({ bulk, onDelete, note }: { bulk: BulkSelect<T>; onDelete: () => void; note?: ReactNode }) {
  if (!bulk.selecting) {
    return (
      <button
        type="button"
        onClick={bulk.start}
        data-tip="여러 개를 골라 한꺼번에 지웁니다. 카드에 마우스를 올려 오른쪽 위 칸을 눌러도 됩니다"
        className={`${buttonClass('secondary')} px-3 py-1.5 text-[13px]`}
      >
        선택
      </button>
    )
  }
  const n = bulk.selected.length
  return (
    <div
      role="toolbar"
      aria-label="고른 파일"
      // 목록 위에 끼우면 카드가 밀려 끌어 고르기가 어긋나므로, 화면 위쪽에 떠 있게 둔다 (아래쪽은 알림 권유 창·폰 아래 탭과 겹친다)
      className="fixed inset-x-4 top-3 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm shadow-lg"
    >
      <span className="font-semibold text-slate-800 tabular-nums">{n}개 선택됨</span>
      {note && <span className="text-xs text-slate-500">{note}</span>}
      <div className="ml-auto flex flex-wrap gap-2">
        <button type="button" onClick={bulk.selectAll} disabled={bulk.choosableCount === 0} className={`${buttonClass('ghost')} px-3 py-1.5`}>
          {bulk.allPicked ? '전체 선택 해제' : `전체 선택 (${bulk.choosableCount})`}
        </button>
        <button type="button" onClick={bulk.clear} className={`${buttonClass('secondary')} px-3 py-1.5`}>
          선택 해제
        </button>
        <button type="button" onClick={onDelete} disabled={n === 0} className={`${buttonClass('danger')} px-3 py-1.5`}>
          삭제
        </button>
      </div>
    </div>
  )
}

/**
 * 고른 것을 한 번 확인받고 하나씩 지운다 (하나 지울 때와 같은 API). 실패한 것은 이름과 까닭을 돌려준다.
 * what: '파일'·'디자인'·'그래프' 처럼 확인 창에 쓸 이름
 */
export function BulkDeleteDialog<T extends { id: number }>({
  items,
  what,
  name,
  warning,
  remove,
  onClose,
  onDone,
}: {
  items: T[] | null
  what: string
  name: (item: T) => string
  warning: string
  remove: (item: T) => Promise<unknown>
  onClose: () => void
  /** 다 끝난 뒤: 실패한 것 목록(이름·까닭)과 지운 수 */
  onDone: (result: { removed: number; failed: { name: string; reason: string }[] }) => void
}) {
  const list = items ?? []
  return (
    <ConfirmDialog
      open={items !== null && list.length > 0}
      title={`${what} ${list.length}개 삭제`}
      message={
        <>
          <p>
            {what} {list.length}개를 지웁니다. {warning}
          </p>
          <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
            {list.map((it) => (
              <li key={it.id} className="truncate">
                {name(it) || '제목 없음'}
              </li>
            ))}
          </ul>
        </>
      }
      confirmLabel={`${list.length}개 삭제`}
      onCancel={onClose}
      onConfirm={async () => {
        const failed: { name: string; reason: string }[] = []
        let removed = 0
        for (const it of list) {
          try {
            await remove(it)
            removed += 1
          } catch (e) {
            failed.push({ name: name(it) || '제목 없음', reason: e instanceof Error ? e.message : '지우지 못했습니다.' })
          }
        }
        onClose()
        onDone({ removed, failed })
      }}
    />
  )
}
