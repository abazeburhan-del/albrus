@echo off
REM ALBRUS - Uzaktan erisim baslatici (sunucu + Cloudflare Tunnel)
REM Cift tiklayarak calistir. Bu pencereyi KAPATMA.
title ALBRUS Uzaktan Erisim
cd /d "%~dp0"

echo ============================================================
echo  ALBRUS - Uzaktan Erisim
echo ============================================================
echo.
echo  1) Sunucu baslatiliyor...
start "ALBRUS Sunucu" cmd /c "node server.js & pause"
timeout /t 4 /nobreak >nul

echo  2) Internet adresi olusturuluyor (Cloudflare Tunnel)...
echo.
echo  ASAGIDA cikan  https://....trycloudflare.com  adresini
echo  telefonun tarayicisina yaz. Giris: admin / admin
echo.
echo  Bu pencereyi ve Sunucu penceresini KAPATMA.
echo ============================================================
echo.

cloudflared.exe tunnel --url http://localhost:4000
pause
