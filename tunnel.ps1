# ============================================================================
# tunnel.ps1 — Sobe o Barber Code + abre um link público (HTTPS) temporário.
# ----------------------------------------------------------------------------
# COMO USAR (Windows, PowerShell):
#   .\tunnel.ps1
#
# O QUE ELE FAZ:
#   1. Instala o cloudflared via winget, se ainda não existir.
#   2. Sobe o servidor Node (se a porta 3000 não estiver respondendo).
#   3. Abre um túnel Cloudflare (grátis, SEM senha) e mostra a URL pública
#      https://<aleatorio>.trycloudflare.com — funciona em qualquer aparelho.
#
# LIMITAÇÕES (é um teste, não produção):
#   • O link muda a cada execução.
#   • Só funciona enquanto este PC estiver ligado com este script rodando.
#   • Para link fixo com o nome: deploy gratuito no Render (ver README,
#     arquivo render.yaml) → https://barbercode-2tyg.onrender.com
# ============================================================================
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $raiz

# 1) Garante o cloudflared
$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
  $padrao = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
  if (Test-Path -LiteralPath $padrao) {
    $cfExe = $padrao
  } else {
    Write-Host '>> Instalando cloudflared via winget...' -ForegroundColor Yellow
    winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements
    $cfExe = $padrao
  }
} else {
  $cfExe = $cf.Source
}

# 2) Garante o servidor rodando na porta 3000
$vivo = $false
try {
  $h = Invoke-RestMethod 'http://localhost:3000/api/health' -TimeoutSec 3
  if ($h.ok) { $vivo = $true }
} catch {}

if (-not $vivo) {
  Write-Host '>> Subindo o servidor (npm start)...' -ForegroundColor Yellow
  Start-Process -FilePath 'node' -ArgumentList 'src/server.js' -WorkingDirectory $raiz -WindowStyle Hidden
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    try { if ((Invoke-RestMethod 'http://localhost:3000/api/health' -TimeoutSec 2).ok) { $vivo = $true; break } } catch {}
  }
}
if (-not $vivo) { throw 'O servidor não respondeu em http://localhost:3000. Rode "npm install" e tente de novo.' }

# 3) Abre o túnel e mostra a URL
Write-Host '>> Abrindo túnel público...' -ForegroundColor Yellow
$log = Join-Path $env:TEMP 'barbercode-tunnel.log'
Remove-Item -Force -ErrorAction SilentlyContinue $log
$proc = Start-Process -FilePath $cfExe -ArgumentList 'tunnel', '--no-autoupdate', '--url', 'http://localhost:3000' -WindowStyle Hidden -PassThru -RedirectStandardError $log

$url = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  $txt = Get-Content -LiteralPath $log -Raw -ErrorAction SilentlyContinue
  if ($txt -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $url = $matches[0]; break }
}

if (-not $url) { throw "Não foi possível obter a URL pública. Veja o log: $log" }

Write-Host ''
Write-Host '=====================================================' -ForegroundColor Green
Write-Host "  SITE:   $url" -ForegroundColor Green
Write-Host "  PAINEL: $url/admin" -ForegroundColor Green
Write-Host '=====================================================' -ForegroundColor Green
Write-Host 'Deixe esta janela ABERTA. Ctrl+C encerra o link.' -ForegroundColor DarkGray

# Mantém o processo em primeiro plano até o usuário encerrar.
Wait-Process -Id $proc.Id
