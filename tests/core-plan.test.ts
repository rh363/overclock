import { test, expect } from 'claude-code/testing'
import { countCheckboxes, pickLatest, classifyDocPath, percent, SPEC_DIR, PLAN_DIR } from '../src/core/plan'

test('countCheckboxes', async () => {
  expect(countCheckboxes('- [ ] a\n- [x] b\n  * [X] c\n- [] no\n[ ] no')).toEqual({ done: 2, total: 3 })
})

test('piano vuoto', async () => {
  expect(countCheckboxes('')).toEqual({ done: 0, total: 0 })
  expect(percent(0, 0)).toBe(0)
  expect(percent(1, 3)).toBe(33)
  expect(percent(2, 3)).toBe(67)
})

test('pickLatest', async () => {
  expect(pickLatest([])).toBeUndefined()
  expect(
    pickLatest([
      { name: 'a.md', kind: 'file', mtimeMs: 10 },
      { name: 'b.md', kind: 'file', mtimeMs: 30 },
      { name: 'dir.md', kind: 'directory', mtimeMs: 99 },
      { name: 'c.txt', kind: 'file', mtimeMs: 50 },
    ]),
  ).toBe('b.md')
  expect(pickLatest([{ name: 'c.txt', kind: 'file', mtimeMs: 1 }])).toBeUndefined()
})

test('classifyDocPath', async () => {
  expect(SPEC_DIR).toBe('docs/superpowers/specs')
  expect(PLAN_DIR).toBe('docs/superpowers/plans')
  expect(classifyDocPath('docs/superpowers/specs/x.md')).toBe('spec')
  expect(classifyDocPath('docs/superpowers/plans/x.md')).toBe('plan')
  expect(classifyDocPath('docs/superpowers/plans/sub/x.md')).toBeNull()
  expect(classifyDocPath('docs/superpowers/plans/x.txt')).toBeNull()
  expect(classifyDocPath('src/x.ts')).toBeNull()
})
