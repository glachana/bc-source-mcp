<#
.SYNOPSIS
    Installe le serveur MCP bc-source-mcp localement et l'enregistre dans
    Claude Code et/ou Claude Desktop.

.DESCRIPTION
    A executer depuis le dossier du repo clone. Verifie les pre-requis (Node 20+, Git),
    installe les dependances npm, compile le projet (npm run build), puis enregistre
    le serveur dans le ou les clients MCP de votre choix.

.PARAMETER ClaudeCode
    Enregistre dans Claude Code (claude mcp add ... -s user).

.PARAMETER ClaudeDesktop
    Enregistre dans Claude Desktop (edition de claude_desktop_config.json).

.PARAMETER CacheDir
    Repertoire pour le cache local (partial clone du repo upstream, worktrees, SQLite).
    Defaut: %USERPROFILE%\.bc-source-mcp\

.PARAMETER UpstreamRepoUrl
    URL du repo upstream BC sources. Defaut: github.com/StefanMaron/MSDyn365BC.Sandbox.Code.History

.PARAMETER LogLevel
    Niveau de log pino (trace|debug|info|warn|error|fatal). Defaut: info

.PARAMETER SkipInstall
    Saute "npm install" (utile en re-execution rapide).

.PARAMETER SkipBuild
    Saute "npm run build" (utile en re-execution rapide).

.EXAMPLE
    .\scripts\setup.ps1
    Menu interactif pour choisir les clients MCP.

.EXAMPLE
    .\scripts\setup.ps1 -ClaudeCode -ClaudeDesktop -CacheDir D:\bc-cache
#>
[CmdletBinding()]
param(
    [switch]$ClaudeCode,
    [switch]$ClaudeDesktop,
    [string]$CacheDir,
    [string]$UpstreamRepoUrl,
    [ValidateSet('trace','debug','info','warn','error','fatal')]
    [string]$LogLevel,
    [switch]$SkipInstall,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

function Write-Step($m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok($m)    { Write-Host "    ok $m" -ForegroundColor Green }
function Write-Warn($m)  { Write-Host "    ! $m" -ForegroundColor Yellow }
function Write-ErrMsg($m){ Write-Host "    x $m" -ForegroundColor Red }

# --- Racine du projet (portable) ---
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ServerName  = 'bc-source-mcp'
$EntryPoint  = Join-Path $ProjectRoot 'dist\index.js'

Write-Host ""
Write-Step "bc-source-mcp - installation locale"
Write-Host "    Project root : $ProjectRoot"
Write-Host ""

# --- Pre-requis ---
Write-Step "Verification des pre-requis"

try {
    $nodeVersion = (& node --version) 2>$null
    if (-not $nodeVersion) { throw "node not found" }
} catch {
    Write-ErrMsg "Node introuvable. Installez Node.js 20+ depuis https://nodejs.org/"
    exit 1
}
$nodeMajor = 0
if ($nodeVersion -match '^v(\d+)\.') { $nodeMajor = [int]$Matches[1] }
if ($nodeMajor -lt 20) {
    Write-ErrMsg "Node $nodeVersion detecte, requiert >= 20"
    exit 1
}
Write-Ok "Node $nodeVersion"

try {
    & git --version | Out-Null
} catch {
    Write-ErrMsg "Git introuvable. Installez Git depuis https://git-scm.com/"
    exit 1
}
Write-Ok "Git OK"

# --- npm install ---
if (-not $SkipInstall) {
    Write-Step "Installation des dependances (npm install)"
    Push-Location $ProjectRoot
    try {
        & npm install --no-fund --no-audit 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "npm install a echoue (code $LASTEXITCODE)" }
    } finally { Pop-Location }
    Write-Ok "Dependances installees"
}

# --- npm run build ---
if (-not $SkipBuild) {
    Write-Step "Compilation (npm run build)"
    Push-Location $ProjectRoot
    try {
        & npm run build 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "npm run build a echoue (code $LASTEXITCODE)" }
    } finally { Pop-Location }
    Write-Ok "Build complete"
}

if (-not (Test-Path $EntryPoint)) {
    Write-ErrMsg "Point d'entree introuvable apres build : $EntryPoint"
    Write-ErrMsg "Relancez avec -SkipInstall:`$false -SkipBuild:`$false"
    exit 1
}

# --- Menu interactif si aucun client choisi ---
if (-not $ClaudeCode -and -not $ClaudeDesktop) {
    Write-Host ""
    Write-Step "Quel client MCP voulez-vous configurer ?"
    Write-Host "    [1] Claude Code (CLI)"
    Write-Host "    [2] Claude Desktop (app)"
    Write-Host "    [3] Les deux"
    Write-Host "    [4] Aucun (skip enregistrement)"
    $choice = Read-Host "    Choix [1-4]"
    switch ($choice) {
        '1' { $ClaudeCode = $true }
        '2' { $ClaudeDesktop = $true }
        '3' { $ClaudeCode = $true; $ClaudeDesktop = $true }
        '4' { Write-Warn "Aucun client configure - vous pouvez relancer plus tard." }
        default {
            Write-Warn "Choix invalide, defaut = les deux"
            $ClaudeCode = $true; $ClaudeDesktop = $true
        }
    }
    Write-Host ""
}

# --- Construction des arguments / env vars ---
$EntryPointFwd = $EntryPoint -replace '\\','/'
$EnvVars = [ordered]@{}
if ($CacheDir) {
    $EnvVars['BC_SOURCE_CACHE_DIR'] = ($CacheDir -replace '\\','/')
}
if ($UpstreamRepoUrl) {
    $EnvVars['BC_SOURCE_REPO_URL'] = $UpstreamRepoUrl
}
if ($LogLevel) {
    $EnvVars['BC_SOURCE_LOG_LEVEL'] = $LogLevel
}

# --- Claude Code ---
if ($ClaudeCode) {
    Write-Step "Enregistrement dans Claude Code"
    $claudeCmd = Get-Command claude -ErrorAction SilentlyContinue
    if (-not $claudeCmd) {
        Write-ErrMsg "CLI 'claude' introuvable. Installez Claude Code : https://docs.claude.com/claude-code"
    } else {
        # Suppression silencieuse de l'entree existante (peut ne pas exister)
        try { & claude mcp remove $ServerName -s user 2>$null | Out-Null } catch { }

        $argsList = @('mcp', 'add', $ServerName, '-s', 'user')
        foreach ($k in $EnvVars.Keys) {
            $argsList += '-e'
            $argsList += "$k=$($EnvVars[$k])"
        }
        $argsList += '--'
        $argsList += 'node'
        $argsList += $EntryPointFwd

        & claude @argsList | Out-Host
        if ($LASTEXITCODE -ne 0) {
            Write-ErrMsg "Erreur lors de l'ajout dans Claude Code (code $LASTEXITCODE)"
        } else {
            Write-Ok "Enregistre dans Claude Code (scope user)"
            Write-Host "    Verifiez avec : claude mcp list"
        }
    }
}

# --- Claude Desktop ---
if ($ClaudeDesktop) {
    Write-Step "Mise a jour de Claude Desktop config"
    $cfgPath = Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'
    $cfgDir  = Split-Path -Parent $cfgPath
    if (-not (Test-Path $cfgDir)) {
        New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null
    }

    # On garde le PSCustomObject natif (preserve strings dans les arrays)
    # et on modifie en place via Add-Member.
    $cfg = $null
    if (Test-Path $cfgPath) {
        try {
            $raw = Get-Content -Path $cfgPath -Raw -Encoding UTF8
            if ($raw -and $raw.Trim().Length -gt 0) {
                $cfg = $raw | ConvertFrom-Json
            }
        } catch {
            Write-Warn "Fichier existant non parseable, sauvegarde en .bak"
            Copy-Item -Path $cfgPath -Destination "$cfgPath.bak" -Force
            $cfg = $null
        }
    }
    if (-not $cfg) { $cfg = [PSCustomObject]@{} }

    if (-not $cfg.PSObject.Properties['mcpServers'] -or $null -eq $cfg.mcpServers) {
        $cfg | Add-Member -NotePropertyName 'mcpServers' -NotePropertyValue ([PSCustomObject]@{}) -Force
    }

    $entry = [PSCustomObject]@{
        command = 'node'
        args    = @($EntryPointFwd)
    }
    if ($EnvVars.Count -gt 0) {
        $envEntry = [PSCustomObject]@{}
        foreach ($k in $EnvVars.Keys) {
            $envEntry | Add-Member -NotePropertyName $k -NotePropertyValue $EnvVars[$k] -Force
        }
        $entry | Add-Member -NotePropertyName 'env' -NotePropertyValue $envEntry -Force
    }

    $cfg.mcpServers | Add-Member -NotePropertyName $ServerName -NotePropertyValue $entry -Force

    $json = $cfg | ConvertTo-Json -Depth 32
    Set-Content -Path $cfgPath -Value $json -Encoding UTF8
    Write-Ok "Config Claude Desktop mise a jour : $cfgPath"
    Write-Warn "Redemarrez Claude Desktop pour prendre en compte le changement."
}

Write-Host ""
Write-Step "Installation terminee"
Write-Host "    Serveur     : $ServerName"
Write-Host "    Entry point : $EntryPointFwd"
if ($EnvVars.Count -gt 0) {
    Write-Host "    Env         :"
    foreach ($k in $EnvVars.Keys) { Write-Host "      $k = $($EnvVars[$k])" }
}
Write-Host ""
Write-Host "    Test : ouvrez Claude Code/Desktop et demandez par ex." -ForegroundColor DarkGray
Write-Host '          "Liste les branches BC disponibles avec bc_list_branches"' -ForegroundColor DarkGray
Write-Host ""
