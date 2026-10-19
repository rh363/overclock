# Overclock

Mod di Claude Code che tiene un pannello fisso con tutto quello che sta succedendo nella sessione: agenti, pipeline Superpowers, piano e altre sessioni. Sola osservazione: non modifica mai gli eventi (unica eccezione, il suffisso dello spinner).

## Cosa fa

- **Agenti.** Grafo testuale (nel terminale) o `Svg` (in Desktop) dei subagent lanciati: `● Explore` mentre lavora, `✓` a fine lavoro. Lo spinner mostra `· N agenti`.
- **Pipeline Superpowers.** Segue le 6 fasi (Brainstorming, Worktree, Piano, Esecuzione, Code review, Chiusura branch) in base alle skill invocate, con badge per TDD, Debug e Verifica. La fase sopravvive a `/clear`.
- **Banda spec/piano.** Sopra il prompt: caso di sessione, spec e piano rilevati (`Spec: <file>`, `Piano 7/12`, `Fase 4/6`). Si possono fissare a mano con `/overclock pin`.
- **Tab Sessioni.** Le sessioni vive sullo stesso computer, raggruppate per repo, con branch, fase e agenti attivi. Avviso `⚠` se due sessioni scrivono lo stesso file entro 5 minuti.

I tre casi di sessione, mostrati con colore e simbolo (leggibile anche senza colori):

| Caso | Quando | Banda |
| --- | --- | --- |
| A | stesso repo, worktree diversi | verde `⎇` |
| B | repo diversi | blu `▣` |
| C | stesso repo e stesso branch, più sessioni vive | arancione `⇄` (ha la precedenza su A) |

Il pannello si apre da solo solo con terminale di almeno 144 colonne.

## Come si carica

Terminale:

```
claude --plugin-dir /percorso/di/overclock
```

Desktop: imposta `CLAUDE_CODE_PLUGIN_DIRS` nel blocco `env` di `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/percorso/di/overclock" } }
```

## Comandi

`/overclock` senza argomenti apre il pannello se è chiuso e lo chiude se è aperto.

| Comando | Effetto |
| --- | --- |
| `/overclock` | apre/chiude il pannello |
| `/overclock agents\|pipeline\|plan\|sessions` | apre il pannello su quella tab |
| `/overclock pin spec <path>` | fissa la spec (path relativo al worktree) |
| `/overclock pin plan <path>` | fissa il piano |
| `/overclock unpin` | torna al rilevamento automatico |
| `/overclock phase <0-6>` | imposta la fase a mano |
| `/overclock reset` | azzera la pipeline |

## Superficie d'accesso

Usa: `$.fs.read/list/exists`, `$.store`, `$.state`, `$.ui`, `$.command`, `$.prompt.fill`, `$.session`, `$.agent.list`, `$.clock`.
Non usa: `$.http`, `$.process`, `$.env`, `$.model`, `$.fs.write`, `tool.check`.

## Aggiungere una skill alla mappa delle fasi

La mappa skill → fase (o badge) sta in `src/core/phases.ts` (`DEFAULT_PHASE_MAP`), ad esempio:

```ts
'superpowers:brainstorming': { phase: 1 },
'superpowers:test-driven-development': { badge: 'TDD' },
```

In alternativa, senza toccare il codice, l'opzione `phaseMapPath` (file JSON, path assoluto o relativo alla cartella della sessione) si unisce alla mappa predefinita: le sue voci si aggiungono a quelle predefinite e, a parità di chiave, le sostituiscono. Stesso formato: `{ "plugin:skill": { "phase": 1-6 } | { "badge": "TDD" | "Debug" | "Verifica" } }`.

## Limiti

- Una skill caricata da un subagente col tool Skill aggiunge il suo badge ma non fa avanzare la fase della sessione (`skill.prompt` non dice da quale agente arriva: Overclock la riconosce dalla chiamata Skill del subagente in corso). Una skill precaricata nel subagente dal suo frontmatter non passa dal tool Skill e conta ancora come skill della sessione.

## Test

```
claude plugin validate .
claude plugin test .
npx -y -p typescript@5.6.3 tsc -p .
```

## Verifica manuale

Da fare a mano (terminale largo almeno 144 colonne):

1. **Agenti.** `claude --plugin-dir <path>`, chiedi di lanciare un subagent `Explore`. Atteso: il pannello si apre da solo, il grafo mostra `● Explore` che poi diventa `✓`; la banda mostra `▣ overclock` (o `⎇`) e `Spec: 2026-10-19-overclock-design.md`; lo spinner mostra `· 1 agente`.
2. **Due sessioni sullo stesso repo.** `git worktree add ../overclock-wt -b test/oc`, apri una seconda sessione lì. Atteso: entro 15 secondi la banda diventa verde `⎇` e la tab Sessioni (`4`) mostra due righe sotto `overclock`. Alla fine `git worktree remove ../overclock-wt && git branch -D test/oc`.
3. **`/clear`.** Nella prima sessione lancia `/clear`. Atteso: la tab Pipeline mostra ancora la fase di prima.
4. **Desktop.** Aggiungi `CLAUDE_CODE_PLUGIN_DIRS` al blocco `env` di `~/.claude/settings.json`, apri una sessione nella tab Code. Atteso: la tab Agenti disegna il grafo `Svg`.
