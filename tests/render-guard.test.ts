import { test, expect } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { guardRender } from '../src/app/runtime'

// A plain `$` with only what the guard touches: the log.
function fake() {
  const logs: string[] = []
  const $ = { ui: { log: (t: string) => { logs.push(t) } } } as unknown as EngineInterface
  return { $, logs }
}

test('guardRender: errore dopo next restituisce il below senza richiamare next', async () => {
  const { $, logs } = fake()
  let calls = 0
  const next = async () => { calls++; return 'below' }
  const r = await guardRender($, {}, next, async (n) => { await n({}); throw new Error('nostro') })
  expect(r).toBe('below')
  expect(calls).toBe(1)
  expect(logs.length).toBe(1)
})

test('guardRender: se è next a lanciare, l\'errore risale', async () => {
  const { $, logs } = fake()
  let calls = 0
  const next = async () => { calls++; throw new Error('engine') }
  let caught: unknown
  try { await guardRender($, {}, next, async (n) => n({})) } catch (err) { caught = err }
  expect((caught as Error).message).toBe('engine')
  expect(calls).toBe(1)
  expect(logs).toEqual([])
})

test('guardRender: errore prima di next lo chiama una volta', async () => {
  const { $, logs } = fake()
  let calls = 0
  const next = async () => { calls++; return 'below' }
  const r = await guardRender($, {}, next, async () => { throw new Error('nostro') })
  expect(r).toBe('below')
  expect(calls).toBe(1)
  expect(logs.length).toBe(1)
})

test('guardRender: senza errori restituisce il disegno', async () => {
  const { $ } = fake()
  const r = await guardRender($, {}, async () => 'below', async (n) => `${await n({})}+band`)
  expect(r).toBe('below+band')
})
