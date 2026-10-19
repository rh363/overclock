// Sessions tab for the terminal: a coloured tree of groups, sessions and agents.
import { STATUS_SYMBOL } from './graph-text'
import { groupHeader, sessionCard } from './view-model'
import type { SessionsView } from './view-model'

export function SessionsText({ view, now, Box, Text }: { view: SessionsView; now: number; Box: any; Text: any }) {
  const selfGroup = view.groups.find((g) => g.branches.some((b) => b.sessions.some((s) => s.isSelf)))
  const selfBranch = selfGroup?.branches.find((b) => b.sessions.some((s) => s.isSelf))?.branch
  return (
    <Box flexDirection="column">
      <Text dimColor>{view.summary}</Text>
      {view.groups.map((g) => {
        const color = sessionCard(g.branches[0]!.sessions[0]!, g.kind, now).color
        return (
          <Box key={`g-${g.repoRoot ?? g.repoName}`} flexDirection="column" marginTop={1}>
            <Text color={color} bold>{groupHeader(g)}</Text>
            {g.branches.map((br) => (
              <Box key={`b-${br.branch ?? ''}`} flexDirection="column">
                {br.sessions.map((s) => {
                  const c = sessionCard(s, g.kind, now)
                  return (
                    <Box key={`s-${c.id}`} flexDirection="column">
                      <Box>
                        <Text color={c.color} dimColor={c.isIdle}>{`  ${c.isIdle ? '○' : '●'} ${c.label}`}</Text>
                        {c.isSelf && <Text bold>{'  tu'}</Text>}
                        <Text dimColor={c.isIdle}>{`  ${c.meta}`}</Text>
                      </Box>
                      {c.agents.map((a) => (
                        <Box key={`a-${a.id}`}>
                          <Text dimColor={a.status !== 'running'}>{`      ${STATUS_SYMBOL[a.status]} ${a.label}  ${a.tokensText}`}</Text>
                        </Box>
                      ))}
                    </Box>
                  )
                })}
                {g === selfGroup && br.branch === selfBranch
                  ? view.warnings.map((w) => <Box key={`w-${w.path}`}><Text color="#c0642a">{`  ${w.text}`}</Text></Box>)
                  : null}
              </Box>
            ))}
          </Box>
        )
      })}
    </Box>
  )
}
