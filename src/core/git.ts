// Pure parsers for .git metadata files.
import { dirname, basename } from './paths'

/** Content of a `.git` file in a worktree ("gitdir: <path>") -> the path. */
export function parseDotGitFile(content: string): string | null {
  const line = (content.split('\n')[0] ?? '').trim()
  if (!line.startsWith('gitdir:')) return null
  const path = line.slice('gitdir:'.length).trim()
  return path === '' ? null : path
}

/** Content of HEAD -> branch name, or `detached@<sha7>`. */
export function parseHead(content: string): string {
  const line = (content.split('\n')[0] ?? '').trim()
  const prefix = 'ref: refs/heads/'
  if (line.startsWith(prefix)) return line.slice(prefix.length)
  return 'detached@' + line.slice(0, 7)
}

/** `/r/.git/worktrees/wt` -> `/r`; `/r/.git` -> `/r`. */
export function repoRootFromGitDir(gitDir: string): string {
  let d = gitDir
  const parent = dirname(d)
  if (basename(parent) === 'worktrees' && basename(dirname(parent)) === '.git') d = dirname(parent)
  return dirname(d)
}
