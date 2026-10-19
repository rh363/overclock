// Pure POSIX-style path helpers: strings and '/' only, no Node.

function trimTrailing(p: string): string {
  let end = p.length
  while (end > 1 && p[end - 1] === '/') end--
  return p.slice(0, end)
}

export function joinPath(...parts: string[]): string {
  let out = ''
  for (const part of parts) {
    if (part === '') continue
    if (out === '') out = part
    else out = trimTrailing(out).replace(/^\/$/, '') + '/' + part.replace(/^\/+/, '')
  }
  return out === '' ? '' : trimTrailing(out)
}

export function dirname(p: string): string {
  const t = trimTrailing(p)
  const i = t.lastIndexOf('/')
  if (i < 0) return '.'
  if (i === 0) return '/'
  return t.slice(0, i)
}

export function basename(p: string): string {
  const t = trimTrailing(p)
  return t.slice(t.lastIndexOf('/') + 1)
}

/** Path of `p` relative to `root`, or null when `p` is outside `root`. */
export function relativeTo(root: string, p: string): string | null {
  const r = trimTrailing(root)
  const t = trimTrailing(p)
  if (t === r) return ''
  const prefix = r === '/' ? '/' : r + '/'
  return t.startsWith(prefix) ? t.slice(prefix.length) : null
}
