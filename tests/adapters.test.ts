import { test, expect } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { storePort } from '../src/adapters/store'
import { filePort, resolveGitInfo } from '../src/adapters/files'
import type { SessionEntry, PipelineState } from '../src/core/types'

// The test `$` has no store/fs and test hooks may not call them (host rule), so the adapters
// run against a plain in-memory `$` of the same shape.
type Fs = Record<string, string>
function fakeEngine(store: Map<string, unknown>, files: Fs = {}): EngineInterface {
  return {
    store: {
      get: async (k: string) => store.get(k),
      set: async (k: string, v: unknown) => { store.set(k, JSON.parse(JSON.stringify(v))) },
      delete: async (k: string) => { store.delete(k) },
      keys: async () => [...store.keys()],
    },
    fs: {
      read: async (p: string) => { const t = files[p]; if (t === undefined) throw new Error('ENOENT'); return t },
      exists: async (p: string) => p in files,
      list: async () => { throw new Error('ENOENT') },
    },
  } as unknown as EngineInterface
}

const NOW = 100_000_000_000
const H = 3_600_000
function entry(over: Partial<SessionEntry> = {}): SessionEntry {
  return {
    v: 1, sessionId: 's1', repoRoot: '/r', repoName: 'r', worktreeRoot: '/r', branch: 'main',
    agents: [], recentWrites: [], phase: 0, badges: [], planDone: 0, planTotal: 0,
    lastActivity: NOW, heartbeat: NOW, ...over,
  }
}
function pipe(updatedAt: number): PipelineState {
  const cycle = { phase: 0 as const, history: [], badges: [] }
  return { current: cycle, cycles: [], plan: { pinned: { spec: false, plan: false }, done: 0, total: 0 }, updatedAt }
}

test('putSession then listSessions returns the entry', async () => {
  const port = storePort(fakeEngine(new Map()))
  await port.putSession(entry())
  expect(await port.listSessions(NOW)).toEqual([entry()])
})

test('stale session is dropped from list and store, with its pipeline', async () => {
  const store = new Map<string, unknown>()
  const port = storePort(fakeEngine(store))
  await port.putSession(entry({ heartbeat: NOW - 25 * H }))
  await port.putPipeline('s1', pipe(NOW))
  expect(await port.listSessions(NOW)).toEqual([])
  expect(store.get('session:s1')).toBeUndefined()
  expect(store.get('pipeline:s1')).toBeUndefined()
})

test('malformed session entries are ignored', async () => {
  const store = new Map<string, unknown>([['session:x', 42], ['session:y', { v: 0 }]])
  expect(await storePort(fakeEngine(store)).listSessions(NOW)).toEqual([])
})

test('pipeline older than 30 days is pruned, recent and malformed are kept', async () => {
  const store = new Map<string, unknown>()
  const port = storePort(fakeEngine(store))
  await port.putPipeline('old', pipe(NOW - 31 * 24 * H))
  await port.putPipeline('new', pipe(NOW - 29 * 24 * H))
  store.set('pipeline:bad', 'oops')
  await port.listSessions(NOW)
  expect(await port.getPipeline('old')).toBeUndefined()
  expect(await port.getPipeline('new')).toBeDefined()
  expect(store.get('pipeline:bad')).toBe('oops')
})

const git = (files: Fs, cwd: string) => resolveGitInfo(filePort(fakeEngine(new Map(), files)), cwd)

test('resolveGitInfo: worktree with absolute gitdir', async () => {
  const got = await git({ '/r/wt/.git': 'gitdir: /r/.git/worktrees/wt\n', '/r/.git/worktrees/wt/HEAD': 'ref: refs/heads/feat/a\n' }, '/r/wt/src')
  expect(got).toEqual({ repoRoot: '/r', worktreeRoot: '/r/wt', branch: 'feat/a' })
})

test('resolveGitInfo: worktree with relative gitdir', async () => {
  const got = await git({ '/r/wt/.git': 'gitdir: ../.git/worktrees/wt\n', '/r/.git/worktrees/wt/HEAD': 'ref: refs/heads/feat/a\n' }, '/r/wt')
  expect(got).toEqual({ repoRoot: '/r', worktreeRoot: '/r/wt', branch: 'feat/a' })
})

test('resolveGitInfo: normal checkout', async () => {
  const got = await git({ '/r/.git': '', '/r/.git/HEAD': 'ref: refs/heads/main\n' }, '/r/src/x')
  expect(got).toEqual({ repoRoot: '/r', worktreeRoot: '/r', branch: 'main' })
})

test('resolveGitInfo: outside git is null', async () => {
  expect(await git({}, '/tmp/x')).toBeNull()
})

test('getPipeline: un valore malformato dà undefined', async () => {
  const store = new Map<string, unknown>([
    ['pipeline:a', { current: { phase: 'x' }, cycles: [], plan: {} }],
    ['pipeline:b', { current: { phase: 1 }, cycles: {}, plan: {} }],
    ['pipeline:c', { current: { phase: 1 }, cycles: [], plan: null }],
    ['pipeline:d', { current: null, cycles: [], plan: {} }],
    ['pipeline:e', 'oops'],
  ])
  const port = storePort(fakeEngine(store))
  for (const id of ['a', 'b', 'c', 'd', 'e']) expect(await port.getPipeline(id)).toBeUndefined()
  store.set('pipeline:ok', pipe(NOW))
  expect(await port.getPipeline('ok')).toEqual(pipe(NOW))
})
