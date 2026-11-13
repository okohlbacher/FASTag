; FASTag NSIS installer hooks (bundle.windows.nsis.installerHooks).
;
; The installer offers both scopes (installMode "both"): per user (HKCU,
; %LOCALAPPDATA%\Programs\FASTag, or the folder of an existing per-user
; install) and all users (HKLM, C:\Program Files\FASTag). FASTag 1.13.x
; installed per user only. The template's own reinstall logic reads the
; install key of the chosen scope only (SHCTX), so an upgrade into the other
; scope would leave a second 1.5 GB copy, a second Apps entry and a second
; Start-menu shortcut behind.
;
; NSIS_HOOK_PREINSTALL therefore looks up an install of the same product
; (same identifier de.openms.fastag, same UNINSTKEY) in the OTHER scope and
; runs its uninstaller silently, in place (_?=), before any file is copied:
;   - all-users install chosen: removes the per-user install of this user
;     (HKCU; under UAC elevation that is the elevated account's HKCU, which
;     is the installing user unless a different administrator signs in);
;   - per-user install chosen: removes the all-users install if this user is
;     an administrator; a standard user cannot, and is told so.
; Settings and history are not touched (the uninstaller deletes app data
; only when "Delete app data" is ticked, which a silent uninstall never is).

Var FastagOtherUninst
Var FastagOtherDir
Var FastagOtherArgs
Var FastagOtherCode
Var FastagTries

!macro NSIS_HOOK_PREINSTALL
  StrCpy $FastagOtherUninst ""
  StrCpy $FastagOtherDir ""
  StrCpy $FastagOtherArgs ""
  ${If} $MultiUser.InstallMode == "AllUsers"
    ReadRegStr $FastagOtherUninst HKCU "${UNINSTKEY}" "UninstallString"
    ReadRegStr $FastagOtherDir HKCU "${MANUPRODUCTKEY}" ""
  ${Else}
    ReadRegStr $FastagOtherUninst HKLM "${UNINSTKEY}" "UninstallString"
    ReadRegStr $FastagOtherDir HKLM "${MANUPRODUCTKEY}" ""
    StrCpy $FastagOtherArgs "/AllUsers"
  ${EndIf}

  ${If} $FastagOtherUninst != ""
  ${AndIf} $FastagOtherDir != ""
  ${AndIf} $FastagOtherDir != $INSTDIR
    ${If} $MultiUser.InstallMode != "AllUsers"
    ${AndIf} $MultiUser.Privileges != "Admin"
    ${AndIf} $MultiUser.Privileges != "Power"
      DetailPrint "FASTag is also installed for all users in $FastagOtherDir; removing it needs an administrator."
      MessageBox MB_OK|MB_ICONEXCLAMATION "${PRODUCTNAME} is also installed for all users of this computer, in $FastagOtherDir. Removing that copy needs an administrator: ask one to uninstall it in Settings > Apps, or start this installer as an administrator." /SD IDOK
    ${Else}
      DetailPrint "Removing the ${PRODUCTNAME} installed in the other scope: $FastagOtherDir"
      ClearErrors
      ; _?= runs the uninstaller in place, so ExecWait waits for it; it must
      ; be the last argument and stay unquoted.
      ExecWait '$FastagOtherUninst /S $FastagOtherArgs _?=$FastagOtherDir' $FastagOtherCode
      ${IfThen} ${Errors} ${|} StrCpy $FastagOtherCode "not started" ${|}
      ${If} ${FileExists} "$FastagOtherDir\${MAINBINARYNAME}.exe"
        DetailPrint "The old ${PRODUCTNAME} in $FastagOtherDir was not removed (uninstaller: $FastagOtherCode)."
        MessageBox MB_OK|MB_ICONEXCLAMATION "The ${PRODUCTNAME} installed earlier in $FastagOtherDir could not be removed (uninstaller: $FastagOtherCode). Uninstall it in Settings > Apps after this installation." /SD IDOK
      ${Else}
        ; Run in place, the uninstaller cannot delete itself or its folder.
        ; Its process can hold the file for a moment after ExecWait returns
        ; (seen under x64 emulation on Windows on ARM64), so retry for 10 s.
        StrCpy $FastagTries 0
        fastag_del_uninst:
          Delete "$FastagOtherDir\uninstall.exe"
          ${If} ${FileExists} "$FastagOtherDir\uninstall.exe"
          ${AndIf} $FastagTries < 20
            IntOp $FastagTries $FastagTries + 1
            Sleep 500
            Goto fastag_del_uninst
          ${EndIf}
        ${If} ${FileExists} "$FastagOtherDir\uninstall.exe"
          DetailPrint "Could not delete $FastagOtherDir\uninstall.exe; delete it by hand."
        ${EndIf}
        RMDir "$FastagOtherDir"
        DetailPrint "Removed the old ${PRODUCTNAME} in $FastagOtherDir (uninstaller exit $FastagOtherCode)."
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; NSIS_HOOK_POSTUNINSTALL: the template deletes each file once (plain
; Delete, errors ignored). Right after the app or its CLI ran, an executable
; or DLL can still be held for a moment (the image section of a process that
; is just ending, an on-access scan; seen as leftovers under x64 emulation on
; Windows on ARM64), and the uninstaller then leaves the CLI, its DLLs and
; uninstall.exe behind. Retry those for up to 30 s, then schedule what is
; still held for deletion at the next restart (/REBOOTOK) and say so.
; uninstall.exe is retried only when this uninstaller runs from its %TEMP%
; copy; run in place (_?=, as the pre-install hook does) it is the running
; image, which its caller deletes.
!macro FASTAG_DELETE_HELD FLAGS
  Delete ${FLAGS} "$INSTDIR\${MAINBINARYNAME}.exe"
  Delete ${FLAGS} "$INSTDIR\resources\fastag\bin\*.exe"
  Delete ${FLAGS} "$INSTDIR\resources\fastag\bin\*.dll"
  ${If} $EXEDIR != $INSTDIR
    Delete ${FLAGS} "$INSTDIR\uninstall.exe"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  StrCpy $FastagTries 0
  fastag_un_retry:
    StrCpy $FastagOtherCode 0
    ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    ${OrIf} ${FileExists} "$INSTDIR\resources\fastag\bin\*.exe"
    ${OrIf} ${FileExists} "$INSTDIR\resources\fastag\bin\*.dll"
      StrCpy $FastagOtherCode 1
    ${EndIf}
    ${If} $EXEDIR != $INSTDIR
    ${AndIf} ${FileExists} "$INSTDIR\uninstall.exe"
      StrCpy $FastagOtherCode 1
    ${EndIf}
    ${If} $FastagOtherCode = 1
      ${If} $FastagTries < 60
        ${If} $FastagTries = 0
          DetailPrint "Files of ${PRODUCTNAME} in $INSTDIR are still in use; retrying for up to 30 s."
        ${EndIf}
        IntOp $FastagTries $FastagTries + 1
        Sleep 500
        !insertmacro FASTAG_DELETE_HELD ""
        Goto fastag_un_retry
      ${EndIf}
      DetailPrint "Some files in $INSTDIR are still in use; they will be deleted when Windows restarts."
      !insertmacro FASTAG_DELETE_HELD "/REBOOTOK"
    ${ElseIf} $FastagTries > 0
      DetailPrint "Deleted the remaining files after $FastagTries retries."
    ${EndIf}
  ; Only empty folders: a file the user put into the install (the taxonomy
  ; index) keeps its folder.
  RMDir "$INSTDIR\resources\fastag\bin"
  RMDir "$INSTDIR\resources\fastag"
  RMDir "$INSTDIR\resources"
  RMDir "$INSTDIR"
!macroend
