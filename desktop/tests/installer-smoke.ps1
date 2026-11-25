$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'own-windows.ps1')
$workspaceTitlePrefix = 'Metis ' + [char]0x2014 + ' '
if (-not [MetisOwnWindows]::IsWorkspaceTitle('Metis') -or -not [MetisOwnWindows]::IsWorkspaceTitle($workspaceTitlePrefix + 'localhost:3000') -or [MetisOwnWindows]::IsWorkspaceTitle($workspaceTitlePrefix + 'Remote Client Device Settings') -or [MetisOwnWindows]::IsWorkspaceTitle('Other app')) { throw 'Workspace title classifier failed.' }
Write-Output 'WINDOWS_WORKSPACE_TITLE_CLASSIFIER_OK'
$expectedVersion = (Get-Content (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json).version
if (-not $env:RUNNER_TEMP) { throw 'Installer smoke test is restricted to an isolated CI runner.' }
$publishedAudit = $env:METIS_RELEASE_PAIRING_SMOKE -eq 'v1.7.31'
if ($publishedAudit) {
  if ($expectedVersion -ne '1.7.31') { throw 'Published audit source version drifted.' }
  $installer = Get-Item (Join-Path $env:RUNNER_TEMP 'metis-v131-release\Metis-AI-Remote-Client-Setup.exe')
  $stream = [IO.File]::OpenRead($installer.FullName)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $digest = [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
  } finally {
    $stream.Dispose()
    $sha256.Dispose()
  }
  if ($digest -ne '6c9be7bd4103b16d2910963acaea836ad964fdeef9e13e930065f23c5d8e1a7f') { throw 'Published installer bytes do not match the approved Release asset.' }
  Write-Output 'MET77_RELEASED_INSTALLER_SHA256_OK'
} else {
  $installer = Get-ChildItem (Join-Path $PSScriptRoot '..\dist') -Filter 'Metis-AI-Remote-Client-Setup.exe' | Select-Object -First 1
}
if (-not $installer) { throw 'Installer missing.' }
$installDir = Join-Path $env:RUNNER_TEMP 'Metis Installer Test'
Start-Process -FilePath $installer.FullName -ArgumentList "/S /currentuser /D=$installDir" -Wait
$exe = Join-Path $installDir 'Metis AI Remote Client.exe'
if (-not (Test-Path $exe)) { throw 'Installed executable missing.' }
$entries = @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Metis' })
if ($entries.Count -ne 1) { throw 'Windows Installed Apps registration missing or duplicated.' }
if ($entries[0].DisplayVersion -ne $expectedVersion) { throw 'Installed version mismatch.' }
$uninstallKey = $entries[0].PSPath
$shortcutPaths = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Metis.lnk'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\Metis.lnk')
)
$wsh = New-Object -ComObject WScript.Shell
foreach ($shortcut in $shortcutPaths) {
  if (-not (Test-Path $shortcut)) { throw "Shortcut missing: $shortcut" }
  if ($wsh.CreateShortcut($shortcut).TargetPath -ne $exe) { throw "Shortcut target mismatch: $shortcut" }
}
Write-Output 'WINDOWS_INSTALL_REGISTRATION_OK'
& node (Join-Path $PSScriptRoot 'verify-split-asar.cjs') (Join-Path $installDir 'resources\\app.asar')
if ($LASTEXITCODE -ne 0) { throw 'Installed background host source verification failed.' }
$env:METIS_DESKTOP_TEST_DATA = Join-Path $env:RUNNER_TEMP 'metis-installer-data'
$stdout = Join-Path $env:RUNNER_TEMP 'metis-installed-startup.stdout.log'
$stderr = Join-Path $env:RUNNER_TEMP 'metis-installed-startup.stderr.log'
# Hosted Windows has no usable accelerated GPU for a restricted test token.
# Match the Electron test suites' CPU rendering; keep all renderer sandboxes.
$renderArguments = '--disable-gpu --disable-software-rasterizer'
$receipt = Join-Path $env:RUNNER_TEMP 'metis-first-launch.json'
& node (Join-Path $PSScriptRoot 'spawn-installed.cjs') $exe $stdout $stderr $receipt $renderArguments
if ($LASTEXITCODE -ne 0) { throw 'Standard installed-app launch failed.' }
$deadline = (Get-Date).AddSeconds(15)
while (!(Test-Path $receipt) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 50 }
$launch = Get-Content $receipt -Raw | ConvertFrom-Json
if (-not $launch.mediumParent) { throw 'Installed-app launcher is not a standard process.' }
$process = Get-Process -Id $launch.pid
$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Milliseconds 500
  $process.Refresh()
  if ($process.HasExited) { throw 'Installed app exited before opening a window.' }
  $windowHandle = [MetisOwnWindows]::Find([int]$process.Id)
} until ($windowHandle -ne 0 -or (Get-Date) -gt $deadline)
if ($windowHandle -eq 0) {
  Get-Content $stderr -Tail 50 -ErrorAction SilentlyContinue | Write-Output
  Get-Content $stdout -Tail 30 -ErrorAction SilentlyContinue | Write-Output
  [MetisOwnWindows]::Describe([int]$process.Id) | Write-Output
  throw 'Installed app has no visible Metis workspace window.'
}
Write-Output 'WINDOWS_INSTALLED_APP_LAUNCH_OK'
if (-not [MetisOwnWindows]::Close([int]$process.Id,$windowHandle)) { throw 'Could not close the owned test app window.' }
Start-Sleep -Milliseconds 500
$process.Refresh()
if ($process.HasExited) { throw 'Closing the main window stopped background operation.' }
$originalPid=$process.Id
$receipt = Join-Path $env:RUNNER_TEMP 'metis-second-launch.json'
& node (Join-Path $PSScriptRoot 'spawn-installed.cjs') $exe (Join-Path $env:RUNNER_TEMP 'metis-second.stdout.log') (Join-Path $env:RUNNER_TEMP 'metis-second.stderr.log') $receipt $renderArguments
if ($LASTEXITCODE -ne 0) { throw 'Standard second launch failed.' }
$deadline = (Get-Date).AddSeconds(15)
while (!(Test-Path $receipt) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 50 }
$second = Get-Process -Id ((Get-Content $receipt -Raw | ConvertFrom-Json).pid)
# Pin a real process handle while this short launcher is still alive. A
# Get-Process object alone can lose ExitCode when the kernel PID is retired.
$null = $second.Handle
$deadline=(Get-Date).AddSeconds(20)
do{
 Start-Sleep -Milliseconds 250
 $process.Refresh()
 $reopenedHandle = [MetisOwnWindows]::Find([int]$process.Id)
}until($reopenedHandle -ne 0 -or (Get-Date) -gt $deadline)
if($reopenedHandle -eq 0 -or $process.HasExited){
 Get-Content $stderr -Tail 40 -ErrorAction SilentlyContinue | Write-Output
 Get-Content (Join-Path $env:RUNNER_TEMP 'metis-second.stderr.log') -Tail 40 -ErrorAction SilentlyContinue | Write-Output
 [MetisOwnWindows]::Describe([int]$process.Id) | Write-Output
 [MetisOwnWindows]::Describe([int]$second.Id) | Write-Output
 throw 'Launching the installed app again did not open a workspace in the existing process.'
}
# Explicit app starts now open a new workspace; the previous last window stays
# hidden. Source integration verifies independent windows and shared sessions.
# Here enforce one visible workspace, a short-lived launcher and the same owner PID.
$workspaceCount = [MetisOwnWindows]::Count([int]$process.Id)
if ($workspaceCount -ne 1) {
  [MetisOwnWindows]::Describe([int]$process.Id) | Write-Output
  throw "Expected exactly one visible workspace after reopening; found $workspaceCount."
}
if(!$second.WaitForExit(15000)){
 Get-Content (Join-Path $env:RUNNER_TEMP 'metis-second.stderr.log') -Tail 50 -ErrorAction SilentlyContinue | Write-Output
 throw 'Second launcher did not exit.'
}
if($second.ExitCode -ne 0){
 Get-Content (Join-Path $env:RUNNER_TEMP 'metis-second.stderr.log') -Tail 50 -ErrorAction SilentlyContinue | Write-Output
 throw ("Second launcher failed: exit='" + $second.ExitCode + "', exited=" + $second.HasExited)
}
if($process.Id -ne $originalPid){throw 'Reopening replaced the background process.'}
Write-Output 'WINDOWS_INSTALLED_CLOSE_AND_SECOND_LAUNCH_REOPEN_OK'
Stop-Process -Id $process.Id
Write-Output 'WINDOWS_BACKGROUND_CLOSE_OK'
if ($publishedAudit) { & (Join-Path $PSScriptRoot 'installer-pairing-smoke.ps1') -Exe $exe }
if ($entries[0].UninstallString -notmatch '^"([^"]+)"') { throw 'Registered uninstall command is invalid.' }
$uninstaller = $Matches[1]
if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($uninstaller)) -ne [IO.Path]::GetFullPath($installDir)) { throw 'Uninstaller is outside the isolated test installation.' }
if (-not (Test-Path $uninstaller)) { throw 'Registered uninstaller missing.' }
Start-Process -FilePath $uninstaller -ArgumentList '/S /currentuser' -Wait
$deadline = (Get-Date).AddSeconds(30)
while (((Test-Path $exe) -or (Test-Path $uninstallKey)) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
if ((Test-Path $exe) -or (Test-Path $uninstallKey)) { throw 'Uninstall did not remove app or Windows registration.' }
foreach ($shortcut in $shortcutPaths) { if (Test-Path $shortcut) { throw "Uninstall left shortcut: $shortcut" } }
Write-Output 'WINDOWS_UNINSTALL_OK'
