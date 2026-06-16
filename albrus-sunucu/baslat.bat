@echo off
REM ALBRUS Sunucu baslatici - bu bilgisayari veri sunucusu yapar
REM Cift tiklayarak calistir. Pencereyi kapatmazsan sunucu acik kalir.
title ALBRUS Sunucu
cd /d "%~dp0"
echo ALBRUS sunucu baslatiliyor...
echo Yerel ag adresi: http://192.168.1.42:4000  (ofis ici)
echo Durdurmak icin bu pencereyi kapatin.
echo.
node server.js
pause
