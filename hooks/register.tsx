import type { EngineInterface, Register } from 'claude-code'
import {
  carryOverOnClear, configure, dispatchAgent, endSession, initSession, logError, maybeAutoOpen, onSkill, onWrite,
  refreshGit, takeClearedId,
} from '../src/app/runtime'

const GIT_MOVE = /\bgit\s+(checkout|switch|worktree)\b/

// Overclock only observes: a failure of its own must never reach the event chain.
async function safe($: EngineInterface, work: () => Promise<void>): Promise<void> {
  try {
    await work()
  } catch (err) {
    logError($, err)
  }
}

// Events that can gate (deny, block): if a hook of ours ever fails, the event goes on as if
// we were not there. `next` is replay-safe inside a catch.
const passThrough = <E, R>(_$: unknown, e: E, next: (e: E) => R): R => next(e)

export const register: Register = (on, options) => {
  configure(options)

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await safe($, async () => {
      await $.command.register({
        name: 'overclock',
        description: 'Pannello di Overclock: agenti, pipeline, piano, sessioni',
        argumentHint: '[agents|pipeline|plan|sessions|pin|unpin|phase|reset]',
        immediate: true,
      })
      await initSession($)
    })
    return r
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    const id = r.agentId
    if (id) {
      await safe($, async () => {
        const at = await $.clock.now()
        await dispatchAgent(
          $,
          e.resume
            ? { kind: 'agent.resumed', id, at }
            : {
                kind: 'agent.started', id, at, parentId: e.parentAgentId, toolUseId: e.tool_use_id,
                type: e.subagentType, description: e.description, background: e.background,
              },
        )
        await maybeAutoOpen($)
      })
    }
    return r
  }).catch(passThrough)

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await safe($, async () => {
      const usage = e.usage
      if (e.agentId) {
        await dispatchAgent($, { kind: 'agent.ended', id: e.agentId, reason: e.reason, usage, at: await $.clock.now() })
      } else {
        await dispatchAgent($, { kind: 'main.turn', usage })
      }
    })
    return r
  })

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await safe($, () => refreshGit($))
    return r
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    await safe($, async () => {
      if (e.agentId) await dispatchAgent($, { kind: 'agent.tool', id: e.agentId, tool: e.tool })
      const ok = r.deny === undefined && !r.isError
      if ((e.tool === 'Write' || e.tool === 'Edit') && ok && typeof e.file_path === 'string') {
        await onWrite($, e.file_path)
      }
      const moved =
        (e.tool === 'Bash' && typeof e.command === 'string' && GIT_MOVE.test(e.command)) ||
        e.tool === 'EnterWorktree' ||
        e.tool === 'ExitWorktree'
      if (moved) await refreshGit($)
    })
    return r
  }).catch(passThrough)

  on('skill.prompt', async ($, e, next) => {
    const r = await next(e)
    // onSkill opens the pane itself when the phase changes.
    await safe($, () => onSkill($, e.skill, e.pluginName))
    return r
  })

  on('session.end', async ($, e, next) => {
    await safe($, () => endSession($, e.sessionId, e.reason))
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    // An event since the /clear may already have done the carry-over (see ensureInit).
    const oldId = e.source === 'clear' ? takeClearedId() : undefined
    if (oldId !== undefined) await safe($, () => carryOverOnClear($, oldId))
    return r
  }).catch(passThrough)
}
