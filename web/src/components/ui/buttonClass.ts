export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md'

const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-50'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 font-semibold text-white hover:bg-blue-700',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  danger: 'bg-red-600 font-semibold text-white hover:bg-red-700',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
}

/** <Link> 처럼 <button> 이 아닌 요소에도 같은 모양을 입힐 때 */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md') {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]}`
}
