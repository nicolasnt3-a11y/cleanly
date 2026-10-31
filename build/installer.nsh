!macro customInstall
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Cleanly" '"$INSTDIR\Cleanly.exe" --startup-clean'
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Cleanly"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Cleanly"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "app.cleanly.desktop"
!macroend
