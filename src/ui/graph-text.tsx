// Text tree of the agents, for surfaces that cannot draw an Svg.
import type { agentsView } from './view-model'

type Node = ReturnType<typeof agentsView>[number]

export const STATUS_SYMBOL = { running: '●', done: '✓', failed: '✗', aborted: '■' } as const

export function GraphText({ nodes, Box, Text }: { nodes: Node[]; Box: any; Text: any }) {
  const rows = nodes.map((n, i) => {
    const branch = i === nodes.length - 1 ? '└─' : '├─'
    const detail = n.detail !== undefined ? `  ${n.detail}` : ''
    return <Text dimColor={n.status !== 'running'}>{`${branch} ${STATUS_SYMBOL[n.status]} ${n.label}${detail}  ${n.statusText}  ${n.tokensText}`}</Text>
  })
  return <Box flexDirection="column"><Text bold>Sessione main</Text>{rows}</Box>
}
