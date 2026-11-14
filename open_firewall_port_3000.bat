@echo off
chcp 65001 >nul
title Open Windows Firewall Port 3000 for NES-PO Server

echo ================================================================
echo   เปิดพอร์ต Windows Firewall (TCP 3000) สำหรับให้เครื่องอื่นในวง LAN เข้าใช้งาน
echo   หมายเหตุ: กรุณาคลิกขวาที่ไฟล์นี้แล้วเลือก "Run as administrator"
echo ================================================================
echo.

netsh advfirewall firewall delete rule name="NES-PO Web Server (Port 3000)" >nul 2>nul
netsh advfirewall firewall add rule name="NES-PO Web Server (Port 3000)" dir=in action=allow protocol=TCP localport=3000

if %errorlevel% equ 0 (
    echo.
    echo [SUCCESS] เปิดพอร์ต 3000 บน Windows Firewall เรียบร้อยแล้ว!
    echo เครื่องอื่นในวง LAN / Wi-Fi เดียวกันสามารถเข้าใช้งานผ่านลิงก์ http://^<IP-เครื่องนี้^>:3000 ได้ทันที
) else (
    echo.
    echo [ERROR] ไม่สามารถตั้งค่า Firewall ได้ กรุณาคลิกขวาที่ไฟล์นี้แล้วเลือก "Run as administrator"
)

echo.
pause
