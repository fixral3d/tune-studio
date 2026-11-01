# Build + flash the simulator without touching the board:
# simulator CDC (303A:81B3) --1200 baud--> ROM download (USB-Serial/JTAG 303A:1001) --esptool--> app again.
# Usage: pwsh tools/flash.ps1   (from firmware/esp32-sim)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$emu = Join-Path $root '..\..\apps\emu-cli'   # has the serialport package

function PortOf($id) {
  $d = Get-PnpDevice -PresentOnly -Class Ports -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match "VID_303A&PID_$id&MI_00" -and $_.Status -eq 'OK' }
  if ($d -and $d.FriendlyName -match '\((COM\d+)\)') { return $Matches[1] }
}
function WaitPort($id, $sec) {
  for ($i = 0; $i -lt $sec * 2; $i++) { $p = PortOf $id; if ($p) { return $p }; Start-Sleep -Milliseconds 500 }
}

Push-Location $root
try {
  pio run
  if ($LASTEXITCODE) { throw 'build failed' }
  $rom = PortOf '1001'
  if (-not $rom) {
    $sim = PortOf '81B3'
    if (-not $sim) { throw 'simulator not found (VID_303A&PID_81B3) — replug, or hold BOOT + RESET for ROM mode' }
    Write-Host "1200-baud touch on $sim"
    Copy-Item (Join-Path $root 'tools\touch1200.mjs') (Join-Path $emu 'touch.tmp.mjs') -Force
    try { node (Join-Path $emu 'touch.tmp.mjs') $sim 2>$null } catch {} finally { Remove-Item (Join-Path $emu 'touch.tmp.mjs') -ErrorAction SilentlyContinue }
    $rom = WaitPort '1001' 15
    if (-not $rom) { throw 'ROM bootloader port did not appear' }
  }
  Write-Host "flashing via $rom"
  pio run -t upload --upload-port $rom
  if ($LASTEXITCODE) { throw 'upload failed' }
  $sim = WaitPort '81B3' 20
  if ($sim) { Write-Host "simulator back on $sim" } else { Write-Warning 'simulator did not re-enumerate (replug once)' }
} finally { Pop-Location }
