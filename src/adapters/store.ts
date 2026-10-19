import type { EngineInterface } from 'claude-code'
import type { StatePort } from '../ports'
import type { PipelineState, SessionEntry } from '../core/types'
import { isStale } from '../core/sessions'

const SESSION = 'session:'
const PIPELINE = 'pipeline:'
// session.end drops the session entry but keeps the pipeline for --resume; prunePipelines
// drops the old ones and caps how many are kept.
const PIPELINE_MAX_AGE_MS = 30 * 86_400_000
const PIPELINE_MAX_COUNT = 100

function isSessionEntry(v: unknown): v is SessionEntry {
  if (typeof v !== 'object' || v === null) return false
  const o = v as { v?: unknown; sessionId?: unknown }
  return o.v === 1 && typeof o.sessionId === 'string'
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// Enough of the shape for initSession and the reducers not to throw on a foreign value.
function isPipeline(v: unknown): v is PipelineState {
  if (!isObject(v) || !isObject(v.current) || !Array.isArray(v.cycles) || !isObject(v.plan)) return false
  const { phase, history, badges } = v.current
  return typeof phase === 'number' && Array.isArray(history) && Array.isArray(badges) && isObject(v.plan.pinned)
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
      return out
    },
    async prunePipelines(now, keepId) {
      const kept: { key: string; updatedAt: number }[] = []
      for (const key of await $.store.keys()) {
        if (!key.startsWith(PIPELINE) || key === PIPELINE + keepId) continue
        const v = await $.store.get(key)
        // Malformed values are not ours to judge: leave them.
        if (!isObject(v) || typeof v.updatedAt !== 'number') continue
        if (now - v.updatedAt > PIPELINE_MAX_AGE_MS) await $.store.delete(key)
        else kept.push({ key, updatedAt: v.updatedAt })
      }
      const cap = keepId === undefined ? PIPELINE_MAX_COUNT : PIPELINE_MAX_COUNT - 1
      kept.sort((a, b) => b.updatedAt - a.updatedAt)
      for (const { key } of kept.slice(cap)) await $.store.delete(key)
    },
    async getPipeline(id) {
      const v = await $.store.get(PIPELINE + id)
      return isPipeline(v) ? v : undefined
    },
    async putPipeline(id, p) {
      await $.store.set(PIPELINE + id, p)
    },
    async deletePipeline(id) {
      await $.store.delete(PIPELINE + id)
    },
  }
}
