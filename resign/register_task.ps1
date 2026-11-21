# SelfAnkiResign: selfanki_resign.exe を2時間おきとログオンのときに動かす（窓は出さない・今のユーザー・管理者権限は要らない）
# 入れ直すかどうかは exe が state.json を見て決めるので、何度動いても軽い。消すときは: Unregister-ScheduledTask -TaskName SelfAnkiResign
#   使い方: powershell -ExecutionPolicy Bypass -File register_task.ps1   （selfanki_resign.exe と同じフォルダに置いて動かす）
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $dir 'selfanki_resign.exe'
if (-not (Test-Path $exe)) { Write-Host "selfanki_resign.exe が同じフォルダにありません: $dir"; exit 1 }
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless `"$exe`"" -WorkingDirectory $dir
$t1 = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddHours((Get-Date).Hour + 1) -RepetitionInterval (New-TimeSpan -Hours 2)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'SelfAnkiResign' -Action $action -Trigger @($t1, $t2) -Settings $settings `
  -Principal $principal -Description 'Re-sign the selfanki iOS shell (free Apple ID, 7-day) before it expires' -Force | Out-Null
Get-ScheduledTask -TaskName 'SelfAnkiResign' | Get-ScheduledTaskInfo | Select-Object TaskName, NextRunTime, LastTaskResult | Format-List
