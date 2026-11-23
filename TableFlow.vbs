Option Explicit
Dim shell, files, root, node, candidate, part, command, result, errorFile, message, stream, arguments
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
node = ""
candidate = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If files.FileExists(candidate) Then node = candidate
If node = "" Then
  For Each part In Split(shell.ExpandEnvironmentStrings("%PATH%"), ";")
    If Len(part) > 0 Then
      candidate = files.BuildPath(Replace(part, Chr(34), ""), "node.exe")
      If files.FileExists(candidate) Then
        node = candidate
        Exit For
      End If
    End If
  Next
End If
If node = "" Then
  MsgBox "Node.js 22.13 or later is required. Install it from https://nodejs.org/ and launch TableFlow again.", 16, "TableFlow"
  WScript.Quit 1
End If
shell.CurrentDirectory = root
arguments = ""
For Each part In WScript.Arguments
  If part = "--no-browser" Then arguments = " --no-browser"
Next
command = Chr(34) & node & Chr(34) & " " & Chr(34) & files.BuildPath(root, "scripts\start-local.mjs") & Chr(34) & arguments
result = shell.Run(command, 0, True)
If result <> 0 Then
  message = "Could not start TableFlow. See .data\tableflow-launch.log."
  errorFile = files.BuildPath(root, ".data\tableflow-launch-error.txt")
  If files.FileExists(errorFile) Then
    Set stream = files.OpenTextFile(errorFile, 1, False, -1)
    message = stream.ReadAll
    stream.Close
  End If
  MsgBox message, 16, "TableFlow"
End If
WScript.Quit result
