// The Overclock pane: four tabs over the agents, the pipeline, the plan and the sessions.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import { emptyTree } from '../core/agents'
import type { Tab } from '../core/commands'
import { PHASE_NAMES } from '../core/phases'
import type { SessionEntry } from '../core/types'
import { GraphText } from './graph-text'
import { agentGraphSvg } from './graph-svg'
import { agentsView, caseStyle, pipelineView } from './view-model'

// Atoms are declared here: the host refuses state sources declared in another file.
const tabAtom = atom({ plugin: 'overclock', key: 'tab' } as const, 'agents')
const agentsAtom = atom({ plugin: 'overclock', key: 'agents' } as const, emptyTree())
const pipelineAtom = atom({ plugin: 'overclock', key: 'pipeline' } as const, null)
const selfAtom = atom({ plugin: 'overclock', key: 'self' } as const, null)
const othersAtom = atom({ plugin: 'overclock', key: 'others' } as const, [])
const planTextAtom = atom({ plugin: 'overclock', key: 'planText' } as const, '')

const TABS: { tab: Tab; key: string; label: string; hotkey: string }[] = [
  { tab: 'agents', key: 'tab-agents', label: 'Agenti', hotkey: '1' },
  { tab: 'pipeline', key: 'tab-pipeline', label: 'Pipeline', hotkey: '2' },
  { tab: 'plan', key: 'tab-plan', label: 'Piano', hotkey: '3' },
  { tab: 'sessions', key: 'tab-sessions', label: 'Sessioni', hotkey: '4' },
]
const PLAN_DIR_HINT = 'Nessun piano trovato in docs/superpowers/plans/'
const PIPE_SYMBOL = { done: '✓', current: '●', todo: '○' } as const

const hhmm = (at: number): string => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function sessionLine(s: SessionEntry, self: SessionEntry | null): string {
  const style = caseStyle(s, self ? [self] : [])
  const symbol = style.symbol !== '' ? style.symbol : '▣'
  const phase = s.phase > 0 ? `${PHASE_NAMES[s.phase - 1]} ${s.phase}/${PHASE_NAMES.length}` : `— ${s.phase}/${PHASE_NAMES.length}`
  const running = s.agents.filter((a) => a.status === 'running').length
  return `${symbol} ${s.branch ?? s.repoName}  ${phase}  ${running} agenti`
}

export async function renderPane($: EngineInterface, e: any): Promise<any> {
  try {
    const [tab, tree, pipeline, self, others, planText, now] = await Promise.all([
      read($, tabAtom), read($, agentsAtom), read($, pipelineAtom), read($, selfAtom), read($, othersAtom),
      read($, planTextAtom), $.clock.now(),
    ])
    const ui = $.ui.resolve(e) as any
    const { Box, Text, Button, Markdown, Svg } = ui
    // resolve() hands out an Svg stub even on the terminal, so the surface decides too.
    const hasSvg = e.surface !== 'terminal' && 'Svg' in ui

    const header = (
      <Box key="tabs">
        {TABS.map((t) => (
          <Button
            key={t.key}
            label={t.label}
            hotkey={t.hotkey}
            dimColor={tab !== t.tab}
            onPress={() => update($, tabAtom, () => t.tab)}
          />
        ))}
      </Box>
    )

    let body: any
    if (tab === 'pipeline') {
      const v = pipelineView(pipeline ?? emptyPipelineLike())
      body = (
        <Box flexDirection="column">
          {v.phases.map((p) => (
            <Box key={`phase-${p.n}`}>
              <Text dimColor={p.state === 'todo'} bold={p.state === 'current'}>
                {`${PIPE_SYMBOL[p.state]} ${p.name}${p.enteredAt !== undefined ? `  ${hhmm(p.enteredAt)}` : ''}${p.skill ? `  ${p.skill}` : ''}`}
              </Text>
            </Box>
          ))}
          {v.badges.length > 0 && <Text>{v.badges.map((b) => `[${b}]`).join(' ')}</Text>}
          {v.previousCycles > 0 && (
            <Text dimColor>{`${v.previousCycles} ${v.previousCycles === 1 ? 'ciclo precedente' : 'cicli precedenti'}`}</Text>
          )}
        </Box>
      )
    } else if (tab === 'plan') {
      const planPath = pipeline?.plan.planPath
      body =
        planPath === undefined || planText === '' ? (
          <Text dimColor>{PLAN_DIR_HINT}</Text>
        ) : (
          <Box flexDirection="column">
            <Box key="open-plan-row">
              <Button
                key="open-plan"
                label="Apri"
                onPress={() => void $.prompt.fill({ text: `@${planPath} `, mode: 'insert' })}
              />
            </Box>
            <Markdown text={planText} />
          </Box>
        )
    } else if (tab === 'sessions') {
      const list = (others as SessionEntry[]).map((s) => sessionLine(s, self))
      body = (
        <Box flexDirection="column">
          {list.length === 0 ? <Text dimColor>Nessun'altra sessione attiva</Text> : list.map((l, i) => <Text key={`s${i}`}>{l}</Text>)}
        </Box>
      )
    } else {
      const nodes = agentsView(tree, now)
      const lines = (others as SessionEntry[]).map((s) => sessionLine(s, self))
      body = (
        <Box flexDirection="column">
          {hasSvg ? <Svg source={agentGraphSvg(nodes, 560)} alt="Grafo degli agenti" /> : GraphText({ nodes, Box, Text })}
          {lines.length > 0 ? (
            <Box key="others" flexDirection="column">
              {lines.map((l, i) => <Box key={`o${i}`}><Text>{l}</Text></Box>)}
            </Box>
          ) : null}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {header}
        {body}
      </Box>
    )
  } catch {
    const { Text } = $.ui.resolve(e)
    return <Text>Overclock: errore di disegno</Text>
  }
}

function emptyPipelineLike() {
  return {
    current: { phase: 0 as const, history: [], badges: [] }, cycles: [],
    plan: { pinned: { spec: false, plan: false }, done: 0, total: 0 }, updatedAt: 0,
  }
}
