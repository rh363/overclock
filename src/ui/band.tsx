// Band above the prompt and spinner suffix. Both read state through atoms declared here:
// the host only accepts state sources declared in the calling file.
import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import { emptyTree } from '../core/agents'
import { bandView, caseDetail, spinnerSuffix } from './view-model'

const agentsAtom = atom({ plugin: 'overclock', key: 'agents' } as const, emptyTree())
const pipelineAtom = atom({ plugin: 'overclock', key: 'pipeline' } as const, null)
const selfAtom = atom({ plugin: 'overclock', key: 'self' } as const, null)
const othersAtom = atom({ plugin: 'overclock', key: 'others' } as const, [])

export async function renderBand($: EngineInterface, e: any, next: (e: any) => any): Promise<any> {
  if (e.props.hasSurvey) return next(e)
  const [self, others, pipeline] = await Promise.all([read($, selfAtom), read($, othersAtom), read($, pipelineAtom)])
  const below = await next(e)
  if (!self) return below
  const v = bandView({ self, others, pipeline }, await $.clock.now())
  const detail = caseDetail(self, others)
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      {below}
      <Box>
        <Box key="case"><Text color={v.case.color} bold>{v.case.label}</Text></Box>
        {detail !== '' && <Box key="detail"><Text dimColor>{` · ${detail}`}</Text></Box>}
        {v.specName !== undefined && <Box key="spec"><Text dimColor>{` · Spec: ${v.specName}`}</Text></Box>}
        {v.planName !== undefined && <Box key="plan"><Text>{` · Piano ${v.planDone}/${v.planTotal} (${v.planPercent}%)`}</Text></Box>}
        {v.phase > 0 && <Box key="phase"><Text>{` · Fase ${v.phase}/6`}</Text></Box>}
        {v.warning !== undefined && <Box key="warning"><Text color="#c0642a">{` · ${v.warning}`}</Text></Box>}
      </Box>
    </Box>
  )
}

export async function renderSpinner($: EngineInterface, e: any, next: (e: any) => any): Promise<any> {
  const suffix = spinnerSuffix(await read($, agentsAtom))
  return next(suffix === undefined ? e : { ...e, props: { ...e.props, suffix } })
}
