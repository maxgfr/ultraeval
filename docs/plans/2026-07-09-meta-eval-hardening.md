# Plan — Durcissement méta d'ultraeval : honeypots, calibration, rejudge, fix-loop, ledger, sensibilité, budget, scénarios live

> **Lancement dans une nouvelle session** : ouvrir ce fichier et exécuter les phases dans l'ordre. Tout le contexte nécessaire est ici ; des notes complémentaires existent dans la mémoire persistante (`ultraeval-self-eval-process`, `ultraeval-normed-process`).

## Contexte

Repo `/Users/maxime/Downloads/ultraeval` = **ultraeval** (skill Claude Code d'évaluation normée de skills/codebases). Le 2026-07-09, une auto-éval baseline (58/100) a produit 23 findings, tous implémentés (TDD), re-run à **81/100 meets-expectations=true** (runs conservés : `.ultraeval/self-2026-07-09-baseline` et `…-post`, gitignorés ; `COMPARE.md` dans le run post). Mergé dans `main` (8 commits d'avance sur origin au moment de la rédaction ; semantic-release part au push).

Ce plan implémente les **7 améliorations méta** que l'auto-éval ne peut pas trouver sur elle-même (identifiées en pilotant deux runs complets) :
1. **Honeypots + calibration des juges** — rien ne mesure la qualité des sceptiques/juges ; un sceptique complaisant passe le gate sans détection.
2. **`rejudge`** — la stabilité du verdict (variance LLM à SHA constant) n'est pas mesurée ; re-juger les mêmes artefacts coûte ~10 % d'un run.
3. **Fix-loop fermée** — `fix`/`verify-fix` + dérivation de `dependsOn` (aujourd'hui toujours `[]`, `src/backlog.ts`).
4. **Ledger d'historique** — les runs étant gitignorés, la tendance 58→81→… meurt ; committer `evals/history.jsonl`.
5. **Sensibilité des poids** — le verdict n'est jamais testé sous perturbation ±0.05 des poids de rubrique.
6. **Discipline de budget** — le workflow généré ignore le `budget` du harness (~1,2 M tokens/self-run) ; une coupe de couverture doit être ENREGISTRÉE, jamais silencieuse.
7. **Scénarios live normés** — l'executor live n'a pas de bibliothèque de scénarios par catégorie (pendant de `rubric-library.md` pour la phase Execute).

Optionnel en échauffement (**Série 0**) : les 4 défauts P2 laissés par le RUN-2, cartes prêtes dans `.ultraeval/self-2026-07-09-post/fixes/` (message `verify` shardé trompeur ; `clean` ne retire pas `eval.sarif` ; `--rank` stampe `status=confirmed` sans adjudication ; `backlog` sans findings.json → ENOENT brut).

## Architecture du repo (rappel minimal)

- Source TS `src/` (18 modules dont `sarif.ts`) → bundle zéro-dep `scripts/ultraeval.mjs` (tsup), copié **byte-identique** dans `skills/ultraeval/scripts/`. Skill : `skills/ultraeval/SKILL.md` + `references/` (dont `protocol.md`, normatif RFC-2119).
- Tests : vitest (`tests/*.test.ts`, 122 au départ) + probes zéro-dep `evals/run.mjs` (`pnpm run eval`).
- Fichiers clés : `src/types.ts` (SEVERITY_DEFS, PROTOCOL_VERSION="1", RUBRIC_VERSION="1", Provenance, Scorecard{bar, agreement, dimensions[].spread}), `src/verify.ts` (worklist/shards/reduceVerdicts), `src/score.ts` (computeScore), `src/backlog.ts` (buildBacklog/targetsOf), `src/templates.ts` (workflowScript + agentContracts + findingsSchema), `src/compare.ts` (fingerprint/retitled/gateFailures), `src/check.ts`, `src/cli.ts` (parse/VALUE_FLAGS/HELP).

## Invariants non négociables (chaque commit)

- **TDD strict** : RED observé en échec avant toute implémentation (skill superpowers:test-driven-development).
- `pnpm run typecheck && pnpm run lint && pnpm vitest run` verts ; **`pnpm run build`** (rebuild bundle + copie skill) inclus dans le commit ; `node scripts/verify-skill-bundle.mjs` et `pnpm run eval` verts.
- Commits conventionnels (`feat:`/`fix:`/`docs:`/`test:`) — **messages git en quotes SIMPLES** (zsh substitue les backticks dans les doubles).
- Zéro dépendance runtime (devDeps OK, ex. ajv) ; plancher Node 18 ; `tests/fixtures/sample-run/` reste la fixture legacy SANS provenance.
- Changement de sémantique de gate/phase ⇒ **bump `PROTOCOL_VERSION` à "2"** dans le commit concerné (les honeypots et la règle budget en sont) + mise à jour de `references/protocol.md` dans le même commit.

## Phase 0 — Setup

1. `git checkout main && git pull` ; branche `feat/meta-eval-hardening` ; `pnpm install --frozen-lockfile` ; `pnpm test && pnpm run check:build` verts.
2. Lire `skills/ultraeval/references/protocol.md` (le doc normatif à maintenir).

## Phase 1 — Passer les 7 leads par le gate du skill (process-conforme)

Run dédié en mode improve (offline, sans workflow multi-agent) :
```
node skills/ultraeval/scripts/ultraeval.mjs init --target /Users/maxime/Downloads/ultraeval --out /Users/maxime/Downloads/ultraeval/.ultraeval/meta-<date> --kind skill --category "agent skill" --mode improve
```
Rédiger `<RUN>/opportunities.json` : les 7 leads, chacun `{impact, effort, title, statement, recommendation, evidence:[{ref}]}` avec des ancres **aux lignes actuelles** (les vérifier au moment de la rédaction — le gate rejette les lignes périmées) : honeypots → `src/verify.ts` (buildWorklist/reduceVerdicts) ; calibration → `src/templates.ts` (contrat judge) + `src/score.ts` ; rejudge → `src/score.ts`/`src/templates.ts` ; fix-loop → `src/backlog.ts` (dependsOn `[]` dans buildBacklog) ; ledger → `src/score.ts` (scoreRun) ; sensibilité → `src/score.ts` (computeScore) ; budget → `src/templates.ts` (workflowScript) ; scénarios → `src/templates.ts` (contrat executor).
Puis : `brainstorm --run <RUN> --rank --check` (exit 0 exigé) et `backlog --run <RUN> --tdd` → 7+ cartes FIX qui pilotent la Phase 2. Impacts suggérés : high/M (honeypots, fix-loop), high/S (ledger, sensibilité, dependsOn), med/M (rejudge, calibration, budget, scénarios).

## Phase 2 — Implémentation (séries TDD, une carte = un cycle RED→GREEN)

### Série 0 (échauffement, optionnelle) — les 4 P2 du RUN-2
Consommer les cartes de `.ultraeval/self-2026-07-09-post/fixes/`. Commit `fix(polish): …`.

### Série 1 — quick wins S : ledger + sensibilité + dependsOn
- **Ledger** : `score --run <RUN> --history <file>` (défaut si flag sans valeur : `evals/history.jsonl` du cwd) appende `{scoredAt, commit: provenance.targetGit?.commit, overall, meetsExpectations, bar, agreement, counts:{p0,p1,p2,opps}}`. Amorcer le fichier avec les deux runs de 2026-07-09 (58 baseline, 81 post). protocol.md : une self-éval de release SHOULD appender. Tests : append + amorçage + run sans provenance (commit absent → champ omis).
- **Sensibilité des poids** : dans `computeScore`, perturber chaque poids de ±0.05 (renormalisation par le total, comme le scoring), recalculer overall/meets ; `scorecard.sensitivity = { robust: boolean, flips: string[] }` (dimensions dont la perturbation fait basculer le verdict). Surfacer dans `formatScore` + `render`. Tests : cas robuste, cas au bord de la barre (bascule), poids non-sommés-à-1.
- **dependsOn dérivé** : dans `buildBacklog`, deux tâches partageant un fichier de `targets` ⇒ la moins prioritaire (ou la plus tardive à priorité égale) `dependsOn` la première. Tests : chaîne sur fichier partagé, indépendance sinon, pas de cycle.
- Commit `feat(score,backlog): history ledger, weight-sensitivity, derived dependsOn`.

### Série 2 — intégrité du gate : honeypots + calibration (⇒ PROTOCOL_VERSION="2")
- **Honeypots** : `verify --run <RUN> --honeypots N` fabrique N paires pièges (claim plausible mais faux, apparié à un digest réel d'un AUTRE finding — déterministe, seedé sur `provenance.dimensionsHash`, PAS de Math.random) mélangées dans `VERIFY.todo.json` ; la vérité terrain va dans `VERIFY.honeypots.json` (jamais montré aux sceptiques — l'orchestrateur ne le colle pas dans les prompts). `verify --apply` : un honeypot gradé `supported|partial` ⇒ `VerifyResult.honeypots = {planted, caught, failed:[claimIds]}`, exit 1, et `check --require-verify` échoue tant que `failed` non vide (re-vérification avec un sceptique frais exigée). Tests : fabrication déterministe, détection du sceptique complaisant (RED), sceptique honnête passe (GREEN), rétro-compat (pas de fichier honeypots ⇒ comportement inchangé). Probe RED/GREEN dans `evals/run.mjs`.
- **Calibration des juges** : mini-fixture dorée versionnée `skills/ultraeval/references/calibration-run.json` (extraits d'artefacts + scores attendus ±1). Le contrat judge (templates.ts) exige de scorer d'abord la fixture et d'écrire `calibration: {scores, passed}` dans sa ligne judges.jsonl ; `computeScore` : un juge sans calibration ou `passed=false` est compté mais flaggé — `scorecard.judgesCalibrated: n/N`, et si N>0 et n=0 ⇒ meets-expectations forcé false (motif dédié). Tests : juge calibré/non-calibré/mixte.
- Mettre à jour `protocol.md` (sections Gate + Judge), bump `PROTOCOL_VERSION="2"`. Commit `feat(gate)!: honeypot skeptic-checks and judge calibration (protocol v2)` (le `!` est cosmétique : semantic-release reste en minor tant qu'on ne veut pas de 2.0 — décider au moment du commit ; sinon `feat(gate):`).

### Série 3 — `rejudge` (stabilité du verdict)
- `rejudge --run <RUN> --out <RUN2>` : copie eval.config/dimensions/findings/RESULTS/SUMMARY/research/runs vers RUN2, judges.jsonl vide, régénère `agents/judge.md` + un `rejudge.workflow.mjs` minimal (panel 3 lenses + score). Après scoring : `compare --run RUN2 --base RUN` affiche déjà le delta ; ajouter au COMPARE.md une ligne `stability` quand les deux runs partagent `provenance.targetGit.commit` (|Δoverall|, agreements). Tests : scaffolding complet, workflow généré syntaxiquement valide (import dynamique), stabilité affichée à SHA identique.
- Validation réelle : exécuter un rejudge sur `.ultraeval/self-2026-07-09-post` (3 juges, ~10 % du coût d'un run) et noter |Δ|.
- Commit `feat(rejudge): test-retest verdict stability from reused artifacts`.

### Série 4 — scénarios live + budget
- **`references/live-scenarios.md`** : par catégorie (agent skill, CLI, bibliothèque, web app, security/SAST, requirements, research/RAG) : golden path, chemin d'erreur, contrat d'aide/--help, artefact attendu, critères de pass. `templates.ts` : le contrat executor embarque le bloc de SA catégorie (matché comme `defaultDimensions`) ; testplan y renvoie. SKILL.md liste la référence. Tests : contrat executor d'un init CLI contient le scénario CLI ; skill.test vérifie l'existence + lien.
- **Budget** : `workflowScript()` génère un préambule qui, si `typeof budget !== "undefined" && budget.total`, réduit la voilure (juges 3→2 sous X restants, recherche regroupée en 1 agent multi-dimensions sous Y) et écrit CHAQUE coupe dans `<RUN>/runs/budget.md` ; le contrat remediator exige de reporter les coupes dans SUMMARY.md ; `check` warn si `runs/budget.md` existe sans mention dans SUMMARY. protocol.md : « un run budgété DOIT enregistrer sa coupe de couverture ». Tests : workflow généré contient le garde `typeof budget`, check warn/ok.
- Commit `feat(execute): normed live-scenario library and budget-aware generated workflow`.

### Série 5 — fix-loop fermée (le gros morceau)
- **`fix --run <RUN> [--task FIX-XXX]`** : pour chaque tâche visée du BACKLOG.json (respectant `dependsOn`), émettre `<RUN>/fixes/agents/FIX-XXX.agent.md` — contrat autonome pour un fix-agent : carte TDD intégrale + invariants du target (suite de tests, rebuild bundle si détecté, commit conventionnel) + chemins ABSOLUS (même invariant que `plan`) + interdiction d'affaiblir un gate. Option `--workflow` : émettre `fix.workflow.mjs` (pipeline séquentiel sur les cartes, `isolation:'worktree'` par tâche en option).
- **`verify-fix --run <RUN> --task FIX-XXX`** : rejoue `verify.command` de la tâche (spawn, timeboxé), vérifie que le fichier de test RED existe, marque `status:"done"` + `verifiedAt` dans BACKLOG.json ; exit 1 sinon. `check` : une tâche `done` dont le finding est encore `open` ⇒ warn.
- Types : `FixTask.status?: "todo"|"done"`, `verifiedAt?`. HELP + README + DOCUMENTATION + tdd-remediation.md à jour. Tests : émission des contrats (contenu : chemins absolus, RED/GREEN/VERIFY), ordre topologique dependsOn, verify-fix passe/échoue, rétro-compat BACKLOG sans status.
- Commit `feat(fix): close the red-green loop — dispatchable fix-agent contracts and verify-fix`.

## Phase 3 — Preuve par soi-même (RUN-3)

1. Sweep : `pnpm run typecheck && pnpm run lint && pnpm test && pnpm run check:build && pnpm run eval`.
2. **RUN-3 complet** : même procédure que les runs précédents — init deep/skill/"agent skill" vers `.ultraeval/self-<date>-v2` (chemins ABSOLUS), `plan`, épingler dans `agents/executor.md` le SELF-EVAL PIN (piloter le moteur UNIQUEMENT contre `tests/fixtures/target-lib/` + COPIE de `sample-run/` ; jamais lancer l'`eval.workflow.mjs` intérieur ; pas de subagents depuis l'executor), lancer `Workflow({scriptPath})`, gates `check` → `verify --honeypots 3` (les nouveaux pièges s'exercent en conditions réelles) → `check --semantic --require-verify` exit 0.
3. `compare --run RUN-3 --base .ultraeval/self-2026-07-09-post --gate` (exit 0 exigé — pas de régression) ; `score --history` appende RUN-3 au ledger ; un `rejudge` de RUN-3 mesure la stabilité du nouveau verdict.
4. Fin de branche : superpowers:finishing-a-development-branch (merge/PR au choix de l'utilisateur).

## Vérification globale

- 7 leads gatés (`brainstorm --rank --check` exit 0) puis chaque carte fermée en TDD.
- Suite complète + probes + bundle reproductible verts à chaque commit ; PROTOCOL_VERSION="2" et protocol.md cohérents.
- Preuves nouvelles générations : `evals/history.jsonl` committé avec ≥3 entrées (58, 81, RUN-3) ; scorecard RUN-3 porte `sensitivity` et `judgesCalibrated` ; `VERIFY.todo.json` de RUN-3 contient des honeypots tous attrapés ; COMPARE.md RUN-3 sans régression ; un contrat `fixes/agents/FIX-001.agent.md` émis et un `verify-fix` exécuté avec succès sur une carte réelle.
