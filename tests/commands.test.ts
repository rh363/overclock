import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentInfo, On, UiOpenResult } from 'claude-code'
import type { PipelineState } from '../src/core/types'

const NOW = 1_000_000_000_000
const ROOT = '/r'

type World = {
  store: Map<string, unknown>
  state: Map<string, unknown>
  files: Record<string, string>
  dirs: Record<string, { name: string; kind: 'file' | 'dir'; mtimeMs: number }[]>
  sid: string
  live: AgentInfo[] | null
  opens: number
  boom: boolean
  closes: string[]
  openIds: string[]
  toasts: string[]
  logs: string[]
  clock: ReturnType<typeof mock.clock>
}

// Bottoms for everything the plugin calls. The store is answered here rather than by
// mock.store: the test may neither call `$.store` nor hook `store.*` twice, and it needs
// to read what the plugin persisted. State writes are observed on their way down.
function world(on: On, opts: { placed?: boolean } = {}): World {
  const w: World = {
    store: new Map(), state: new Map(), sid: 's1', live: [], opens: 0, boom: false, closes: [], openIds: [], toasts: [], logs: [],
    files: { [`${ROOT}/.git/HEAD`]: 'ref: refs/heads/main\n' },
    dirs: { [`${ROOT}/.git`]: [] },
    clock: mock.clock(on, { now: NOW }),
  }
  on('store.get', (_$, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_$, e) => {
    if (w.boom) throw new Error('boom')
 w.store.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } })
  on('store.delete', (_$, e) => { w.store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('state.set', async (_$, e, next) => { w.state.set(e.key, e.value); return next(e) })
  on('session.id', () => ({ value: w.sid }))
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.read', (_$, e) => (e.path in w.files ? { value: w.files[e.path]! } : { deny: 'ENOENT' }))
  on('fs.exists', (_$, e) => {
    return { value: e.path in w.files || e.path in w.dirs }
  })
  on('fs.list', (_$, e) => {
    const d = w.dirs[e.path]
    return d ? { value: d.map((x) => ({ ...x, size: 0, isLink: false })) } : { deny: 'ENOENT' }
  })
  on('agent.list', () => (w.live ? { value: w.live } : { deny: 'agent.list non disponibile' }))
  on('ui.open', (_$, e) => {
    w.opens++
    w.openIds.push(e.id)
    const r: UiOpenResult = opts.placed === false ? { isPlaced: false, reason: 'narrow' } : { isPlaced: true }
    return { value: r }
  })
  on('ui.close', (_$, e) => { w.closes.push(e.id); return { value: undefined } })
  on('ui.toast', (_$, e) => { w.toasts.push(e.text); return { value: undefined } })
  on('ui.log', (_$, e) => { w.logs.push(e.text); return { value: undefined } })
  on('command.register', () => ({ value: { command: 'overclock' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('classic.SessionStart', () => ({}))
  on('agent.spawn', (_$, e) => ({ model: 'm', agentId: e.resume?.agentId ?? `a${e.tool_use_id}` }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  return w
}

const startSession = ($: Engine) =>
  $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
const run = async ($: Engine, args: string) => (await $.command.run({ command: 'overclock', args } as never)).text
const pipe = (w: World) => w.state.get('pipeline') as PipelineState

test('toggle: apre, poi chiude, poi riapre dopo ui.close', async ($, on) => {
  const w = world(on)
  await startSession($)
  expect(await run($, '')).toBe('Pannello aperto.')
  expect(w.opens).toBe(1)
  expect(w.state.get('paneOpen')).toBe(true)
  expect(await run($, '')).toBe('Pannello chiuso.')
  expect(w.closes).toEqual(['overclock'])
  expect(w.state.get('paneOpen')).toBe(false)
  expect(await run($, '')).toBe('Pannello aperto.')
})

test('open: imposta la tab e apre anche se gia aperto', async ($, on) => {
  const w = world(on)
  await startSession($)
  await run($, '')
  expect(await run($, 'plan')).toBe('Pannello aperto su plan.')
  expect(w.state.get('tab')).toBe('plan')
  expect(w.opens).toBe(2)
})

test('pin: file esistente, relativo e assoluto', async ($, on) => {
  const w = world(on)
  w.files[`${ROOT}/docs/p.md`] = '- [x] a\n- [ ] b\n'
  await startSession($)
  expect(await run($, 'pin plan docs/p.md')).toBe('Piano fissato: docs/p.md')
  let p = pipe(w)
  expect(p.plan.planPath).toBe('docs/p.md')
  expect(p.plan.pinned.plan).toBe(true)
  expect([p.plan.done, p.plan.total]).toEqual([1, 2])
  expect(w.state.get('planText')).toBe('- [x] a\n- [ ] b\n')
  w.files[`${ROOT}/s.md`] = 'x'
  expect(await run($, `pin spec ${ROOT}/s.md`)).toBe('Spec fissato: s.md')
  p = pipe(w)
  expect(p.plan.specPath).toBe('s.md')
  expect(p.plan.pinned.spec).toBe(true)
})

test('pin: file mancante o fuori dalla radice', async ($, on) => {
  const w = world(on)
  await startSession($)
  expect(await run($, 'pin spec nope.md')).toBe('File non trovato: nope.md')
  expect(await run($, 'pin spec /elsewhere/x.md')).toBe('File non trovato: /elsewhere/x.md')
  expect(pipe(w).plan.pinned.spec).toBe(false)
})

test('unpin: azzera i pin e rilancia il rilevamento', async ($, on) => {
  const w = world(on)
  w.files[`${ROOT}/mine.md`] = 'x'
  w.dirs[`${ROOT}/docs/superpowers/specs`] = [{ name: '2026-01-01-a-design.md', kind: 'file', mtimeMs: 1 }]
  await startSession($)
  await run($, 'pin spec mine.md')
  expect(pipe(w).plan.specPath).toBe('mine.md')
  expect(await run($, 'unpin')).toBe('Rilevamento automatico ripristinato.')
  const p = pipe(w)
  expect(p.plan.pinned).toEqual({ spec: false, plan: false })
  expect(p.plan.specPath).toBe('docs/superpowers/specs/2026-01-01-a-design.md')
})

test('phase e reset', async ($, on) => {
  const w = world(on)
  await startSession($)
  expect(await run($, 'phase 3')).toBe('Fase impostata a 3 (Piano).')
  expect(pipe(w).current.phase).toBe(3)
  expect((w.store.get('pipeline:s1') as PipelineState).current.phase).toBe(3)
  expect(await run($, 'phase 0')).toBe('Fase impostata a 0 (nessuna fase).')
  await run($, 'phase 4')
  expect(await run($, 'reset')).toBe('Pipeline azzerata.')
  expect(pipe(w).current.phase).toBe(0)
  expect(pipe(w).current.history).toEqual([])
})

test('errore di sintassi: restituisce il messaggio d uso', async ($, on) => {
  world(on)
  await startSession($)
  expect(await run($, 'phase 9')).toContain('Uso: /overclock')
})

test('errore interno: testo generico, niente eccezione', async ($, on) => {
  const w = world(on)
  await startSession($)
  w.boom = true
  expect(await run($, 'reset')).toBe('Overclock: errore nel comando')
  expect(w.logs.some((l) => l.startsWith('overclock:'))).toBe(true)
})
