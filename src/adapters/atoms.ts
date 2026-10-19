import { atom } from 'claude-code'
import { emptyTree } from '../core/agents'
import type { Tab } from '../core/commands'

// One atom per key of PluginState['overclock'] (keys must be literals).
export const agentsAtom = atom({ plugin: 'overclock', key: 'agents' } as const, emptyTree())
export const pipelineAtom = atom({ plugin: 'overclock', key: 'pipeline' } as const, null)
export const selfAtom = atom({ plugin: 'overclock', key: 'self' } as const, null)
export const othersAtom = atom({ plugin: 'overclock', key: 'others' } as const, [])
export const tabAtom = atom({ plugin: 'overclock', key: 'tab' } as const, 'agents' as Tab)
export const planTextAtom = atom({ plugin: 'overclock', key: 'planText' } as const, '')
export const autoOpenedAtom = atom({ plugin: 'overclock', key: 'autoOpened' } as const, false)
export const toastShownAtom = atom({ plugin: 'overclock', key: 'toastShown' } as const, false)
