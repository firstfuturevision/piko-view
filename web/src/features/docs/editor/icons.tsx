/** 문서 편집기 도구 막대 아이콘 (24×24 선 그림, 글자색을 따른다) */
const PATHS = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  print: 'M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z',
  bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
  italic: 'M10 5h8M6 19h8M14 5l-4 14',
  underline: 'M7 4v7a5 5 0 0 0 10 0V4M5 20h14',
  strike: 'M5 12h14M16.5 7.5C16 5.8 14.3 5 12 5c-2.8 0-4.5 1.3-4.5 3.3 0 1.4.8 2.4 2.5 3M8 16c.6 1.9 2.2 3 4.3 3 2.8 0 4.7-1.4 4.7-3.6 0-.7-.2-1.3-.6-1.8',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2',
  image: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM20 15l-5-5L5 20',
  table: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 9.5h16M4 15h16M10 4v16M15 4v16',
  comment: 'M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM12 8v6M9 11h6',
  alignLeft: 'M4 6h16M4 10h10M4 14h16M4 18h10',
  alignCenter: 'M4 6h16M7 10h10M4 14h16M7 18h10',
  alignRight: 'M4 6h16M10 10h10M4 14h16M10 18h10',
  alignJustify: 'M4 6h16M4 10h16M4 14h16M4 18h16',
  bulletList: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  orderedList: 'M10 6h10M10 12h10M10 18h10M4 4.5h1.5V9M4 9h3M4 14.5c.4-.6 1-1 1.7-1 .9 0 1.5.6 1.5 1.3 0 1.1-3.2 2.4-3.2 4.2h3.3',
  taskList: 'M4 5h4v4H4zM4 14.5l1.6 1.6L8.5 13M11 7h9M11 15h9',
  indent: 'M4 5h16M10 10h10M10 14h10M4 19h16M4 9.5l3 2.5-3 2.5',
  outdent: 'M4 5h16M10 10h10M10 14h10M4 19h16M7 9.5 4 12l3 2.5',
  hr: 'M4 12h16M8 7h8M8 17h8',
  clear: 'M6 5h12M12 5l-3.5 14M15 15l5 5M20 15l-5 5',
  quote: 'M6 17c-1.2-1.2-2-2.6-2-4.6C4 9.3 6 7 9 6l.6 1.2C7.6 8.1 7 9.5 7 11h3v6zM15 17c-1.2-1.2-2-2.6-2-4.6 0-3.1 2-5.4 5-6.4l.6 1.2c-2 .9-2.6 2.3-2.6 3.8h3v6z',
  code: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
  chevronDown: 'M6 9l6 6 6-6',
  outline: 'M4 6h16M8 11h12M8 16h12M4 11h.01M4 16h.01',
  history: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4M12 8v4l3 2',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  share: 'M12 4v11M7.5 8.5 12 4l4.5 4.5M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5',
  back: 'M15 5l-7 7 7 7',
} as const

export type DocIconName = keyof typeof PATHS

export default function DocIcon({ name, className = 'h-[18px] w-[18px]' }: { name: DocIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

/** 글자색(A 아래 색 막대)·형광펜 아이콘 */
export function ColorGlyph({ kind, color }: { kind: 'text' | 'highlight'; color: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-[18px] w-[18px] shrink-0">
      {kind === 'text' ? (
        <path d="M7 16 12 4l5 12M8.6 12h6.8" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path
          d="m14.5 4.5 5 5-7.5 7.5H7v-5zM7 12l5 5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <rect x="4" y="19" width="16" height="3" rx="1" fill={color} stroke={color === 'transparent' ? '#cbd5e1' : 'none'} />
    </svg>
  )
}
