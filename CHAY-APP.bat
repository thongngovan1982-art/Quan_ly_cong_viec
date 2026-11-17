@echo off
chcp 65001 >nul
title Team Tracker
cd /d "%~dp0"
where node >nul 2>nul || (echo Chua cai Node.js. Tai ban LTS tai https://nodejs.org roi chay lai file nay. & pause & exit /b)
echo Dang khoi dong Team Tracker... Mo trinh duyet: http://localhost:3000
start "" http://localhost:3000
node server.js
pause
