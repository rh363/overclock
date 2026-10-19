import { test, expect } from 'claude-code/testing'
import { joinPath, dirname, basename, relativeTo } from '../src/core/paths'
import { parseDotGitFile, parseHead, repoRootFromGitDir } from '../src/core/git'

test('joinPath normalizza i separatori', async () => {
  expect(joinPath('/a/', 'b', 'c.md')).toBe('/a/b/c.md')
})

test('dirname e basename', async () => {
  expect(basename('/a/b/')).toBe('b')
  expect(basename('/a/b/c.md')).toBe('c.md')
  expect(dirname('/a/b/c.md')).toBe('/a/b')
  expect(dirname('/a')).toBe('/')
})

test('relativeTo', async () => {
  expect(relativeTo('/r', '/r/docs/x.md')).toBe('docs/x.md')
  expect(relativeTo('/r', '/rx/y')).toBe(null)
})

test('parseDotGitFile', async () => {
  expect(parseDotGitFile('gitdir: /r/.git/worktrees/wt\n')).toBe('/r/.git/worktrees/wt')
  expect(parseDotGitFile('garbage')).toBe(null)
})

test('parseHead', async () => {
  expect(parseHead('ref: refs/heads/feat/overclock-ui\n')).toBe('feat/overclock-ui')
  expect(parseHead('3fddd00aa1b2c3d4e5f60718293a4b5c6d7e8f90\n')).toBe('detached@3fddd00')
})

test('repoRootFromGitDir', async () => {
  expect(repoRootFromGitDir('/r/.git/worktrees/wt')).toBe('/r')
  expect(repoRootFromGitDir('/r/.git')).toBe('/r')
  expect(repoRootFromGitDir('/home/u/worktrees/.git')).toBe('/home/u/worktrees')
})
