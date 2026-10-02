$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

try {
  $nodeVersion = (& node --version).Trim()
  if ($nodeVersion -notmatch '^v(2[4-9]|[3-9][0-9])\.') { throw "Node.js 24 or newer is required. Detected $nodeVersion. Install Node 24 LTS and retry." }
  foreach ($path in @('data', 'data/backups', 'data/uploads')) { New-Item -ItemType Directory -Force (Join-Path $root $path) | Out-Null }
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
  $env:PORT = $port
  $process = Start-Process -FilePath 'node' -ArgumentList @('--input-type=module', '-e', "import { createApp } from './server/app.js'; const server=createApp({ dbPath: './data/community.sqlite' }); server.listen(process.env.PORT, '127.0.0.1');") -WorkingDirectory $root -PassThru
  $health = "http://127.0.0.1:$port/api/health"
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Milliseconds 250; try { if ((Invoke-RestMethod $health).ok) { $ready = $true; break } } catch {} }
  if (-not $ready) { throw "Community server did not become healthy at $health. Check the Node process and data directory." }
  Start-Process $health
  Write-Host "曜海社区版 is running at http://localhost:$port"
  Write-Host "Data: $root\data | Stop the server with: Stop-Process -Id $($process.Id)"
  Read-Host 'Press Enter to close this launcher (the server process remains available)' | Out-Null
} catch {
  Write-Error $_.Exception.Message
  Read-Host 'Press Enter to close' | Out-Null
  exit 1
}
