@echo off
REM ALBRUS - WhatsApp bakim fotograflarini kategorilere gore duzenler.
REM Cift tikla calistir. Ya da: export klasorunu bu dosyanin uzerine SURUKLE-BIRAK.
chcp 65001 >nul
title ALBRUS - WhatsApp Duzenleyici
cd /d "%~dp0"

set "KAYNAK=%~1"

if "%KAYNAK%"=="" (
  echo.
  echo  ═══════════════════════════════════════════
  echo   ALBRUS - WhatsApp Bakim Fotografi Duzenleyici
  echo  ═══════════════════════════════════════════
  echo.
  echo  WhatsApp'ta grubu ac : Menu ^> Daha fazla ^> Sohbeti disa aktar ^> MEDYA EKLE
  echo  Cikan ZIP'i bilgisayara indirip KLASORE CIKAR.
  echo.
  echo  Sonra o klasorun yolunu buraya yapistir.
  echo  ^(Klasoru bu .bat dosyasinin uzerine surukleyip birakabilirsin de^)
  echo.
  set /p KAYNAK="Export klasor yolu: "
)

if "%KAYNAK%"=="" (
  echo Klasor girilmedi. Cikiliyor.
  pause
  exit /b 1
)

echo.
echo  ONCE DENEME yapiliyor - hicbir dosya yazilmayacak...
echo.
node duzenle.js "%KAYNAK%" "%USERPROFILE%\Desktop" --deneme
if errorlevel 1 goto son

echo.
set /p ONAY="Yukaridaki dagilim dogru mu? Dosyalar Masaustune kopyalansin mi? (E/H): "
if /i not "%ONAY%"=="E" (
  echo Iptal edildi.
  goto son
)

echo.
node duzenle.js "%KAYNAK%" "%USERPROFILE%\Desktop"

:son
echo.
pause
