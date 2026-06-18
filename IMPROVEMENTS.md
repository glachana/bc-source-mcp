# Roadmap d'améliorations — bc-source-mcp

Liste de travail tirée de l'audit du serveur MCP. Cochez en passant à `[x]` quand
livré, et complétez le numéro de version qui a apporté la correction.

Légende :
- 🔴 Critique / bug
- 🟠 Couverture API / nouveaux tools
- 🟡 Performance / scalabilité
- 🟢 UX & qualité MCP
- 🔵 Robustesse & sécurité
- ⚪ Configuration & déploiement

---

## 🔴 Critique / Bugs

- [x] **#1** — Bug `ensureBranchIndexed` / `indexBranch` : message trompeur, bloc redondant supprimé.
- [ ] **#2** — `bc_search_code` : ajouter `offset` ou curseur `next_cursor` pour aller au-delà des 500 résultats max.
- [x] **#3** — `bc_get_object` : ajouter `line_start`/`line_end`/`include_source` pour éviter de bourrer le contexte LLM sur les gros objets (`Sales-Post.Codeunit.al` ~ 100k lignes).
- [x] **#4** — `bc_search_code` : timeout sur ripgrep (30s par défaut) pour éviter qu'un pattern catastrophique bloque le serveur.
- [ ] **#5** — `bc_get_procedure` : ne gère pas les surcharges (même nom, signatures différentes). Ajouter `signature_hint` ou retourner toutes les surcharges.

## 🟠 Couverture API / nouveaux tools

- [ ] **#6** — Tool `bc_get_table_fields` : accès direct aux champs d'une table (numéro, nom, type, propriétés) sans parser tout le source. Implique nouvelle table SQLite `fields(branch, object_type, object_name, id, name, datatype, properties_json)`.
- [ ] **#7** — Tool `bc_get_event_subscribers` : symétrique à `bc_get_event_publishers`. Lister tous les `[EventSubscriber(...)]` d'un objet ou tous les souscripteurs d'un event donné.
- [ ] **#8** — Tool `bc_diff_objects` : comparer la signature/définition d'un même objet entre deux branches (Customer w1-26 vs w1-27, w1-27 vs fr-27).
- [ ] **#9** — Tool `bc_find_object_by_id` : trouver un objet par son ID (ex. `table 18`) au lieu du couple `(type, name)`.
- [ ] **#10** — Tools `bc_get_page_actions` / `bc_get_page_fields` : structure d'une page (groupes, actions, layout) sans le source complet.
- [ ] **#11** — Tool `bc_get_object_dependencies` : retourner les objets référencés par un objet donné (tables utilisées, codeunits appelés, events souscrits). Permettre l'exploration de l'arbre d'appel.
- [ ] **#12** — Tool `bc_list_extensions_of` : "Quels TableExtension étendent `Customer` ?". Exposer la colonne `ext_target` déjà indexée.

## 🟡 Performance / scalabilité

- [x] **#13** — Index FTS5 cross-branch : table virtuelle `objects_fts` (unicode61 remove_diacritics), peuplée à l'indexation, vidée par `bc_refresh`. Nouveau tool `bc_search_fts`.
- [ ] **#14** — Cache LRU des sources lues : éviter les `readFileSync` répétés sur les objets populaires (50 fichiers, 50 MB max).
- [ ] **#15** — Indexation parallèle / streaming : `worker_threads` pour paralléliser le parsing AL. Cible < 3s par branche (vs ~10s actuels).
- [ ] **#16** — Migration `readFileSync` → `fs/promises` : tous les I/O actuellement synchrones bloquent le thread Node.
- [ ] **#17** — Auto-refresh périodique : option `BC_SOURCE_AUTO_REFRESH_HOURS=24` qui déclenche un refresh asynchrone des branches récemment utilisées en tâche de fond.

## 🟢 UX & qualité du protocole MCP

- [ ] **#18** — Exposer des **Resources** MCP : `bc://w1-26/codeunit/Approvals Mgmt.` adressables, clients peuvent attacher/citer sans appeler un tool.
- [ ] **#19** — Exposer des **Prompts** MCP guidés : ex. "Trouve les events à souscrire pour étendre la validation des Customer en v27".
- [ ] **#20** — Descriptions de tools enrichies d'exemples concrets d'inputs (best-practice MCP).
- [ ] **#21** — Messages d'erreur actionnables avec suggestions fuzzy (Levenshtein) : "Sales Header" introuvable → suggestions "Sales Header Archive", "Sales-Post Header".
- [ ] **#22** — `outputSchema` plus strict avec `z.enum([...])` sur les champs énumérés au lieu de `z.string()`.
- [ ] **#23** — Cohérence snake_case : harmoniser `source_type`/`source_name` vs `object_type`/`object_name` sur un vocabulaire unique.

## 🔵 Robustesse & sécurité

- [x] **#24** — Path traversal protection : `safeJoinUnderWorktree` dans `bc_get_object` et `bc_get_procedure`, refuse les chemins indexés qui s'échappent du worktree.
- [x] **#25** — Validation Zod stricte : `min(1).max(...)` sur `branch`, `pattern`, `name`, `query`, etc. Refuser des inputs de 10 MB.
- [x] **#26** — `busy_timeout = 5000` sur SQLite pour gérer les locks concurrents pendant `bc_refresh`.
- [ ] **#27** — `bc_prune_cache` : mode "deep clean" qui détecte les worktrees orphelines (présentes sur disque mais absentes de l'index).
- [ ] **#28** — Logger les durées d'exécution des tools : wrapper `withTiming(toolName, fn)` pour exposer des métriques via un futur `bc_metrics`.

## ⚪ Configuration & déploiement

- [ ] **#29** — Variable `BC_SOURCE_MAX_BRANCHES` (garde-fou contre indexation accidentelle des 545 branches, ~50 Go disque).
- [ ] **#30** — Tool `bc_health` : check SQLite ouvrable, repo Git accessible, ripgrep trouvé, espace disque suffisant.
- [ ] **#31** — Transport Streamable HTTP : mode `bc-source-mcp serve --http --port 3000` pour permettre à plusieurs utilisateurs de partager un même cache (utile en équipe).
- [ ] **#32** — Tests d'intégration tools MCP : aujourd'hui les 54 tests couvrent uniquement les parsers AL. Ajouter des tests bout-en-bout via MCP Inspector ou un client de test mocké.
- [x] **#33** — CI/CD GitHub Actions : build + test sur Node 20/22, publication npm automatique sur release, versioning automatique via release-please.
- [ ] **#34** — Documenter dans le README les colonnes internes utiles (`ext_target`, schéma SQLite), pour qu'un agent puisse exploiter ce qu'il y a déjà.

---

## Top 5 priorités restantes

| # | Travail | Effort | Impact |
|---|---|---|---|
| **#6** | Tool `bc_get_table_fields` | ~1 j | 🟠 Très haute valeur agent AL |
| **#18** | Exposer Resources MCP | ~1 j | 🟢 Standard MCP moderne, intégration native |
| **#8** | Tool `bc_diff_objects` | ~2 j | 🟠 Cas d'usage upgrades / localisations |
| **#15** | Indexation parallèle workers | ~1 j | 🟡 10s → 3s par branche |
| **#21** | Fuzzy suggestions sur erreurs | ~½ j | 🟢 DX énorme pour l'agent |
