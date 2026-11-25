import type { JSONContent } from '@tiptap/core'
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  TableLayoutType,
  VerticalAlign,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx'

// 문서 JSON → Word(.docx). 제목·문단·꾸밈(굵게·기울임·밑줄·취소선·색·형광펜·글자 크기)·링크·
// 목록(글머리·번호·체크)·표(합친 칸 포함)·이미지·인용·코드·가로줄을 옮긴다.
// 이 파일은 내보낼 때만 불러온다 (docx 라이브러리가 커서).

const FONT = '맑은 고딕'
/** A4 에서 여백(25.4mm)을 뺀 본문 폭 (px, 96dpi) */
const CONTENT_PX = 602

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
}

const HEADING = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3]

/** '#e11d48' · 'rgb(225, 29, 72)' → 'E11D48' */
function hex(color: unknown): string | undefined {
  if (typeof color !== 'string' || !color) return undefined
  const s = color.trim()
  const m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
    return h.toUpperCase()
  }
  const rgb = s.match(/^rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/i)
  if (rgb) return rgb.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase()
  return undefined
}

/** '14pt' · '16px' → 반 포인트 단위 (docx size) */
function halfPoints(size: unknown): number | undefined {
  if (typeof size !== 'string') return undefined
  const m = size.match(/^([\d.]+)(pt|px)?$/)
  if (!m) return undefined
  const pt = m[2] === 'px' ? Number(m[1]) * 0.75 : Number(m[1])
  return Math.round(pt * 2)
}

interface Ctx {
  images: Map<string, { data: Uint8Array; width: number; height: number } | null>
  /** 번호 목록마다 1부터 다시 세도록 */
  listInstance: number
  /** 표 칸 안: 문단 사이를 붙인다 */
  inCell?: boolean
}

function runs(nodes: JSONContent[] | undefined, extra: { font?: string; shade?: string } = {}): ParagraphChild[] {
  const out: ParagraphChild[] = []
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') {
      out.push(new TextRun({ text: '', break: 1 }))
      continue
    }
    if (n.type !== 'text') continue
    const marks = n.marks ?? []
    const mark = (name: string) => marks.find((m) => m.type === name)
    const style = mark('textStyle')?.attrs ?? {}
    const hl = mark('highlight')
    const code = mark('code')
    const run = new TextRun({
      text: n.text ?? '',
      bold: !!mark('bold'),
      italics: !!mark('italic'),
      underline: mark('underline') || mark('link') ? {} : undefined,
      strike: !!mark('strike'),
      color: mark('link') ? '2563EB' : hex(style.color),
      size: halfPoints(style.fontSize),
      font: code || extra.font ? 'Consolas' : undefined,
      shading:
        hl || code || extra.shade
          ? { type: ShadingType.CLEAR, color: 'auto', fill: hex(hl?.attrs?.color) ?? (hl ? 'FEF08A' : (extra.shade ?? 'F1F5F9')) }
          : undefined,
    })
    const link = mark('link')
    out.push(link ? new ExternalHyperlink({ link: String(link.attrs?.href ?? ''), children: [run] }) : run)
  }
  return out
}

function paragraph(node: JSONContent, opts: IParagraphOptions = {}): Paragraph {
  const indent = Number(node.attrs?.indent) || 0
  return new Paragraph({
    children: runs(node.content),
    alignment: ALIGN[String(node.attrs?.textAlign ?? '')],
    ...(indent && !opts.numbering ? { indent: { left: indent * 480 } } : {}),
    spacing: { after: 120, line: 300 },
    ...opts,
  })
}

function image(node: JSONContent, ctx: Ctx): Paragraph | null {
  const img = ctx.images.get(String(node.attrs?.src ?? ''))
  if (!img) return null
  // 편집기에서 바꾼 크기가 있으면 따르고, 본문 폭을 넘지 않게 줄인다
  let w = Number(node.attrs?.width) || img.width
  let h = Number(node.attrs?.height) || (img.height * w) / img.width
  if (w > CONTENT_PX) {
    h = (h * CONTENT_PX) / w
    w = CONTENT_PX
  }
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new ImageRun({ type: 'png', data: img.data, transformation: { width: Math.round(w), height: Math.round(h) } })],
  })
}

function list(node: JSONContent, ctx: Ctx, level: number, out: (Paragraph | Table)[]) {
  const ordered = node.type === 'orderedList'
  const task = node.type === 'taskList'
  const instance = ordered ? ++ctx.listInstance : 0
  for (const item of node.content ?? []) {
    const [first, ...rest] = item.content ?? []
    const checkbox = task ? new TextRun({ text: item.attrs?.checked ? '☑ ' : '☐ ' }) : null
    const children = [...(checkbox ? [checkbox] : []), ...runs(first?.content)]
    out.push(
      new Paragraph({
        children,
        spacing: { after: 60, line: 300 },
        ...(task
          ? { indent: { left: 360 * (level + 1) } }
          : { numbering: { reference: ordered ? 'numbers' : 'bullets', level: Math.min(level, 8), ...(ordered ? { instance } : {}) } }),
      }),
    )
    for (const child of rest) {
      if (['bulletList', 'orderedList', 'taskList'].includes(child.type ?? '')) list(child, ctx, level + 1, out)
      else out.push(...blocks([child], ctx))
    }
  }
}

const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE }

/** 본문 폭(A4 - 좌우 여백 1440) */
const CONTENT_TWIPS = 11906 - 2 * 1440

/** 편집기의 열 너비(colwidth, px)를 Word 열 너비(twip)로. 모든 칸에 너비가 있는 줄 하나로 정하고, 없으면 고르게 */
function columnTwips(node: JSONContent): number[] {
  const rows = node.content ?? []
  const n = Math.max(1, ...rows.map((r) => (r.content ?? []).reduce((a, c) => a + (Number(c.attrs?.colspan) || 1), 0)))
  let px: number[] | null = null
  for (const r of rows) {
    const ws: number[] = []
    for (const c of r.content ?? []) {
      const cw = c.attrs?.colwidth as number[] | null | undefined
      const span = Number(c.attrs?.colspan) || 1
      if (!cw || cw.length !== span || cw.some((w) => !w)) { ws.length = 0; break }
      ws.push(...cw)
    }
    if (ws.length === n) { px = ws; break }
  }
  const src = px ?? Array(n).fill(1)
  const sum = src.reduce((a, b) => a + b, 0)
  return src.map((w) => Math.round((w / sum) * CONTENT_TWIPS))
}

function table(node: JSONContent, ctx: Ctx): Table {
  const cols = columnTwips(node)
  const cellCtx: Ctx = { ...ctx, inCell: true }
  // 칸마다 몇째 열부터인지 셀 때 위 줄에서 내려온 칸(rowspan)을 건너뛴다
  const taken: number[] = Array(cols.length).fill(0)
  const rows = (node.content ?? []).map((row, ri) => {
    let col = 0
    const cells = (row.content ?? []).map((cell) => {
      while (col < cols.length && taken[col] > 0) col++
      const span = Number(cell.attrs?.colspan) || 1
      const rspan = Number(cell.attrs?.rowspan) || 1
      const width = cols.slice(col, col + span).reduce((a, b) => a + b, 0)
      for (let k = col; k < col + span && k < cols.length; k++) taken[k] = Math.max(taken[k], rspan)
      col += span
      const header = cell.type === 'tableHeader'
      const inner = blocks(cell.content ?? [], cellCtx).filter((b): b is Paragraph => b instanceof Paragraph)
      return new TableCell({
        children: inner.length ? inner : [new Paragraph('')],
        columnSpan: span > 1 ? span : undefined,
        rowSpan: rspan > 1 ? rspan : undefined,
        width: width ? { size: width, type: WidthType.DXA } : undefined,
        verticalAlign: header ? VerticalAlign.CENTER : undefined,
        // 칸 색(없으면 머리글은 옅은 회색)
        shading: cell.attrs?.backgroundColor
          ? { type: ShadingType.CLEAR, color: 'auto', fill: String(cell.attrs.backgroundColor).replace('#', '').toUpperCase() }
          : header
            ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F5F9' }
            : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        ...(cell.attrs?.borderless ? { borders: NO_BORDERS } : {}),
      })
    })
    for (let k = 0; k < taken.length; k++) if (taken[k] > 0) taken[k]--
    const isHeader = ri === 0 && (row.content ?? []).every((c) => c.type === 'tableHeader')
    return new TableRow({ children: cells, tableHeader: isHeader })
  })
  return new Table({ rows, columnWidths: cols, layout: TableLayoutType.FIXED, width: { size: CONTENT_TWIPS, type: WidthType.DXA } })
}

function blocks(nodes: JSONContent[], ctx: Ctx): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  for (const node of nodes) {
    switch (node.type) {
      case 'heading':
        out.push(paragraph(node, { heading: HEADING[Number(node.attrs?.level) || 1] ?? HeadingLevel.HEADING_3, spacing: { before: 240, after: 120 } }))
        break
      case 'paragraph':
        out.push(paragraph(node, ctx.inCell ? { spacing: { after: 0, line: 264 } } : {}))
        break
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        list(node, ctx, 0, out)
        break
      case 'blockquote':
        // 인용: 왼쪽에 회색 줄을 긋고 들여 쓴다
        for (const child of node.content ?? []) {
          if (child.type === 'paragraph' || child.type === 'heading') {
            out.push(
              paragraph(child, {
                indent: { left: 480 },
                border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'CBD5E1', space: 10 } },
              }),
            )
          } else out.push(...blocks([child], ctx))
        }
        break
      case 'codeBlock':
        out.push(
          new Paragraph({
            children: runs(node.content, { font: 'Consolas', shade: 'F1F5F9' }),
            spacing: { after: 120 },
          }),
        )
        break
      case 'horizontalRule':
        out.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1', space: 1 } }, spacing: { after: 120 } }))
        break
      case 'image': {
        const p = image(node, ctx)
        if (p) out.push(p)
        break
      }
      case 'table':
        out.push(table(node, ctx))
        out.push(new Paragraph(''))
        break
      default:
        if (node.content) out.push(...blocks(node.content, ctx))
    }
  }
  return out
}

/** 이미지 주소 → PNG 바이트 (캔버스로 다시 그려 어떤 형식이든 PNG 로 맞춘다) */
async function loadImage(src: string): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    const res = await fetch(src, { credentials: 'include' })
    if (!res.ok) return null
    const bitmap = await createImageBitmap(await res.blob())
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (!blob) return null
    return { data: new Uint8Array(await blob.arrayBuffer()), width: bitmap.width, height: bitmap.height }
  } catch {
    return null
  }
}

function imageSources(node: JSONContent, acc: Set<string>) {
  if (node.type === 'image' && node.attrs?.src) acc.add(String(node.attrs.src))
  for (const c of node.content ?? []) imageSources(c, acc)
  return acc
}

const bulletLevels = ['●', '○', '■', '●', '○', '■', '●', '○', '■'].map((text, level) => ({
  level,
  format: LevelFormat.BULLET,
  text,
  alignment: AlignmentType.LEFT,
  style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } },
}))

const NUMBER_FORMATS = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN]
const numberLevels = Array.from({ length: 9 }, (_, level) => ({
  level,
  format: NUMBER_FORMATS[level % 3],
  text: `%${level + 1}.`,
  alignment: AlignmentType.LEFT,
  style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 300 } } },
}))

/** Word 파일(Blob)을 만든다 */
export async function buildDocx(json: JSONContent, title: string): Promise<Blob> {
  const srcs = [...imageSources(json, new Set())]
  const loaded = await Promise.all(srcs.map(loadImage))
  const ctx: Ctx = { images: new Map(srcs.map((s, i) => [s, loaded[i]])), listInstance: 0 }
  const doc = new Document({
    title,
    creator: 'Piko View',
    styles: {
      default: {
        document: { run: { font: FONT, size: 22 } },
        heading1: { run: { font: FONT, size: 40, bold: true, color: '0F172A' }, paragraph: { spacing: { before: 360, after: 160 } } },
        heading2: { run: { font: FONT, size: 30, bold: true, color: '1E293B' }, paragraph: { spacing: { before: 280, after: 120 } } },
        heading3: { run: { font: FONT, size: 26, bold: true, color: '334155' }, paragraph: { spacing: { before: 240, after: 100 } } },
      },
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: bulletLevels },
        { reference: 'numbers', levels: numberLevels },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        children: blocks(json.content ?? [], ctx),
      },
    ],
  })
  return Packer.toBlob(doc)
}

/** 파일 이름에 쓸 수 없는 글자를 뺀다 */
export function safeFileName(title: string): string {
  return (title || '문서').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) || '문서'
}
