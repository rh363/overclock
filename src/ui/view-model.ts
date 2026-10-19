// Pure view model: renderers read these values and never recompute them.
import { activeCount } from '../core/agents'
import { basename } from '../core/paths'
import { PHASE_NAMES } from '../core/phases'
import { percent } from '../core/plan'
import { classify, sharedWrites } from '../core/sessions'
import type { AgentTree, PipelineState, SessionCase, SessionEntry } from '../core/types'

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
