@echo off
title Phrontis Mobile Dev
setlocal
rem ============================================================
rem  Phrontis Mobile - dev server launcher
rem  (desktop shortcut Phrontis-Mobile-dev.bat just calls this)
rem
rem  ASCII only + CRLF required: cmd.exe parses .bat with the OEM
rem  codepage (Chinese text corrupts parsing) and LF makes it read
rem  lines wrong. Same rule as the main repo desktop launchers.
rem ============================================================
set "REPO=%~dp0.."
set "PORT=5173"

echo ==============================================
echo  Phrontis Mobile - dev server
echo ==============================================
echo   Window  : a phone-shaped app window opens automatically
echo   Phone   : same WiFi/hotspot, use the address below
echo             that matches the phone network:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do echo     http:%%a
echo   (skip 169.254.* and virtual NICs like 192.168.*.1)
echo   Stop    : close the app window or Ctrl+C then Y
echo ==============================================
echo.

rem open an Edge app-mode window (no tabs / address bar) once vite is up
start "" /min cmd /c "timeout /t 4 /nobreak >nul && start msedge --app=http://localhost:%PORT% --window-size=452,940"

cd /d "%REPO%"
call npm run dev -- --strictPort
set "EC=%ERRORLEVEL%"
echo.
echo [Phrontis Mobile] dev server exited (code %EC%).
echo If the port was busy, another instance may already be
echo running - just open http://localhost:%PORT% in a browser.
pause
exit /b %EC%
