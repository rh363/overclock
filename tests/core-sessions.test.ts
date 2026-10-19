import { test, expect } from 'claude-code/testing'
import { classify, isLive, isStale, sharedWrites, pruneWrites, groupSessions } from '../src/core/sessions'
import type { SessionEntry } from '../src/core/types'

const NOW = 10_000_000
function entry(over: Partial<SessionEntry> = {}): SessionEntry {
  return {
    v: 1, sessionId: 's', repoRoot: '/r/a', repoName: 'a', worktreeRoot: '/r/a', branch: 'main',
    agents: [], recentWrites: [], phase: 0, badges: [], planDone: 0, planTotal: 0,
    lastActivity: NOW, heartbeat: NOW, ...over,
  }
}

test('classify: A, B, C, none', async () => {
  const self = entry({ sessionId: 'me' })
  expect(classify(self, [])).toEqual({ kind: 'none', sameBranch: 0, worktrees: 1, otherRepos: 0 })
  const a = entry({ sessionId: 'x', worktreeRoot: '/r/a-wt', branch: 'feat' })
  expect(classify(self, [a])).toEqual({ kind: 'A', sameBranch: 0, worktrees: 2, otherRepos: 0 })
  const b = entry({ sessionId: 'y', repoRoot: '/r/b', repoName: 'b', worktreeRoot: '/r/b' })
  expect(classify(self, [b])).toEqual({ kind: 'B', sameBranch: 0, worktrees: 1, otherRepos: 1 })
  const c = entry({ sessionId: 'z', worktreeRoot: '/r/a-wt2' })
  expect(classify(self, [c]).kind).toBe('C')
  expect(classify(self, [c]).sameBranch).toBe(1)
  expect(classify(self, [a, c]).kind).toBe('C')
})

test('classify: fuori da git e mai C', async () => {
  const self = entry({ sessionId: 'me', repoRoot: null, worktreeRoot: '/tmp/x', branch: null })
  const o = entry({ sessionId: 'o', repoRoot: null, worktreeRoot: '/tmp/y', branch: null })
  const r = classify(self, [o])
  expect(r.kind).toBe('B')
  expect(r.otherRepos).toBe(1)
})

test('liveness', async () => {
  expect(isLive(entry({ heartbeat: NOW - 59_999 }), NOW)).toBe(true)
  expect(isLive(entry({ heartbeat: NOW - 60_001 }), NOW)).toBe(false)
  expect(isStale(entry({ heartbeat: NOW - 86_400_001 }), NOW)).toBe(true)
  expect(isStale(entry({ heartbeat: NOW - 1000 }), NOW)).toBe(false)
})

test('sharedWrites', async () => {
  const w = (ago: number) => [{ path: 'src/a.ts', at: NOW - ago }]
  const self = entry({ sessionId: 'me', recentWrites: w(60_000) })
  const o = entry({ sessionId: 'o', recentWrites: w(180_000) })
  const r = sharedWrites(self, [o], NOW)
  expect(r).toEqual([{ path: 'src/a.ts', sessionIds: ['me', 'o'], at: NOW - 60_000 }])
  expect(sharedWrites(self, [entry({ sessionId: 'o', recentWrites: w(360_000) })], NOW)).toEqual([])
  expect(sharedWrites(self, [entry({ sessionId: 'o', branch: 'x', recentWrites: w(1000) })], NOW)).toEqual([])
})

test('pruneWrites', async () => {
  const kept = pruneWrites([{ path: 'a', at: NOW - 299_999 }, { path: 'b', at: NOW - 300_001 }], NOW)
  expect(kept.map((x) => x.path)).toEqual(['a'])
})

test('groupSessions', async () => {
  const me = entry({ sessionId: 'me', repoRoot: '/r/z', repoName: 'z', worktreeRoot: '/r/z' })
  const idle = entry({ sessionId: 'idle', repoRoot: '/r/z', repoName: 'z', worktreeRoot: '/r/z2', lastActivity: NOW - 660_000 })
  const act = entry({ sessionId: 'act', repoRoot: '/r/z', repoName: 'z', worktreeRoot: '/r/z3' })
  const other = entry({ sessionId: 'oth', repoRoot: '/r/a', repoName: 'a', worktreeRoot: '/r/a' })
  const dead = entry({ sessionId: 'dead', heartbeat: NOW - 120_000 })
  const g = groupSessions([other, dead, idle, me, act], 'me', NOW)
  expect(g.map((x) => x.repoName)).toEqual(['z', 'a'])
  expect(g[0]!.kind).toBe('C')
  expect(g[0]!.branches).toHaveLength(1)
  const ss = g[0]!.branches[0]!.sessions
  expect(ss.map((s) => s.sessionId)).toEqual(['me', 'act', 'idle'])
  expect(ss[0]!.isSelf).toBe(true)
  expect(ss[2]!.isIdle).toBe(true)
  expect(g[1]!.kind).toBe('B')
})
