import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { bandView, caseDetail, caseStyle } from '../src/ui/view-model'
import type { PipelineState, SessionEntry } from '../src/core/types'

const NOW = 1_000_000_000_000
const ROOT = '/r'

const entry = (o: Partial<SessionEntry> & { sessionId: string }): SessionEntry => ({
  v: 1, repoRoot: ROOT, repoName: 'r', worktreeRoot: ROOT, branch: 'main', agents: [], recentWrites: [],
  phase: 0, badges: [], planDone: 0, planTotal: 0, lastActivity: NOW, heartbeat: NOW, ...o,
})
const pipeline = (o: Partial<PipelineState['plan']>, phase: PipelineState['current']['phase'] = 4): PipelineState => ({
  current: { phase, history: [], badges: [] }, cycles: [],
  plan: { pinned: { spec: false, plan: false }, done: 0, total: 0, ...o }, updatedAt: NOW,
})

test('caseStyle: simbolo e colore di ogni caso', () => {
  const me = entry({ sessionId: 'me', branch: 'feat/x' })
  expect(caseStyle(me, [])).toMatchObject({ kind: 'none', label: '▣ r' })
  const a = caseStyle(me, [entry({ sessionId: 'o', worktreeRoot: '/wt', branch: 'other' })])
  expect(a).toEqual({ kind: 'A', symbol: '⎇', color: '#2f7d5b', label: '⎇ feat/x' })
  const b = caseStyle(me, [entry({ sessionId: 'o', repoRoot: '/z', worktreeRoot: '/z', repoName: 'z' })])
  expect(b).toEqual({ kind: 'B', symbol: '▣', color: '#4a5fc1', label: '▣ r' })
  const c = caseStyle(me, [entry({ sessionId: 'o', branch: 'feat/x' })])
  expect(c).toEqual({ kind: 'C', symbol: '⇄', color: '#c0642a', label: '⇄ feat/x ×2' })
})

test('bandView: piano vuoto ha percentuale 0, senza piano non c\'è nome', () => {
  const me = entry({ sessionId: 'me' })
  const v = bandView({ self: me, others: [], pipeline: pipeline({ planPath: 'docs/superpowers/plans/p.md' }) }, NOW)
  expect(v.planPercent).toBe(0)
  expect(v.planName).toBe('p.md')
  expect(bandView({ self: me, others: [], pipeline: null }, NOW).planName).toBeUndefined()
})

test('caseDetail: nel caso none mostra il branch di self, se c\'è', () => {
  expect(caseDetail(entry({ sessionId: 'me', branch: 'feat/x' }), [])).toBe('feat/x')
  expect(caseDetail(entry({ sessionId: 'me', branch: null }), [])).toBe('')
})

test('bandView: avviso sul primo file scritto da due sessioni', () => {
  const w = [{ path: 'src/a.ts', at: NOW }]
  const me = entry({ sessionId: 'me', recentWrites: w })
  const v = bandView({ self: me, others: [entry({ sessionId: 'o', recentWrites: w })], pipeline: null }, NOW)
  expect(v.warning).toBe('⚠ src/a.ts')
})

type Opts = { others?: SessionEntry[]; plan?: string; cwd?: string; git?: boolean }

// Bottoms for the plugin's calls; state is seeded by driving the plugin's own events.
function world(on: On, o: Opts = {}) {
  const cwd = o.cwd ?? ROOT
  const store = new Map<string, unknown>()
  for (const e of o.others ?? []) store.set(`session:${e.sessionId}`, JSON.parse(JSON.stringify(e)))
  const files: Record<string, string> = o.git === false ? {} : { [`${cwd}/.git/HEAD`]: 'ref: refs/heads/main\n' }
  const dirs: Record<string, { name: string; kind: 'file' | 'dir'; mtimeMs: number }[]> = {}
  if (o.git !== false) dirs[`${cwd}/.git`] = []
  if (o.plan !== undefined) {
    files[`${cwd}/docs/superpowers/plans/2026-01-01-p.md`] = o.plan
    dirs[`${cwd}/docs/superpowers/plans`] = [{ name: '2026-01-01-p.md', kind: 'file', mtimeMs: 1 }]
  }
  mock.clock(on, { now: NOW })
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => { store.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } })
  on('store.delete', (_$, e) => { store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: cwd }))
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
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine band</Text>
  })
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.suffix}</Text>
  })
}

const band = {
  hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 100, scroll: { offset: 0, bodyRows: 5 }, view: {},
}
const spinner = { word: 'Working', message: null, suffix: '…', mode: 'responding' as const }
const start = ($: Engine) => $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`banda su ${surface}: caso C, piano, spec e composizione`, async ($, on) => {
    world(on, { others: [entry({ sessionId: 'o', branch: 'main' })], plan: '- [x] a\n- [ ] b\n' })
    await start($)
    const ui = await $.ui.mount({ plugin: 'overclock', surface, component: 'AbovePrompt', props: band })
    expect((await ui.find({ key: 'case' }))?.text).toBe('⇄ main ×2')
    expect((await ui.find({ key: 'plan' }))?.text).toBe('Piano 1/2 (50%)')
    expect(await ui.find({ type: 'Text', text: ' · ' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: 'engine band' }))).toBeDefined()
    await ui.unmount()
  })

  test(`banda su ${surface}: piano 7/12 (58%)`, async ($, on) => {
    const md = Array.from({ length: 12 }, (_, i) => `- [${i < 7 ? 'x' : ' '}] t${i}`).join('\n')
    world(on, { plan: md })
    await start($)
    const ui = await $.ui.mount({ plugin: 'overclock', surface, component: 'AbovePrompt', props: band })
    expect((await ui.find({ key: 'plan' }))?.text).toBe('Piano 7/12 (58%)')
    await ui.unmount()
  })

  test(`banda su ${surface}: fuori da git mostra il nome della cartella`, async ($, on) => {
    world(on, { git: false, cwd: '/tmp/mia-cartella' })
    await $.session.start({ cwd: '/tmp/mia-cartella', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'overclock', surface, component: 'AbovePrompt', props: band })
    expect((await ui.find({ key: 'case' }))?.text).toBe('▣ mia-cartella')
    await ui.unmount()
  })

  test(`banda su ${surface}: con un sondaggio cede il posto`, async ($, on) => {
    world(on)
    await start($)
    const ui = await $.ui.mount({ plugin: 'overclock', surface, component: 'AbovePrompt', props: { ...band, hasSurvey: true } })
    expect(await ui.find({ key: 'case' })).toBeUndefined()
    await ui.unmount()
  })
}

test('spinner: con 2 agenti attivi il conteggio si accoda al suffisso dell\'engine', async ($, on) => {
  world(on)
  await start($)
  for (const n of ['1', '2']) {
    await $.agent.spawn({
      tool_use_id: n, prompt: 'p', description: 'd', subagentType: 'general-purpose',
      provider: { plugin: 'core', tier: 'core' }, parentModel: 'm', background: false, fork: false,
    } as never)
  }
  const ui = await $.ui.mount({ plugin: 'overclock', surface: 'terminal', component: 'Spinner', props: { ...spinner, suffix: '(esc)' } })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('(esc) · 2 agenti')
  await ui.unmount()
})

test('spinner: senza agenti attivi il suffisso resta quello dell\'engine', async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'overclock', surface: 'terminal', component: 'Spinner', props: spinner })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('…')
  await ui.unmount()
})
