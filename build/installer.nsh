!include nsDialogs.nsh
!include LogicLib.nsh
!include MUI2.nsh

; --- Variables ---
Var Dialog
Var Label
Var Text
Var Link
Var TheAPIKey

; --- Custom Page ---
Page custom ApiKeyPage ApiKeyPageLeave

Function ApiKeyPage
  nsDialogs::Create 1018
  Pop $Dialog

  ${If} $Dialog == error
    Abort
  ${EndIf}

  ; Title
  ${NSD_CreateLabel} 0 0 100% 12u "Gemini API Configuration"
  Pop $Label
  
  ; Description with Modern Font/Spacing
  ${NSD_CreateLabel} 0 20u 100% 28u "To use NullByte, you must provide a valid Google Gemini API Key.$\nThis software cannot function without it."
  Pop $Label

  ; Input Field
  ${NSD_CreateText} 0 55u 100% 14u ""
  Pop $Text
  
  ; Link to get key
  ${NSD_CreateLink} 0 80u 100% 12u "Get a free API Key from Google AI Studio"
  Pop $Link
  ${NSD_OnClick} $Link OnLinkClick

  nsDialogs::Show
FunctionEnd

Function OnLinkClick
  ExecShell "open" "https://aistudio.google.com/app/apikey"
FunctionEnd

Function ApiKeyPageLeave
  ${NSD_GetText} $Text $TheAPIKey
  ${If} $TheAPIKey == ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "An API Key is required to install and use this application.$\nPlease paste your key to continue."
    Abort
  ${EndIf}
FunctionEnd

; --- Installation Hook ---
!macro customInstall
  ${If} $TheAPIKey != ""
     SetShellVarContext current
     CreateDirectory "$APPDATA\NullByte\config"
     FileOpen $0 "$APPDATA\NullByte\config\settings.json" w
     FileWrite $0 '{"apiKey": "$TheAPIKey", "model": "gemma-3-27b-it"}'
     FileClose $0
  ${EndIf}
!macroend
