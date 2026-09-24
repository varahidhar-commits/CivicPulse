@echo off
title CivicPulse
cd /d "%~dp0backend"

start http://localhost:4000

npm start

pause