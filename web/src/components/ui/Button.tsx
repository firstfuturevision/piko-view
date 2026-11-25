import type { ButtonHTMLAttributes } from 'react'
import { buttonClass, type ButtonSize, type ButtonVariant } from './buttonClass'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** 처리 중: 누를 수 없게 하고 aria-busy 를 붙인다 */
  busy?: boolean
}

/** 공용 버튼. 모양만 정하고 동작은 일반 <button> 과 같다 (type 기본값 'button') */
export default function Button({ variant = 'secondary', size = 'md', busy, className = '', disabled, type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`${buttonClass(variant, size)} ${className}`}
      {...rest}
    />
  )
}
