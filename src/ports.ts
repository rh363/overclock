import type { PipelineState, SessionEntry } from './core/types'

export interface StatePort {
  putSession(e: SessionEntry): Promise<void>
  deleteSession(id: string): Promise<void>
  /** Prunes stale entries, drops malformed ones. */
  listSessions(now: number): Promise<SessionEntry[]>
  getPipeline(id: string): Promise<PipelineState | undefined>
  putPipeline(id: string, p: PipelineState): Promise<void>
  deletePipeline(id: string): Promise<void>
}

export interface FilePort {
  /** undefined when the file is missing or the read fails. */
  read(path: string): Promise<string | undefined>
  /** [] when the directory is missing. */
  list(dir: string): Promise<{ name: string; kind: string; mtimeMs: number }[]>
  exists(path: string): Promise<boolean>
}

export type GitInfo = { repoRoot: string; worktreeRoot: string; branch: string }
