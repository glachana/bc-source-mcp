<#
.SYNOPSIS
    Met a jour le serveur MCP bc-source-mcp : git pull, npm install, npm run build.

.DESCRIPTION
    A executer depuis le dossier du repo clone. Tire les derniers commits de la
    branche courante, reinstalle les dependances, recompile, puis demande de
    redemarrer le client MCP.

.PARAMETER NoPull
    Saute "git pull" (utile si vous etes deja a jour ou en local-only).

.EXAMPLE
    .\scripts\update.ps1
#>
[CmdletBinding()]
param(
    [switch]$NoPull
)

$ErrorActionPreference = 'Stop'

function Write-Step($m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok($m)    { Write-Host "    ok $m" -ForegroundColor Green }
function Write-Warn($m)  { Write-Host "    ! $m" -ForegroundColor Yellow }
function Write-ErrMsg($m){ Write-Host "    x $m" -ForegroundColor Red }

$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Step "bc-source-mcp - mise a jour"
Write-Host "    Project root : $ProjectRoot"
Write-Host ""

Push-Location $ProjectRoot
try {
    if (-not $NoPull) {
        Write-Step "git pull --ff-only"
        & git pull --ff-only
        if ($LASTEXITCODE -ne 0) {
            Write-ErrMsg "git pull a echoue (code $LASTEXITCODE). Resolvez les conflits puis relancez."
            exit 1
        }
        Write-Ok "Repo a jour"
    }

    Write-Step "npm install"
    & npm install --no-fund --no-audit 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-ErrMsg "npm install a echoue (code $LASTEXITCODE)"
        exit 1
    }
    Write-Ok "Dependances installees"

    Write-Step "npm run build"
    & npm run build 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-ErrMsg "npm run build a echoue (code $LASTEXITCODE)"
        exit 1
    }
    Write-Ok "Build complete"
} finally {
    Pop-Location
}

Write-Host ""
Write-Step "Mise a jour terminee"
Write-Warn "Redemarrez Claude Code / Claude Desktop pour charger la nouvelle version."
Write-Host ""
Write-Host "    Astuce : si vous voulez aussi rafraichir l'index BC en cache," -ForegroundColor DarkGray
Write-Host "             demandez a Claude d'appeler bc_refresh ou bc_cache_status." -ForegroundColor DarkGray
Write-Host ""
