// Sessions tab for Desktop: one card per session, grouped by repo.
import { STATUS_SYMBOL } from './graph-text'
import { groupHeader, sessionCard } from './view-model'
import type { SessionsView } from './view-model'

export function SessionsCards({ view, now, Box, Text }: { view: SessionsView; now: number; Box: any; Text: any }) {
  const selfGroup = view.groups.find((g) => g.branches.some((b) => b.sessions.some((s) => s.isSelf)))
  const selfBranch = selfGroup?.branches.find((b) => b.sessions.some((s) => s.isSelf))?.branch
  return (
    <Box flexDirection="column">
      <Text dimColor>{view.summary}</Text>
      {view.groups.map((g) => (
        <Box key={`g-${g.repoRoot ?? g.repoName}`} flexDirection="column" marginTop={1}>
          <Text bold>{groupHeader(g)}</Text>
          {g.branches.map((br) => (
            <Box key={`b-${br.branch ?? ''}`} flexDirection="column">
              <Box flexWrap="wrap">
                {br.sessions.map((s) => {
                  const c = sessionCard(s, g.kind, now)
                  return (
                    <Box key={`s-${c.id}`} marginRight={1} marginBottom={1} width={34}>
                      <Box width={1} backgroundColor={c.color} />
                      <Box flexDirection="column" paddingX={1} flexGrow={1}>
                        <Box>
                          <Text bold dimColor={c.isIdle} color={c.color}>{c.label}</Text>
                          {c.isSelf && <Text backgroundColor="#555555" color="#ffffff">{' tu '}</Text>}
                        </Box>
                        <Text dimColor>{c.meta}</Text>
                        {c.planTotal > 0 && (
                          <Box>
                            <Box width={`${c.planPercent}%`} height={1} backgroundColor={c.color} />
                            <Box width={`${100 - c.planPercent}%`} height={1} backgroundColor="#555555" />
                          </Box>
                        )}
                        {c.agents.length === 0 ? <Text dimColor>nessun agente attivo</Text> : null}
                        {c.agents.map((a) => (
                          <Box key={`a-${a.id}`}>
                            <Text dimColor={a.status !== 'running'}>{`${STATUS_SYMBOL[a.status]} ${a.label}  ${a.tokensText}`}</Text>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )
                })}
              </Box>
              {g === selfGroup && br.branch === selfBranch
                ? view.warnings.map((w) => <Box key={`w-${w.path}`}><Text color="#c0642a">{w.text}</Text></Box>)
                : null}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}
