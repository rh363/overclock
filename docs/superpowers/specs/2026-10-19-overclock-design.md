# Mod "Overclock" per Claude Code — design

19 ottobre 2026 · Alex Massaroni · stato: domande aperte chiuse, in attesa di approvazione

## Obiettivo e requisiti

Overclock è un mod di Claude Code. In un pannello fisso mostra chi sta lavorando, a che punto è il flusso Superpowers e su quale spec e piano si sta lavorando. Gira nella tab Code di Claude Desktop e nel terminale.

L'obiettivo è capire a colpo d'occhio cosa sta succedendo anche con più sessioni aperte insieme, sia quando sono worktree dello stesso repo, sia quando sono repo diversi, sia quando sono più sessioni sullo stesso branch.

| Requisito | Cosa deve mostrare | Superficie |
| --- | --- | --- |
| Schema agenti | Sessione principale, subagent attivi e conclusi (tipo, descrizione, stato, durata, token) e le altre sessioni locali che usano il mod, raggruppate per caso (vedi "Sessioni parallele") | Desktop: grafo SVG · Terminale: albero testuale |
| Pipeline Superpowers | Fasi già attraversate, fase corrente, fasi ancora da fare, skill che ha attivato ogni fase | Desktop e terminale |
| Spec e piano sempre visibili | Path di spec e piano attivi, avanzamento dei task del piano, apertura rapida | Banda sopra il prompt, sempre presente |
| Vista di tutte le sessioni | Ogni sessione locale viva con branch, fase, piano e agenti attivi, raggruppata per repo e colorata per caso | Tab "Sessioni" del pannello, Desktop e terminale |

**La UI è una prima versione.** Alex non sa ancora quali informazioni gli serviranno di più a colpo d'occhio, quindi la UI verrà raffinata dopo l'uso. Per questo i renderer leggono solo un modello di vista già calcolato (`src/ui/view-model.ts`): cambiare cosa si mostra non deve toccare core né adapter.

**Fuori scope per la v1:** avviare o fermare agenti dal pannello, sessioni cloud, sessioni WSL (lì i plugin non girano).

**Anti-obiettivo:** il mod non deve mai cambiare il comportamento di Claude. È solo un osservatore (vedi "Sicurezza").

## Fattibilità

Versioni: Claude Code installato v2.1.303. Nomi dei campi verificati sul file dei tipi della build 2.1.299 (`plugin-authoring/types/claude-code.d.ts`). Prima di scrivere codice vanno ricontrollati su `.claude-plugin/types/claude-code/index.d.ts`, che l'engine genera alla prima load del mod.

| Bisogno | Strumento dell'API (campi verificati) | Note |
| --- | --- | --- |
| Inizio di un subagent | evento `agent.spawn`: `e.tool_use_id`, `e.subagentType`, `e.description`, `e.parentAgentId?`, `e.background`, `e.fork`; `await next(e)` restituisce `{ agentId }` oppure `{ deny }` | Osservato senza modificarlo. Su `deny` nessun nodo |
| Fine di un subagent | evento `turn.complete` con `e.agentId` valorizzato: `e.reason` (`answer`/`aborted`/`refusal`/`error`), `e.isAborted`, `e.durationMs`, `e.usage` | Ogni esecuzione di un subagent è un turno del suo loop, quindi la fine arriva da qui, anche per gli agenti in background |
| Riconciliazione | `$.agent.list()` → `AgentInfo { id, type, description, status, parentId? }` | Chiamato a ogni redraw del pane: corregge i nodi rimasti "running" |
| Token | `e.usage` di `turn.complete`: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` | Sommati per agente. Per la sessione main, dai `turn.complete` senza `agentId` |
| Ultimo tool di un agente | `tool.call`: `e.tool`, `e.agentId?` | Solo osservato |
| Fasi Superpowers | `skill.prompt`: `e.skill`, `e.pluginName?` | Il formato esatto di `e.skill` (con o senza prefisso `superpowers:`) va verificato con un test; la mappa accetta entrambi |
| Repo e worktree | `$.session.repo()` → `{ root, remote, name }`, dove `root` è la root del working tree **principale** anche da un worktree; `$.session.root()` è la root della sessione | `repo.root` uguale e `session.root` diverso significa worktree diversi dello stesso repo |
| Branch | Non c'è nell'API. Lo leggo con `$.fs.read` da `<session.root>/.git/HEAD`; in un worktree `.git` è un file `gitdir: …` e `HEAD` sta in quel percorso | Nessun `$.process`. Riletto a ogni `turn.start` della main e dopo un `tool.call` `Bash` che contiene `git checkout` o `git switch` |
| Altre sessioni locali | `$.store`: il file JSON del plugin, condiviso da tutte le sessioni sulla macchina e persistente tra sessioni | Una chiave per sessione |
| Spec e piano | `$.fs.list` / `$.fs.read`, più `tool.call` su `Write`/`Edit` (`e.file_path`) | |
| Pannello fisso | `$.ui.open({ id, title })` + `ui.render` su `{ component: 'Pane', requestId }` | Desktop e terminale |
| Riferimento sempre visibile | `ui.render` su `{ component: 'AbovePrompt' }` | Va composto con `await next(e)` |
| Grafo | elemento `Svg`, solo su `e.surface === 'desktop'` | Nel terminale niente `Svg`: albero testuale |

Limiti rilevanti:
- ogni hook ha 10 secondi di esecuzione propria;
- letture e scritture con `$.fs` oltre 4 MiB vengono rifiutate, e `$.store` è un unico file JSON, quindi va tenuto piccolo;
- i redraw sono limitati a 10 al secondo;
- nel terminale, un pane aperto dal mod senza un'azione dell'utente compare solo da 144 colonne in su (110 dopo la prima apertura manuale).

## Sessioni parallele

Overclock riconosce tre casi e li rende distinguibili con un colore, un simbolo e un raggruppamento diversi. Il disegno di riferimento è il mockup `.superpowers/brainstorm/*/content/session-cases.html`, approvato da Alex.

| Caso | Come si riconosce | Banda | Tab Agenti |
| --- | --- | --- | --- |
| **A · Worktree diversi, stesso repo** | stesso `repo.root`, `session.root` diverso | verde, `⎇ <branch>` + `<repo> · N worktree` | Sotto il nome del repo, una riga per worktree: branch, fase della sua pipeline, numero di agenti attivi |
| **B · Repo diversi** | `repo.root` diverso | blu, `▣ <repo>` + `<branch>` + `+N altri repo` attenuato | Un blocco per repo, piatto. Gli altri repo sono contesto e restano attenuati |
| **C · Stesso branch** | stesso `repo.root` e stesso branch, più sessioni vive | arancione, `⇄ <branch> ×N` + `condiviso con N-1 sessioni` | Le sessioni del branch sotto un'unica intestazione, ognuna con la sua pipeline. Avviso `⚠` quando due sessioni hanno scritto lo stesso file negli ultimi 5 minuti |

- Se i casi si mescolano, la banda mostra il caso della **sessione corrente**. Il caso C ha la precedenza sul caso A, perché segnala un rischio.
- La tab Agenti annida prima per repo, poi per branch.
- Le sessioni fuori da un repo git compaiono come `▣ <nome cartella>`, senza pipeline.

Calcolo del caso: un'unica funzione pura `classify(self, others)` nel core, con input le voci `session:*` vive.

## Modello dati

Lo stato vive in entità pure (`AgentNode`, `SessionEntry`, `PipelineState`, `PlanRef`), aggiornate solo dagli eventi; il disegno le legge e non le modifica mai.

### Agenti

```typescript
type AgentStatus = 'running' | 'done' | 'failed' | 'aborted'

interface AgentNode {
  id: string            // agentId da next(e) di agent.spawn; 'main' per la sessione
  parentId?: string     // e.parentAgentId, 'main' se assente
  toolUseId: string     // e.tool_use_id, per collegare il nodo alla chiamata Agent
  type: string          // e.subagentType
  description: string   // e.description
  background: boolean   // e.background
  status: AgentStatus   // da turn.complete: answer→done, error/refusal→failed, aborted→aborted
  startedAt: number
  endedAt?: number
  tokens: { input: number; output: number }   // somme da e.usage
  lastTool?: string     // ultimo e.tool visto con questo agentId
}
```

- Un agente che riprende (`e.resume` su `agent.spawn`) torna in `running` sullo stesso nodo.
- Ogni sessione tiene al massimo 50 nodi conclusi; i più vecchi vengono scartati.

### Voce di sessione in `$.store`

```typescript
interface SessionEntry {
  sessionId: string          // $.session.id()
  repoRoot: string | null    // $.session.repo()?.root
  repoName: string           // repo.name ?? basename(repoRoot) ?? basename(session.root)
  worktreeRoot: string       // $.session.root()
  branch: string | null      // da .git/HEAD; 'detached@<sha7>' se detached
  agents: AgentNode[]
  recentWrites: { path: string; at: number }[]   // ultimi 5 minuti, path relativi al repo
  phase: number; badges: string[]                 // riassunto della pipeline per la tab Sessioni
  planDone: number; planTotal: number
  lastActivity: number                            // ultimo evento di un agente o della main
  heartbeat: number
}
```

- Chiave: `session:<sessionId>`. Ogni sessione scrive solo la propria chiave, così non c'è read-modify-write condiviso.
- Heartbeat ogni 15 secondi con `$.clock`, più una scrittura a ogni evento rilevante.
- Una voce senza heartbeat da più di 60 secondi è considerata non viva.
- Una voce senza heartbeat da più di 24 ore viene cancellata da chi la legge.
- `session.end` cancella la propria voce.

### Fasi Superpowers

La pipeline è una sequenza fissa. La fase corrente si sposta quando Claude carica una skill mappata. Si può solo avanzare: una skill di una fase già passata viene registrata, ma la fase non torna indietro. L'unica eccezione è `/overclock phase`.

| # | Fase | Skill che la attivano | Artefatto atteso |
| --- | --- | --- | --- |
| 1 | Brainstorming | `superpowers:brainstorming` | Spec in `docs/superpowers/specs/` |
| 2 | Worktree | `superpowers:using-git-worktrees`, `alex-dev-skills:git-worktrees` | Branch isolato |
| 3 | Piano | `superpowers:writing-plans` | Piano in `docs/superpowers/plans/` |
| 4 | Esecuzione | `superpowers:subagent-driven-development`, `superpowers:executing-plans` | Task del piano spuntati |
| 5 | Code review | `superpowers:requesting-code-review` | Review completata |
| 6 | Chiusura branch | `superpowers:finishing-a-development-branch` | Merge o PR |

**Badge trasversali.** Compaiono sulla fase corrente, non come fasi a sé:

| Badge | Skill |
| --- | --- |
| TDD | `superpowers:test-driven-development`, `alex-dev-skills:tdd-prove-it` |
| Debug | `superpowers:systematic-debugging`, `alex-dev-skills:systematic-debugging` |
| Verifica | `superpowers:verification-before-completion` |

Alex lascia scegliere le skill a Claude, quindi il mod riconosce sia le skill di Superpowers sia quelle di `alex-dev-skills`. La tab Pipeline mostra, accanto a ogni fase, quale skill l'ha attivata e a che ora.

La mappa skill → fase/badge sta in `config/phases.json` dentro il mod, così una rinomina o una skill nuova costano una riga. Un `userConfig` opzionale, `phaseMapPath`, può puntare a un file alternativo.

**La pipeline segue la sessione, non il branch** (decisione di Alex). Nella stessa sessione di Claude si cambia spesso worktree o branch: la fase Worktree lo fa sempre. La pipeline deve seguire il lavoro, non la cartella.

- Chiave `pipeline:<sessionId>`, scritta solo dalla propria sessione.
- Cambiare worktree o branch aggiorna solo il branch mostrato; la pipeline continua.
- Sopravvive a `/clear` e alla ripresa della sessione. Se `/clear` cambia `sessionId` (da verificare nel primo test adapter), al `session.start` successivo la sessione nuova eredita la pipeline della precedente: stesso `session.root`, voce terminata da meno di 10 secondi.
- Nel caso C ogni sessione ha la propria pipeline; il caso si vede da etichetta e avviso, non da una pipeline condivisa.

**Nuovo ciclo** (scelta di Claude): se una skill di fase 1 arriva quando la pipeline è già a fase 2 o oltre, il ciclo corrente si chiude, finisce in `cycles` e ne parte uno nuovo da fase 1. La tab Pipeline mostra il ciclo corrente; i precedenti stanno in una riga riassuntiva compressa.

```typescript
interface PipelineCycle {
  phase: 0 | 1 | 2 | 3 | 4 | 5 | 6          // 0 = nessuna fase ancora
  history: { phase: number; skill: string; at: number }[]
  badges: { name: 'TDD' | 'Debug' | 'Verifica'; at: number }[]  // della fase corrente
}
interface PipelineState {
  current: PipelineCycle
  cycles: PipelineCycle[]   // conclusi, al massimo 10
  plan: PlanRef
}
```

### Spec e piano

All'avvio il mod cerca il file `.md` più recente (per `mtime`) in `docs/superpowers/specs/` e `docs/superpowers/plans/`, relativi a `session.root`. Poi aggiorna il riferimento quando un `Write` o un `Edit` tocca quelle cartelle. Dal piano conta le checkbox `- [ ]` e `- [x]` per l'avanzamento (es. 7/12 task), e le riconta dopo ogni `Write`/`Edit` sul piano.

Un riferimento fissato con `/overclock pin` vince sul rilevamento automatico. È salvato in `PipelineState.plan` della sessione, così resta anche dopo `/clear`.

```typescript
interface PlanRef { specPath?: string; planPath?: string; pinned: { spec: boolean; plan: boolean }; done: number; total: number }
```

## Layout

Il pannello a destra del transcript ospita agenti e pipeline. La banda sopra il prompt tiene spec, piano, fase e caso di sessione sempre visibili, anche a pannello chiuso.

```text
+-----------------------------+  +----------------------------------------+
| Transcript                  |  | 1 Agenti  2 Pipeline  3 Piano  4 Sess. |
|                             |  |            [Sessione main]             |
|                             |  |        /          |           \        |
|                             |  | [implementer] [spec review] [Explore]  |
|                             |  |   in corso     completato   completato |
|                             |  | ⎇ overclock (3 worktree)               |
|                             |  |   feat/store-adapter  Piano 3/6  1 ag. |
|                             |  | Pipeline 4/6 - Esecuzione  [TDD]       |
+-----------------------------+  +----------------------------------------+
| ⎇ feat/overclock-ui · Spec: overclock-design.md · Piano 7/12 · Fase 4/6 |  <- banda AbovePrompt
+--------------------------------------------------------------------------+
| Prompt                                                                   |
+--------------------------------------------------------------------------+
```

Nel Desktop il grafo è un `Svg`. Nel terminale, che non disegna `Svg`, la stessa tab mostra un albero testuale:

```text
Sessione main
├─ ● implementer   task 3        in corso   12.4k tok
├─ ✓ spec review                completato  3.1k tok
└─ ✓ Explore                    completato  8.7k tok
⎇ overclock (3 worktree)
  ├─ ● feat/store-adapter   Piano 3/6        1 agente
  └─ ○ fix/band-compose     Review 5/6       inattiva

Pipeline  ✓ Brainstorming ✓ Worktree ✓ Piano ● Esecuzione ○ Review ○ Chiusura
```

- **Tab Pipeline:** le sei fasi in verticale, ognuna con orario di ingresso, skill che l'ha attivata e badge.
- **Tab Sessioni:** tutte le sessioni locali vive, con lo stesso modello dati della sezione "Sessioni parallele". Riferimento: mockup `.superpowers/brainstorm/*/content/all-sessions.html`.
  - In cima un riepilogo: sessioni vive, agenti attivi, token di oggi.
  - Le sessioni sono raggruppate per repo (poi per branch) e colorate per caso.
  - Per ogni sessione: branch, fase, avanzamento del piano e agenti attivi con i token. Nel Desktop sono schede in griglia con barra di avanzamento; nel terminale un albero compatto.
  - Gli agenti conclusi delle altre sessioni sono nascosti. Una sessione inattiva da più di 10 minuti scende in fondo al gruppo, attenuata.
  - Per mostrare il piano delle altre sessioni, `SessionEntry` pubblica anche `phase`, `planDone`, `planTotal` e `badges`.
- **Tab Piano:** il piano reso in `Markdown`, con le checkbox.
- **Colori del caso di sessione:** verde, blu e arancione, con un simbolo (`⎇`, `▣`, `⇄`) che si legge anche senza colori.
- **Spinner:** se l'API lo permette, riceve un suffisso con il numero di subagent attivi (es. `Working · 2 agenti`). Se nella build non c'è un modo pulito per farlo, si rinuncia: è un extra.

## Architettura del codice

Il repository `overclock/` **è** la cartella del plugin: si carica con `claude --plugin-dir /home/alex/WebstormProjects/overclock`.

Il core è TypeScript puro, senza import dell'API dei mod: riceve eventi di dominio e restituisce nuovo stato. `register.tsx` è l'unico adapter in ingresso, i renderer sono adapter in uscita, `$.store` e `$.fs` stanno dietro due port.

```text
overclock/
├── .claude-plugin/plugin.json      # manifest, "types", userConfig (phaseMapPath)
├── config/phases.json              # mappa skill → fase / badge
├── hooks/
│   ├── hooks.json                  # { "modules": ["./register.tsx"] }
│   └── register.tsx                # adapter: eventi mod → eventi di dominio
├── src/
│   ├── core/                       # dominio puro, nessun $
│   │   ├── agents.ts               # reducer dell'albero agenti
│   │   ├── pipeline.ts             # macchina a stati delle fasi
│   │   ├── plan.ts                 # parsing checkbox, scelta file attivo
│   │   ├── sessions.ts             # classify(): casi A/B/C, avviso file condivisi
│   │   └── git.ts                  # parsing di .git / HEAD
│   ├── ports.ts                    # StatePort, FilePort
│   ├── adapters/
│   │   ├── store.ts                # StatePort su $.store
│   │   └── files.ts                # FilePort su $.fs
│   └── ui/
│       ├── view-model.ts           # stato → ciò che si mostra (unico punto da toccare per raffinare la UI)
│       ├── pane.tsx                # tab Agenti / Pipeline / Piano / Sessioni
│       ├── sessions-cards.tsx      # tab Sessioni per Desktop
│       ├── sessions-text.tsx       # tab Sessioni per terminale
│       ├── band.tsx                # banda sopra il prompt
│       ├── graph-svg.tsx           # grafo agenti per Desktop
│       └── graph-text.tsx          # albero agenti per terminale
├── types/index.d.ts                # PluginState per $.state
├── test/*.test.ts                  # claude plugin test
└── docs/superpowers/               # spec e piani
```

L'ambiente dei moduli non ha DOM né Node. Quindi:
- `src/core` non importa nulla di Node (niente `path`, niente `fs`);
- i path si trattano con funzioni proprie;
- il core si testa con lo stesso `claude plugin test`. Se si rivela scomodo, si può aggiungere un runner unitario semplice (vitest) che importa solo `src/core`.

Esempio del confine:

```typescript
// hooks/register.tsx (adapter)
on('agent.spawn', async ($, e, next) => {
  const r = await next(e)
  if (r.deny === undefined && r.agentId) {
    dispatch($, { kind: 'agent.started', id: r.agentId, parentId: e.parentAgentId,
      toolUseId: e.tool_use_id, type: e.subagentType, description: e.description, background: e.background })
  }
  return r
})

on('turn.complete', async ($, e, next) => {
  const r = await next(e)
  if (e.agentId) dispatch($, { kind: 'agent.ended', id: e.agentId, reason: e.reason, usage: e.usage })
  else dispatch($, { kind: 'main.turn', usage: e.usage })
  return r
})

// src/core/agents.ts (dominio puro)
export function reduce(tree: AgentTree, ev: DomainEvent, now: number): AgentTree { /* ... */ }
```

## Comandi e interazioni

Tutti i comandi sono `immediate`: funzionano anche mentre Claude lavora e non consumano un turno.

| Comando | Cosa fa |
| --- | --- |
| `/overclock` | Apre o chiude il pannello, con focus |
| `/overclock agents` · `pipeline` · `plan` · `sessions` | Apre il pannello direttamente su quella tab |
| `/overclock pin spec <path>` · `pin plan <path>` | Fissa spec o piano a mano, ignorando il rilevamento |
| `/overclock unpin` | Torna al rilevamento automatico |
| `/overclock phase <n>` | Corregge a mano la fase corrente, anche all'indietro |
| `/overclock reset` | Azzera la pipeline della sessione corrente |

- **Nel pannello:** i tasti `1`, `2`, `3`, `4` cambiano tab. Nella tab Piano il pulsante Apri mette il file nel prompt come riferimento `@path` (`$.prompt` in modalità fill), così basta un invio per farlo leggere a Claude.
- **Nella banda:** spec e piano sono sempre lì, con la percentuale di avanzamento.
- **Apertura automatica** (deciso con Alex): il pannello si apre da solo alla prima `agent.spawn` o alla prima skill mappata della sessione, una sola volta per sessione; da lì in poi resta come l'utente lo lascia. Nel terminale stretto (sotto le 144 colonne) `$.ui.open` restituisce `isPlaced: false`. In quel caso il mod mostra un toast una sola volta: `Overclock: /overclock per aprire il pannello`.

## Sicurezza, test e rischi

Overclock è un mod di sola osservazione: ogni hook restituisce il risultato di `next(e)` senza modificarlo, e non nega, riscrive o approva nulla.

**Superficie di accesso dichiarata**, verificabile con `claude plugin validate`:

- usa: `$.fs.read`, `$.fs.list`, `$.fs.stat`, `$.store`, `$.state`, `$.ui`, `$.command`, `$.prompt`, `$.session`, `$.agent.list`, `$.clock`;
- non usa: `$.http`, `$.process`, `$.env`, `$.model`, `$.fs.write`, `tool.check`.

Le descrizioni dei subagent e i path dei file possono contenere dati di progetto. Restano nello store locale del plugin, sotto la configurazione di Claude Code, e non vanno mai in rete.

**Test**

- **Core:** unit test puri su reducer agenti, `classify()` dei casi A/B/C, macchina a stati delle fasi, parsing di piano e `.git/HEAD`. In TDD: prima il test che fallisce.
- **Adapter:** `claude plugin test` con eventi finti (`agent.spawn`, `turn.complete` con e senza `agentId`, `skill.prompt`, `tool.call` su `Write`), per verificare stato e albero disegnato. Il primo test conferma anche la forma di `e.skill`.
- **Rendering:** snapshot del tree per `surface: 'terminal'` e `surface: 'desktop'`, un test dopo `/clear`, uno per ciascuno dei tre casi di sessione e uno per la tab Sessioni con più sessioni e agenti.

**Rischi**

| Rischio | Effetto | Mitigazione |
| --- | --- | --- |
| `turn.complete` di un subagent perso (riavvio, crash) | Agente che resta "running" | Riconciliazione con `$.agent.list()`: un nodo `running` che non compare più nella lista passa a `done` |
| Branch non esposto dall'API | Caso A/C sbagliato | Parsing di `.git/HEAD` con test; rilettura dopo `git checkout`/`switch` |
| Race su `$.store` fra sessioni | Viste globali incoerenti | Ogni sessione scrive solo le proprie chiavi (`session:<id>`, `pipeline:<id>`). Resta un dubbio: l'API non dice se due processi che scrivono lo store nello stesso momento si sovrascrivono l'intero file. Lo verifica il **primo task** del piano; se lo store non regge, si torna da Alex prima di andare avanti |
| Store che cresce | File JSON grande e lento | Massimo 50 agenti per sessione, `recentWrites` di 5 minuti, voci più vecchie di 24 ore cancellate |
| Rinomine delle skill | Pipeline ferma | `config/phases.json`, `phaseMapPath`, `/overclock phase` |
| Banda condivisa con altri mod | Contenuto altrui sovrascritto | Comporre sempre con `await next(e)` |
| API dei mod ancora giovane | Campi evento che cambiano | Tipi generati per versione, `tsc -p` e `claude plugin test` prima di ogni commit |

## Decisioni prese

- **Sessioni parallele:** supportati tutti e tre i casi, con resa distinta (mockup approvato da Alex).
- **Pipeline:** per sessione, non per branch (decisione di Alex: cambiando worktree la sessione resta la stessa).
- **Vista di tutte le sessioni:** tab Sessioni nel Desktop e nel terminale (richiesta di Alex). La UI è una prima versione da raffinare dopo l'uso.
- **Skill:** Alex lascia scegliere a Claude, quindi la mappa riconosce sia Superpowers sia `alex-dev-skills` (scelta di Claude, approvata).
- **Pannello:** si apre da solo (decisione di Alex).
- **Nome:** Overclock, comando `/overclock`.

**Scelte di Claude da verificare leggendo:**
- finestra di 5 minuti per l'avviso sui file condivisi;
- heartbeat ogni 15 secondi e soglia di 60 secondi;
- massimo 50 agenti per sessione;
- la fase avanza solo in avanti; una skill di fase 1 dopo la fase 2 apre un nuovo ciclo;
- nella tab Sessioni gli agenti conclusi delle altre sessioni sono nascosti, e una sessione inattiva da più di 10 minuti scende in fondo;
- il caso C ha la precedenza sul caso A nella banda;
- il repo coincide con la cartella del plugin;
- toast quando il terminale è troppo stretto per il pannello.

## Prossimi passi

Piano di implementazione in `docs/superpowers/plans/`, con prima i test del core e poi il mod in TypeScript, caricabile con `claude --plugin-dir ./`.
