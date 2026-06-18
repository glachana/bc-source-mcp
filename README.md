# bc-source-mcp

[![npm](https://img.shields.io/npm/v/bc-source-mcp.svg)](https://www.npmjs.com/package/bc-source-mcp)
[![license](https://img.shields.io/npm/l/bc-source-mcp.svg)](LICENSE)

Serveur **MCP** (Model Context Protocol) qui expose les sources de **Microsoft Dynamics 365 Business Central** — toutes versions (BC v23 -> v29), toutes localisations (W1 + 47 pays), avec et sans vNext — a des agents IA comme **Claude Code** et **Claude Desktop**.

> Vous voulez juste l'installer pour l'utiliser ? Voir [INSTALL.md](INSTALL.md).

Donnees pompees du depot communautaire [StefanMaron/MSDyn365BC.Sandbox.Code.History](https://github.com/StefanMaron/MSDyn365BC.Sandbox.Code.History). Le serveur fait un **partial clone** (~1,6 Go au lieu de 50-100 Go) puis indexe les objets AL dans une base SQLite locale, ce qui permet des lookups a <100 ms.

---

## A quoi ca sert

Pour un agent IA qui code en AL, devoir deviner la signature d'une procedure standard, le nom exact d'un event publisher ou la liste des champs d'une table BC est une cause majeure d'hallucinations. Ce MCP donne a l'agent un acces **structure** et **verifie** au code source BC, sans dependre de sa memoire d'entrainement.

Exemples d'usages typiques :

- Trouver les `IntegrationEvent` a souscrire dans `Approvals Mgmt.` en v27
- Recuperer la definition exacte de la table `Customer` en localisation FR vs W1
- Chercher tous les usages d'un motif de code a travers la Base Application
- Comparer la presence d'un objet entre plusieurs versions

## Les 14 tools exposes

| Categorie | Tool | Description |
|---|---|---|
| Decouverte | `bc_list_branches` | Liste les 545 branches du repo upstream |
| Decouverte | `bc_list_versions` | Versions BC (23 -> 29, avec ou sans vNext) |
| Decouverte | `bc_list_localizations` | 47 codes pays + W1 |
| Decouverte | `bc_list_apps` | Apps top-level d'une branche |
| Decouverte | `bc_list_objects` | Objets AL filtres (type / app / pattern) avec pagination |
| Decouverte | `bc_find_object_across_branches` | Presence d'un objet a travers les branches indexees |
| Lookup | `bc_get_object` | Source AL d'un objet (avec `line_start`/`line_end`/`include_source` pour les gros objets) |
| Lookup | `bc_get_event_publishers` | Events publies par un objet (`IntegrationEvent`, `BusinessEvent`, `InternalEvent`) |
| Lookup | `bc_get_procedure` | Procedure ciblee avec signature, body, attributes |
| Recherche | `bc_search_code` | Recherche regex via ripgrep, scope par app/type (avec timeout de 30s) |
| Recherche | `bc_search_fts` | Full-text FTS5 **cross-branch**, syntaxe FTS5 (tokens, phrases, prefix*) avec snippets |
| Admin | `bc_refresh` | Re-fetch + re-index d'une ou toutes les branches |
| Admin | `bc_cache_status` | Disk usage + branches indexees |
| Admin | `bc_prune_cache` | Suppression selective de worktrees |

> Note : apres une mise a jour vers une version qui introduit l'index FTS5, les branches deja
> indexees ne sont **pas** automatiquement re-indexees. Lancez `bc_refresh` sur les branches
> que vous voulez voir apparaitre dans `bc_search_fts`.

## Installation

### Voie 1 — via NPM (recommande)

**Claude Code** :

``powershell
claude mcp add bc-source-mcp -s user -- npx -y bc-source-mcp
``

**Claude Desktop** — editez `%APPDATA%\Claude\claude_desktop_config.json` :

``json
{
  "mcpServers": {
    "bc-source-mcp": {
      "command": "npx",
      "args": ["-y", "bc-source-mcp"]
    }
  }
}
``

Le binaire `bc-source-mcp` est expose par le `bin` de package.json. `npx -y` recupere la derniere version a chaque demarrage (cache npm); pour epingler une version, utilisez `bc-source-mcp@0.1.0`.

### Voie 2 — clone GitHub (pour contribuer)

``powershell
git clone https://github.com/glachana/bc-source-mcp.git
cd bc-source-mcp
npm install
npm run build
.\scripts\setup.ps1 -ClaudeCode -ClaudeDesktop
``

Guide utilisateur complet : [INSTALL.md](INSTALL.md).

## Configuration

Variables d'environnement utilisables (toutes optionnelles) :

| Variable | Defaut | Description |
|---|---|---|
| `BC_SOURCE_CACHE_DIR` | `~/.bc-source-mcp/` | Cache local (partial clone + worktrees + SQLite). ~2-5 Go selon les versions indexees. |
| `BC_SOURCE_REPO_URL` | StefanMaron/MSDyn365BC.Sandbox.Code.History | URL du repo upstream -- override si vous avez un fork |
| `BC_SOURCE_LOG_LEVEL` | `info` | `trace`/`debug`/`info`/`warn`/`error`/`fatal` |

Pour les passer a Claude Code : ajoutez `-e KEY=VALUE` a la commande `claude mcp add`. Pour Claude Desktop : ajoutez une cle `env` a l'entree `mcpServers`.

## Maintenance

Il y a **deux choses distinctes** a garder a jour :

### MAJ du **serveur**

- Installation NPM : `npm install -g bc-source-mcp@latest` (ou retirer le cache npx)
- Installation depuis Git : `.\scripts\update.ps1`

Ensuite redemarrez Claude Code/Desktop.

### MAJ des **donnees BC en cache** (sources upstream)

Independamment du code du serveur, vous voulez parfois rafraichir les sources BC en cache pour recuperer les derniers commits upstream (par ex. quand Microsoft publie un nouveau cumulative update).

Dans votre client MCP, demandez a Claude :

> Avec `bc_refresh`, rafraichis l'index de la branche w1-26.

Ou pour toutes les branches indexees :

> Avec `bc_refresh` sans parametre, rafraichis toutes les branches.

Le tool `bc_cache_status` vous donne a tout moment la taille disque + la liste des branches en cache.

## Developpement

``powershell
npm install
npm run build         # tsc -> dist/
npm test              # vitest
npm run inspector     # MCP Inspector pour tester en interactif
``

Tests : 54 unit tests sur les parsers AL (object header, events, procedures) et le branch resolver.

## Architecture

Le serveur maintient un cache local sous `~/.bc-source-mcp/` :

``
~/.bc-source-mcp/
+-- repo/                Partial clone Git unique (--filter=blob:none, ~1,6 Go)
+-- worktrees/<branch>/  Worktrees Git checkout-es a la demande
+-- index.db             SQLite : branches, apps, objects, event_publishers
``

A la premiere requete sur une branche (ex. `w1-26`) :

1. `git fetch origin <branch>` (blobs telecharges a la demande grace au partial clone)
2. `git worktree add` du checkout complet de la branche
3. Walk recursif de tous les `*.al` -> parsing header + events -> insert SQLite
4. Lookups ulterieurs : tout en RAM/SQLite, <100 ms

Branches du repo upstream : 545 (47 localisations x 7 versions, avec ou sans vNext).
Sur `w1-26` : ~15 000 objets AL et ~22 000 event publishers indexes en ~10 s.

## Stack

- **TypeScript** + **Node.js** 20+
- [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) (transport stdio)
- [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) (index local)
- [`simple-git`](https://github.com/steveukx/git-js) (partial clone + worktrees)
- [`@vscode/ripgrep`](https://github.com/microsoft/vscode-ripgrep) (recherche full-text)
- [`zod`](https://zod.dev/) (schemas) + [`pino`](https://getpino.io/) (logs sur stderr)

## Contribuer

Issues et PR bienvenues sur [https://github.com/glachana/bc-source-mcp](https://github.com/glachana/bc-source-mcp).

Le projet utilise **Conventional Commits** + **release-please** pour le versioning
et la publication npm automatiques. Lire [CONTRIBUTING.md](CONTRIBUTING.md) avant
d'ouvrir une PR.

Roadmap d'ameliorations en cours : [IMPROVEMENTS.md](IMPROVEMENTS.md).

## Licence

[MIT](LICENSE) (c) 2026 Gabriel Lachana.
