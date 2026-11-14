@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==========================================================
echo   NES-PO Management System (FM-PU-02 / Rev.00)
echo   บริษัท นวพล เอ็นจิเนียริ่ง แอนด์ ซัพพลาย จำกัด
echo ==========================================================
echo กำลังเปิดหน้าเว็บที่ http://localhost:3000 ...
start "" "http://localhost:3000"
node server.js
pause
