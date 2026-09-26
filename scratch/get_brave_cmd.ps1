Get-CimInstance Win32_Process -Filter "Name='brave.exe'" | ForEach-Object {
    if ($_.CommandLine -match "remote-debugging-port") {
        Write-Output $_.CommandLine
    }
}
