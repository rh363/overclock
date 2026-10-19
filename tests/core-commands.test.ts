import { test, expect } from 'claude-code/testing'
import { parseCommand } from '../src/core/commands'

const USAGE = 'Uso: /overclock [agents|pipeline|plan|sessions|pin spec|plan <path>|unpin|phase <0-6>|reset]'

test('parseCommand', async () => {
  expect(parseCommand('')).toEqual({ kind: 'toggle' })
  expect(parseCommand('  ')).toEqual({ kind: 'toggle' })
  expect(parseCommand('sessions')).toEqual({ kind: 'open', tab: 'sessions' })
  expect(parseCommand('plan')).toEqual({ kind: 'open', tab: 'plan' })
  expect(parseCommand('pin spec docs/a.md')).toEqual({ kind: 'pin', target: 'spec', path: 'docs/a.md' })
  expect(parseCommand('pin plan my docs/a b.md')).toEqual({ kind: 'pin', target: 'plan', path: 'my docs/a b.md' })
  expect(parseCommand('pin spec')).toEqual({ kind: 'error', message: USAGE })
  expect(parseCommand('unpin')).toEqual({ kind: 'unpin' })
  expect(parseCommand('phase 4')).toEqual({ kind: 'phase', phase: 4 })
  expect(parseCommand('phase 0')).toEqual({ kind: 'phase', phase: 0 })
  expect(parseCommand('phase 9')).toEqual({ kind: 'error', message: USAGE })
  expect(parseCommand('phase x')).toEqual({ kind: 'error', message: USAGE })
  expect(parseCommand('reset')).toEqual({ kind: 'reset' })
  expect(parseCommand('boh')).toEqual({ kind: 'error', message: USAGE })
})
