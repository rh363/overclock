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
export type AgentEvent =
  | { kind: 'agent.started'; id: string; parentId?: string; toolUseId: string; type: string; description: string; background: boolean; at: number }
  | { kind: 'agent.resumed'; id: string; at: number }
  | { kind: 'agent.ended'; id: string; reason: TurnReason; usage?: { input_tokens: number; output_tokens: number }; at: number }
  | { kind: 'agent.tool'; id: string; tool: string }
  | { kind: 'main.turn'; usage?: { input_tokens: number; output_tokens: number } }
  | { kind: 'agents.reconcile'; liveIds: string[]; at: number }

export type Phase = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type BadgeName = 'TDD' | 'Debug' | 'Verifica'
export interface PipelineCycle { phase: Phase; history: { phase: Phase; skill: string; at: number }[]; badges: { name: BadgeName; at: number }[] }
export interface PlanRef { specPath?: string; planPath?: string; pinned: { spec: boolean; plan: boolean }; done: number; total: number }
export interface PipelineState { current: PipelineCycle; cycles: PipelineCycle[]; plan: PlanRef; updatedAt: number }
export type PhaseMap = Record<string, { phase: Phase } | { badge: BadgeName }>
