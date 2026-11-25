import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

/**
 * 내용 길이만큼 높이가 늘어나는 글 칸 (안쪽 스크롤 없이 다 보이게). 긴 글이면 둘러싼 창이 스크롤된다.
 * minRows 만큼은 늘 보인다.
 */
export default function AutoTextarea({ minRows = 2, value, className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])
  return <textarea ref={ref} rows={minRows} value={value} className={`resize-none overflow-hidden ${className}`} {...rest} />
}
