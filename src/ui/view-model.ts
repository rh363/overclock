// Pure view model: renderers read these values and never recompute them.
import { activeCount } from '../core/agents'
import { basename } from '../core/paths'
import { PHASE_NAMES } from '../core/phases'
import { percent } from '../core/plan'
import { classify, groupSessions, sharedWrites } from '../core/sessions'
import type { SessionGroup } from '../core/sessions'
import type { AgentNode, AgentStatus, AgentTree, BadgeName, PipelineState, SessionCase, SessionEntry, Tokens } from '../core/types'

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

export type SessionWarning = { path: string; text: string }
export type SessionsView = { summary: string; groups: SessionGroup[]; warnings: SessionWarning[] }
type GroupedSession = SessionGroup['branches'][number]['sessions'][number]

const sumTokens = (t: Tokens) => t.input + t.output

/** Token count as `142k` / `850` (summary) or with one decimal below 100k when `fine` is set. */
export function formatTokens(n: number, fine = false): string {
  if (n < 1000) return String(n)
  return fine ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`
}

/** The agents a session shows: running ones, plus the last finished one for the own session. */
export function shownAgents(s: { agents: AgentNode[]; isSelf: boolean }): AgentNode[] {
  const running = s.agents.filter((a) => a.status === 'running')
  if (!s.isSelf) return running
  let last: AgentNode | undefined
  for (const a of s.agents) {
    if (a.status !== 'running' && (!last || (a.endedAt ?? 0) >= (last.endedAt ?? 0))) last = a
  }
  return last ? [...running, last] : running
}

/** `branch` for A/B (repo name when detached or out of git), `sessione <4 chars>` for C. */
export function sessionLabel(s: SessionEntry, kind: SessionCase): string {
  return kind === 'C' ? `sessione ${s.sessionId.slice(0, 4)}` : (s.branch ?? s.repoName)
}

export function sessionsView(self: SessionEntry, others: SessionEntry[], now: number, mainTokens?: Tokens): SessionsView {
  const groups = groupSessions([self, ...others], self.sessionId, now)
  const midnight = new Date(now).setHours(0, 0, 0, 0)
  const live = [self, ...others]
  let tokens = mainTokens ? sumTokens(mainTokens) : 0
  let running = 0
  for (const s of live) {
    for (const a of s.agents) {
      if (a.status === 'running') running++
      if (a.startedAt >= midnight) tokens += sumTokens(a.tokens)
    }
  }
  const warnings = sharedWrites(self, others, now).map((w) => ({
    path: w.path,
    text: `⚠ ${w.path} scritto da entrambe ${Math.floor((now - w.at) / 60_000)}m fa`,
  }))
  return {
    summary: `${live.length} sessioni vive · ${running} agenti attivi · ${formatTokens(tokens)} token oggi`,
    groups,
    warnings,
  }
}

export function groupHeader(g: SessionGroup): string {
  const n = g.branches.reduce((a, b) => a + b.sessions.length, 0)
  if (g.kind === 'C') {
    const shared = g.branches.find((b) => b.sessions.length >= 2)
    return `⇄ ${g.repoName} @ ${shared?.branch ?? '(detached)'} · ${n} sessioni sullo stesso branch`
  }
  if (g.kind === 'A') return `⎇ ${g.repoName} · ${g.branches.length} worktree`
  return `▣ ${g.repoName}`
}

export type SessionCard = {
  id: string; label: string; color: string; isSelf: boolean; isIdle: boolean
  meta: string; planPercent: number; planTotal: number
  agents: { id: string; label: string; tokensText: string; status: AgentStatus }[]
}

export function sessionCard(s: GroupedSession, kind: SessionCase, now: number): SessionCard {
  const color = kind === 'A' ? GREEN : kind === 'B' ? BLUE : kind === 'C' ? ORANGE : GREY
  const parts = [s.phase > 0 ? `${PHASE_NAMES[s.phase - 1]} ${s.phase}/${PHASE_NAMES.length}` : '—']
  if (s.planTotal > 0) parts.push(`Piano ${s.planDone}/${s.planTotal}`)
  for (const b of s.badges) parts.push(`[${b}]`)
  if (s.isIdle) parts.push(`inattiva da ${Math.floor((now - s.lastActivity) / 60_000)} min`)
  return {
    id: s.sessionId, label: sessionLabel(s, kind), color, isSelf: s.isSelf, isIdle: s.isIdle,
    meta: parts.join(' · '), planPercent: percent(s.planDone, s.planTotal), planTotal: s.planTotal,
    agents: shownAgents(s).map((a) => ({
      id: a.id, label: a.description !== '' ? `${a.type} · ${a.description}` : a.type,
      tokensText: formatTokens(sumTokens(a.tokens), true), status: a.status,
    })),
  }
}
