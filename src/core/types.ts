// Shared types for the pure core. Flat list of exports.

export type AgentStatus = 'running' | 'done' | 'failed' | 'aborted'
export type Tokens = { input: number; output: number }
export interface AgentNode {
  id: string; parentId: string; toolUseId: string; type: string; description: string
  background: boolean; status: AgentStatus; startedAt: number; endedAt?: number
  tokens: Tokens; lastTool?: string
}
export interface AgentTree { nodes: AgentNode[]; mainTokens: Tokens }
export type TurnReason = 'answer' | 'aborted' | 'refusal' | 'error'
/** Token counts of a turn; the cache counts are optional and absent means 0. */
export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
export type AgentEvent =
  | { kind: 'agent.started'; id: string; parentId?: string; toolUseId: string; type: string; description: string; background: boolean; at: number }
  | { kind: 'agent.resumed'; id: string; at: number }
  | { kind: 'agent.ended'; id: string; reason: TurnReason; usage?: Usage; at: number }
  | { kind: 'agent.tool'; id: string; tool: string }
  | { kind: 'main.turn'; usage?: Usage }
  // teammateIds: the live ones that are teammates, whose loop outlives a turn.
  | { kind: 'agents.reconcile'; liveIds: string[]; teammateIds?: string[]; at: number }

export type Phase = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type BadgeName = 'TDD' | 'Debug' | 'Verifica'
export interface PipelineCycle { phase: Phase; history: { phase: Phase; skill: string; at: number }[]; badges: { name: BadgeName; at: number }[] }
export interface PlanRef { specPath?: string; planPath?: string; pinned: { spec: boolean; plan: boolean }; done: number; total: number }
export interface PipelineState { current: PipelineCycle; cycles: PipelineCycle[]; plan: PlanRef; updatedAt: number }
export type PhaseMap = Record<string, { phase: Phase } | { badge: BadgeName }>

export interface SessionEntry {
  v: 1; sessionId: string; repoRoot: string | null; repoName: string; worktreeRoot: string
  branch: string | null; agents: AgentNode[]; recentWrites: { path: string; at: number }[]
  phase: Phase; badges: BadgeName[]; planDone: number; planTotal: number
  lastActivity: number; heartbeat: number
}
export type SessionCase = 'A' | 'B' | 'C' | 'none'
