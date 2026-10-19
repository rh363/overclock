import type { SessionCase, SessionEntry } from './types'

export const LIVE_MS = 60_000
export const STALE_MS = 86_400_000
export const SHARED_WRITE_MS = 300_000
export const IDLE_MS = 600_000

export function isLive(e: SessionEntry, now: number): boolean {
  return now - e.heartbeat <= LIVE_MS
}
export function isStale(e: SessionEntry, now: number): boolean {
  return now - e.heartbeat > STALE_MS
}

// A null repoRoot never equals anything, so out-of-git sessions are never "same repo".
const sameRepo = (a: SessionEntry, b: SessionEntry) => a.repoRoot !== null && a.repoRoot === b.repoRoot
const sameBranchOf = (a: SessionEntry, b: SessionEntry) => sameRepo(a, b) && a.branch === b.branch

// `others` are already filtered to live sessions, without `self`.
export function classify(
  self: SessionEntry,
  others: SessionEntry[],
): { kind: SessionCase; sameBranch: number; worktrees: number; otherRepos: number } {
  const sameBranch = others.filter((o) => sameBranchOf(self, o)).length
  const worktrees = new Set([self, ...others.filter((o) => sameRepo(self, o))].map((e) => e.worktreeRoot)).size
  const otherRepos = new Set(
    others.filter((o) => !sameRepo(self, o)).map((o) => o.repoRoot ?? `wt:${o.worktreeRoot}`),
  ).size
  let kind: SessionCase = 'none'
  if (others.length > 0) kind = sameBranch > 0 ? 'C' : worktrees > 1 ? 'A' : 'B'
  return { kind, sameBranch, worktrees, otherRepos }
}

export function sharedWrites(
  self: SessionEntry,
  others: SessionEntry[],
  now: number,
): { path: string; sessionIds: string[]; at: number }[] {
  const byPath = new Map<string, { ids: string[]; at: number }>()
  for (const e of [self, ...others.filter((o) => sameBranchOf(self, o))]) {
    const seen = new Set<string>()
    for (const w of e.recentWrites) {
      if (now - w.at > SHARED_WRITE_MS) continue
      const cur = byPath.get(w.path) ?? { ids: [], at: 0 }
      if (!seen.has(w.path)) {
        cur.ids.push(e.sessionId)
        seen.add(w.path)
      }
      cur.at = Math.max(cur.at, w.at)
      byPath.set(w.path, cur)
    }
  }
  const out: { path: string; sessionIds: string[]; at: number }[] = []
  for (const [path, v] of byPath) if (v.ids.length >= 2) out.push({ path, sessionIds: v.ids, at: v.at })
  return out
}

export function pruneWrites(writes: { path: string; at: number }[], now: number) {
  return writes.filter((w) => now - w.at <= SHARED_WRITE_MS)
}

export type SessionGroup = {
  repoName: string
  repoRoot: string | null
  kind: SessionCase
  branches: { branch: string | null; sessions: (SessionEntry & { isSelf: boolean; isIdle: boolean })[] }[]
}

export function groupSessions(all: SessionEntry[], selfId: string, now: number): SessionGroup[] {
  const kept = all.filter((e) => e.sessionId === selfId || isLive(e, now))
  const self = kept.find((e) => e.sessionId === selfId)
  const keyOf = (e: SessionEntry) => e.repoRoot ?? e.worktreeRoot
  const groups = new Map<string, SessionEntry[]>()
  for (const e of kept) {
    const k = keyOf(e)
    groups.set(k, [...(groups.get(k) ?? []), e])
  }
  const selfKey = self ? keyOf(self) : undefined
  const selfBranch = self ? self.branch : undefined
  const out: SessionGroup[] = []
  for (const [key, members] of groups) {
    const isSelfGroup = key === selfKey
    let kind: SessionCase
    if (isSelfGroup && self) {
      kind = classify(self, kept.filter((e) => e !== self)).kind
    } else {
      const perBranch = new Map<string | null, number>()
      for (const m of members) perBranch.set(m.branch, (perBranch.get(m.branch) ?? 0) + 1)
      const shared = members[0]!.repoRoot !== null && [...perBranch.values()].some((n) => n >= 2)
      const wts = new Set(members.map((m) => m.worktreeRoot)).size
      kind = members[0]!.repoRoot === null ? 'B' : shared ? 'C' : wts >= 2 ? 'A' : 'B'
    }
    const names = [...new Set(members.map((m) => m.branch))].sort((a, b) => {
      if (isSelfGroup && a !== b) {
        if (a === selfBranch) return -1
        if (b === selfBranch) return 1
      }
      return (a ?? '').localeCompare(b ?? '')
    })
    const branches = names.map((branch) => {
      const ss = members
        .filter((m) => m.branch === branch)
        .map((m) => ({ ...m, isSelf: m.sessionId === selfId, isIdle: now - m.lastActivity > IDLE_MS }))
      // Active first, idle last; Array.sort is stable.
      ss.sort((a, b) => Number(a.isIdle) - Number(b.isIdle))
      return { branch, sessions: ss }
    })
    out.push({ repoName: members[0]!.repoName, repoRoot: members[0]!.repoRoot, kind, branches })
  }
  out.sort((a, b) => {
    const as = a.branches.some((br) => br.sessions.some((s) => s.isSelf))
    const bs = b.branches.some((br) => br.sessions.some((s) => s.isSelf))
    if (as !== bs) return as ? -1 : 1
    return a.repoName.localeCompare(b.repoName)
  })
  return out
}
