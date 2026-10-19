import type { EngineInterface } from 'claude-code'
import type { FilePort, GitInfo } from '../ports'
import { joinPath, dirname, basename } from '../core/paths'
import { parseDotGitFile, parseHead, repoRootFromGitDir } from '../core/git'

export function filePort($: EngineInterface): FilePort {
  return {
    async read(path) {
      try {
        const r = await $.fs.read(path)
        return typeof r === 'string' ? r : undefined
      } catch {
        return undefined
      }
    },
    async list(dir) {
      try {
        const entries = await $.fs.list(dir)
        return entries.map((e) => ({ name: e.name, kind: e.kind, mtimeMs: e.mtimeMs }))
      } catch {
        return []
      }
    },
    async exists(path) {
      try {
        return await $.fs.exists(path)
      } catch {
        return false
      }
    },
  }
}

/** Resolves `.` and `..` segments of an absolute path. */
function normalize(p: string): string {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return '/' + out.join('/')
}

/** Walks up from `cwd` looking for `<dir>/.git`; null outside git. */
export async function resolveGitInfo(fp: FilePort, cwd: string): Promise<GitInfo | null> {
  let dir = cwd
  for (;;) {
    const dotGit = joinPath(dir, '.git')
    if (await fp.exists(dotGit)) {
      const raw = parseDotGitFile((await fp.read(dotGit)) ?? '')
      // A relative gitdir is relative to the directory holding the .git file.
      const gitDir = raw === null ? dotGit : raw.startsWith('/') ? raw : normalize(joinPath(dir, raw))
      const head = await fp.read(joinPath(gitDir, 'HEAD'))
      return {
        repoRoot: repoRootFromGitDir(gitDir),
        worktreeRoot: dir,
        branch: head === undefined ? 'unknown' : parseHead(head),
      }
    }
    const parent = dirname(dir)
    if (parent === dir || basename(dir) === '') return null
    dir = parent
  }
}
