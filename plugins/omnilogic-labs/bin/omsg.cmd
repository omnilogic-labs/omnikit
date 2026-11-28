@echo off
rem omsg on Windows: cmd.exe and PowerShell cannot run the bash script next to
rem this file, and agy and Codex run hook commands through them. Hand it to
rem Git Bash (not System32\bash.exe, which is WSL).
setlocal
set "OMSG_BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%OMSG_BASH%" set "OMSG_BASH=%ProgramFiles%\Git\usr\bin\bash.exe"
if not exist "%OMSG_BASH%" (
  echo omsg: Git Bash not found under %ProgramFiles%\Git 1>&2
  exit /b 1
)
"%OMSG_BASH%" "%~dp0omsg" %*
exit /b %ERRORLEVEL%
