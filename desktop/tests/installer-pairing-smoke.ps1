param([Parameter(Mandatory=$true)][string]$Exe)
$ErrorActionPreference = 'Stop'
if ($env:METIS_RELEASE_PAIRING_SMOKE -ne 'v1.7.31' -or -not $env:RUNNER_TEMP) {
  throw 'Pairing is restricted to the opt-in published installer audit.'
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$fixture = $null
$app = $null
$sandbox = Join-Path $env:RUNNER_TEMP ('met77-first-pairing-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $sandbox | Out-Null
$previousProfile = $env:METIS_DESKTOP_TEST_DATA
$env:METIS_DESKTOP_TEST_DATA = Join-Path $sandbox 'fresh-profile'
if (Test-Path $env:METIS_DESKTOP_TEST_DATA) { throw 'Pairing profile already exists.' }

function Wait-FixtureFile([string]$Path, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while (-not (Test-Path $Path)) {
    if ((Get-Date) -gt $deadline) { throw "Timed out waiting for test receipt: $([IO.Path]::GetFileName($Path))" }
    if ($app) { $app.Refresh(); if ($app.HasExited) { throw 'Installed test process exited.' } }
    if ($fixture) { $fixture.Refresh(); if ($fixture.HasExited) { throw 'Loopback fixture exited.' } }
    Start-Sleep -Milliseconds 125
  }
  return (Get-Content $Path -Raw | ConvertFrom-Json)
}

function Find-FixtureWindow([bool]$Hub) {
  if (-not $Hub) {
    $handle = [MetisOwnWindows]::Find([int]$app.Id)
    if ($handle -eq 0) { return $null }
    return [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$handle)
  }
  $props = [Windows.Automation.Condition[]]@(
    [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$app.Id),
    [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, ('Metis ' + [char]0x2014 + ' Remote Client Device Settings'))
  )
  return [Windows.Automation.AutomationElement]::RootElement.FindFirst([Windows.Automation.TreeScope]::Children,
    [Windows.Automation.AndCondition]::new($props))
}

function Wait-Control([string]$Name, [Windows.Automation.ControlType]$Type, [bool]$Hub = $false) {
  $deadline = (Get-Date).AddSeconds(25)
  $props = [Windows.Automation.Condition[]]@(
    [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, $Name),
    [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, $Type)
  )
  $condition = [Windows.Automation.AndCondition]::new($props)
  do {
    $app.Refresh()
    if ($app.HasExited) { throw 'Installed test process exited before ascertaining the control.' }
    try {
      $win = Find-FixtureWindow $Hub
      if ($win) {
        $control = $win.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
        if ($control -and $control.Current.IsEnabled) {
          if ($control.Current.IsOffscreen -and $control.Current.IsKeyboardFocusable) {
            # The pair submit sits below the initial fold on the CI display.
            # Focus it through normal keyboard accessibility to scroll it into view.
            $control.SetFocus()
          }
          if (-not $control.Current.IsOffscreen) { return $control }
        }
      }
    } catch [Windows.Automation.ElementNotAvailableException] {
      # The initial app frame can be replaced when the first workspace is loaded.
    }
    Start-Sleep -Milliseconds 140
  } while ((Get-Date) -lt $deadline)
  [MetisOwnWindows]::Describe([int]$app.Id) | Out-Host
  try {
    $win = Find-FixtureWindow $Hub
    if ($win) {
      $win.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition) |
        Select-Object -First 48 |
        ForEach-Object { '{0}: {1} enabled={2} offscreen={3}' -f $_.Current.ControlType.ProgrammaticName, $_.Current.Name, $_.Current.IsEnabled, $_.Current.IsOffscreen } |
        Out-Host
    }
  } catch [Windows.Automation.ElementNotAvailableException] {}
  throw "Owned installed test control not available: $Name (hub=$Hub)"
}

function Invoke-Control([string]$Name, [bool]$Hub = $false) {
  $element = Wait-Control $Name ([Windows.Automation.ControlType]::Button) $Hub
  $element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
}

function Set-Control([string]$Name, [string]$Value, [bool]$Hub = $false) {
  $element = Wait-Control $Name ([Windows.Automation.ControlType]::Edit) $Hub
  $element.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue($Value)
}

try {
  $serverScript = Join-Path $PSScriptRoot 'installer-pairing-server.cjs'
  $fixture = Start-Process -FilePath (Get-Command node).Source -ArgumentList @(('"' + $serverScript + '"'), ('"' + $sandbox + '"')) -PassThru -NoNewWindow
  $address = Wait-FixtureFile (Join-Path $sandbox 'address.json') 15
  if ($address.origin -notmatch '^http://127\.0\.0\.1:[0-9]+/$') { throw 'Invalid loopback fixture address.' }
  $ready = Join-Path $sandbox 'app.json'
  & node (Join-Path $PSScriptRoot 'spawn-installed.cjs') $Exe (Join-Path $sandbox 'app.stdout.log') (Join-Path $sandbox 'app.stderr.log') $ready '--disable-gpu --disable-software-rasterizer --force-renderer-accessibility'
  if ($LASTEXITCODE -ne 0) { throw 'Published installer app launch failed.' }
  $launch = Wait-FixtureFile $ready 15
  if (-not $launch.mediumParent) { throw 'Expected the standard-user fixture.' }
  $app = Get-Process -Id ([int]$launch.pid)
  $null = $app.Handle
  $originalId = $app.Id
  if (Test-Path (Join-Path $env:METIS_DESKTOP_TEST_DATA 'config.json')) { throw 'Unexpected pre-paired profile.' }

  Invoke-Control 'Start'
  Set-Control 'Server address' $address.origin
  Invoke-Control 'Continue'
  Invoke-Control 'Open isolated device settings'
  Set-Control 'Metis server URL' $address.origin $true
  Set-Control 'Pairing code' 'u_installerFixture' $true
  Invoke-Control 'Connect device' $true

  $proof = Wait-FixtureFile (Join-Path $sandbox 'result.json') 32
  $app.Refresh()
  if ($app.HasExited -or $app.Id -ne $originalId) { throw 'First device response required a new app process.' }
  if ($proof.enrollments -ne 1 -or $proof.authentications -ne 1 -or $proof.firstDeviceCheck -ne $true) {
    throw 'Expected one new pairing, one authenticated device runtime and its initial read-only response.'
  }
  Write-Output 'MET77_PUBLISHED_WINDOWS_FIRST_PAIRING_AND_DEVICE_CHECK_WITHOUT_RESTART_OK'
} catch {
  Get-Content (Join-Path $sandbox 'app.stderr.log') -Tail 30 -ErrorAction SilentlyContinue | Write-Output
  throw
} finally {
  if ($app -and -not $app.HasExited) {
    Stop-Process -InputObject $app -ErrorAction SilentlyContinue
    if (-not $app.WaitForExit(5000)) { throw 'Owned first-pairing process did not exit during fixture cleanup.' }
  }
  if ($fixture -and -not $fixture.HasExited) { Stop-Process -InputObject $fixture -ErrorAction SilentlyContinue }
  $env:METIS_DESKTOP_TEST_DATA = $previousProfile
}
