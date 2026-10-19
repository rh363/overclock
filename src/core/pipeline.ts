import type { Phase, PhaseMap, PipelineCycle, PipelineState } from './types'

export const MAX_CYCLES = 10
export const MAX_HISTORY = 50

const emptyCycle = (): PipelineCycle => ({ phase: 0, history: [], badges: [] })

export function emptyPipeline(at: number): PipelineState {
  return { current: emptyCycle(), cycles: [], plan: { pinned: { spec: false, plan: false }, done: 0, total: 0 }, updatedAt: at }
}

// Keeps the MAX_HISTORY most recent entries of a cycle's history.
const capped = <T>(h: T[]): T[] => (h.length > MAX_HISTORY ? h.slice(-MAX_HISTORY) : h)

/** Nothing worth persisting: no phase, history, badge, cycle, pin, spec or plan. */
export function isEmptyPipeline(p: PipelineState): boolean {
  const { current: c, plan } = p
  return (
    c.phase === 0 && c.history.length === 0 && c.badges.length === 0 && p.cycles.length === 0 &&
    !plan.pinned.spec && !plan.pinned.plan && plan.specPath === undefined && plan.planPath === undefined
  )
}

export function applySkill(p: PipelineState, key: string, map: PhaseMap, at: number): PipelineState {
  // Own keys only: 'constructor' or 'toString' are not skills.
  const entry = Object.hasOwn(map, key) ? map[key] : undefined
  if (!entry) return p
  const cur = p.current
  if ('badge' in entry) {
    if (cur.badges.some((b) => b.name === entry.badge)) return { ...p, updatedAt: at }
    return { ...p, current: { ...cur, badges: [...cur.badges, { name: entry.badge, at }] }, updatedAt: at }
  }
  const phase = entry.phase
  const hist = { phase, skill: key, at }
  // A phase-1 skill after phase 2+ closes the cycle and starts a new one.
  if (phase === 1 && cur.phase >= 2) {
    const cycles = [...p.cycles, cur].slice(-MAX_CYCLES)
    return { ...p, cycles, current: { phase: 1, history: [hist], badges: [] }, updatedAt: at }
  }
  if (phase > cur.phase) {
    return { ...p, current: { phase, history: capped([...cur.history, hist]), badges: [] }, updatedAt: at }
  }
  // Never go back: record the skill only.
  return { ...p, current: { ...cur, history: capped([...cur.history, hist]) }, updatedAt: at }
}

export function setPhase(p: PipelineState, phase: Phase, at: number): PipelineState {
  const cur = p.current
  const hist = { phase, skill: '/overclock phase', at }
  return {
    ...p,
    current: { phase, history: capped([...cur.history, hist]), badges: phase === cur.phase ? cur.badges : [] },
    updatedAt: at,
  }
}

export function resetPipeline(p: PipelineState, at: number): PipelineState {
  return { ...emptyPipeline(at), plan: p.plan }
}
