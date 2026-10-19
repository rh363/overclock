import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { sessionsView } from '../src/ui/view-model'
import type { AgentNode, SessionEntry } from '../src/core/types'

const NOW = 1_000_000_000_000
const ROOT = '/billing-api'
const MIN = 60_000

const entry = (o: Partial<SessionEntry> & { sessionId: string }): SessionEntry => ({
  v: 1, repoRoot: '/overclock', repoName: 'overclock', worktreeRoot: '/overclock', branch: 'main', agents: [], recentWrites: [],
  phase: 4, badges: [], planDone: 0, planTotal: 0, lastActivity: NOW, heartbeat: NOW, ...o,
})
const agent = (o: Partial<AgentNode> & { id: string }): AgentNode => ({
  parentId: 'main', toolUseId: `t${o.id}`, type: 'implementer', description: '', background: false,
  status: 'running', startedAt: NOW, tokens: { input: 0, output: 0 }, ...o,
})
const billing = (id: string, o: Partial<SessionEntry> = {}) =>
  entry({ sessionId: id, repoRoot: ROOT, repoName: 'billing-api', worktreeRoot: ROOT, branch: 'feat/invoices', ...o })

// Four others; the own session (id s1, billing-api @ feat/invoices) is the fifth.
const others = (): SessionEntry[] => [
  billing('7f3a', { recentWrites: [{ path: 'api/invoices.py', at: NOW - 3 * MIN }], agents: [agent({ id: 'x', type: 'implementer' })] }),
  entry({ sessionId: 'o1', worktreeRoot: '/overclock', branch: 'feat/a', planTotal: 12, planDone: 7, agents: [agent({ id: 'y', type: 'Plan' })] }),
  entry({ sessionId: 'o2', worktreeRoot: '/wt2', branch: 'feat/b', agents: [agent({ id: 'old', type: 'ghostagent', status: 'done', endedAt: NOW })] }),
  entry({ sessionId: 'o3', worktreeRoot: '/wt3', branch: 'fix/idle', lastActivity: NOW - 12 * MIN }),
]

test('sessionsView: riepilogo, ordine e agenti altrui', () => {
  const self = billing('s1', { recentWrites: [{ path: 'api/invoices.py', at: NOW }], agents: [agent({ id: 'a', tokens: { input: 100_000, output: 40_000 } })] })
  const v = sessionsView(self, others(), NOW, { input: 1000, output: 1000 })
  expect(v.summary).toBe('5 sessioni vive · 3 agenti attivi · 142k token oggi')
  const wt = v.groups.find((g) => g.repoName === 'overclock')!
  expect(wt.branches.map((b) => b.sessions.map((s) => s.sessionId).join())).toEqual(['o1', 'o2', 'o3'])
  expect(v.warnings).toHaveLength(1)
})

function world(on: On, store: Map<string, unknown>) {
  const files: Record<string, string> = { [`${ROOT}/.git/HEAD`]: 'ref: refs/heads/feat/invoices\n' }
  mock.clock(on, { now: NOW })
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => { store.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } })
  on('store.delete', (_$, e) => { store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.read', (_$, e) => (e.path in files ? { value: files[e.path]! } : { deny: 'ENOENT' }))
  on('fs.exists', (_$, e) => ({ value: e.path in files || e.path === `${ROOT}/.git` }))
  on('fs.list', (_$, e) => (e.path === `${ROOT}/.git` ? { value: [] } : { deny: 'ENOENT' }))
  on('agent.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'overclock' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('agent.spawn', (_$, e) => ({ model: 'm', agentId: `a${e.tool_use_id}` }))
  on('tool.call', () => ({ result: {} }))
}

async function open($: Engine, surface: 'terminal' | 'desktop') {
  await $.session.start({ cwd: ROOT, surface, isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/api/invoices.py`, content: 'x' })
  const ui = await $.ui.mount({ plugin: 'overclock', surface, component: 'Pane', requestId: 'overclock', props: {} } as never)
  await ui.press({ key: 'tab-sessions' })
  return ui
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`tab Sessioni su ${surface}: avviso, inattiva e agenti conclusi altrui`, async ($, on) => {
    const store = new Map<string, unknown>()
    for (const e of others()) store.set(`session:${e.sessionId}`, e)
    world(on, store)
    const ui = await open($, surface)
    expect(await ui.find({ type: 'Text', text: /5 sessioni vive/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /api\/invoices\.py scritto da entrambe \d+m fa/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /inattiva da 12 min/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /sessione 7f3a/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ghostagent/ })).toBeUndefined()
    await ui.unmount()
  })
}
