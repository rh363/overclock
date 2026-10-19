import type { BadgeName, Phase, PhaseMap } from './types'

// Index 0 is phase 1.
export const PHASE_NAMES: readonly string[] = ['Brainstorming', 'Worktree', 'Piano', 'Esecuzione', 'Code review', 'Chiusura branch']

export const DEFAULT_PHASE_MAP: PhaseMap = {
  'superpowers:brainstorming': { phase: 1 },
  'superpowers:using-git-worktrees': { phase: 2 },
  'alex-dev-skills:git-worktrees': { phase: 2 },
  'superpowers:writing-plans': { phase: 3 },
  'superpowers:subagent-driven-development': { phase: 4 },
  'superpowers:executing-plans': { phase: 4 },
  'superpowers:requesting-code-review': { phase: 5 },
  'superpowers:finishing-a-development-branch': { phase: 6 },
  'superpowers:test-driven-development': { badge: 'TDD' },
  'alex-dev-skills:tdd-prove-it': { badge: 'TDD' },
  'superpowers:systematic-debugging': { badge: 'Debug' },
  'alex-dev-skills:systematic-debugging': { badge: 'Debug' },
  'superpowers:verification-before-completion': { badge: 'Verifica' },
}

export function skillKey(skill: string, pluginName?: string): string {
  if (skill.includes(':')) return skill
  return pluginName ? `${pluginName}:${skill}` : skill
}

const BADGES: readonly string[] = ['TDD', 'Debug', 'Verifica'] satisfies BadgeName[]

export function parsePhaseMap(json: string): PhaseMap | null {
  let raw: unknown
  try { raw = JSON.parse(json) } catch { return null }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const out: PhaseMap = {}
  for (const [key, v] of Object.entries(raw)) {
    if (typeof v !== 'object' || v === null) return null
    const o = v as { phase?: unknown; badge?: unknown }
    if (typeof o.phase === 'number' && Number.isInteger(o.phase) && o.phase >= 1 && o.phase <= 6) {
      out[key] = { phase: o.phase as Phase }
    } else if (typeof o.badge === 'string' && BADGES.includes(o.badge)) {
      out[key] = { badge: o.badge as BadgeName }
    } else return null
  }
  return out
}
