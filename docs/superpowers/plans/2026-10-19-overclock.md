# Overclock — piano di implementazione

> **Per chi esegue con agenti:** SOTTO-SKILL OBBLIGATORIA: usa superpowers:subagent-driven-development (consigliata) o superpowers:executing-plans per eseguire questo piano un task alla volta. I passi usano le checkbox (`- [ ]`) per tenere traccia dell'avanzamento.

**Obiettivo:** costruire il mod Overclock di Claude Code: pannello con agenti, pipeline Superpowers, piano e tutte le sessioni locali, più una banda sopra il prompt con spec, piano, fase e caso di sessione.

**Architettura:** dominio puro in `src/core/`, che non importa nulla da `$` (`claude-code`). Un solo adapter in ingresso, `hooks/register.tsx`. `$.store` e `$.fs` stanno dietro due port in `src/adapters/`. I renderer in `src/ui/` leggono solo un modello di vista calcolato in `src/ui/view-model.ts`, così la UI si può raffinare senza toccare core e adapter.

**Stack:** TypeScript (moduli ES, nessuna dipendenza npm a runtime), API dei mod di Claude Code ≥ 2.1.299, test con `claude plugin test` (kit `claude-code/testing`), type-check con `npx -p typescript@5.6.3 tsc -p .`.

**Spec:** `docs/superpowers/specs/2026-10-19-overclock-design.md`. Chi esegue legge spec e piano insieme.

## Vincoli globali

- **Cartella del plugin:** il repository stesso. Si carica con `claude --plugin-dir /home/alex/WebstormProjects/overclock`. Nome del plugin `overclock`, comando `/overclock`.
- **Ambiente del modulo:** niente DOM e niente Node, quindi niente `path`, `fs`, `process`, `require` né `import()`. Si importano solo file `.ts`/`.tsx`; un `.json` non viene caricato.
- **Sola osservazione:** ogni hook di evento restituisce il risultato di `next(e)`, o `next(e)` stesso, senza modificarlo. Unica eccezione voluta: lo `Spinner`, che passa `next({ ...e, props: { ...e.props, suffix } })`.
- **Superficie consentita:** `$.fs.read`, `$.fs.list`, `$.fs.stat`, `$.fs.exists`, `$.store`, `$.state`, `$.ui`, `$.command`, `$.prompt.fill`, `$.session`, `$.agent.list`, `$.clock`, `$.plugin`.
- **Superficie vietata:** `$.http`, `$.process`, `$.env`, `$.model`, `$.fs.write`, `tool.check`.
- **Chiavi nello store:** `session:<sessionId>` e `pipeline:<sessionId>`. Ogni sessione scrive solo le proprie.
- **Valori numerici della spec:**
  - heartbeat ogni 15 000 ms; una sessione è viva se il suo heartbeat ha meno di 60 000 ms;
  - una voce `session:*` più vecchia di 24 h viene cancellata;
  - avviso sui file condivisi entro 5 minuti (300 000 ms);
  - nella tab Sessioni una sessione è inattiva dopo 10 minuti (600 000 ms);
  - al massimo 50 agenti conclusi per sessione e 10 cicli conclusi per pipeline;
  - il pannello si apre da solo solo da 144 colonne in su (lo decide l'engine).
- **Colori e simboli dei casi:** A verde `#2f7d5b` `⎇`, B blu `#4a5fc1` `▣`, C arancione `#c0642a` `⇄`.
- **Toast, testo esatto:** `Overclock: /overclock per aprire il pannello`.
- **Lingua:** italiano per tutti i testi della UI.

### Cambiamenti rispetto alla spec, decisi nel piano dopo aver verificato l'API

1. `/clear` non fa partire un `session.start`: arriva `session.end` con `reason: 'clear'`, poi `classic.SessionStart` con `source: 'clear'` e un nuovo `sessionId`. La pipeline passa alla sessione nuova seguendo questa coppia di eventi; la regola "terminata da meno di 10 secondi" non serve più.
2. La mappa skill → fase è il modulo `src/core/phases.ts`, non `config/phases.json`, perché il modulo non può importare JSON. L'opzione `phaseMapPath` resta: se impostata, il file JSON si legge con `$.fs.read`.
3. Repo e branch si ricavano interamente da `.git`, risalendo da `$.session.cwd()`, e non da `$.session.repo()`. Così, quando la sessione entra in un worktree, il caso di sessione si aggiorna.
4. I test stanno in `tests/` (la cartella che il tsconfig standard include), non in `test/`.

## Focus della review

Cinque casi d'uso reali che nessun test di task copre da sé. Per ognuno, il test che lo fissa è aggiunto al task indicato.

1. **Sessione fuori da un repo git** (es. `~/Downloads`): il mod non deve rompersi, la banda mostra `▣ <nome cartella>` e nessun branch → Task 2 (`resolveGitInfo` → `null`) e Task 9 (banda).
2. **HEAD detached** (rebase o bisect in corso): il branch è `detached@<sha7>`, senza crash → Task 2.
3. **Agente in background il cui `turn.complete` non arriva mai** (sessione interrotta): al heartbeat successivo passa a `done` → Task 3 (reconcile) e Task 8.
4. **Piano senza checkbox, o file vuoto:** la banda mostra `Piano 0/0`, senza dividere per zero nella percentuale → Task 5 e Task 9.
5. **Store con voci corrotte o di versioni vecchie** (valori non-oggetto, campi mancanti): vengono ignorate, senza eccezioni → Task 7 (`listSessions`).

---

## Struttura dei file

```text
.claude-plugin/plugin.json        manifest: name, version, description, types, userConfig
hooks/hooks.json                  { "modules": ["./register.tsx"] }
hooks/register.tsx                adapter in ingresso: eventi → dispatch, render site
types/index.d.ts                  PluginState['overclock'] (contratto di $.state)
tsconfig.json                     type-check (header dei tipi + "src")
src/core/types.ts                 tutti i tipi di dominio condivisi
src/core/paths.ts                 join/dirname/basename/relative senza Node
src/core/git.ts                   parsing di .git e HEAD
src/core/agents.ts                reducer dell'albero agenti
src/core/phases.ts                mappa skill → fase/badge, skillKey()
src/core/pipeline.ts              macchina a stati della pipeline
src/core/plan.ts                  checkbox, scelta del file più recente, classificazione dei path
src/core/sessions.ts              classify(), avvisi sui file condivisi, raggruppamento, liveness
src/core/commands.ts              parsing degli argomenti di /overclock
src/ports.ts                      StatePort, FilePort
src/adapters/store.ts             StatePort su $.store
src/adapters/files.ts             FilePort su $.fs + resolveGitInfo()
src/adapters/atoms.ts             atom di $.state
src/app/runtime.ts                orchestrazione: dispatch, publish, heartbeat, rilevamento piano
src/ui/view-model.ts              stato → viste (banda, agenti, pipeline, piano, sessioni)
src/ui/band.tsx                   banda AbovePrompt
src/ui/pane.tsx                   pannello con le 4 tab
src/ui/graph-svg.ts               stringa SVG del grafo agenti (Desktop)
src/ui/graph-text.tsx             albero agenti testuale (terminale)
src/ui/sessions-cards.tsx         tab Sessioni per Desktop
src/ui/sessions-text.tsx          tab Sessioni per terminale
tests/*.test.ts(x)                claude plugin test
```

**Come si scrivono i test (vale per tutti i task).** Ogni file di test importa `{ test, expect, describe, mock } from 'claude-code/testing'`. Il corpo `($, on) => …` riceve l'engine.

- **Test del core:** importano solo da `src/core/*` e ignorano `$`.
- **Test degli adapter:** il kit non risponde a fs, store e clock, quindi:
  - registrano `mock.store(on, {...})` e `mock.clock(on, { now })`;
  - rispondono agli eventi `fs.*` con `on('fs.read', ...)`, `on('fs.list', ...)` e simili, dai dati del test;
  - registrano gli hook "di fondo" degli eventi che sparano, prima della prima chiamata a `$`: `on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))`, `on('turn.complete', () => ({ text: '' }))` e così via. Senza questi, l'hook di fondo del kit lancia un'eccezione.

Comandi:
- tutti i test: `claude plugin test .`
- un solo file: `claude plugin test tests/<file>`; se il comando accetta solo una cartella, usare `claude plugin test .` e controllare il nome del test nell'output.

---

### Task 1: Scheletro del mod e verifica dello store fra processi

È il primo task voluto dalla spec: se lo store perde scritture fra due sessioni, ci si ferma e si torna da Alex.

**File:**
- Crea: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx`, `types/index.d.ts`, `tsconfig.json`, `tests/smoke.test.ts`
- Crea, fuori dal repo: `$SCRATCH/store-probe/` (mod usa e getta)

**Interfacce:**
- Produce: plugin `overclock` caricabile; `register: Register` in `hooks/register.tsx`.

- [ ] **Passo 1: scrivi il manifest** in `.claude-plugin/plugin.json`:
  ```json
  { "name": "overclock", "version": "0.1.0",
    "description": "Agenti, pipeline Superpowers, piano e sessioni in un pannello fisso",
    "types": "./types/index.d.ts",
    "userConfig": { "phaseMapPath": { "type": "string", "default": "", "description": "File JSON alternativo per la mappa skill → fase (vuoto = predefinita)" } } }
  ```
  Poi `hooks/hooks.json` con `{ "modules": ["./register.tsx"] }`. `register.tsx` per ora contiene solo `export const register: Register = () => {}`. `types/index.d.ts` dichiara `declare module 'claude-code' { interface PluginState { overclock: {} } }`; i campi arrivano nel Task 7.

- [ ] **Passo 2: scrivi `tsconfig.json`** con le `compilerOptions` dell'header dei tipi:
  - `"target": "es2023"`, `"lib": ["es2023"]`, `"types": []`
  - `"module": "esnext"`, `"moduleResolution": "bundler"`
  - `"strict": true`, `"noUncheckedIndexedAccess": true`, `"noEmit": true`, `"skipLibCheck": true`
  - `"jsx": "react"`, `"jsxFactory": "h"`, `"jsxFragmentFactory": "Fragment"`

  E `"include": [".claude-plugin/types", "hooks", "types", "tests", "src"]`.

  Se `.claude-plugin/types/claude-code/index.d.ts` non esiste ancora, crealo copiando `ls /tmp/claude-*/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts | tail -1`. L'engine lo riscrive alla prima load. La cartella è già in `.gitignore`.

- [ ] **Passo 3: scrivi `tests/smoke.test.ts`**, con il test `il plugin si carica`: `expect($.plugin.name).toBe('overclock')`.

- [ ] **Passo 4: verifica.**
  - Esegui `claude plugin validate . && claude plugin test . && npx -y -p typescript@5.6.3 tsc -p .`
  - Atteso: validate senza errori, `1 passed`, tsc senza output.

- [ ] **Passo 5: sonda dello store fra processi.**
  1. In `$SCRATCH/store-probe/` crea un mod minimo (manifest `store-probe`, `hooks.json`, `register.ts`). Su `session.start` fa 100 `await $.store.set(`k:${$.session.id()}:${i}`, i)` in sequenza, poi `return next(e)`.
  2. Lancia due sessioni insieme: `(claude -p --plugin-dir $SCRATCH/store-probe --model haiku "ok" & claude -p --plugin-dir $SCRATCH/store-probe --model haiku "ok"; wait)`.
  3. Trova il file dello store con `ls ~/.claude/plugins/store/` (o cerca `store-probe` sotto `~/.claude`). Conta le chiavi `k:`.
  4. Atteso: 200 chiavi.
  5. **Se sono meno di 200: FERMATI** e riporta ad Alex il numero trovato. Il resto del piano presuppone uno store sicuro fra processi.
  6. Cancella la sonda e il suo file dello store.

- [ ] **Passo 6: commit.** `git add .claude-plugin/plugin.json hooks types tsconfig.json tests && git commit -m "feat: scheletro del mod overclock"`

---

### Task 2: Path e git (core puro)

**File:**
- Crea: `src/core/paths.ts`, `src/core/git.ts`
- Test: `tests/core-git.test.ts`

**Interfacce:**
- Produce:
  - `joinPath(...parts: string[]): string`
  - `dirname(p: string): string`
  - `basename(p: string): string`
  - `relativeTo(root: string, p: string): string | null`, che dà `null` se `p` è fuori da `root`
  - `parseDotGitFile(content: string): string | null`: dal contenuto `gitdir: <path>` restituisce il path assoluto
  - `parseHead(content: string): string`: `ref: refs/heads/feat/x` → `feat/x`, uno sha di 40 caratteri → `detached@<primi 7>`
  - `repoRootFromGitDir(gitDir: string): string`: `/r/.git/worktrees/wt` → `/r`, `/r/.git` → `/r`

- [ ] **Passo 1: test che falliscono**, ognuno con le sue asserzioni:
  - `joinPath('/a/', 'b', 'c.md') === '/a/b/c.md'`
  - `basename('/a/b/') === 'b'`
  - `relativeTo('/r', '/r/docs/x.md') === 'docs/x.md'`
  - `relativeTo('/r', '/rx/y') === null`
  - `parseDotGitFile('gitdir: /r/.git/worktrees/wt\n') === '/r/.git/worktrees/wt'`
  - `parseDotGitFile('garbage') === null`
  - `parseHead('ref: refs/heads/feat/overclock-ui\n') === 'feat/overclock-ui'`
  - `parseHead('3fddd00aa1b2c3d4e5f60718293a4b5c6d7e8f90\n') === 'detached@3fddd00'` (Focus della review 2)
  - `repoRootFromGitDir('/r/.git/worktrees/wt') === '/r'`
  - `repoRootFromGitDir('/r/.git') === '/r'`
- [ ] **Passo 2:** `claude plugin test .`. Atteso: FAIL, modulo non trovato.
- [ ] **Passo 3: implementa.** Solo stringhe e separatore `/`, niente regex fragili sui path di Windows (WSL è fuori scope).
- [ ] **Passo 4:** `claude plugin test .`. Atteso: PASS.
- [ ] **Passo 5: commit.** `feat(core): parsing di path e git`

---

### Task 3: Reducer degli agenti (core puro)

**File:**
- Crea: `src/core/types.ts` (tipi degli agenti), `src/core/agents.ts`
- Test: `tests/core-agents.test.ts`

**Interfacce:**
- Produce, in `src/core/types.ts`:
  ```typescript
  export type AgentStatus = 'running' | 'done' | 'failed' | 'aborted'
  export type Tokens = { input: number; output: number }
  export interface AgentNode {
    id: string; parentId: string; toolUseId: string; type: string; description: string
    background: boolean; status: AgentStatus; startedAt: number; endedAt?: number
    tokens: Tokens; lastTool?: string
  }
  export interface AgentTree { nodes: AgentNode[]; mainTokens: Tokens }
  export type TurnReason = 'answer' | 'aborted' | 'refusal' | 'error'
  export type AgentEvent =
    | { kind: 'agent.started'; id: string; parentId?: string; toolUseId: string; type: string; description: string; background: boolean; at: number }
    | { kind: 'agent.resumed'; id: string; at: number }
    | { kind: 'agent.ended'; id: string; reason: TurnReason; usage?: { input_tokens: number; output_tokens: number }; at: number }
    | { kind: 'agent.tool'; id: string; tool: string }
    | { kind: 'main.turn'; usage?: { input_tokens: number; output_tokens: number } }
    | { kind: 'agents.reconcile'; liveIds: string[]; at: number }
  ```
- Produce, in `src/core/agents.ts`:
  - `emptyTree(): AgentTree`
  - `reduceAgents(tree: AgentTree, ev: AgentEvent): AgentTree`, puro, senza mutazioni
  - `activeCount(tree: AgentTree): number`
  - `MAX_DONE_AGENTS = 50`

- [ ] **Passo 1: test che falliscono.**
  - **started:** aggiunge un nodo `running` con `parentId` uguale a `'main'` quando manca.
  - **ended:** imposta lo stato in base a `reason` (`answer` → `done`, `error` e `refusal` → `failed`, `aborted` → `aborted`), poi `endedAt` e i token sommati (due `ended` con `{input_tokens: 100, output_tokens: 10}` danno `{ input: 200, output: 20 }`).
  - **resumed:** riporta un nodo `done` a `running` senza perdere i token.
  - **tool:** imposta `lastTool`.
  - **main.turn:** somma su `mainTokens`.
  - **reconcile** (Focus della review 3): un nodo `running` che manca da `liveIds` diventa `done` con `endedAt = at`; i nodi presenti restano invariati.
  - **eventi sconosciuti:** `ended`, `tool` o `resumed` su un id sconosciuto restituiscono l'albero uguale (`toBe`, stesso riferimento).
  - **limite:** dopo 60 agenti conclusi restano 50 nodi conclusi, cioè i più recenti per `endedAt`; i nodi `running` non vengono mai scartati.
  - **conteggio:** `activeCount` conta solo i `running`.
- [ ] **Passo 2:** `claude plugin test .`. Atteso: FAIL.
- [ ] **Passo 3: implementa `reduceAgents`.** Uno `switch` su `ev.kind`; la potatura a 50 si applica solo dopo `agent.ended` e `agents.reconcile`.
- [ ] **Passo 4:** `claude plugin test .`. Atteso: PASS.
- [ ] **Passo 5: commit.** `feat(core): reducer dell'albero agenti`

---

### Task 4: Fasi e pipeline (core puro)

**File:**
- Crea: `src/core/phases.ts`, `src/core/pipeline.ts`; aggiungi i tipi della pipeline a `src/core/types.ts`
- Test: `tests/core-pipeline.test.ts`

**Interfacce:**
- Produce, in `src/core/types.ts`:
  ```typescript
  export type Phase = 0 | 1 | 2 | 3 | 4 | 5 | 6
  export type BadgeName = 'TDD' | 'Debug' | 'Verifica'
  export interface PipelineCycle { phase: Phase; history: { phase: Phase; skill: string; at: number }[]; badges: { name: BadgeName; at: number }[] }
  export interface PlanRef { specPath?: string; planPath?: string; pinned: { spec: boolean; plan: boolean }; done: number; total: number }
  export interface PipelineState { current: PipelineCycle; cycles: PipelineCycle[]; plan: PlanRef; updatedAt: number }
  export type PhaseMap = Record<string, { phase: Phase } | { badge: BadgeName }>
  ```
- Produce, in `src/core/phases.ts`:
  - `PHASE_NAMES: readonly string[]`: `['Brainstorming','Worktree','Piano','Esecuzione','Code review','Chiusura branch']`, dove l'indice 0 è la fase 1
  - `DEFAULT_PHASE_MAP: PhaseMap`, con esattamente le chiavi delle tabelle "Fasi Superpowers" e "Badge trasversali" della spec
  - `skillKey(skill: string, pluginName?: string): string`: se `skill` contiene `:` la restituisce com'è; altrimenti, se c'è `pluginName`, restituisce `` `${pluginName}:${skill}` ``; altrimenti `skill`
  - `parsePhaseMap(json: string): PhaseMap | null`: valida la forma e restituisce `null` se non è valida
- Produce, in `src/core/pipeline.ts`:
  - `emptyPipeline(at: number): PipelineState`
  - `applySkill(p: PipelineState, key: string, map: PhaseMap, at: number): PipelineState`
  - `setPhase(p: PipelineState, phase: Phase, at: number): PipelineState`
  - `resetPipeline(p: PipelineState, at: number): PipelineState`
  - `MAX_CYCLES = 10`

- [ ] **Passo 1: test che falliscono.**
  - **`skillKey`:**
    - `skillKey('brainstorming','superpowers') === 'superpowers:brainstorming'`
    - `skillKey('superpowers:brainstorming') === 'superpowers:brainstorming'`
    - `skillKey('commit') === 'commit'`
  - **Mappa predefinita:**
    - `DEFAULT_PHASE_MAP['alex-dev-skills:git-worktrees']` vale `{ phase: 2 }`
    - `DEFAULT_PHASE_MAP['alex-dev-skills:tdd-prove-it']` vale `{ badge: 'TDD' }`
  - **Avanzamento:** da 0, `superpowers:writing-plans` porta a 3 e la history ha un elemento.
  - **Nessun ritorno indietro:** a fase 4, `superpowers:using-git-worktrees` lascia la fase a 4 ma registra la skill nella history.
  - **Nuovo ciclo:** a fase 4, `superpowers:brainstorming` chiude il ciclo; `cycles.length` diventa 1 e `current.phase` 1. A fase 1 invece la stessa skill non apre un nuovo ciclo.
  - **Limite dei cicli:** dopo 12 cicli chiusi ne restano 10.
  - **Badge:** un badge si aggiunge una sola volta per fase; quando la fase avanza, i badge si azzerano.
  - **Skill non mappata:** restituisce `p` (stesso riferimento).
  - **Comandi manuali:** `setPhase(p, 2)` va indietro e registra `skill: '/overclock phase'`; `resetPipeline` mantiene `plan.pinned` e i path fissati, e azzera fase, history e cicli.
  - **`parsePhaseMap`:**
    - `'{"x:y":{"phase":3}}'` → la mappa corrispondente
    - `'{"x":{"phase":9}}'` → `null`
    - `'not json'` → `null`
- [ ] **Passo 2:** `claude plugin test .`. Atteso: FAIL.
- [ ] **Passo 3: implementa.** Ogni funzione aggiorna `updatedAt = at`.
- [ ] **Passo 4:** `claude plugin test .`. Atteso: PASS.
- [ ] **Passo 5: commit.** `feat(core): mappa fasi e macchina a stati della pipeline`

---

### Task 5: Spec e piano (core puro)

**File:**
- Crea: `src/core/plan.ts`
- Test: `tests/core-plan.test.ts`

**Interfacce:**
- Produce:
  - `countCheckboxes(markdown: string): { done: number; total: number }`: conta le righe `/^\s*[-*] \[( |x|X)\] /`
  - `pickLatest(entries: { name: string; kind: string; mtimeMs: number }[]): string | undefined`: il nome del `.md` con `kind === 'file'` e `mtimeMs` più alto
  - `classifyDocPath(relPath: string): 'spec' | 'plan' | null`: `docs/superpowers/specs/*.md` → `'spec'`, `docs/superpowers/plans/*.md` → `'plan'`, solo al primo livello
  - `percent(done: number, total: number): number`: intero arrotondato, 0 se `total === 0`
  - `SPEC_DIR = 'docs/superpowers/specs'`, `PLAN_DIR = 'docs/superpowers/plans'`

- [ ] **Passo 1: test che falliscono.**
  - **`countCheckboxes`:** il testo `"- [ ] a\n- [x] b\n  * [X] c\n- [] no\n[ ] no"` dà `{ done: 2, total: 3 }`.
  - **Piano vuoto** (Focus della review 4): `countCheckboxes('')` dà `{ done: 0, total: 0 }` e `percent(0,0) === 0`.
  - **`pickLatest`:** ignora le directory e i file non `.md`; con una lista vuota restituisce `undefined`.
  - **`classifyDocPath`:**
    - `'docs/superpowers/specs/x.md'` → `'spec'`
    - `'docs/superpowers/plans/sub/x.md'` → `null`
    - `'src/x.ts'` → `null`
- [ ] **Passo 2:** `claude plugin test .`. Atteso: FAIL.
- [ ] **Passo 3: implementa.**
- [ ] **Passo 4:** `claude plugin test .`. Atteso: PASS.
- [ ] **Passo 5: commit.** `feat(core): conteggio del piano e scelta dei file`

---

### Task 6: Sessioni parallele e comandi (core puro)

**File:**
- Crea: `src/core/sessions.ts`, `src/core/commands.ts`; aggiungi `SessionEntry` a `src/core/types.ts`
- Test: `tests/core-sessions.test.ts`, `tests/core-commands.test.ts`

**Interfacce:**
- Produce, in `src/core/types.ts`:
  ```typescript
  export interface SessionEntry {
    v: 1; sessionId: string; repoRoot: string | null; repoName: string; worktreeRoot: string
    branch: string | null; agents: AgentNode[]; recentWrites: { path: string; at: number }[]
    phase: Phase; badges: BadgeName[]; planDone: number; planTotal: number
    lastActivity: number; heartbeat: number
  }
  export type SessionCase = 'A' | 'B' | 'C' | 'none'
  ```
- Produce, in `src/core/sessions.ts`:
  - `LIVE_MS = 60_000`, `STALE_MS = 86_400_000`, `SHARED_WRITE_MS = 300_000`, `IDLE_MS = 600_000`
  - `isLive(e: SessionEntry, now: number): boolean`
  - `isStale(e: SessionEntry, now: number): boolean`
  - `classify(self: SessionEntry, others: SessionEntry[]): { kind: SessionCase; sameBranch: number; worktrees: number; otherRepos: number }`
    - `others` sono già filtrate sulle sessioni vive e senza `self`
    - `sameBranch` conta le altre sessioni sullo stesso repo e branch
    - `worktrees` conta i `worktreeRoot` distinti del repo, `self` compreso
    - `otherRepos` conta i `repoRoot` distinti diversi da quello di `self`
    - **precedenze:** C prima di A, A prima di B; `'none'` quando non ci sono altre sessioni
  - `sharedWrites(self: SessionEntry, others: SessionEntry[], now: number): { path: string; sessionIds: string[]; at: number }[]`: solo tra sessioni sullo stesso repo e branch, entro `SHARED_WRITE_MS`
  - `pruneWrites(writes, now)`: tiene solo le ultime 300 000 ms
  - `groupSessions(all: SessionEntry[], selfId: string, now: number): SessionGroup[]`, con
    ```typescript
    type SessionGroup = { repoName: string; repoRoot: string | null; kind: SessionCase; branches: { branch: string | null; sessions: (SessionEntry & { isSelf: boolean; isIdle: boolean })[] }[] }
    ```
    - prima il gruppo che contiene `self`, poi gli altri per nome
    - dentro ogni branch, le sessioni inattive (`now - lastActivity > IDLE_MS`) vanno in fondo
- Produce, in `src/core/commands.ts`:
  ```typescript
  export type Tab = 'agents' | 'pipeline' | 'plan' | 'sessions'
  export type OverclockCommand =
    | { kind: 'toggle' } | { kind: 'open'; tab: Tab }
    | { kind: 'pin'; target: 'spec' | 'plan'; path: string } | { kind: 'unpin' }
    | { kind: 'phase'; phase: Phase } | { kind: 'reset' } | { kind: 'error'; message: string }
  export function parseCommand(args: string): OverclockCommand
  ```

- [ ] **Passo 1: test che falliscono.** Una funzione di fabbrica `entry(over: Partial<SessionEntry>)` nel test genera i dati di prova.
  - **`classify`:**
    - stesso repo, worktree diverso, branch diverso → `A` con `worktrees: 2`
    - repo diverso → `B` con `otherRepos: 1`
    - stesso repo e stesso branch → `C` con `sameBranch: 1`
    - una sessione C e una A insieme → `C`
    - nessuna altra sessione → `none`
    - `self` fuori da git (`repoRoot: null`) con un'altra sessione fuori da git in un'altra cartella → `B`, mai `C`
  - **Liveness:**
    - `isLive` è vero con heartbeat a `now-59_999` e falso a `now-60_001`
    - `isStale` è vero oltre 24 h
  - **`sharedWrites`:**
    - stesso file scritto da `self` e da un'altra sessione sullo stesso branch 3 minuti fa → un avviso con due `sessionIds`
    - lo stesso scritto 6 minuti fa → nessun avviso
    - stesso file ma branch diverso → nessun avviso
  - **`groupSessions`:**
    - il gruppo di `self` viene per primo
    - una sessione con `lastActivity` di 11 minuti fa ha `isIdle: true` e sta in fondo al suo branch
  - **`parseCommand`:**
    - `''` → toggle
    - `'sessions'` → open sessions
    - `'pin spec docs/a.md'` → pin
    - `'pin spec'` → error
    - `'phase 4'` → phase 4
    - `'phase 9'` → error
    - `'reset'` → reset
    - `'boh'` → error con il messaggio `Uso: /overclock [agents|pipeline|plan|sessions|pin spec|plan <path>|unpin|phase <0-6>|reset]`
- [ ] **Passo 2:** `claude plugin test .`. Atteso: FAIL.
- [ ] **Passo 3: implementa.**
- [ ] **Passo 4:** `claude plugin test .`. Atteso: PASS.
- [ ] **Passo 5: commit.** `feat(core): casi di sessione, raggruppamento e parsing dei comandi`

---

### Task 7: Port, adapter e contratto di stato

**File:**
- Crea: `src/ports.ts`, `src/adapters/store.ts`, `src/adapters/files.ts`, `src/adapters/atoms.ts`
- Modifica: `types/index.d.ts`
- Test: `tests/adapters.test.ts`

**Interfacce:**
- Consuma: i tipi del Task 3, del Task 4 e del Task 6; `parseDotGitFile`, `parseHead` e `repoRootFromGitDir` del Task 2.
- Produce, in `src/ports.ts`:
  ```typescript
  export interface StatePort {
    putSession(e: SessionEntry): Promise<void>; deleteSession(id: string): Promise<void>
    listSessions(now: number): Promise<SessionEntry[]>   // pulisce le voci stale, scarta le malformate
    getPipeline(id: string): Promise<PipelineState | undefined>
    putPipeline(id: string, p: PipelineState): Promise<void>; deletePipeline(id: string): Promise<void>
  }
  export interface FilePort {
    read(path: string): Promise<string | undefined>      // undefined se manca o la lettura fallisce
    list(dir: string): Promise<{ name: string; kind: string; mtimeMs: number }[]>  // [] se manca
    exists(path: string): Promise<boolean>
  }
  export type GitInfo = { repoRoot: string; worktreeRoot: string; branch: string }
  ```
- Produce:
  - `src/adapters/store.ts`: `storePort($: EngineInterface): StatePort`
  - `src/adapters/files.ts`: `filePort($): FilePort` e `resolveGitInfo(fp: FilePort, cwd: string): Promise<GitInfo | null>`. Risale da `cwd` fino a `/` cercando `<dir>/.git`. Se `.git` è un file, segue `gitdir:` e legge `HEAD` lì; altrimenti legge `<dir>/.git/HEAD`.
  - `src/adapters/atoms.ts`: un atom per ogni chiave di `PluginState['overclock']`. Il contratto è:
    ```typescript
    overclock: {
      agents: AgentTree; pipeline: PipelineState | null; self: SessionEntry | null
      others: SessionEntry[]; tab: Tab; planText: string; autoOpened: boolean; toastShown: boolean
    }
    ```

- [ ] **Passo 1: test che falliscono** (con `mock.store` e risposte agli eventi `fs.*` registrate nel test).
  - `putSession` seguito da `listSessions(now)` restituisce la voce.
  - Una voce con heartbeat di 25 h fa sparisce dalla lista e anche dallo store: `$.store.get` dà `undefined`.
  - **Voci malformate** (Focus della review 5): `$.store.set('session:x', 42)` e `$.store.set('session:y', { v: 0 })` vengono ignorate, senza eccezioni.
  - **Worktree:** `resolveGitInfo` con fs finto `/r/wt/.git` = `gitdir: /r/.git/worktrees/wt` e `/r/.git/worktrees/wt/HEAD` = `ref: refs/heads/feat/a` dà `{ repoRoot: '/r', worktreeRoot: '/r/wt', branch: 'feat/a' }`.
  - **Checkout normale:** da `cwd` `/r/src/x`, con `/r/.git/HEAD`, dà `{ repoRoot: '/r', worktreeRoot: '/r', branch: … }`.
  - **Fuori da git** (Focus della review 1): restituisce `null`.
- [ ] **Passo 2:** `claude plugin test .`. Atteso: FAIL.
- [ ] **Passo 3: implementa.** `listSessions` legge `$.store.keys()` filtrando il prefisso `session:`. Una voce è valida solo se `typeof v === 'object' && v.v === 1 && typeof v.sessionId === 'string'`. Quando cancella una voce stale, cancella anche la sua `pipeline:<id>`. Poi cancella ogni `pipeline:*` con `updatedAt` più vecchio di 30 giorni: `session.end` toglie la voce `session:` ma lascia la pipeline, perché serva a `--resume`. Questa soglia di 30 giorni è una scelta del piano. Aggiungi il test: una `pipeline:old` con `updatedAt` di 31 giorni fa sparisce dopo `listSessions`.
- [ ] **Passo 4:** `claude plugin test . && npx -y -p typescript@5.6.3 tsc -p .`. Atteso: PASS e nessun errore di tipo.
- [ ] **Passo 5: commit.** `feat: port e adapter per store, fs e git`

---

### Task 8: Runtime ed eventi (adapter in ingresso)

**File:**
- Crea: `src/app/runtime.ts`
- Modifica: `hooks/register.tsx`
- Test: `tests/register.test.ts`

**Interfacce:**
- Consuma: tutto il core, `storePort`, `filePort`, `resolveGitInfo` e gli atom.
- Produce, in `src/app/runtime.ts`, funzioni che ricevono `$` e aggiornano `$.state` e lo store:
  - `initSession($): Promise<void>`: risolve git da `$.session.cwd()`, carica `pipeline:<id>` o ne crea una vuota, rileva spec e piano, pubblica `self`, avvia `$.clock.every(15_000, heartbeat)`
  - `dispatchAgent($, ev: AgentEvent): Promise<void>`
  - `onSkill($, skill: string, pluginName?: string): Promise<void>`
  - `onWrite($, absPath: string): Promise<void>`: aggiunge a `recentWrites` e, se `classifyDocPath` riconosce il file, aggiorna `PlanRef` (salvo pin) e ricarica `planText` e il conteggio
  - `refreshGit($): Promise<void>`
  - `heartbeat($): Promise<void>`: `agents.reconcile` con gli id di `$.agent.list()`, rilettura di `others` con `listSessions` (escludendo `self` e le voci non vive), `putSession(self)`
  - `maybeAutoOpen($): Promise<void>`
  - `carryOverOnClear($, oldId: string): Promise<void>`

Collegamenti in `hooks/register.tsx`. Tutti gli hook di evento restituiscono il risultato di `next`.

| Evento | Cosa fa |
| --- | --- |
| `session.start` | `await next(e)`, poi `$.command.register({ name: 'overclock', description: 'Pannello di Overclock: agenti, pipeline, piano, sessioni', argumentHint: '[agents\|pipeline\|plan\|sessions\|pin\|unpin\|phase\|reset]', immediate: true })` e `initSession` |
| `agent.spawn` | `const r = await next(e)`. Se `r.agentId`: con `e.resume`, `agent.resumed`; altrimenti `agent.started`, con `parentId: e.parentAgentId`, `toolUseId: e.tool_use_id`, `type: e.subagentType`, `description: e.description` e `background: e.background`. Poi `maybeAutoOpen` |
| `turn.complete` | `const r = await next(e)`. Con `e.agentId`: `agent.ended` con `reason: e.reason` e `usage: e.usage`. Senza: `main.turn` |
| `turn.start` | Senza `e.agentId`: `refreshGit` |
| `tool.call` | `const r = await next(e)`. Con `e.agentId`: `agent.tool`. Se `e.tool` è `Write` o `Edit` e `r.isError` è falso: `onWrite(e.file_path)`. Se `e.tool` è `Bash` e `/\bgit\s+(checkout\|switch\|worktree)\b/` corrisponde a `e.command`, oppure `e.tool` è `EnterWorktree` o `ExitWorktree`: `refreshGit` |
| `skill.prompt` | `const r = await next(e)`, poi `onSkill(e.skill, e.pluginName)`. Quando la fase cambia per la prima volta, `maybeAutoOpen` |
| `session.end` | Con `e.reason === 'clear'`: ricorda `oldId = $.session.id()` in una variabile del modulo. Sempre: `deleteSession(id)` |
| `classic.SessionStart` | Con `source === 'clear'` e un `oldId` salvato: `carryOverOnClear` sposta la pipeline su `pipeline:<nuovo id>` e cancella la vecchia, azzera `agents`, poi `initSession`. Verificare il nome esatto dell'evento e del campo `source` in `.claude-plugin/types/claude-code/index.d.ts` (dichiarazione intorno a `SessionStart`) |

`maybeAutoOpen`:
- non fa nulla se `autoOpened` è già vero;
- altrimenti `const r = await $.ui.open({ id: 'overclock', title: 'Overclock' })` e `autoOpened = true`;
- se `!r.isPlaced && !toastShown`, mostra il toast `Overclock: /overclock per aprire il pannello` e imposta `toastShown`.

La mappa delle fasi è `DEFAULT_PHASE_MAP`, unita al JSON di `options.phaseMapPath` quando è impostato e `parsePhaseMap` lo accetta; se il file non è valido, una sola riga con `$.ui.log`.

- [ ] **Passo 1: test che falliscono.** Ogni test registra `mock.store`, `mock.clock` e gli hook di fondo per `agent.spawn`, `turn.complete`, `skill.prompt`, `tool.call`, `session.start`, `ui.open` (risponde `{ value: { isPlaced: true } }` o `isPlaced: false`), `agent.list` e `fs.*`.
  1. **Agente seguito:** `$.agent.spawn` (fondo: `{ model: 'm', agentId: 'a1' }`) e poi `$.turn.complete({ agentId: 'a1', reason: 'answer', usage: {...}, … })`. Lo stato `agents` ha `a1` in `done`, con i token.
  2. **Fase da skill:** `$.skill.prompt({ skill: 'writing-plans', text: '' })` con `pluginName: 'superpowers'` porta `pipeline.current.phase` a 3, e anche `pipeline:<id>` nello store.
  3. **Apertura automatica:** il primo spawn chiama `ui.open` una volta; il secondo no.
  4. **Terminale stretto:** con il fondo di `ui.open` a `isPlaced: false`, il toast compare una sola volta.
  5. **Heartbeat** (Focus della review 3): dopo `clock.advance(15_000)`, con `agent.list` vuoto, un agente `running` diventa `done`, e `session:<id>` ha un `heartbeat` aggiornato.
  6. **Scrittura del piano:** un `$.tool.call({ tool: 'Write', file_path: '<root>/docs/superpowers/plans/p.md', … })`, con l'fs finto che restituisce `- [x] a\n- [ ] b`, dà `pipeline.plan` con `{ planPath: 'docs/superpowers/plans/p.md', done: 1, total: 2 }`.
  7. **`/clear`:** `session.end` con `reason: 'clear'`, poi `classic.SessionStart` con `source: 'clear'` e un nuovo id (da `mock.session` o da un hook di fondo su `session.id`). La pipeline si ritrova sotto il nuovo id e la vecchia chiave non c'è più.
- [ ] **Passo 2:** `claude plugin test .`. Atteso: FAIL.
- [ ] **Passo 3: implementa** `runtime.ts` e i collegamenti in `register.tsx`.
- [ ] **Passo 4:** `claude plugin test . && claude plugin validate . && npx -y -p typescript@5.6.3 tsc -p .`. Atteso: tutto verde. Nell'output di validate, gli hook elencati sono quelli della tabella e non c'è nessun `gating hook`.
- [ ] **Passo 5: commit.** `feat: collegamento degli eventi e runtime`

---

### Task 9: Modello di vista, banda e spinner

**File:**
- Crea: `src/ui/view-model.ts`, `src/ui/band.tsx`
- Modifica: `hooks/register.tsx` (render site `AbovePrompt` e `Spinner`)
- Test: `tests/ui-band.test.tsx`

**Interfacce:**
- Consuma: gli atom, `classify`, `percent` e `PHASE_NAMES`.
- Produce, in `src/ui/view-model.ts`:
  ```typescript
  export type CaseStyle = { kind: SessionCase; symbol: '⎇' | '▣' | '⇄' | ''; color: string; label: string }
  export function caseStyle(self: SessionEntry, others: SessionEntry[]): CaseStyle
  export type BandView = { case: CaseStyle; specName?: string; planName?: string; planDone: number; planTotal: number; planPercent: number; phase: number; phaseName?: string; warning?: string }
  export function bandView(s: { self: SessionEntry | null; others: SessionEntry[]; pipeline: PipelineState | null }, now: number): BandView
  ```
  Le etichette `label` sono quelle della spec:
  - A: `⎇ <branch>` con `<repo> · N worktree`
  - B: `▣ <repo>` con `<branch>` e `+N altri repo`
  - C: `⇄ <branch> ×N` con `condiviso con N-1 sessioni`
  - fuori da git o caso `none`: `▣ <repoName>`
- Produce, in `src/ui/band.tsx`: `renderBand($, e, next)`, che restituisce `next(e)` se `e.props.hasSurvey` è vero. Altrimenti: `const below = await next(e)` e poi `<Box flexDirection="column">{below}{mine}</Box>`. La riga ha le chiavi `case`, `spec`, `plan` e `phase`, nel formato `⎇ feat/x · Spec: a.md · Piano 7/12 (58%) · Fase 4/6`.
- Spinner: con `activeCount > 0`, `next({ ...e, props: { ...e.props, suffix: `… · ${n} ${n === 1 ? 'agente' : 'agenti'}` } })`; altrimenti `next(e)`.

- [ ] **Passo 1: test che falliscono.**
  - **`caseStyle`:** un test per ciascun caso, con simbolo e colore dei Vincoli globali.
  - **`bandView` con piano vuoto** (Focus della review 4): `planPercent === 0`.
  - **Rendering della banda**, su `terminal` e `desktop`:
    - `find({ key: 'case' })?.text` contiene `⇄ main ×2` in uno scenario C
    - `find({ key: 'plan' })?.text` è `Piano 7/12 (58%)`
  - **Fuori da git** (Focus della review 1): la banda mostra `▣ <nome cartella>`.
  - **Composizione:** con un'altra banda fittizia registrata sotto, la sua `Text` resta nel disegno.
  - **Spinner:** con 2 agenti attivi, `suffix` è `… · 2 agenti`.
- [ ] **Passo 2:** `claude plugin test .`. Atteso: FAIL.
- [ ] **Passo 3: implementa.**
- [ ] **Passo 4:** `claude plugin test . && npx -y -p typescript@5.6.3 tsc -p .`. Atteso: PASS.
- [ ] **Passo 5: commit.** `feat(ui): banda sopra il prompt e suffisso dello spinner`

---

### Task 10: Pannello, tab Agenti, Pipeline e Piano

**File:**
- Crea: `src/ui/pane.tsx`, `src/ui/graph-svg.ts`, `src/ui/graph-text.tsx`
- Modifica: `src/ui/view-model.ts`, `hooks/register.tsx`
- Test: `tests/ui-pane.test.tsx`

**Interfacce:**
- Produce, in `src/ui/view-model.ts`:
  - `agentsView(tree: AgentTree, now: number): { id: string; parentId: string; label: string; status: AgentStatus; statusText: 'in corso' | 'completato' | 'fallito' | 'interrotto'; tokensText: string; detail?: string }[]`
    - `tokensText`: `12.4k tok` sopra 1000, altrimenti `850 tok`
    - `detail`: il `lastTool` o la `description` dell'agente
  - `pipelineView(p: PipelineState): { phases: { n: number; name: string; state: 'done' | 'current' | 'todo'; enteredAt?: number; skill?: string }[]; badges: BadgeName[]; previousCycles: number }`
- Produce, in `src/ui/graph-svg.ts`: `agentGraphSvg(nodes: ReturnType<typeof agentsView>, width: number): string`. È SVG valido, sotto i 131 072 caratteri: nodo `main` in alto, figli su righe successive, uno stroke per stato, testo con escape di `<`, `>` e `&`. Sopra i 60 nodi disegna solo i running e gli ultimi 20 conclusi.
- Produce, in `src/ui/graph-text.tsx`: `GraphText({ nodes, Box, Text })`, l'albero `├─`/`└─` con `●`, `✓`, `✗` e `■` come nel mockup della spec.
- Produce, in `src/ui/pane.tsx`: `renderPane($, e)`.
  - In cima, quattro `Button` con `hotkey` da `'1'` a `'4'`, `key` `tab-agents`, `tab-pipeline`, `tab-plan` e `tab-sessions`, e `onPress` che scrive l'atom `tab`.
  - **Tab Agenti:** su `desktop`, `<Svg source={agentGraphSvg(...)} alt="Grafo degli agenti" />` più le altre sessioni in forma breve. Su `terminal` (e su qualunque superficie senza `Svg` nella tabella di `$.ui.resolve(e)`), `GraphText`.
  - **Tab Pipeline:** sei righe `✓`/`●`/`○` con nome, orario `HH:MM`, skill, i badge `[TDD]` e simili, e `N cicli precedenti` se ce ne sono.
  - **Tab Piano:** `<Markdown text={planText} />` e un `Button` `key="open-plan"` con label `Apri`, che esegue `$.prompt.fill({ text: '@' + planPath + ' ', mode: 'insert' })`. Senza piano: `Nessun piano trovato in docs/superpowers/plans/`.
- Render site in `register.tsx`: `on('ui.render', { component: 'Pane', requestId: 'overclock' }, renderPane)`.

- [ ] **Passo 1: test che falliscono.**
  - **`agentsView`:** il formato dei token (`12400` → `12.4k tok`) e l'etichetta di stato.
  - **`agentGraphSvg`:** inizia con `<svg`; una descrizione con `<b>` arriva con l'escape; 200 nodi restano sotto i 131 072 caratteri.
  - **Montaggio del Pane:**
    - su `desktop`, `find({ type: 'Svg' })` esiste;
    - su `terminal` no, e `find({ type: 'Text', text: /implementer/ })` esiste.
  - **Tab Piano:** `press({ key: 'tab-plan' })` mostra il Markdown. `press({ key: 'open-plan' })` scatena `prompt.fill` con `text` `@docs/superpowers/plans/p.md `, intercettato da un hook di fondo `on('prompt.fill', …)`.
  - **`pipelineView`:** a fase 4 le fasi 1–3 sono `done`, la 4 `current`, la 5 e la 6 `todo`.
- [ ] **Passo 2:** `claude plugin test .`. Atteso: FAIL.
- [ ] **Passo 3: implementa.**
- [ ] **Passo 4:** `claude plugin test . && npx -y -p typescript@5.6.3 tsc -p .`. Atteso: PASS.
- [ ] **Passo 5: commit.** `feat(ui): pannello con le tab agenti, pipeline e piano`

---

### Task 11: Tab Sessioni

**File:**
- Crea: `src/ui/sessions-cards.tsx`, `src/ui/sessions-text.tsx`
- Modifica: `src/ui/view-model.ts`, `src/ui/pane.tsx`
- Test: `tests/ui-sessions.test.tsx`

**Interfacce:**
- Consuma: `groupSessions` (Task 6) e `caseStyle` (Task 9).
- Produce, in `src/ui/view-model.ts`: `sessionsView(self, others, now): { summary: string; groups: SessionGroup[] }`.
  - `summary`: `N sessioni vive · M agenti attivi · Xk token oggi`. I token di oggi sono la somma, sulle sessioni vive, dei token degli agenti con `startedAt` dopo la mezzanotte locale, più `mainTokens` della propria.
  - **Agenti mostrati:** per le altre sessioni solo i `running`; per la propria, i `running` più l'ultimo concluso.
  - **Etichetta di sessione:** il branch per i casi A e B, `sessione <prime 4 cifre dell'id>` per il caso C.
- Produce:
  - `SessionsCards`, per Desktop: un `Box` per sessione con bordo sinistro nel colore del caso, `key={'s-' + sessionId}`, barra di avanzamento del piano fatta da due `Box` con `backgroundColor` e larghezza proporzionale, l'etichetta `tu` sulla propria e gli avvisi `⚠ <path> scritto da entrambe Nm fa`.
  - `SessionsText`, per il terminale: lo stesso contenuto come albero colorato, come nel mockup `all-sessions.html`.
- La tab `sessions` di `pane.tsx` sceglie `SessionsCards` su `desktop` e `SessionsText` altrove.

- [ ] **Passo 1: test che falliscono**, con 5 sessioni come nel mockup (3 worktree di `overclock`, 2 sessioni di `billing-api` sullo stesso branch con un file in comune).
  - **Riepilogo:** `summary` inizia con `5 sessioni vive`.
  - **Avviso:** su entrambe le superfici, `find({ type: 'Text', text: /api\/invoices\.py/ })` esiste.
  - **Sessione inattiva:** quella con `lastActivity` di 12 minuti fa compare dopo le attive del suo gruppo.
  - **Agenti conclusi altrui:** un agente concluso di un'altra sessione non compare.
- [ ] **Passo 2:** `claude plugin test .`. Atteso: FAIL.
- [ ] **Passo 3: implementa.**
- [ ] **Passo 4:** `claude plugin test . && npx -y -p typescript@5.6.3 tsc -p .`. Atteso: PASS.
- [ ] **Passo 5: commit.** `feat(ui): tab sessioni per desktop e terminale`

---

### Task 12: Comando /overclock

**File:**
- Modifica: `hooks/register.tsx`, `src/app/runtime.ts`
- Test: `tests/commands.test.ts`

**Interfacce:**
- Consuma: `parseCommand` (Task 6); `setPhase` e `resetPipeline` (Task 4); gli atom.
- Produce: `on('command.run', { command: 'overclock' }, …)`, che restituisce `{ text }`:

| Comando | Azione | Testo restituito |
| --- | --- | --- |
| toggle | `$.ui.open({ id: 'overclock', title: 'Overclock', focus: true })`. Il pane si richiude con Esc o con il suo segno di chiusura, perché l'API non ha una close. | `Pannello aperto.` |
| open | imposta l'atom `tab`, poi lo stesso `open` | `Pannello aperto su <tab>.` |
| pin | il path relativo a `worktreeRoot`; se il file non esiste: `File non trovato: <path>`. Altrimenti `pinned[target] = true` e ricarica `planText` e il conteggio | `<Spec\|Piano> fissato: <path>` |
| unpin | azzera i pin e rilancia il rilevamento | `Rilevamento automatico ripristinato.` |
| phase | `setPhase` | `Fase impostata a <n> (<nome>).` |
| reset | `resetPipeline` | `Pipeline azzerata.` |
| error | — | il `message` |

Se dalla verifica dei tipi risulta che `$.ui` ha un `close` per i pane, `toggle` chiude un pannello aperto e risponde `Pannello chiuso.`.

- [ ] **Passo 1: test che falliscono.** Un test per riga della tabella, con `$.command.run({ command: 'overclock', args: '…' })`; il test controlla `text` e lo stato.
- [ ] **Passo 2:** `claude plugin test .`. Atteso: FAIL.
- [ ] **Passo 3: implementa.**
- [ ] **Passo 4:** `claude plugin test . && npx -y -p typescript@5.6.3 tsc -p .`. Atteso: PASS.
- [ ] **Passo 5: commit.** `feat: comando /overclock`

---

### Task 13: Verifica dal vivo e README

**File:**
- Modifica: `README.md`

- [ ] **Passo 1: controlli statici.**
  - Esegui `claude plugin validate . && claude plugin test . && npx -y -p typescript@5.6.3 tsc -p .`. Tutto deve essere verde.
  - Nell'output di validate, la superficie usata deve coincidere con quella consentita dai Vincoli globali, senza nulla di vietato.
- [ ] **Passo 2: prova in un terminale largo almeno 144 colonne.**
  - Lancia `claude --plugin-dir /home/alex/WebstormProjects/overclock` e chiedi a Claude di lanciare un subagent `Explore`.
  - Atteso:
    - il pannello si apre da solo e il grafo testuale mostra `● Explore`, che poi diventa `✓`;
    - la banda mostra `▣ overclock` (o `⎇`) e `Spec: 2026-10-19-overclock-design.md`;
    - lo spinner mostra `· 1 agente`.
- [ ] **Passo 3: due sessioni sullo stesso repo** (un worktree con `git worktree add ../overclock-wt -b test/oc`, aperto in un secondo terminale). Atteso: entro 15 secondi la banda diventa verde `⎇` e la tab Sessioni (`4`) mostra due righe sotto `overclock`. Rimuovi il worktree alla fine.
- [ ] **Passo 4: `/clear` nella prima sessione.** Atteso: la tab Pipeline mostra ancora la fase di prima.
- [ ] **Passo 5: Desktop.**
  - Aggiungi `"CLAUDE_CODE_PLUGIN_DIRS": "/home/alex/WebstormProjects/overclock"` al blocco `env` di `~/.claude/settings.json`, **dopo aver chiesto ad Alex**: è una modifica alla sua configurazione.
  - Apri una sessione nella tab Code. Atteso: la tab Agenti disegna il grafo `Svg`.
  - Se Alex non vuole la modifica, salta il passo e scrivilo nel report.
- [ ] **Passo 6: README.**
  - Cosa fa e come si carica (`--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`).
  - I comandi della tabella del Task 12.
  - La superficie d'accesso, in due righe.
  - Come aggiungere una skill alla mappa (`src/core/phases.ts` o `phaseMapPath`).
- [ ] **Passo 7: commit.** `docs: README di Overclock`
