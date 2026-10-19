import { test, expect } from 'claude-code/testing'
import { emptyTree, reduceAgents, activeCount, MAX_DONE_AGENTS } from '../src/core/agents'
import type { AgentEvent, AgentTree } from '../src/core/types'

const start = (id: string, at = 1, extra: Partial<AgentEvent> = {}): AgentEvent =>
  ({ kind: 'agent.started', id, toolUseId: 't' + id, type: 'Explore', description: 'd', background: false, at, ...extra }) as AgentEvent
const usage = { input_tokens: 100, output_tokens: 10 }

test('started aggiunge un nodo running con parent main', async () => {
  const t = reduceAgents(emptyTree(), start('a'))
  expect(t.nodes.length).toBe(1)
  expect(t.nodes[0]!.status).toBe('running')
  expect(t.nodes[0]!.parentId).toBe('main')
  expect(t.nodes[0]!.tokens).toEqual({ input: 0, output: 0 })
})

test('ended imposta stato, endedAt e somma i token', async () => {
  const reasons = [['answer', 'done'], ['error', 'failed'], ['refusal', 'failed'], ['aborted', 'aborted']] as const
  for (const [reason, status] of reasons) {
    const t = reduceAgents(reduceAgents(emptyTree(), start('a')), { kind: 'agent.ended', id: 'a', reason, usage, at: 9 })
    expect(t.nodes[0]!.status).toBe(status)
    expect(t.nodes[0]!.endedAt).toBe(9)
  }
  let t = reduceAgents(emptyTree(), start('a'))
  t = reduceAgents(t, { kind: 'agent.ended', id: 'a', reason: 'answer', usage, at: 5 })
  t = reduceAgents(t, { kind: 'agent.ended', id: 'a', reason: 'answer', usage, at: 6 })
  expect(t.nodes[0]!.tokens).toEqual({ input: 200, output: 20 })
})

test('resumed riporta a running senza perdere i token', async () => {
  let t = reduceAgents(emptyTree(), start('a'))
  t = reduceAgents(t, { kind: 'agent.ended', id: 'a', reason: 'answer', usage, at: 5 })
  t = reduceAgents(t, { kind: 'agent.resumed', id: 'a', at: 7 })
  expect(t.nodes[0]!.status).toBe('running')
  expect(t.nodes[0]!.tokens).toEqual({ input: 100, output: 10 })
})

test('tool imposta lastTool', async () => {
  const t = reduceAgents(reduceAgents(emptyTree(), start('a')), { kind: 'agent.tool', id: 'a', tool: 'Read' })
  expect(t.nodes[0]!.lastTool).toBe('Read')
})

test('main.turn somma su mainTokens', async () => {
  let t = reduceAgents(emptyTree(), { kind: 'main.turn', usage })
  t = reduceAgents(t, { kind: 'main.turn', usage })
  expect(t.mainTokens).toEqual({ input: 200, output: 20 })
})

test('reconcile chiude i running assenti da liveIds', async () => {
  let t = reduceAgents(emptyTree(), start('a'))
  t = reduceAgents(t, start('b'))
  t = reduceAgents(t, { kind: 'agents.reconcile', liveIds: ['b'], at: 42 })
  expect(t.nodes[0]!.status).toBe('done')
  expect(t.nodes[0]!.endedAt).toBe(42)
  expect(t.nodes[1]!.status).toBe('running')
  expect(t.nodes[1]!.endedAt).toBe(undefined)
})

test('eventi su id sconosciuto restituiscono lo stesso albero', async () => {
  const t = reduceAgents(emptyTree(), start('a'))
  expect(reduceAgents(t, { kind: 'agent.ended', id: 'x', reason: 'answer', at: 1 })).toBe(t)
  expect(reduceAgents(t, { kind: 'agent.tool', id: 'x', tool: 'Read' })).toBe(t)
  expect(reduceAgents(t, { kind: 'agent.resumed', id: 'x', at: 1 })).toBe(t)
})

test('limite: 50 conclusi più recenti, running mai scartati', async () => {
  let t: AgentTree = reduceAgents(emptyTree(), start('run'))
  for (let i = 0; i < 60; i++) {
    t = reduceAgents(t, start('a' + i, i))
    t = reduceAgents(t, { kind: 'agent.ended', id: 'a' + i, reason: 'answer', at: 100 + i })
  }
  const done = t.nodes.filter((n) => n.status !== 'running')
  expect(MAX_DONE_AGENTS).toBe(50)
  expect(done.length).toBe(50)
  expect(done.some((n) => n.id === 'a9')).toBe(false)
  expect(done.some((n) => n.id === 'a10')).toBe(true)
  expect(t.nodes.some((n) => n.id === 'run')).toBe(true)
})

test('activeCount conta solo i running', async () => {
  let t = reduceAgents(emptyTree(), start('a'))
  t = reduceAgents(t, start('b'))
  t = reduceAgents(t, { kind: 'agent.ended', id: 'a', reason: 'answer', at: 3 })
  expect(activeCount(t)).toBe(1)
})

test('i token includono lettura e creazione della cache', async () => {
  const u = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 100 }
  let t = reduceAgents(emptyTree(), start('a'))
  t = reduceAgents(t, { kind: 'agent.ended', id: 'a', reason: 'answer', usage: u, at: 5 })
  expect(t.nodes[0]!.tokens).toEqual({ input: 1110, output: 5 })
  t = reduceAgents(t, { kind: 'main.turn', usage: u })
  expect(t.mainTokens).toEqual({ input: 1110, output: 5 })
})
