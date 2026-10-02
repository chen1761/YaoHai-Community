$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$process = $null
$health = $null
$stdoutPath = $null
$stderrPath = $null

function Stop-ChildProcess {
  if ($script:process -and -not $script:process.HasExited) {
    Stop-Process -Id $script:process.Id -Force -ErrorAction SilentlyContinue
    try { $script:process.WaitForExit(5000) } catch {}
  }
  if ($script:stdoutPath) { Remove-Item -LiteralPath $script:stdoutPath -Force -ErrorAction SilentlyContinue }
  if ($script:stderrPath) { Remove-Item -LiteralPath $script:stderrPath -Force -ErrorAction SilentlyContinue }
}

try {
  $nodeVersion = (& node --version).Trim()
  if ($nodeVersion -notmatch '^v(\d+)\.') { throw "Unable to parse Node.js version '$nodeVersion'. Install Node.js 24 or newer." }
  $major = [int]$Matches[1]
  if ($major -lt 24) { throw "Node.js 24 or newer is required. Detected $nodeVersion." }
  foreach ($path in @('data', 'data/backups', 'data/uploads')) { New-Item -ItemType Directory -Force (Join-Path $root $path) | Out-Null }

  $lastError = $null
  for ($attempt = 1; $attempt -le 3 -and -not $health; $attempt++) {
    $stdoutPath = Join-Path ([IO.Path]::GetTempPath()) "yaohai-community-$PID-$attempt.out"
    $stderrPath = Join-Path ([IO.Path]::GetTempPath()) "yaohai-community-$PID-$attempt.err"
    $process = Start-Process -FilePath 'node' -ArgumentList @('--input-type=module', '-e', "import { createApp } from './server/app.js'; const server=createApp({ dbPath: './data/community.sqlite' }); server.on('error', error => { console.error(error); process.exitCode=1; }); server.listen(0, '127.0.0.1', function(){ console.log('PORT:' + this.address().port); });") -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Milliseconds 250
      $output = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue } else { '' }
      if ($null -eq $output) { $output = '' }
      $portMatch = [regex]::Match($output, 'PORT:(\d+)')
      if ($portMatch.Success) { $port = [int]$portMatch.Groups[1].Value; $health = "http://127.0.0.1:$port/api/health" }
      if ($process.HasExited) { $details = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue } else { '' }; $lastError = "server exited with code $($process.ExitCode): $details"; break }
      if (-not $health) { continue }
      try { if ((Invoke-RestMethod $health).ok) { $ready = $true; break } } catch { $lastError = $_.Exception.Message }
    }
    if (-not $ready) { Stop-ChildProcess; $health = $null; $stdoutPath = $null; $stderrPath = $null; continue }
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
