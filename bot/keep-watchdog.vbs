' Keeps the Landstar watchdog running. Run by the Windows scheduled task
' "Landstar Watchdog Keeper" at sign-in and every 5 minutes after that.
' If no watchdog (node ... watchdog.js) is running, it starts
' "Start Everything (watchdog).bat" minimized. Otherwise it does nothing.
' Runs with no window, so the 5-minute check never flashes on screen.

Option Explicit
Dim fso, shell, wmi, procs, root, bat

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
bat = root & "\Start Everything (watchdog).bat"

Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set procs = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name = 'node.exe' AND CommandLine LIKE '%watchdog.js%'")
If procs.Count > 0 Then WScript.Quit 0

If Not fso.FileExists(bat) Then WScript.Quit 1
shell.CurrentDirectory = root
' The helper cmd is hidden (0); "start /min" opens the watchdog window minimized.
shell.Run "cmd /c start ""Landstar Watchdog"" /min """ & bat & """", 0, False
WScript.Quit 0
