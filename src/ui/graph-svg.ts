// Agent graph as an SVG string: main on top, children on the rows below.
import type { agentsView } from './view-model'

type Node = ReturnType<typeof agentsView>[number]

const STROKE = { running: '#2f7d5b', done: '#4a5fc1', failed: '#b3261e', aborted: '#888888' } as const
const MAX_NODES = 60
const KEEP_FINISHED = 20
const BOX_W = 150
const BOX_H = 58
const GAP = 16
const ROW_H = 90

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function visible(nodes: Node[]): Node[] {
  if (nodes.length <= MAX_NODES) return nodes
  const finished = nodes.filter((n) => n.status !== 'running').slice(-KEEP_FINISHED)
  const keep = new Set([...nodes.filter((n) => n.status === 'running'), ...finished])
  return nodes.filter((n) => keep.has(n))
}

export function agentGraphSvg(nodes: Node[], width: number): string {
  const shown = visible(nodes)
  const ids = new Set(shown.map((n) => n.id))
  const depthOf = new Map<string, number>()
  const byId = new Map(shown.map((n) => [n.id, n]))
  const depth = (n: Node, guard = 0): number => {
    const known = depthOf.get(n.id)
    if (known !== undefined) return known
    const parent = byId.get(n.parentId)
    const d = parent && ids.has(parent.id) && guard < 50 ? depth(parent, guard + 1) + 1 : 1
    depthOf.set(n.id, d)
    return d
  }
  const rows = new Map<number, Node[]>()
  for (const n of shown) rows.set(depth(n), [...(rows.get(depth(n)) ?? []), n])
  const rowCount = Math.max(0, ...rows.keys())
  const perRow = Math.max(1, Math.floor((width - GAP) / (BOX_W + GAP)))
  const pos = new Map<string, { x: number; y: number }>()
  let y = ROW_H
  const body: string[] = []
  for (let d = 1; d <= rowCount; d++) {
    const row = rows.get(d) ?? []
    for (let start = 0; start < row.length; start += perRow) {
      const line = row.slice(start, start + perRow)
      const total = line.length * (BOX_W + GAP) - GAP
      const x0 = Math.max(GAP, (width - total) / 2)
      line.forEach((n, i) => pos.set(n.id, { x: x0 + i * (BOX_W + GAP), y }))
      y += ROW_H
    }
  }
  const mainX = (width - BOX_W) / 2
  const lines: string[] = []
  for (const n of shown) {
    const p = pos.get(n.id)!
    const parent = pos.get(n.parentId)
    const fromX = (parent ? parent.x : mainX) + BOX_W / 2
    const fromY = (parent ? parent.y : 8) + BOX_H
    lines.push(`<line x1="${fromX}" y1="${fromY}" x2="${p.x + BOX_W / 2}" y2="${p.y}" stroke="#999" stroke-width="1"/>`)
    body.push(
      `<rect x="${p.x}" y="${p.y}" width="${BOX_W}" height="${BOX_H}" rx="6" fill="none" stroke="${STROKE[n.status]}" stroke-width="2"/>` +
        `<text x="${p.x + 8}" y="${p.y + 18}" font-size="13" fill="currentColor">${esc(clip(n.label, 20))}</text>` +
        `<text x="${p.x + 8}" y="${p.y + 35}" font-size="11" fill="#888">${esc(clip(`${n.statusText} · ${n.tokensText}`, 24))}</text>` +
        (n.detail !== undefined ? `<text x="${p.x + 8}" y="${p.y + 50}" font-size="11" fill="#888">${esc(clip(n.detail, 24))}</text>` : ''),
    )
  }
  const height = Math.max(y, ROW_H)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="sans-serif">` +
    lines.join('') +
    `<rect x="${mainX}" y="8" width="${BOX_W}" height="${BOX_H}" rx="6" fill="none" stroke="#2f7d5b" stroke-width="2"/>` +
    `<text x="${mainX + 8}" y="35" font-size="13" fill="currentColor">Sessione main</text>` +
    body.join('') +
    `</svg>`
  )
}
