import { useSyncExternalStore } from 'react'

/** 마우스를 올리면 뜨는 도움말 툴팁 켜기/끄기 (사람마다, 이 브라우저에 기억) */
const KEY = 'piko:tips'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

const enabled = read()

export function useTipsEnabled(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => enabled,
  )
}
