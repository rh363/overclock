import type { Phase } from './types'

export type Tab = 'agents' | 'pipeline' | 'plan' | 'sessions'
export type OverclockCommand =
  | { kind: 'toggle' } | { kind: 'open'; tab: Tab }
  | { kind: 'pin'; target: 'spec' | 'plan'; path: string } | { kind: 'unpin' }
  | { kind: 'phase'; phase: Phase } | { kind: 'reset' } | { kind: 'error'; message: string }

const USAGE = 'Uso: /overclock [agents|pipeline|plan|sessions|pin spec|plan <path>|unpin|phase <0-6>|reset]'
const TABS: Tab[] = ['agents', 'pipeline', 'plan', 'sessions']
const fail = (): OverclockCommand => ({ kind: 'error', message: USAGE })

// Parses the argument string of /overclock.
export function parseCommand(args: string): OverclockCommand {
  const s = args.trim()
  if (s === '') return { kind: 'toggle' }
  if ((TABS as string[]).includes(s)) return { kind: 'open', tab: s as Tab }
  if (s === 'unpin') return { kind: 'unpin' }
  if (s === 'reset') return { kind: 'reset' }
  const m = /^(\S+)\s+(.+)$/.exec(s)
  if (!m) return fail()
  const head = m[1]!
  const rest = m[2]!
  if (head === 'pin') {
    const p = /^(spec|plan)\s+(.+)$/.exec(rest)
    return p ? { kind: 'pin', target: p[1]! as 'spec' | 'plan', path: p[2]!.trim() } : fail()
  }
  if (head === 'phase' && /^[0-6]$/.test(rest)) return { kind: 'phase', phase: Number(rest) as Phase }
  return fail()
}
