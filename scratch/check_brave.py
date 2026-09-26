import subprocess

out = subprocess.check_output("wmic process where \"name='brave.exe'\" get ProcessId,CommandLine", shell=True, text=True)
for line in out.splitlines():
    if "--remote-debugging-port" in line:
        print("Brave Command Line:\n", line)
