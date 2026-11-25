import type { JSONContent } from '@tiptap/core'

// 목록 카드에 보일 첫 쪽 미리보기. 실제 화면을 찍지 않고 JSON 을 보고 글자만 간단히 그린다
// (A4 비율 240×340, 1쪽 분량까지).

const W = 240
const H = 340
const PAD = 22

function plain(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return ' '
  return (node.content ?? []).map(plain).join('')
}

interface Line {
  text: string
  size: number
  bold: boolean
  color: string
  indent: number
  prefix?: string
  gapBefore: number
}

function collect(nodes: JSONContent[] | undefined, out: Line[], depth = 0, ordered = false) {
  let n = 0
  for (const node of nodes ?? []) {
    switch (node.type) {
      case 'heading': {
        const level = Number(node.attrs?.level) || 1
        out.push({ text: plain(node), size: [0, 15, 12, 10.5][level] ?? 10, bold: true, color: '#0f172a', indent: 0, gapBefore: level === 1 ? 4 : 7 })
        break
      }
      case 'paragraph':
        out.push({ text: plain(node), size: 7.5, bold: false, color: '#475569', indent: depth * 10, gapBefore: 2 })
        break
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        collect(node.content, out, depth + 1, node.type === 'orderedList')
        break
      case 'listItem':
      case 'taskItem': {
        n += 1
        const [first, ...rest] = node.content ?? []
        const prefix = node.type === 'taskItem' ? (node.attrs?.checked ? '☑' : '☐') : ordered ? `${n}.` : '•'
        out.push({ text: first ? plain(first) : '', size: 7.5, bold: false, color: '#475569', indent: depth * 10, prefix, gapBefore: 1 })
        collect(rest, out, depth, false)
        break
      }
      case 'blockquote':
        collect(node.content, out, depth + 1)
        break
      case 'codeBlock':
        out.push({ text: plain(node), size: 7, bold: false, color: '#334155', indent: depth * 10 + 4, gapBefore: 2 })
        break
      case 'table':
        for (const row of node.content ?? []) {
          const cells = (row.content ?? []).map((c) => plain(c)).join('  |  ')
          out.push({ text: cells, size: 7, bold: false, color: '#475569', indent: depth * 10, gapBefore: 1 })
        }
        break
      case 'horizontalRule':
        out.push({ text: '—', size: 6, bold: false, color: '#cbd5e1', indent: 0, gapBefore: 3 })
        break
      case 'image':
        out.push({ text: '🖼', size: 18, bold: false, color: '#94a3b8', indent: 0, gapBefore: 3 })
        break
    }
  }
}

/** 문서 JSON → 미리보기 PNG data URL (그리지 못하면 빈 글) */
export function renderThumbnail(json: JSONContent): string {
  try {
    const canvas = document.createElement('canvas')
    const scale = 1.5
    canvas.width = W * scale
    canvas.height = H * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.scale(scale, scale)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)
    const lines: Line[] = []
    collect(json.content, lines)
    const font = '"Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif'
    let y = PAD
    for (const line of lines) {
      ctx.font = `${line.bold ? 700 : 400} ${line.size}px ${font}`
      ctx.fillStyle = line.color
      const lh = line.size * 1.45
      y += line.gapBefore
      let x = PAD + line.indent
      if (line.prefix) {
        ctx.fillText(line.prefix, x, y + line.size)
        x += line.size * 1.4
      }
      const maxW = W - PAD - x
      // 한 줄에 들어가는 만큼씩 자른다
      let rest = line.text || ' '
      while (rest.length) {
        // 대충 어림한 뒤 넘치면 한 글자씩 줄인다
        let cut = Math.min(rest.length, Math.ceil(maxW / (line.size * 0.5)))
        while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxW) cut -= 1
        ctx.fillText(rest.slice(0, cut), x, y + line.size)
        rest = rest.slice(cut)
        y += lh
        if (y > H - PAD) break
      }
      if (y > H - PAD) break
    }
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}
