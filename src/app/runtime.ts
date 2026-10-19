// Inbound adapter: turns engine events into core reductions, then publishes the result to
// $.state (what the UI reads) and $.store (what other sessions read).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Timer } from 'claude-code'
import { reduceAgents, emptyTree } from '../core/agents'
import { parseCommand } from '../core/commands'
import type { Tab } from '../core/commands'
import { DEFAULT_PHASE_MAP, PHASE_NAMES, parsePhaseMap, skillKey } from '../core/phases'
import { applySkill, emptyPipeline, isEmptyPipeline, resetPipeline, setPhase } from '../core/pipeline'
import { PLAN_DIR, SPEC_DIR, classifyDocPath, countCheckboxes, pickLatest } from '../core/plan'
import { isLive, pruneWrites } from '../core/sessions'
import { basename, joinPath, relativeTo } from '../core/paths'
import type { AgentEvent, BadgeName, PhaseMap, PipelineState, SessionEntry } from '../core/types'
import type { FilePort } from '../ports'
import { storePort } from '../adapters/store'
import { filePort, resolveGitInfo } from '../adapters/files'

// One atom per key of PluginState['overclock']. The host's module scan only accepts state
// sources declared in the calling file, so every module that reads state declares its own.
const agentsAtom = atom({ plugin: 'overclock', key: 'agents' } as const, emptyTree())
const pipelineAtom = atom({ plugin: 'overclock', key: 'pipeline' } as const, null)
const selfAtom = atom({ plugin: 'overclock', key: 'self' } as const, null)
const othersAtom = atom({ plugin: 'overclock', key: 'others' } as const, [])
const planTextAtom = atom({ plugin: 'overclock', key: 'planText' } as const, '')
const autoOpenedAtom = atom({ plugin: 'overclock', key: 'autoOpened' } as const, false)
const toastShownAtom = atom({ plugin: 'overclock', key: 'toastShown' } as const, false)
const paneOpenAtom = atom({ plugin: 'overclock', key: 'paneOpen' } as const, false)
const tabAtom = atom({ plugin: 'overclock', key: 'tab' } as const, 'agents')

export const HEARTBEAT_MS = 15_000
const PANE = { id: 'overclock', title: 'Overclock' }
const TOAST = 'Overclock: /overclock per aprire il pannello'
// AgentInfo statuses of a loop that has ended.
const ENDED = new Set(['completed', 'failed', 'killed'])

// Module variables hold only what may be lost on hot reload: options, caches, the timer.
let phaseMapPath = ''
let phaseMap: PhaseMap | undefined
let timer: Timer | undefined
// Id of the session a /clear just ended, until its pipeline is carried over.
let clearedId: string | undefined
// Id of the last session that ended (any reason): a later init under another id is a new
// conversation, whose agents start from empty.
let endedId: string | undefined
// Skill tool calls in flight in a subagent's loop, by the name the call gave: skill.prompt
// carries no agentId, but it fires while the Skill call that expands it is in flight.
const subagentSkills = new Map<string, number>()

/** Runs a subagent's Skill call, marking its skill as a subagent's while it is in flight. */
export async function inSubagentSkill<R>(skill: string, call: () => Promise<R>): Promise<R> {
  subagentSkills.set(skill, (subagentSkills.get(skill) ?? 0) + 1)
  try {
    return await call()
  } finally {
    const n = (subagentSkills.get(skill) ?? 1) - 1
    if (n > 0) subagentSkills.set(skill, n)
    else subagentSkills.delete(skill)
  }
}

/** The id a /clear ended, if its carry-over is still pending; clears it. */
export function takeClearedId(): string | undefined {
  const id = clearedId
  clearedId = undefined
  return id
}

/** Called by register() on every (re)load with the plugin's options. */
export function configure(options: PluginOptions): void {
  const p = options.phaseMapPath
  phaseMapPath = typeof p === 'string' ? p.trim() : ''
  phaseMap = undefined
}

async function loadPhaseMap($: EngineInterface): Promise<PhaseMap> {
  if (phaseMap) return phaseMap
  if (phaseMapPath === '') return (phaseMap = DEFAULT_PHASE_MAP)
  const path = phaseMapPath.startsWith('/') ? phaseMapPath : joinPath(await $.session.cwd(), phaseMapPath)
  const text = await filePort($).read(path)
  const parsed = text === undefined ? null : parsePhaseMap(text)
  if (parsed === null) {
    $.ui.log(`overclock: mappa fasi non valida in ${path}, uso quella predefinita`)
    return (phaseMap = DEFAULT_PHASE_MAP)
  }
  return (phaseMap = { ...DEFAULT_PHASE_MAP, ...parsed })
}

function summary(p: PipelineState | null) {
  const badges: BadgeName[] = []
  for (const b of p?.current.badges ?? []) if (!badges.includes(b.name)) badges.push(b.name)
  return { phase: p?.current.phase ?? 0, badges, planDone: p?.plan.done ?? 0, planTotal: p?.plan.total ?? 0 }
}

/** Recomputes self from the atoms (plus `change`), stamps the heartbeat and persists it. */
async function publishSelf(
  $: EngineInterface,
  change: (s: SessionEntry) => SessionEntry = (s) => s,
  opts: { activity?: boolean } = {},
): Promise<void> {
  const now = await $.clock.now()
  const tree = await read($, agentsAtom)
  const p = await read($, pipelineAtom)
  const self = await update($, selfAtom, (cur) => {
    if (!cur) return cur
    const s = change(cur)
    return {
      ...s,
      ...summary(p),
      agents: tree.nodes,
      recentWrites: pruneWrites(s.recentWrites, now),
      lastActivity: opts.activity ? now : s.lastActivity,
      heartbeat: now,
    }
  })
  if (self) await storePort($).putSession(self)
}

/** An empty pipeline is not persisted, unless it replaces one already stored. */
async function savePipeline($: EngineInterface, p: PipelineState): Promise<void> {
  await update($, pipelineAtom, () => p)
  const id = await $.session.id()
  const sp = storePort($)
  if (isEmptyPipeline(p) && (await sp.getPipeline(id)) === undefined) return
  await sp.putPipeline(id, p)
}

const absolute = (root: string, path: string) => (path.startsWith('/') ? path : joinPath(root, path))

/** Reads the plan file into planText and its checkbox counts into the PlanRef. */
async function loadPlan($: EngineInterface, fp: FilePort, root: string, p: PipelineState): Promise<PipelineState> {
  const text = p.plan.planPath ? await fp.read(absolute(root, p.plan.planPath)) : undefined
  await update($, planTextAtom, () => text ?? '')
  if (text === undefined) return p
  const { done, total } = countCheckboxes(text)
  return { ...p, plan: { ...p.plan, done, total } }
}

/** Latest spec and plan under `root`, unless pinned; then the plan's progress. */
async function detectDocs($: EngineInterface, fp: FilePort, root: string, p: PipelineState): Promise<PipelineState> {
  const plan = { ...p.plan }
  if (!plan.pinned.spec) {
    const name = pickLatest(await fp.list(joinPath(root, SPEC_DIR)))
    if (name) plan.specPath = `${SPEC_DIR}/${name}`
  }
  if (!plan.pinned.plan) {
    const name = pickLatest(await fp.list(joinPath(root, PLAN_DIR)))
    if (name) plan.planPath = `${PLAN_DIR}/${name}`
  }
  return loadPlan($, fp, root, { ...p, plan })
}

/** Reports a failure of Overclock's own work without letting it reach the event chain. */
export function logError($: EngineInterface, err: unknown): void {
  try {
    $.ui.log(`overclock: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
  } catch {
    // nothing left to report to
  }
}

/**
 * Self for the current session id. Re-initialises when self is missing or belongs to another
 * id (a /clear whose classic.SessionStart never came), carrying the pipeline over first.
 */
async function ensureInit($: EngineInterface): Promise<SessionEntry> {
  const id = await $.session.id()
  const self = await read($, selfAtom)
  if (self && self.sessionId === id) return self
  const oldId = takeClearedId()
  if (oldId !== undefined && oldId !== id) await carryOverOnClear($, oldId)
  else {
    const prevId = self?.sessionId ?? endedId
    if (prevId !== undefined && prevId !== id) await update($, agentsAtom, () => emptyTree())
    await initSession($)
  }
  return (await read($, selfAtom))!
}

function startHeartbeat($: EngineInterface): void {
  timer?.cancel()
  timer = $.clock.every(HEARTBEAT_MS, () => {
    void heartbeat($).catch((err: unknown) => logError($, err))
  })
}

export function stopHeartbeat(): void {
  timer?.cancel()
  timer = undefined
}

export async function initSession($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  const cwd = await $.session.cwd()
  const now = await $.clock.now()
  const fp = filePort($)
  const git = await resolveGitInfo(fp, cwd)
  const root = git?.worktreeRoot ?? cwd
  await loadPhaseMap($)
  const sp = storePort($)
  await sp.prunePipelines(now, id)

  let p = (await sp.getPipeline(id)) ?? emptyPipeline(now)
  p = await detectDocs($, fp, root, p)
  await savePipeline($, p)

  const self: SessionEntry = {
    v: 1, sessionId: id,
    repoRoot: git?.repoRoot ?? null,
    repoName: basename(git?.repoRoot ?? root),
    worktreeRoot: root,
    branch: git?.branch ?? null,
    agents: [], recentWrites: [], ...summary(p),
    lastActivity: now, heartbeat: now,
  }
  await update($, selfAtom, () => self)
  await heartbeat($)
  startHeartbeat($)
}

export async function dispatchAgent($: EngineInterface, ev: AgentEvent): Promise<void> {
  await ensureInit($)
  await update($, agentsAtom, (t) => reduceAgents(t, ev))
  await publishSelf($, undefined, { activity: ev.kind !== 'agents.reconcile' })
}

/**
 * tool.call: in memory only (the subagent's last tool, self's lastActivity); the heartbeat
 * publishes it. Keeps the store off the tool's return path.
 */
export async function onToolCall($: EngineInterface, agentId: string | undefined, tool: string): Promise<void> {
  await ensureInit($)
  const now = await $.clock.now()
  if (agentId) await update($, agentsAtom, (t) => reduceAgents(t, { kind: 'agent.tool', id: agentId, tool }))
  await update($, selfAtom, (s) => (s ? { ...s, lastActivity: now } : s))
}

export async function onSkill($: EngineInterface, skill: string, pluginName?: string): Promise<void> {
  await ensureInit($)
  const now = await $.clock.now()
  const map = await loadPhaseMap($)
  const key = skillKey(skill, pluginName)
  // A subagent's skill (requesting-code-review inside subagent-driven) is not the session's
  // phase: only its badge counts.
  const entry = Object.hasOwn(map, key) ? map[key] : undefined
  if (entry && 'phase' in entry && (subagentSkills.has(key) || subagentSkills.has(skill))) return
  const before = (await read($, pipelineAtom)) ?? emptyPipeline(now)
  const after = applySkill(before, key, map, now)
  if (after === before) return
  await savePipeline($, after)
  await publishSelf($, undefined, { activity: true })
  if (after.current.phase !== before.current.phase) await maybeAutoOpen($)
}

// Tools that write a file, by the argument naming it. MultiEdit is not in every build's tool
// table, so the name is matched as a string.
const WRITE_ARG: Record<string, string> = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }

/** The file a tool call writes, if it is a write tool's call with that path given. */
export function writtenPath(call: { tool: string } & Record<string, unknown>): string | undefined {
  const arg = Object.hasOwn(WRITE_ARG, call.tool) ? WRITE_ARG[call.tool] : undefined
  const path = arg === undefined ? undefined : call[arg]
  return typeof path === 'string' ? path : undefined
}

export async function onWrite($: EngineInterface, absPath: string): Promise<void> {
  const self = await ensureInit($)
  const now = await $.clock.now()
  const root = self.worktreeRoot
  const rel = relativeTo(root, absPath)
  const path = rel ?? absPath
  const kind = rel === null ? null : classifyDocPath(rel)
  const p = await read($, pipelineAtom)
  if (kind && p) {
    const plan = { ...p.plan }
    if (kind === 'spec' && !plan.pinned.spec) plan.specPath = path
    if (kind === 'plan' && !plan.pinned.plan) plan.planPath = path
    let next: PipelineState = { ...p, plan, updatedAt: now }
    if (kind === 'plan' && plan.planPath === path) next = await loadPlan($, filePort($), root, next)
    await savePipeline($, next)
  }
  await publishSelf(
    $,
    (s) => ({ ...s, recentWrites: [...s.recentWrites.filter((w) => w.path !== path), { path, at: now }] }),
    { activity: true },
  )
}

export async function refreshGit($: EngineInterface): Promise<void> {
  const self = await ensureInit($)
  const cwd = await $.session.cwd()
  const fp = filePort($)
  const git = await resolveGitInfo(fp, cwd)
  const root = git?.worktreeRoot ?? cwd
  const repoRoot = git?.repoRoot ?? null
  const branch = git?.branch ?? null
  if (root === self.worktreeRoot && repoRoot === self.repoRoot && branch === self.branch) return
  if (root !== self.worktreeRoot) {
    const p = await read($, pipelineAtom)
    if (p) await savePipeline($, await detectDocs($, fp, root, p))
  }
  await publishSelf($, (s) => ({ ...s, repoRoot, repoName: basename(repoRoot ?? root), worktreeRoot: root, branch }))
}

export async function heartbeat($: EngineInterface): Promise<void> {
  const self = await ensureInit($)
  const now = await $.clock.now()
  const live = await $.agent.list()
  const alive = live.filter((a) => !ENDED.has(a.status))
  const liveIds = alive.map((a) => a.id)
  const teammateIds = alive.filter((a) => a.teammateId !== undefined).map((a) => a.id)
  await update($, agentsAtom, (t) => reduceAgents(t, { kind: 'agents.reconcile', liveIds, teammateIds, at: now }))
  const all = await storePort($).listSessions(now)
  const others = all.filter((e) => e.sessionId !== self.sessionId && isLive(e, now))
  await update($, othersAtom, () => others)
  await publishSelf($)
}

export async function maybeAutoOpen($: EngineInterface): Promise<void> {
  if (await read($, autoOpenedAtom)) return
  await update($, autoOpenedAtom, () => true)
  const r = await $.ui.open(PANE)
  if (r.isPlaced) await update($, paneOpenAtom, () => true)
  if (!r.isPlaced && !(await read($, toastShownAtom))) {
    $.ui.toast(TOAST)
    await update($, toastShownAtom, () => true)
  }
}

/**
 * session.end: drop this session's entry, stop the heartbeat that would rewrite it and forget
 * self, so the next event re-initialises. After /clear, remember the id for the carry-over.
 */
export async function endSession($: EngineInterface, id: string, reason: string): Promise<void> {
  stopHeartbeat()
  endedId = id
  if (reason === 'clear') clearedId = id
  await update($, selfAtom, () => null)
  await storePort($).deleteSession(id)
}

/** After /clear: move the pipeline to the new session id, reset agents, re-init. */
export async function carryOverOnClear($: EngineInterface, oldId: string): Promise<void> {
  const newId = await $.session.id()
  const sp = storePort($)
  if (newId !== oldId) {
    const p = await sp.getPipeline(oldId)
    if (p) await sp.putPipeline(newId, p)
    await sp.deletePipeline(oldId)
  }
  await update($, agentsAtom, () => emptyTree())
  await update($, selfAtom, () => null)
  await initSession($)
}

/**
 * classic.SessionStart other than startup or clear (a /resume in the same process): when
 * session.end left self empty, start the new conversation from empty agents.
 */
export async function onSessionResumed($: EngineInterface): Promise<void> {
  if (await read($, selfAtom)) return
  await update($, agentsAtom, () => emptyTree())
  await initSession($)
}

/** ui.close of our pane (by Esc, the close mark or /overclock): remembers it is closed. */
export async function onPaneClosed($: EngineInterface, id: string): Promise<void> {
  if (id === PANE.id) await update($, paneOpenAtom, () => false)
}

async function openPane($: EngineInterface): Promise<boolean> {
  const r = await $.ui.open({ ...PANE, focus: true })
  if (r.isPlaced) await update($, paneOpenAtom, () => true)
  return r.isPlaced
}

const PIN_LABEL = { spec: 'Spec', plan: 'Piano' } as const

async function pinDoc($: EngineInterface, target: 'spec' | 'plan', path: string): Promise<string> {
  const self = await ensureInit($)
  const root = self.worktreeRoot
  const rel = path.startsWith('/') ? relativeTo(root, path) : path.replace(/^\.\//, '')
  if (rel === null || rel === '' || rel.split('/').includes('..') || !(await filePort($).exists(joinPath(root, rel)))) {
    return `File non trovato: ${path}`
  }
  const p = (await read($, pipelineAtom)) ?? emptyPipeline(await $.clock.now())
  const plan = { ...p.plan, pinned: { ...p.plan.pinned, [target]: true } }
  if (target === 'spec') plan.specPath = rel
  else plan.planPath = rel
  const next = await loadPlan($, filePort($), root, { ...p, plan, updatedAt: await $.clock.now() })
  await savePipeline($, next)
  await publishSelf($)
  return `${PIN_LABEL[target]} fissato: ${rel}`
}

async function runCommand($: EngineInterface, args: string): Promise<string> {
  const cmd = parseCommand(args)
  switch (cmd.kind) {
    case 'error':
      return cmd.message
    case 'toggle':
      if (await read($, paneOpenAtom)) {
        await $.ui.close(PANE)
        await update($, paneOpenAtom, () => false)
        return 'Pannello chiuso.'
      }
      await openPane($)
      return 'Pannello aperto.'
    case 'open':
      await update($, tabAtom, () => cmd.tab as Tab)
      await openPane($)
      return `Pannello aperto su ${cmd.tab}.`
    case 'pin':
      return pinDoc($, cmd.target, cmd.path)
    case 'unpin': {
      const self = await ensureInit($)
      const p = (await read($, pipelineAtom)) ?? emptyPipeline(await $.clock.now())
      const cleared = { ...p, plan: { ...p.plan, pinned: { spec: false, plan: false } } }
      await savePipeline($, await detectDocs($, filePort($), self.worktreeRoot, cleared))
      await publishSelf($)
      return 'Rilevamento automatico ripristinato.'
    }
    case 'phase': {
      await ensureInit($)
      const now = await $.clock.now()
      const p = (await read($, pipelineAtom)) ?? emptyPipeline(now)
      await savePipeline($, setPhase(p, cmd.phase, now))
      await publishSelf($, undefined, { activity: true })
      return `Fase impostata a ${cmd.phase} (${cmd.phase === 0 ? 'nessuna fase' : PHASE_NAMES[cmd.phase - 1]}).`
    }
    case 'reset': {
      await ensureInit($)
      const now = await $.clock.now()
      const p = (await read($, pipelineAtom)) ?? emptyPipeline(now)
      await savePipeline($, resetPipeline(p, now))
      await publishSelf($, undefined, { activity: true })
      return 'Pipeline azzerata.'
    }
  }
}

/** /overclock: never throws, so a failure cannot break the command chain. */
export async function handleCommand($: EngineInterface, args: string): Promise<{ text: string }> {
  try {
    return { text: await runCommand($, args) }
  } catch (err) {
    logError($, err)
    return { text: 'Overclock: errore nel comando' }
  }
}

// The render gets `next` only: the host does not let `$` be passed to a function parameter.
type Render<E, R> = (next: (e: E) => Promise<R>) => Promise<R>

/**
 * Runs a render of ours that calls `next` at most once. A failure of ours falls back to what
 * the engine drew (`next` is not called twice); a failure of `next` itself is not ours to hide.
 */
export async function guardRender<E, R>($: EngineInterface, e: E, next: (e: E) => Promise<R>, render: Render<E, R>): Promise<R> {
  let below: { value: R } | undefined
  let nextFailed = false
  const once = async (x: E): Promise<R> => {
    try {
      const value = await next(x)
      below = { value }
      return value
    } catch (err) {
      nextFailed = true
      throw err
    }
  }
  try {
    return await render(once)
  } catch (err) {
    if (nextFailed) throw err
    logError($, err)
    return below ? below.value : next(e)
  }
}
