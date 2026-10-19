import { test, expect } from 'claude-code/testing'
import { DEFAULT_PHASE_MAP, PHASE_NAMES, skillKey, parsePhaseMap } from '../src/core/phases'
import { emptyPipeline, applySkill, setPhase, resetPipeline, MAX_CYCLES } from '../src/core/pipeline'
import type { Phase } from '../src/core/types'

const M = DEFAULT_PHASE_MAP
const at = (p: Phase) => setPhase(emptyPipeline(0), p, 1)

test('skillKey', async () => {
  expect(skillKey('brainstorming', 'superpowers')).toBe('superpowers:brainstorming')
  expect(skillKey('superpowers:brainstorming')).toBe('superpowers:brainstorming')
  expect(skillKey('commit')).toBe('commit')
})

test('mappa predefinita', async () => {
  expect(DEFAULT_PHASE_MAP['alex-dev-skills:git-worktrees']).toEqual({ phase: 2 })
  expect(DEFAULT_PHASE_MAP['alex-dev-skills:tdd-prove-it']).toEqual({ badge: 'TDD' })
  expect(Object.keys(DEFAULT_PHASE_MAP).length).toBe(13)
  expect(PHASE_NAMES.length).toBe(6)
})

test('avanzamento', async () => {
  const p = applySkill(emptyPipeline(0), 'superpowers:writing-plans', M, 5)
  expect(p.current.phase).toBe(3)
  expect(p.current.history.length).toBe(1)
  expect(p.updatedAt).toBe(5)
})

test('nessun ritorno indietro', async () => {
  const p = applySkill(at(4), 'superpowers:using-git-worktrees', M, 5)
  expect(p.current.phase).toBe(4)
  expect(p.current.history.length).toBe(2)
})

test('nuovo ciclo', async () => {
  const p = applySkill(at(4), 'superpowers:brainstorming', M, 5)
  expect(p.cycles.length).toBe(1)
  expect(p.current.phase).toBe(1)
  expect(p.current.history.length).toBe(1)
  const q = applySkill(at(1), 'superpowers:brainstorming', M, 5)
  expect(q.cycles.length).toBe(0)
})

test('limite dei cicli', async () => {
  let p = emptyPipeline(0)
  for (let i = 0; i < 13; i++) {
    p = applySkill(p, 'superpowers:brainstorming', M, i)
    p = applySkill(p, 'superpowers:writing-plans', M, i)
  }
  expect(p.cycles.length).toBe(MAX_CYCLES)
})

test('badge', async () => {
  let p = applySkill(at(3), 'superpowers:test-driven-development', M, 5)
  p = applySkill(p, 'alex-dev-skills:tdd-prove-it', M, 6)
  expect(p.current.badges.length).toBe(1)
  p = applySkill(p, 'superpowers:executing-plans', M, 7)
  expect(p.current.phase).toBe(4)
  expect(p.current.badges.length).toBe(0)
  expect(applySkill(emptyPipeline(0), 'superpowers:systematic-debugging', M, 1).current.badges.length).toBe(1)
})

test('skill non mappata', async () => {
  const p = emptyPipeline(0)
  expect(applySkill(p, 'foo:bar', M, 5)).toBe(p)
})

test('comandi manuali', async () => {
  const p = setPhase(at(4), 2, 9)
  expect(p.current.phase).toBe(2)
  expect(p.current.history[p.current.history.length - 1]?.skill).toBe('/overclock phase')
  const pinned = { ...p, plan: { specPath: '/s.md', pinned: { spec: true, plan: false }, done: 1, total: 2 } }
  const r = resetPipeline(applySkill(pinned, 'superpowers:brainstorming', M, 10), 11)
  expect(r.current).toEqual({ phase: 0, history: [], badges: [] })
  expect(r.cycles).toEqual([])
  expect(r.plan.pinned.spec).toBe(true)
  expect(r.plan.specPath).toBe('/s.md')
})

test('parsePhaseMap', async () => {
  expect(parsePhaseMap('{"x:y":{"phase":3}}')).toEqual({ 'x:y': { phase: 3 } })
  expect(parsePhaseMap('{"x":{"phase":9}}')).toBe(null)
  expect(parsePhaseMap('{"x":{"badge":"Foo"}}')).toBe(null)
  expect(parsePhaseMap('not json')).toBe(null)
})
