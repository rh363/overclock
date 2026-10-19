import type { AgentEvent, AgentNode, AgentStatus, AgentTree, Tokens, TurnReason } from './types'

export const MAX_DONE_AGENTS = 50

export function emptyTree(): AgentTree {
  return { nodes: [], mainTokens: { input: 0, output: 0 } }
}

export function activeCount(tree: AgentTree): number {
  return tree.nodes.filter((n) => n.status === 'running').length
}

const STATUS_BY_REASON: Record<TurnReason, AgentStatus> = {
  answer: 'done',
  error: 'failed',
  refusal: 'failed',
  aborted: 'aborted',
}

function addUsage(t: Tokens, u?: { input_tokens: number; output_tokens: number }): Tokens {
  if (!u) return t
  return { input: t.input + u.input_tokens, output: t.output + u.output_tokens }
}

// Keep every running node plus the MAX_DONE_AGENTS most recently ended ones,
// preserving the original order.
function prune(nodes: AgentNode[]): AgentNode[] {
  const finished = nodes.filter((n) => n.status !== 'running')
  if (finished.length <= MAX_DONE_AGENTS) return nodes
  const keep = new Set(
    finished
      .map((n, i) => ({ n, i }))
      .sort((a, b) => (b.n.endedAt ?? 0) - (a.n.endedAt ?? 0) || b.i - a.i)
      .slice(0, MAX_DONE_AGENTS)
      .map((x) => x.n),
  )
  return nodes.filter((n) => n.status === 'running' || keep.has(n))
}

function patch(tree: AgentTree, id: string, fn: (n: AgentNode) => AgentNode): AgentTree {
  if (!tree.nodes.some((n) => n.id === id)) return tree
  return { ...tree, nodes: tree.nodes.map((n) => (n.id === id ? fn(n) : n)) }
}

export function reduceAgents(tree: AgentTree, ev: AgentEvent): AgentTree {
  switch (ev.kind) {
    case 'agent.started': {
      const node: AgentNode = {
        id: ev.id,
        parentId: ev.parentId ?? 'main',
        toolUseId: ev.toolUseId,
        type: ev.type,
        description: ev.description,
        background: ev.background,
        status: 'running',
        startedAt: ev.at,
        tokens: { input: 0, output: 0 },
      }
      const exists = tree.nodes.some((n) => n.id === ev.id)
      return { ...tree, nodes: exists ? tree.nodes.map((n) => (n.id === ev.id ? node : n)) : [...tree.nodes, node] }
    }
    case 'agent.resumed':
      return patch(tree, ev.id, (n) => ({ ...n, status: 'running', endedAt: undefined }))
    case 'agent.ended': {
      const next = patch(tree, ev.id, (n) => ({
        ...n,
        status: STATUS_BY_REASON[ev.reason],
        endedAt: ev.at,
        tokens: addUsage(n.tokens, ev.usage),
      }))
      return next === tree ? tree : { ...next, nodes: prune(next.nodes) }
    }
    case 'agent.tool':
      return patch(tree, ev.id, (n) => ({ ...n, lastTool: ev.tool }))
    case 'main.turn':
      return { ...tree, mainTokens: addUsage(tree.mainTokens, ev.usage) }
    case 'agents.reconcile': {
      const live = new Set(ev.liveIds)
      if (!tree.nodes.some((n) => n.status === 'running' && !live.has(n.id))) return tree
      const nodes = tree.nodes.map((n) =>
        n.status === 'running' && !live.has(n.id) ? { ...n, status: 'done' as const, endedAt: ev.at } : n,
      )
      return { ...tree, nodes: prune(nodes) }
    }
  }
}
