; Extra steps for the NSIS installer (bundle.windows.nsis.installerHooks).

; Remove the "start with Windows" entry written by src-tauri/src/autostart.rs
; (value name = ENTRY_NAME there). Skipped when the uninstaller runs as part
; of an update: the new version lives at the same path, so the entry stays valid.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DownloadManager"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "DownloadManager"
  ${EndIf}
!macroend
