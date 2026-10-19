// Pure helpers for specs and plans: checkbox progress and file selection.

export const SPEC_DIR = 'docs/superpowers/specs'
export const PLAN_DIR = 'docs/superpowers/plans'

const CHECKBOX = /^\s*[-*] \[( |x|X)\] /

/** Count markdown task-list checkboxes: done (x/X) over total. */
export function countCheckboxes(markdown: string): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const line of markdown.split('\n')) {
    const m = CHECKBOX.exec(line)
    if (!m) continue
    total++
    if (m[1] !== ' ') done++
  }
  return { done, total }
}

/** Name of the most recently modified `.md` file, ignoring directories. */
export function pickLatest(
  entries: { name: string; kind: string; mtimeMs: number }[],
): string | undefined {
  let best: { name: string; mtimeMs: number } | undefined
  for (const e of entries) {
    if (e.kind !== 'file' || !e.name.endsWith('.md')) continue
    if (!best || e.mtimeMs > best.mtimeMs) best = e
  }
  return best?.name
}

/** Classify a repo-relative path (`/` separators); first level only. */
export function classifyDocPath(relPath: string): 'spec' | 'plan' | null {
  for (const [dir, kind] of [
    [SPEC_DIR, 'spec'],
    [PLAN_DIR, 'plan'],
  ] as const) {
    if (!relPath.startsWith(dir + '/')) continue
    const rest = relPath.slice(dir.length + 1)
    if (rest.length > 3 && !rest.includes('/') && rest.endsWith('.md')) return kind
  }
  return null
}

/** Rounded integer percentage; 0 when total is 0. */
export function percent(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100)
}
