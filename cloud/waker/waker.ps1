# Pryme Waker for Windows
# Run it once on a PC at home that stays on (for example the CCTV PC):
#   Right-click this file -> "Run with PowerShell"
# It asks for your Pryme username & password, then starts hidden with Windows.
# When you press "Power On" in Pryme (from anywhere), this PC wakes the server with Wake-on-LAN.
$ErrorActionPreference = 'Stop'
$DefaultUrl = '__PRYME_URL__'
$Dir  = Join-Path $env:APPDATA 'PrymeWaker'
$Cfg  = Join-Path $Dir 'config.json'
$Self = Join-Path $Dir 'waker.ps1'
$Log  = Join-Path $Dir 'waker.log'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Save-Conf($o) { $o | ConvertTo-Json | Set-Content -Path $Cfg -Encoding UTF8 }
function Write-Log($m) { try { Add-Content -Path $Log -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m); if ((Get-Item $Log).Length -gt 1MB) { Remove-Item $Log } } catch {} }

$conf = $null
if (Test-Path $Cfg) { try { $conf = Get-Content $Cfg -Raw | ConvertFrom-Json } catch { $conf = $null } }

# ---------- first run: pair + install ----------
if (-not $conf -or -not $conf.token -or ($args -contains '-pair')) {
  Write-Host ''
  Write-Host '  == Pryme Waker setup ==' -ForegroundColor Cyan
  Write-Host '  This PC will switch your Pryme server on when you press Power On.' -ForegroundColor Gray
  Write-Host ''
  while ($true) {
    $url = Read-Host "  Pryme Cloud URL [$DefaultUrl]"
    if (-not $url) { $url = $DefaultUrl }
    $url = $url.TrimEnd('/')
    $user = Read-Host '  Pryme username'
    $sec  = Read-Host '  Pryme password' -AsSecureString
    $pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    Write-Host '  Connecting... (first time can take ~1 minute while Render wakes up)' -ForegroundColor Gray
    try {
      $body = @{ username = $user; password = $pass; name = $env:COMPUTERNAME } | ConvertTo-Json
      $r = Invoke-RestMethod -Method Post -Uri "$url/waker/pair" -Body $body -ContentType 'application/json' -TimeoutSec 150
      break
    } catch {
      Write-Host ("  X  " + $_.Exception.Message + " - try again.") -ForegroundColor Red
    }
  }
  $conf = [pscustomobject]@{ url = $url; token = $r.token; mac = $r.mac }
  Save-Conf $conf
  if ($PSCommandPath -ne $Self) { Copy-Item -Path $PSCommandPath -Destination $Self -Force }
  $ws  = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'Pryme Waker.lnk'))
  $lnk.TargetPath = 'powershell.exe'
  $lnk.Arguments  = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Self`""
  $lnk.Save()
  try { powercfg /change standby-timeout-ac 0 | Out-Null; powercfg /change hibernate-timeout-ac 0 | Out-Null } catch {}
  Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID -and $_.CommandLine -like '*PrymeWaker*' } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Self`""
  Write-Host ''
  Write-Host '  OK  Paired! Pryme Waker is running and starts with Windows (hidden).' -ForegroundColor Green
  Write-Host '      Keep this PC on and connected to your home network. Sleep is turned off while plugged in.' -ForegroundColor Gray
  Write-Host ''
  Read-Host '  Press Enter to close'
  exit
}

# ---------- Wake-on-LAN ----------
function Send-Wol([string]$mac, $extra) {
  $hex = ($mac -replace '[^0-9A-Fa-f]', '')
  if ($hex.Length -ne 12) { Write-Log 'No server MAC known yet'; return }
  $b = [byte[]](0..5 | ForEach-Object { [Convert]::ToByte($hex.Substring($_ * 2, 2), 16) })
  $p = [byte[]]((,0xFF * 6) + ($b * 16))
  $targets = @('255.255.255.255')
  foreach ($e in @($extra)) { if ($e) { $targets += [string]$e } }
  try {
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object {
      $ip = [Net.IPAddress]::Parse($_.IPAddress).GetAddressBytes(); $pl = [int]$_.PrefixLength; $bc = @()
      for ($i = 0; $i -lt 4; $i++) { $bits = [Math]::Max(0, [Math]::Min(8, $pl - 8 * $i)); $mask = (0xFF -shl (8 - $bits)) -band 0xFF; $bc += ($ip[$i] -bor ((-bnot $mask) -band 0xFF)) }
      $targets += ($bc -join '.')
    }
  } catch {}
  $targets = $targets | Select-Object -Unique
  $u = New-Object Net.Sockets.UdpClient
  $u.EnableBroadcast = $true
  for ($n = 0; $n -lt 6; $n++) {
    foreach ($t in $targets) { foreach ($port in 9, 7) { try { [void]$u.Send($p, $p.Length, $t, $port) } catch {} } }
    Start-Sleep -Milliseconds 500
  }
  $u.Close()
  Write-Log ("Wake signal sent to {0} via {1}" -f $mac, ($targets -join ', '))
}

# ---------- main loop ----------
Write-Log "Pryme Waker started -> $($conf.url)"
while ($true) {
  try {
    $body = @{ name = $env:COMPUTERNAME; mac = $conf.mac } | ConvertTo-Json
    $r = Invoke-RestMethod -Method Post -Uri "$($conf.url)/waker/poll" -Headers @{ 'x-waker-token' = $conf.token } -Body $body -ContentType 'application/json' -TimeoutSec 100
    if ($r.mac -and $r.mac -ne $conf.mac) { $conf.mac = $r.mac; Save-Conf $conf }
    foreach ($c in @($r.cmds)) {
      if ($c -and $c.op -eq 'wake') { $m = $c.mac; if (-not $m) { $m = $conf.mac }; Send-Wol $m @($c.bcast) }
    }
  } catch {
    $code = $null; try { $code = [int]$_.Exception.Response.StatusCode } catch {}
    if ($code -eq 401) { Write-Log 'Not paired any more - run the setup again'; Start-Sleep -Seconds 300 }
    else { Start-Sleep -Seconds 5 }
  }
}
