$ErrorActionPreference = 'Stop'
if (-not $env:RUNNER_TEMP) { throw 'Installer smoke test is restricted to an isolated CI runner.' }
$installer = Get-ChildItem (Join-Path $PSScriptRoot '..\dist') -Filter 'Metis-AI-Setup-*-x64.exe' | Select-Object -First 1
if (-not $installer) { throw 'Installer missing.' }
$installDir = Join-Path $env:RUNNER_TEMP 'Metis AI Installer Test'
Start-Process -FilePath $installer.FullName -ArgumentList "/S /currentuser /D=$installDir" -Wait
$exe = Join-Path $installDir 'Metis AI.exe'
if (-not (Test-Path $exe)) { throw 'Installed executable missing.' }
$entries = @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Metis AI' })
if ($entries.Count -ne 1) { throw 'Windows Installed Apps registration missing or duplicated.' }
if ($entries[0].DisplayVersion -ne '0.1.0') { throw 'Installed version mismatch.' }
$uninstallKey = $entries[0].PSPath
$shortcutPaths = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Metis AI.lnk'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\Metis AI.lnk')
)
$wsh = New-Object -ComObject WScript.Shell
foreach ($shortcut in $shortcutPaths) {
  if (-not (Test-Path $shortcut)) { throw "Shortcut missing: $shortcut" }
  if ($wsh.CreateShortcut($shortcut).TargetPath -ne $exe) { throw "Shortcut target mismatch: $shortcut" }
}
Write-Output 'WINDOWS_INSTALL_REGISTRATION_OK'
$process = Start-Process -FilePath $exe -PassThru
$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Milliseconds 500
  $process.Refresh()
  if ($process.HasExited) { throw 'Installed app exited before opening a window.' }
} until ($process.MainWindowHandle -ne 0 -or (Get-Date) -gt $deadline)
if ($process.MainWindowHandle -eq 0) { throw 'Installed app window did not appear.' }
if ($process.MainWindowTitle -ne 'Metis AI') { throw 'Installed app window title mismatch.' }
Write-Output 'WINDOWS_INSTALLED_APP_LAUNCH_OK'
if (-not $process.CloseMainWindow()) { throw 'Could not close the test app window.' }
if (-not $process.WaitForExit(15000)) { throw 'Test app did not exit normally.' }
$uninstaller = Join-Path $installDir 'Uninstall Metis AI.exe'
Start-Process -FilePath $uninstaller -ArgumentList '/S /currentuser' -Wait
$deadline = (Get-Date).AddSeconds(30)
while (((Test-Path $exe) -or (Test-Path $uninstallKey)) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
if ((Test-Path $exe) -or (Test-Path $uninstallKey)) { throw 'Uninstall did not remove app or Windows registration.' }
foreach ($shortcut in $shortcutPaths) { if (Test-Path $shortcut) { throw "Uninstall left shortcut: $shortcut" } }
Write-Output 'WINDOWS_UNINSTALL_OK'
