:: filepath: d:\whataapp_sj\start.bat
@echo off


echo Starting backend server...
start "WhatsApp Backend" cmd /k "cd /d %~dp0backend && npm run dev"

timeout /t 2 /nobreak > nul

echo Starting frontend server...
start "WhatsApp Frontend" cmd /k "cd /d %~dp0 && npm run frontend"

timeout /t 2 /nobreak > nul

start http://localhost:5173

echo Both backend and frontend are starting in separate windows.
echo Frontend: http://localhost:5173
echo Backend: