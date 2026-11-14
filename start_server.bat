@echo off
chcp 65001 >nul
title NES-PO, PR ^& WMS Management Server
cd /d "%~dp0"

echo ================================================================
echo   NES-PO, PR ^& WMS Management System
echo   NAWAPHOL ENGINEERING ^& SUPPLY CO., LTD.
echo ================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] ไม่พบโปรแกรม Node.js ในเครื่องนี้!
    echo กรุณาติดตั้ง Node.js ^(เวอร์ชัน 22.5 หรือ 24 ขึ้นไป^) จาก https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [INFO] ตรวจพบ Node.js เวอร์ชัน: %NODE_VER%
echo.
echo [1] ลิงก์สำหรับเปิดใช้งานบนเครื่องนี้ ^(Server^):
echo     http://localhost:3000
echo.
echo [2] ลิงก์สำหรับให้เครื่องอื่นในวง LAN / Wi-Fi เดียวกันเข้าใช้งาน ^(พอร์ต 3000^):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    for /f "tokens=* delims= " %%b in ("%%a") do (
        echo     http://%%b:3000
    )
)
echo.
echo ================================================================
echo   กำลังเปิดเบราว์เซอร์และรันระบบ Server...
echo   ^(ห้ามปิดหน้าต่างสีดำนี้ขณะใช้งาน หากต้องการหยุด Server ให้กด Ctrl+C^)
echo ================================================================
echo.

start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
node server.js

echo.
echo [INFO] ระบบ Server หยุดทำงานแล้ว
pause
