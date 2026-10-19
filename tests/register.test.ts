import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentInfo, AgentSpawnInput, On, UiOpenResult } from 'claude-code'
import type { AgentTree, PipelineState, SessionEntry } from '../src/core/types'

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
  sets: string[]
  toasts: string[]
  logs: string[]
  clock: ReturnType<typeof mock.clock>
  // The test's engine, for a bottom that dispatches a nested event.
  engine?: Engine
}

// Bottoms for everything the plugin calls. The store is answered here rather than by
// mock.store: the test may neither call `$.store` nor hook `store.*` twice, and it needs
// to read what the plugin persisted. State writes are observed on their way down.
function world(on: On, opts: { placed?: boolean } = {}): World {
  const w: World = {
    store: new Map(), state: new Map(), sid: 's1', live: [], opens: 0, sets: [], toasts: [], logs: [],
    files: { [`${ROOT}/.git/HEAD`]: 'ref: refs/heads/main\n' },
    dirs: { [`${ROOT}/.git`]: [] },
    clock: mock.clock(on, { now: NOW }),
  }
  on('store.get', (_$, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_$, e) => { w.sets.push(e.key); w.store.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } })
  on('store.delete', (_$, e) => { w.store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('state.set', async (_$, e, next) => { w.state.set(e.key, e.value); return next(e) })
  on('session.id', () => ({ value: w.sid }))
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.read', (_$, e) => (e.path in w.files ? { value: w.files[e.path]! } : { deny: 'ENOENT' }))
  on('fs.exists', (_$, e) => ({ value: e.path in w.files || e.path in w.dirs }))
  on('fs.list', (_$, e) => {
    const d = w.dirs[e.path]
    return d ? { value: d.map((x) => ({ ...x, size: 0, isLink: false })) } : { deny: 'ENOENT' }
  })
  on('agent.list', () => (w.live ? { value: w.live } : { deny: 'agent.list non disponibile' }))
  on('ui.open', () => {
    w.opens++
    const r: UiOpenResult = opts.placed === false ? { isPlaced: false, reason: 'narrow' } : { isPlaced: true }
    return { value: r }
  })
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
  // The Skill tool expands the skill's prompt while its call is in flight, as the engine does.
  on('tool.call', async (_$, e) => {
    if (e.tool === 'Skill' && w.engine) {
      const [plugin, skill] = String((e as { skill?: unknown }).skill).split(':') as [string, string]
      await w.engine.skill.prompt({ skill, text: '', pluginName: plugin })
    }
    return { result: {} }
  })
  return w
}

const spawnInput = (n: string): AgentSpawnInput => ({
  tool_use_id: n, prompt: 'p', description: `d${n}`, subagentType: 'general-purpose',
  provider: { plugin: 'core', tier: 'core' } as AgentSpawnInput['provider'],
  parentModel: 'm', background: false, fork: false,
})
const complete = (agentId: string | undefined) => ({
  answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' as const, agentId,
  usage: { model: 'm', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
})
const startSession = ($: Engine) =>
  $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
const agents = (w: World) => w.state.get('agents') as AgentTree

test('agente seguito: spawn e turn.complete lo chiudono con i token', async ($, on) => {
  const w = world(on)
  await $.agent.spawn(spawnInput('1'))
  expect(agents(w).nodes.find((n) => n.id === 'a1')?.status).toBe('running')
  await $.turn.complete(complete('a1'))
  const node = agents(w).nodes.find((n) => n.id === 'a1')
  expect(node?.status).toBe('done')
  expect(node?.tokens).toEqual({ input: 10, output: 5 })
  expect(node?.description).toBe('d1')
})

test('fase da skill: writing-plans porta la pipeline a 3, anche nello store', async ($, on) => {
  const w = world(on)
  await startSession($)
  await $.skill.prompt({ skill: 'writing-plans', text: '', pluginName: 'superpowers' })
  expect((w.state.get('pipeline') as PipelineState).current.phase).toBe(3)
  expect((w.store.get('pipeline:s1') as PipelineState).current.phase).toBe(3)
  expect((w.store.get('session:s1') as SessionEntry).phase).toBe(3)
})

test('apertura automatica: il primo spawn apre il pannello, il secondo no', async ($, on) => {
  const w = world(on)
  await startSession($)
  await $.agent.spawn(spawnInput('1'))
  expect(w.opens).toBe(1)
  await $.agent.spawn(spawnInput('2'))
  expect(w.opens).toBe(1)
  expect(w.toasts).toEqual([])
})

test('terminale stretto: il toast compare una sola volta', async ($, on) => {
  const w = world(on, { placed: false })
  await startSession($)
  await $.agent.spawn(spawnInput('1'))
  await $.agent.spawn(spawnInput('2'))
  await $.skill.prompt({ skill: 'brainstorming', text: '', pluginName: 'superpowers' })
  expect(w.toasts).toEqual(['Overclock: /overclock per aprire il pannello'])
})

test('heartbeat: riconcilia gli agenti e aggiorna session:<id>', async ($, on) => {
  const w = world(on)
  await startSession($)
  await $.agent.spawn(spawnInput('1'))
  expect(agents(w).nodes[0]?.status).toBe('running')
  await w.clock.advance(15_000)
  expect(agents(w).nodes[0]?.status).toBe('done')
  const entry = w.store.get('session:s1') as SessionEntry
  expect(entry.heartbeat).toBe(NOW + 15_000)
  expect(entry.agents[0]?.status).toBe('done')
})

test('heartbeat: legge le altre sessioni vive, senza self', async ($, on) => {
  const w = world(on)
  const other = (id: string, heartbeat: number): SessionEntry => ({
    v: 1, sessionId: id, repoRoot: ROOT, repoName: 'r', worktreeRoot: ROOT, branch: 'main', agents: [],
    recentWrites: [], phase: 0, badges: [], planDone: 0, planTotal: 0, lastActivity: heartbeat, heartbeat,
  })
  w.store.set('session:live', other('live', NOW))
  w.store.set('session:dead', other('dead', NOW - 120_000))
  await startSession($)
  const others = w.state.get('others') as SessionEntry[]
  expect(others.map((o) => o.sessionId)).toEqual(['live'])
  expect((w.state.get('self') as SessionEntry).branch).toBe('main')
})

test('scrittura del piano: aggiorna planPath e conteggio', async ($, on) => {
  const w = world(on)
  await startSession($)
  w.files[`${ROOT}/docs/superpowers/plans/p.md`] = '- [x] a\n- [ ] b'
  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/docs/superpowers/plans/p.md`, content: 'x' })
  const p = w.state.get('pipeline') as PipelineState
  expect(p.plan).toEqual({ planPath: 'docs/superpowers/plans/p.md', done: 1, total: 2, pinned: { spec: false, plan: false } })
  expect(w.state.get('planText')).toBe('- [x] a\n- [ ] b')
  expect((w.store.get('session:s1') as SessionEntry).recentWrites).toEqual([{ path: 'docs/superpowers/plans/p.md', at: NOW }])
})

test('avvio: rileva spec e piano più recenti', async ($, on) => {
  const w = world(on)
  w.dirs[`${ROOT}/docs/superpowers/specs`] = [{ name: 's.md', kind: 'file', mtimeMs: 1 }]
  w.dirs[`${ROOT}/docs/superpowers/plans`] = [
    { name: 'old.md', kind: 'file', mtimeMs: 1 }, { name: 'new.md', kind: 'file', mtimeMs: 2 },
  ]
  w.files[`${ROOT}/docs/superpowers/plans/new.md`] = '- [x] a\n- [x] b\n- [ ] c'
  await startSession($)
  const p = w.state.get('pipeline') as PipelineState
  expect(p.plan.specPath).toBe('docs/superpowers/specs/s.md')
  expect(p.plan.planPath).toBe('docs/superpowers/plans/new.md')
  expect([p.plan.done, p.plan.total]).toEqual([2, 3])
})

test('/clear: la pipeline passa al nuovo id e la vecchia chiave sparisce', async ($, on) => {
  const w = world(on)
  await startSession($)
  await $.skill.prompt({ skill: 'writing-plans', text: '', pluginName: 'superpowers' })
  await $.agent.spawn(spawnInput('1'))
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(w.store.has('session:s1')).toBe(false)
  w.sid = 's2'
  await $.classic.SessionStart({ source: 'clear', session_id: 's2' })
  expect((w.store.get('pipeline:s2') as PipelineState).current.phase).toBe(3)
  expect(w.store.has('pipeline:s1')).toBe(false)
  expect((w.store.get('session:s2') as SessionEntry).phase).toBe(3)
  expect(agents(w).nodes).toEqual([])
})

test('phaseMapPath: la mappa del file si unisce a quella predefinita', { options: { phaseMapPath: 'map.json' } }, async ($, on) => {
  const w = world(on)
  w.files[`${ROOT}/map.json`] = JSON.stringify({ 'me:custom': { phase: 5 } })
  await startSession($)
  await $.skill.prompt({ skill: 'custom', text: '', pluginName: 'me' })
  expect((w.state.get('pipeline') as PipelineState).current.phase).toBe(5)
  await $.skill.prompt({ skill: 'finishing-a-development-branch', text: '', pluginName: 'superpowers' })
  expect((w.state.get('pipeline') as PipelineState).current.phase).toBe(6)
})

test('phaseMapPath non valida: una riga di log, poi la mappa predefinita', { options: { phaseMapPath: '/r/bad.json' } }, async ($, on) => {
  const w = world(on)
  w.files['/r/bad.json'] = '{ nope'
  await startSession($)
  await $.skill.prompt({ skill: 'writing-plans', text: '', pluginName: 'superpowers' })
  await $.skill.prompt({ skill: 'brainstorming', text: '', pluginName: 'superpowers' })
  expect(w.logs.length).toBe(1)
  expect((w.state.get('pipeline') as PipelineState).current.phase).toBe(1)
})

test('/clear senza classic.SessionStart: il primo evento porta la sessione sul nuovo id', async ($, on) => {
  const w = world(on)
  await startSession($)
  await $.skill.prompt({ skill: 'writing-plans', text: '', pluginName: 'superpowers' })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  w.sid = 's2'
  await $.agent.spawn(spawnInput('1'))
  expect((w.store.get('pipeline:s2') as PipelineState).current.phase).toBe(3)
  expect(w.store.has('pipeline:s1')).toBe(false)
  expect(w.store.has('session:s1')).toBe(false)
  expect((w.state.get('self') as SessionEntry).sessionId).toBe('s2')
  expect(agents(w).nodes.map((n) => n.id)).toEqual(['a1'])
  await w.clock.advance(15_000)
  expect((w.store.get('session:s2') as SessionEntry).heartbeat).toBe(NOW + 15_000)
  expect(w.store.has('session:s1')).toBe(false)
  expect(w.logs).toEqual([])
})

test('heartbeat fallito: una riga di log, non un errore muto', async ($, on) => {
  const w = world(on)
  await startSession($)
  w.live = null
  await w.clock.advance(15_000)
  expect(w.logs.length).toBe(1)
  expect(w.logs[0]).toContain('overclock:')
})

test('pipeline malformata nello store: initSession riparte da una vuota', async ($, on) => {
  const w = world(on)
  w.store.set('pipeline:s1', { current: { phase: 'x' }, cycles: [], plan: {} })
  await startSession($)
  expect((w.state.get('self') as SessionEntry).sessionId).toBe('s1')
  expect((w.state.get('pipeline') as PipelineState).current.phase).toBe(0)
  expect(w.logs).toEqual([])
})

test('pipeline vuota: non viene salvata nello store', async ($, on) => {
  const w = world(on)
  await startSession($)
  expect(w.store.has('pipeline:s1')).toBe(false)
  expect(w.store.has('session:s1')).toBe(true)
  await $.skill.prompt({ skill: 'writing-plans', text: '', pluginName: 'superpowers' })
  expect(w.store.has('pipeline:s1')).toBe(true)
})

test('avvio: pota le pipeline vecchie una volta sola, non a ogni heartbeat', async ($, on) => {
  const w = world(on)
  const old = { current: { phase: 3, history: [], badges: [] }, cycles: [], plan: { pinned: { spec: false, plan: false }, done: 0, total: 0 } }
  w.store.set('pipeline:old', { ...old, updatedAt: NOW - 31 * 86_400_000 })
  await startSession($)
  expect(w.store.has('pipeline:old')).toBe(false)
  w.store.set('pipeline:old2', { ...old, updatedAt: NOW - 31 * 86_400_000 })
  await w.clock.advance(15_000)
  expect(w.store.has('pipeline:old2')).toBe(true)
})

test('git da un subagente non cambia branch e worktree della sessione', async ($, on) => {
  const w = world(on)
  await startSession($)
  await $.agent.spawn(spawnInput('1'))
  w.files[`${ROOT}/.git/HEAD`] = 'ref: refs/heads/x\n'
  await $.tool.call({ tool: 'Bash', command: 'git switch x', agentId: 'a1' } as never)
  expect((w.state.get('self') as SessionEntry).branch).toBe('main')
  await $.tool.call({ tool: 'Bash', command: 'git switch x' } as never)
  expect((w.state.get('self') as SessionEntry).branch).toBe('x')
})

test('tool call: nessuna scrittura nello store, la pubblica l\'heartbeat', async ($, on) => {
  const w = world(on)
  await startSession($)
  await $.agent.spawn(spawnInput('1'))
  await w.clock.advance(5_000)
  w.live = [{ id: 'a1', status: 'running' } as AgentInfo]
  w.sets.length = 0
  for (const tool of ['Read', 'Grep', 'Glob']) await $.tool.call({ tool, agentId: 'a1' } as never)
  await $.tool.call({ tool: 'Read' } as never)
  expect(w.sets).toEqual([])
  expect(agents(w).nodes[0]?.lastTool).toBe('Glob')
  await w.clock.advance(10_000)
  const entry = w.store.get('session:s1') as SessionEntry
  expect(entry.agents[0]?.lastTool).toBe('Glob')
  expect(entry.lastActivity).toBe(NOW + 5_000)
  expect(entry.heartbeat).toBe(NOW + 15_000)
})

test('tool call della sessione principale: aggiorna lastActivity', async ($, on) => {
  const w = world(on)
  await startSession($)
  await w.clock.advance(5_000)
  await $.tool.call({ tool: 'Read' } as never)
  expect((w.state.get('self') as SessionEntry).lastActivity).toBe(NOW + 5_000)
})

test('/resume nello stesso processo: self ripubblicato col nuovo id, agenti azzerati', async ($, on) => {
  const w = world(on)
  await startSession($)
  await $.agent.spawn(spawnInput('1'))
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } } as never)
  expect(w.store.has('session:s1')).toBe(false)
  w.sid = 's2'
  await $.classic.SessionStart({ source: 'resume', session_id: 's2' } as never)
  expect((w.state.get('self') as SessionEntry).sessionId).toBe('s2')
  expect((w.store.get('session:s2') as SessionEntry).sessionId).toBe('s2')
  expect(agents(w).nodes).toEqual([])
  await w.clock.advance(15_000)
  expect((w.store.get('session:s2') as SessionEntry).heartbeat).toBe(NOW + 15_000)
  expect(w.logs).toEqual([])
})

test('/resume senza classic.SessionStart: il primo evento azzera gli agenti', async ($, on) => {
  const w = world(on)
  await startSession($)
  await $.agent.spawn(spawnInput('1'))
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } } as never)
  w.sid = 's2'
  await $.agent.spawn(spawnInput('2'))
  expect((w.state.get('self') as SessionEntry).sessionId).toBe('s2')
  expect(agents(w).nodes.map((n) => n.id)).toEqual(['a2'])
})


test('skill da un subagente: la fase della sessione non avanza, il badge sì', async ($, on) => {
  const w = world(on)
  w.engine = $
  await startSession($)
  await $.skill.prompt({ skill: 'subagent-driven-development', text: '', pluginName: 'superpowers' })
  await $.agent.spawn(spawnInput('1'))
  await $.tool.call({ tool: 'Skill', skill: 'superpowers:requesting-code-review', agentId: 'a1' } as never)
  expect((w.state.get('pipeline') as PipelineState).current.phase).toBe(4)
  await $.tool.call({ tool: 'Skill', skill: 'superpowers:test-driven-development', agentId: 'a1' } as never)
  expect((w.state.get('pipeline') as PipelineState).current.badges.map((b) => b.name)).toEqual(['TDD'])
  await $.tool.call({ tool: 'Skill', skill: 'superpowers:requesting-code-review' } as never)
  expect((w.state.get('pipeline') as PipelineState).current.phase).toBe(5)
})
