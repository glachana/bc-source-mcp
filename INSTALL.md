# Installation -- bc-source-mcp

Serveur MCP qui expose les sources Business Central (toutes versions / localisations) a des agents IA via [Claude Code](https://docs.claude.com/claude-code) et/ou [Claude Desktop](https://claude.ai/download).

## Pre-requis

| Outil | Version | Verification |
|---|---|---|
| **Node.js** | 20 ou + | `node --version` |
| **Git** | >= 2.20 | `git --version` (utilise par le serveur pour cloner les sources BC) |
| **Claude Code** *et/ou* **Claude Desktop** | recent | `claude --version` |

## Installation -- via NPM (recommande)

### Claude Code

``powershell
claude mcp add bc-source-mcp -s user -- npx -y bc-source-mcp
claude mcp list
``

### Claude Desktop

Editez `%APPDATA%\Claude\claude_desktop_config.json` (le creer s'il n'existe pas) et ajoutez :

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

Puis redemarrez Claude Desktop.

## Installation -- depuis GitHub (pour contribuer ou tester)

``powershell
git clone https://github.com/glachana/bc-source-mcp.git
cd bc-source-mcp
.\scripts\setup.ps1 -ClaudeCode -ClaudeDesktop
``

Sans switch, `setup.ps1` affiche un menu interactif pour choisir le(s) client(s).

## Verification

**Claude Code** :

``powershell
claude mcp list
# bc-source-mcp doit apparaitre dans la liste
``

**Claude Desktop** : redemarrez l'application, puis posez une question test :

> *Avec `bc_list_branches`, montre-moi combien de branches BC sont disponibles.*

Claude doit invoquer le tool et repondre ~545 branches.

## Mise a jour

- **Via NPM** : `npx` re-resout la derniere version automatiquement quand son cache expire. Pour forcer : `npm cache clean --force` puis redemarrez Claude.
- **Depuis Git** : `.\scripts\update.ps1` puis redemarrez Claude Code/Desktop.

Pour aussi rafraichir le cache des sources BC, demandez a Claude d'appeler `bc_refresh`.

## Desinstallation

``powershell
# Claude Code
claude mcp remove bc-source-mcp -s user

# Claude Desktop : editer %APPDATA%\Claude\claude_desktop_config.json
#                 et supprimer la cle "bc-source-mcp" sous "mcpServers"

# Si install depuis Git : supprimer le repo local
# Remove-Item -Recurse -Force <chemin-clone>

# Cache de donnees BC (sources telechargees -- 2 a 5 Go)
Remove-Item -Recurse -Force $env:USERPROFILE\.bc-source-mcp
``

## Premier usage -- prompts a essayer

1. *Avec `bc_get_object`, montre-moi la definition de la table `Customer` en BC v26 (branche w1-26).*
2. *Liste tous les `IntegrationEvent` publies par le codeunit `Approvals Mgmt.` en w1-26 avec `bc_get_event_publishers`.*
3. *Cherche `OnAfterPostSalesDoc` dans tous les codeunits de la Base Application en w1-27.*

## Depannage

| Symptome | Cause probable | Solution |
|---|---|---|
| `node : terme non reconnu` | Node pas installe | <https://nodejs.org/> puis nouveau PowerShell |
| `node 18.x detected, requires >= 20` | Node trop vieux | MAJ Node, ou utilisez `nvm-windows` |
| `claude : terme non reconnu` | Claude Code CLI absent | Voir <https://docs.claude.com/claude-code> |
| `bc_list_branches` ne repond rien dans Claude | MCP pas demarre | Verifier `claude mcp list` / redemarrer Desktop |
| Premiere utilisation tres lente (3+ min) | Partial clone du repo upstream (~1,6 Go) | Normal, one-time |
| `Get-ExecutionPolicy` bloque le `.ps1` | Politique d'execution | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
