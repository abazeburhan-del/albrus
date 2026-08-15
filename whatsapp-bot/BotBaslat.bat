@echo off
REM ALBRUS - WhatsApp Bakim Botu
REM Cift tikla calistir. Ilk acilista QR cikar, telefonundan okut.
REM Bu pencereyi KAPATMA - kapatirsan yeni fotograflar kaydedilmez.
chcp 65001 >nul
title ALBRUS - WhatsApp Bakim Botu
cd /d "%~dp0"

node bot.js

echo.
echo Bot durdu. Pencereyi kapatabilirsin.
pause
