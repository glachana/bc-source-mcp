<#
.SYNOPSIS
    Installation one-liner de bc-source-mcp-mcp depuis GitHub.

.DESCRIPTION
    Clone (ou met a jour) le repo dans %USERPROFILE%\bc-source-mcp\ puis delegue a
    scripts\setup.ps1 du repo clone pour installer/builder/enregistrer dans les
    clients MCP.

    Compatible avec : irm https://raw.githubusercontent.com/glachana/bc-source-mcp-mcp/main/scripts/install-from-github.ps1 | iex
    (le iex n'expose pas les arguments - voir INSTALL.md pour la forme avancee).

.PARAMETER InstallPath
    Repertoire d'installation. Defaut: %USERPROFILE%\bc-source-mcp

.PARAMETER ClaudeCode
    Enregistre dans Claude Code.

.PARAMETER ClaudeDesktop
    Enregistre dans Claude Desktop.

.PARAMETER CacheDir
    Repertoire pour le cache local du serveur (partial clone + worktrees + SQLite).

.PARAMETER UpstreamRepoUrl
    URL du repo upstream BC sources (override le defaut Stefan Maron).

.PARAMETER LogLevel
    Niveau de log pino (trace|debug|info|warn|error|fatal).

.EXAMPLE
    .\install-from-github.ps1 -ClaudeCode -ClaudeDesktop
#>
[CmdletBinding()]
param(
    [string]$InstallPath,
    [switch]$ClaudeCode,
    [switch]$ClaudeDesktop,
    [string]$CacheDir,
    [string]$UpstreamRepoUrl,
    [ValidateSet('trace','debug','info','warn','error','fatal')]
    [string]$LogLevel
)

$ErrorActionPreference = 'Stop'

function Write-Step($m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok($m)    { Write-Host "    ok $m" -ForegroundColor Green }
function Write-Warn($m)  { Write-Host "    ! $m" -ForegroundColor Yellow }
function Write-ErrMsg($m){ Write-Host "    x $m" -ForegroundColor Red }

$RepoUrl   = 'https://github.com/glachana/bc-source-mcp-mcp.git'
$Branch    = 'main'
$RepoName  = 'bc-source-mcp-mcp'

if (-not $InstallPath) {
    $InstallPath = Join-Path $env:USERPROFILE $RepoName
}

Write-Host ""
Write-Step "bc-source-mcp-mcp - installation depuis GitHub"
Write-Host "    Source      : $RepoUrl ($Branch)"
Write-Host "    Destination : $InstallPath"
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

# --- Clone ou pull ---
if (Test-Path (Join-Path $InstallPath '.git')) {
    Write-Step "Repo deja present, mise a jour (git pull --ff-only)"
    Push-Location $InstallPath
    try {
        & git fetch origin 2>&1 | Out-Null
        & git checkout $Branch 2>&1 | Out-Null
        & git pull --ff-only origin $Branch
        if ($LASTEXITCODE -ne 0) {
            Write-ErrMsg "git pull a echoue. Resolvez les conflits dans $InstallPath."
            exit 1
        }
    } finally { Pop-Location }
    Write-Ok "Repo synchronise"
} else {
    Write-Step "Clone du repo dans $InstallPath"
    $parent = Split-Path -Parent $InstallPath
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    & git clone --branch $Branch $RepoUrl $InstallPath
    if ($LASTEXITCODE -ne 0) {
        Write-ErrMsg "git clone a echoue. Verifiez votre acces au repo (privé) et vos identifiants."
        exit 1
    }
    Write-Ok "Repo clone"
}

# --- Delegation a setup.ps1 ---
$SetupScript = Join-Path $InstallPath 'scripts\setup.ps1'
if (-not (Test-Path $SetupScript)) {
    Write-ErrMsg "Script introuvable apres clone : $SetupScript"
    exit 1
}

Write-Step "Delegation a scripts\setup.ps1"
$setupArgs = @{}
if ($ClaudeCode)      { $setupArgs['ClaudeCode']      = $true }
if ($ClaudeDesktop)   { $setupArgs['ClaudeDesktop']   = $true }
if ($CacheDir)        { $setupArgs['CacheDir']        = $CacheDir }
if ($UpstreamRepoUrl) { $setupArgs['UpstreamRepoUrl'] = $UpstreamRepoUrl }
if ($LogLevel)        { $setupArgs['LogLevel']        = $LogLevel }

& $SetupScript @setupArgs

Write-Host ""
Write-Step "Installation depuis GitHub terminee"
Write-Host "    Repo local : $InstallPath"
Write-Host ""

