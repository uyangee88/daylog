Dim shell, fso, dir
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & dir & "\venv\Scripts\pythonw.exe"" """ & dir & "\main.py""", 0, False
