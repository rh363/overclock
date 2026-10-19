// Self-contained state contract (no imports allowed). These shapes mirror src/core/types.ts
// and Tab in src/core/commands.ts; adapters/atoms.ts is type-checked against them.
export type OcTokens = { input: number; output: number }
export type OcAgentNode = {
  id: string; parentId: string; toolUseId: string; type: string; description: string
  background: boolean; status: 'running' | 'done' | 'failed' | 'aborted'; startedAt: number; endedAt?: number
  tokens: OcTokens; lastTool?: string
}
export type OcPhase = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type OcBadge = 'TDD' | 'Debug' | 'Verifica'
export type OcCycle = {
  phase: OcPhase
  history: { phase: OcPhase; skill: string; at: number }[]
  badges: { name: OcBadge; at: number }[]
}
export type OcPipeline = {
  current: OcCycle; cycles: OcCycle[]
  plan: { specPath?: string; planPath?: string; pinned: { spec: boolean; plan: boolean }; done: number; total: number }
  updatedAt: number
}
export type OcSession = {
  v: 1; sessionId: string; repoRoot: string | null; repoName: string; worktreeRoot: string
  branch: string | null; agents: OcAgentNode[]; recentWrites: { path: string; at: number }[]
  phase: OcPhase; badges: OcBadge[]; planDone: number; planTotal: number
  lastActivity: number; heartbeat: number
}

declare module 'claude-code' {
  interface PluginState {
    overclock: {
      agents: { nodes: OcAgentNode[]; mainTokens: OcTokens }
      pipeline: OcPipeline | null
      self: OcSession | null
      others: OcSession[]
      tab: 'agents' | 'pipeline' | 'plan' | 'sessions'
      planText: string
      autoOpened: boolean
      toastShown: boolean
    }
  }
}
