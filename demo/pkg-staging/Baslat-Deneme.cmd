@echo off
rem BilgiAl deneme surumu - veri bu klasorun icindedir (deneme\)
rem Kullanim: cift tikla. Kapatmak icin pencereyi kapat.
setlocal
set "HERE=%~dp0"
start "" "%HERE%BilgiAl.exe" --user-data-dir="%HERE%deneme"
endlocal
