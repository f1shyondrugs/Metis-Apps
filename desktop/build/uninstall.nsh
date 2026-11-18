!macro customInit
  ${if} ${isUpdated}
  ${andIf} ${Silent}
    ; The Electron process must exit before the Windows files are replaced.
    ; This banner is owned by NSIS and never holds the old app directory open.
    Banner::show /NOUNLOAD /set 76 "Please wait. Metis will reopen automatically." "Updating Metis"
  ${endIf}
!macroend

!macro customInstall
  ${if} ${isUpdated}
  ${andIf} ${Silent}
    Banner::destroy
  ${endIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::ExecToLog 'schtasks.exe /Delete /TN "Metis AI Remote Client" /F'
    RMDir /r "$APPDATA\MetisAI\RemoteClient"
  ${endIf}
!macroend
