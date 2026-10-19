import type { EngineInterface } from 'claude-code'
import type { StatePort } from '../ports'
import type { PipelineState, SessionEntry } from '../core/types'
import { isStale } from '../core/sessions'

const SESSION = 'session:'
const PIPELINE = 'pipeline:'
// session.end drops the session entry but keeps the pipeline for --resume; prune old ones here.
const PIPELINE_MAX_AGE_MS = 30 * 86_400_000

function isSessionEntry(v: unknown): v is SessionEntry {
  if (typeof v !== 'object' || v === null) return false
  const o = v as { v?: unknown; sessionId?: unknown }
  return o.v === 1 && typeof o.sessionId === 'string'
}

export function storePort($: EngineInterface): StatePort {
  return {
    async putSession(e) {
      await $.store.set(SESSION + e.sessionId, e)
    },
    async deleteSession(id) {
      await $.store.delete(SESSION + id)
    },
    async listSessions(now) {
      const keys = await $.store.keys()
      const out: SessionEntry[] = []
      for (const key of keys) {
        if (!key.startsWith(SESSION)) continue
        const v = await $.store.get(key)
        if (!isSessionEntry(v)) continue
        if (isStale(v, now)) {
          await $.store.delete(key)
          await $.store.delete(PIPELINE + key.slice(SESSION.length))
        } else out.push(v)
      }
      for (const key of keys) {
        if (!key.startsWith(PIPELINE)) continue
        const v = (await $.store.get(key)) as { updatedAt?: unknown } | undefined | null
        if (typeof v === 'object' && v !== null && typeof v.updatedAt === 'number' && now - v.updatedAt > PIPELINE_MAX_AGE_MS) {
          await $.store.delete(key)
        }
      }
      return out
    },
    async getPipeline(id) {
      const v = await $.store.get(PIPELINE + id)
      return typeof v === 'object' && v !== null ? (v as PipelineState) : undefined
    },
    async putPipeline(id, p) {
      await $.store.set(PIPELINE + id, p)
    },
    async deletePipeline(id) {
      await $.store.delete(PIPELINE + id)
    },
  }
}
