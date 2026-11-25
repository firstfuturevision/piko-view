import type { JSONContent } from '@tiptap/core'

// 문서 JSON → 마크다운 (Markdown으로 복사). 꾸밈은 굵게·기울임·취소선·코드·링크만 옮긴다.

function inline(nodes: JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n'
      if (n.type === 'image') return `![${n.attrs?.alt ?? ''}](${absolute(String(n.attrs?.src ?? ''))})`
      if (n.type !== 'text') return inline(n.content)
      let t = n.text ?? ''
      const marks = n.marks ?? []
      const has = (name: string) => marks.some((m) => m.type === name)
      if (has('code')) t = `\`${t}\``
      if (has('bold')) t = `**${t}**`
      if (has('italic')) t = `*${t}*`
      if (has('strike')) t = `~~${t}~~`
      const link = marks.find((m) => m.type === 'link')
      if (link) t = `[${t}](${link.attrs?.href ?? ''})`
      return t
    })
    .join('')
}

function absolute(src: string): string {
  return src.startsWith('/') ? `${location.origin}${src}` : src
}

function block(node: JSONContent, indent: string): string[] {
  switch (node.type) {
    case 'heading':
      return [`${'#'.repeat(Number(node.attrs?.level) || 1)} ${inline(node.content)}`, '']
    case 'paragraph':
      return [indent + inline(node.content), '']
    case 'blockquote':
      return (node.content ?? []).flatMap((c) => block(c, '')).map((l) => (l ? `> ${l}` : '>')).concat('')
    case 'codeBlock':
      return ['```', inline(node.content), '```', '']
    case 'horizontalRule':
      return ['---', '']
    case 'image':
      return [inline([node]), '']
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return [...list(node, indent), ...(indent ? [] : [''])]
    case 'table':
      return table(node)
    default:
      return (node.content ?? []).flatMap((c) => block(c, indent))
  }
}

function list(node: JSONContent, indent: string): string[] {
  const out: string[] = []
  ;(node.content ?? []).forEach((item, i) => {
    const marker =
      node.type === 'orderedList' ? `${i + 1}.` : node.type === 'taskList' ? (item.attrs?.checked ? '- [x]' : '- [ ]') : '-'
    const [first, ...rest] = item.content ?? []
    out.push(`${indent}${marker} ${first ? inline(first.content) : ''}`)
    for (const child of rest) {
      if (['bulletList', 'orderedList', 'taskList'].includes(child.type ?? '')) out.push(...list(child, indent + '   '))
      else out.push(...block(child, indent + '   ').filter(Boolean))
    }
  })
  return out
}

function table(node: JSONContent): string[] {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      (cell.content ?? [])
        .map((p) => inline(p.content))
        .join(' ')
        .replace(/\|/g, '\\|'),
    ),
  )
  if (!rows.length) return []
  const cols = Math.max(...rows.map((r) => r.length))
  const pad = (r: string[]) => [...r, ...Array(cols - r.length).fill('')]
  const line = (r: string[]) => `| ${pad(r).join(' | ')} |`
  return [line(rows[0]), `|${' --- |'.repeat(cols)}`, ...rows.slice(1).map(line), '']
}

export function toMarkdown(json: JSONContent, title?: string): string {
  const lines = (json.content ?? []).flatMap((n) => block(n, ''))
  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return title && !body.startsWith('# ') ? `# ${title}\n\n${body}\n` : `${body}\n`
}
