// Pure view model: renderers read these values and never recompute them.
import { activeCount } from '../core/agents'
import { basename } from '../core/paths'
import { PHASE_NAMES } from '../core/phases'
import { percent } from '../core/plan'
import { classify, sharedWrites } from '../core/sessions'
import type { AgentStatus, AgentTree, BadgeName, PipelineState, SessionCase, SessionEntry } from '../core/types'

export type CaseStyle = { kind: SessionCase; symbol: '⎇' | '▣' | '⇄' | ''; color: string; label: string }

export type BandView = {
  case: CaseStyle
  specName?: string
  planName?: string
  planDone: number
  planTotal: number
  planPercent: number
  phase: number
  phaseName?: string
  warning?: string
}

const GREEN = '#2f7d5b'
const BLUE = '#4a5fc1'
export const ORANGE = '#c0642a'
const GREY = '#888888'

export function caseStyle(self: SessionEntry, others: SessionEntry[]): CaseStyle {
  const c = classify(self, others)
  const branch = self.branch ?? '(detached)'
  switch (c.kind) {
    case 'A':
      return { kind: 'A', symbol: '⎇', color: GREEN, label: `⎇ ${branch}` }
    case 'C':
      return { kind: 'C', symbol: '⇄', color: ORANGE, label: `⇄ ${branch} ×${c.sameBranch + 1}` }
    case 'B':
      return { kind: 'B', symbol: '▣', color: BLUE, label: `▣ ${self.repoName}` }
    default:
      return { kind: 'none', symbol: '', color: GREY, label: `▣ ${self.repoName}` }
  }
}

/** The secondary, dimmed part of the band that goes with the case label. */
export function caseDetail(self: SessionEntry, others: SessionEntry[]): string {
  const c = classify(self, others)
  switch (c.kind) {
    case 'A':
      return `${self.repoName} · ${c.worktrees} worktree`
    case 'B': {
      const parts = [self.branch ?? '(detached)']
      if (c.otherRepos > 0) parts.push(`+${c.otherRepos} altri repo`)
      return parts.join(' · ')
    }
    case 'C':
      return `condiviso con ${c.sameBranch} ${c.sameBranch === 1 ? 'sessione' : 'sessioni'}`
    default:
      return ''
  }
}

export function bandView(
  s: { self: SessionEntry | null; others: SessionEntry[]; pipeline: PipelineState | null },
  now: number,
): BandView {
  const { self, others, pipeline } = s
  const plan = pipeline?.plan
  const phase = pipeline?.current.phase ?? self?.phase ?? 0
  const base = {
    specName: plan?.specPath ? basename(plan.specPath) : undefined,
    planName: plan?.planPath ? basename(plan.planPath) : undefined,
    planDone: plan?.done ?? 0,
    planTotal: plan?.total ?? 0,
    planPercent: percent(plan?.done ?? 0, plan?.total ?? 0),
    phase,
    phaseName: phase > 0 ? PHASE_NAMES[phase - 1] : undefined,
  }
  if (!self) return { case: { kind: 'none', symbol: '', color: GREY, label: '' }, ...base }
  const first = sharedWrites(self, others, now)[0]
  return { case: caseStyle(self, others), ...base, warning: first ? `⚠ ${first.path}` : undefined }
}

/** Spinner suffix for n active agents, or undefined when none run. */
export function spinnerSuffix(tree: AgentTree): string | undefined {
  const n = activeCount(tree)
  return n > 0 ? `… · ${n} ${n === 1 ? 'agente' : 'agenti'}` : undefined
}

export type AgentRow = {
  id: string; parentId: string; label: string; status: AgentStatus
  statusText: 'in corso' | 'completato' | 'fallito' | 'interrotto'; tokensText: string; detail?: string
}

const STATUS_TEXT = { running: 'in corso', done: 'completato', failed: 'fallito', aborted: 'interrotto' } as const

function tokensText(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k tok` : `${n} tok`
}

export function agentsView(tree: AgentTree, _now: number): AgentRow[] {
  return tree.nodes.map((n) => ({
    id: n.id,
    parentId: n.parentId,
    label: n.type,
    status: n.status,
    statusText: STATUS_TEXT[n.status],
    tokensText: tokensText(n.tokens.input + n.tokens.output),
    detail: n.lastTool ?? (n.description !== '' ? n.description : undefined),
  }))
}

export type PhaseRow = { n: number; name: string; state: 'done' | 'current' | 'todo'; enteredAt?: number; skill?: string }

export function pipelineView(p: PipelineState): { phases: PhaseRow[]; badges: BadgeName[]; previousCycles: number } {
  const cur = p.current
  const phases = PHASE_NAMES.map((name, i): PhaseRow => {
    const n = i + 1
    const last = [...cur.history].reverse().find((h) => h.phase === n)
    return {
      n, name,
      state: n < cur.phase ? 'done' : n === cur.phase ? 'current' : 'todo',
      enteredAt: last?.at, skill: last?.skill,
    }
  })
  return { phases, badges: cur.badges.map((b) => b.name), previousCycles: p.cycles.length }
}
