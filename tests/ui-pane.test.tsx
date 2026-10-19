import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { agentsView, pipelineView } from '../src/ui/view-model'
import { agentGraphSvg } from '../src/ui/graph-svg'
import type { AgentNode, AgentTree, PipelineState } from '../src/core/types'

const NOW = 1_000_000_000_000
const ROOT = '/r'
const PLAN = 'docs/superpowers/plans/p.md'

const node = (o: Partial<AgentNode> & { id: string }): AgentNode => ({
  parentId: 'main', toolUseId: `t${o.id}`, type: 'implementer', description: 'task 3', background: false,
  status: 'running', startedAt: NOW, tokens: { input: 0, output: 0 }, ...o,
})
const tree = (nodes: AgentNode[]): AgentTree => ({ nodes, mainTokens: { input: 0, output: 0 } })

test('agentsView: token e stato', () => {
  const v = agentsView(tree([
    node({ id: 'a', tokens: { input: 10000, output: 2400 }, lastTool: 'Edit' }),
    node({ id: 'b', status: 'done', tokens: { input: 800, output: 50 } }),
    node({ id: 'c', status: 'failed' }),
    node({ id: 'd', status: 'aborted' }),
  ]), NOW)
  expect(v[0]).toMatchObject({ tokensText: '12.4k tok', statusText: 'in corso', detail: 'Edit' })
  expect(v[1]).toMatchObject({ tokensText: '850 tok', statusText: 'completato', detail: 'task 3' })
  expect(v[2]!.statusText).toBe('fallito')
  expect(v[3]!.statusText).toBe('interrotto')
})

test('agentGraphSvg: svg valido, escape e limite di dimensione', () => {
  const svg = agentGraphSvg(agentsView(tree([node({ id: 'a', description: '<b> & x' })]), NOW), 560)
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).toContain('&lt;b&gt; &amp; x')
  expect(svg).not.toContain('<b>')
  const many = Array.from({ length: 200 }, (_, i) => node({ id: `n${i}`, type: `ag${i}x`, description: 'x'.repeat(200), status: i < 5 ? 'running' : 'done' }))
  const big = agentGraphSvg(agentsView(tree(many), NOW), 560)
  expect(big.length).toBeLessThan(131072)
  // main box + 5 running + the last 20 finished
  expect(big.match(/<rect /g)!.length).toBe(1 + 5 + 20)
  for (let i = 0; i < 5; i++) expect(big).toContain(`>ag${i}x<`)
  for (let i = 180; i < 200; i++) expect(big).toContain(`>ag${i}x<`)
  expect(big).not.toContain('>ag5x<')
  expect(big).not.toContain('>ag179x<')
})

test('pipelineView: a fase 4 le prime tre sono done', () => {
  const p: PipelineState = {
    current: { phase: 4, history: [{ phase: 1, skill: 'superpowers:brainstorming', at: NOW }], badges: [{ name: 'TDD', at: NOW }] },
    cycles: [], plan: { pinned: { spec: false, plan: false }, done: 0, total: 0 }, updatedAt: NOW,
  }
  const v = pipelineView(p)
  expect(v.phases.map((x) => x.state)).toEqual(['done', 'done', 'done', 'current', 'todo', 'todo'])
  expect(v.phases[0]).toMatchObject({ enteredAt: NOW, skill: 'superpowers:brainstorming' })
  expect(v.badges).toEqual(['TDD'])
  expect(v.previousCycles).toBe(0)
})

function world(on: On, fills: string[], o: { others?: unknown[]; plan?: boolean } = {}) {
  const store = new Map<string, unknown>()
  for (const e of o.others ?? []) store.set(`session:${(e as { sessionId: string }).sessionId}`, e)
  const hasPlan = o.plan !== false
  const files: Record<string, string> = { [`${ROOT}/.git/HEAD`]: 'ref: refs/heads/main\n', ...(hasPlan ? { [`${ROOT}/${PLAN}`]: '- [x] a\n- [ ] b\n' } : {}) }
  const dirs: Record<string, { name: string; kind: 'file' | 'dir'; mtimeMs: number }[]> = {
    [`${ROOT}/.git`]: [], ...(hasPlan ? { [`${ROOT}/docs/superpowers/plans`]: [{ name: 'p.md', kind: 'file', mtimeMs: 1 }] } : {}),
  }
  mock.clock(on, { now: NOW })
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => { store.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } })
  on('store.delete', (_$, e) => { store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.read', (_$, e) => (e.path in files ? { value: files[e.path]! } : { deny: 'ENOENT' }))
  on('fs.exists', (_$, e) => ({ value: e.path in files || e.path in dirs }))
  on('fs.list', (_$, e) => (dirs[e.path] ? { value: dirs[e.path]!.map((x) => ({ ...x, size: 0, isLink: false })) } : { deny: 'ENOENT' }))
  on('agent.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'overclock' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('agent.spawn', (_$, e) => ({ model: 'm', agentId: `a${e.tool_use_id}` }))
  on('prompt.fill', (_$, e) => { fills.push(e.text); return { isFilled: true } })
}

async function setup($: Engine, surface: 'terminal' | 'desktop') {
  await $.session.start({ cwd: ROOT, surface, isInteractive: true })
  await $.agent.spawn({
    tool_use_id: '1', prompt: 'p', description: 'task 3', subagentType: 'implementer',
    provider: { plugin: 'core', tier: 'core' }, parentModel: 'm', background: false, fork: false,
  } as never)
  return $.ui.mount({ plugin: 'overclock', surface, component: 'Pane', requestId: 'overclock', props: {} } as never)
}

test('pane su desktop: il grafo è un Svg', async ($, on) => {
  world(on, [])
  const ui = await setup($, 'desktop')
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})

test('pane su terminale: albero testuale, niente Svg', async ($, on) => {
  world(on, [])
  const ui = await setup($, 'terminal')
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /implementer/ })).toBeDefined()
  await ui.unmount()
})

test('tab Piano: Markdown e Apri riempie il prompt', async ($, on) => {
  const fills: string[] = []
  world(on, fills)
  const ui = await setup($, 'terminal')
  await ui.press({ key: 'tab-plan' })
  expect(await ui.find({ type: 'Markdown' })).toBeDefined()
  await ui.press({ key: 'open-plan' })
  expect(fills).toEqual([`@${PLAN} `])
  await ui.unmount()
})

test('tab Pipeline: sei fasi', async ($, on) => {
  world(on, [])
  const ui = await setup($, 'terminal')
  await ui.press({ key: 'tab-pipeline' })
  expect(await ui.find({ key: 'phase-1' })).toBeDefined()
  expect(await ui.find({ key: 'phase-6' })).toBeDefined()
  await ui.unmount()
})

const other = {
  v: 1, sessionId: 'o', repoRoot: ROOT, repoName: 'r', worktreeRoot: '/wt', branch: 'feat/other', agents: [], recentWrites: [],
  phase: 5, badges: [], planDone: 0, planTotal: 0, lastActivity: NOW, heartbeat: NOW,
}

test('tab Agenti: blocco delle altre sessioni solo se ce ne sono', async ($, on) => {
  world(on, [], { others: [other] })
  let ui = await setup($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /feat\/other.*Code review 5\/6.*0 agenti/ })).toBeDefined()
  await ui.unmount()
})

test('tab Agenti: senza altre sessioni il blocco manca', async ($, on) => {
  world(on, [])
  const ui = await setup($, 'terminal')
  expect(await ui.find({ key: 'others' })).toBeUndefined()
  await ui.unmount()
})

test('tab: pipeline, poi agenti e sessioni', async ($, on) => {
  world(on, [], { others: [other] })
  const ui = await setup($, 'terminal')
  await ui.press({ key: 'tab-pipeline' })
  expect(await ui.find({ key: 'phase-1' })).toBeDefined()
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ key: 'phase-1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /implementer/ })).toBeDefined()
  await ui.press({ key: 'tab-sessions' })
  expect(await ui.find({ type: 'Text', text: /implementer/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /feat\/other/ })).toBeDefined()
  await ui.unmount()
})

test('tab Piano senza piano: messaggio esatto', async ($, on) => {
  world(on, [], { plan: false })
  const ui = await setup($, 'terminal')
  await ui.press({ key: 'tab-plan' })
  expect(await ui.find({ type: 'Text', text: 'Nessun piano trovato in docs/superpowers/plans/' })).toBeDefined()
  expect(await ui.find({ key: 'open-plan' })).toBeUndefined()
  await ui.unmount()
})
