$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$process = $null
$health = $null

function Stop-ChildProcess {
  if ($script:process -and -not $script:process.HasExited) {
    Stop-Process -Id $script:process.Id -Force -ErrorAction SilentlyContinue
    try { $script:process.WaitForExit(5000) } catch {}
  }
}

try {
  $nodeVersion = (& node --version).Trim()
  if ($nodeVersion -notmatch '^v(\d+)\.') { throw "Unable to parse Node.js version '$nodeVersion'. Install Node.js 24 or newer." }
  $major = [int]$Matches[1]
  if ($major -lt 24) { throw "Node.js 24 or newer is required. Detected $nodeVersion." }
  foreach ($path in @('data', 'data/backups', 'data/uploads')) { New-Item -ItemType Directory -Force (Join-Path $root $path) | Out-Null }

  $lastError = $null
  for ($attempt = 1; $attempt -le 3 -and -not $health; $attempt++) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
    $health = "http://127.0.0.1:$port/api/health"
    $process = Start-Process -FilePath 'node' -ArgumentList @('--input-type=module', '-e', "import { createApp } from './server/app.js'; const server=createApp({ dbPath: './data/community.sqlite' }); server.listen($port, '127.0.0.1');") -WorkingDirectory $root -PassThru
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Milliseconds 250
      if ($process.HasExited) { $lastError = "server exited with code $($process.ExitCode)"; break }
      try { if ((Invoke-RestMethod $health).ok) { $ready = $true; break } } catch { $lastError = $_.Exception.Message }
    }
    if (-not $ready) { Stop-ChildProcess; $health = $null; continue }
  }
  if (-not $health) { throw "Community server failed to become healthy after 3 attempts. Last error: $lastError" }
  Start-Process $health
  Write-Host "曜海社区版 is running at $health"
  Write-Host "Data: $root\data | Stop the server with: Stop-Process -Id $($process.Id)"
  Read-Host 'Press Enter to close this launcher (the server process remains available)' | Out-Null
} catch {
  $exitCode = if ($process -and $process.HasExited) { $process.ExitCode } else { 1 }
  Stop-ChildProcess
  Write-Error "$($_.Exception.Message) (server exit code: $exitCode)"
  Read-Host 'Press Enter to close' | Out-Null
  exit $exitCode
} finally {
  if ($health -eq $null) { Stop-ChildProcess }
}
