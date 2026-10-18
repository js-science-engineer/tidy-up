@echo off
rem TidyLab 一键启动：启动本地服务并自动打开浏览器
cd /d %~dp0
start "" http://localhost:5175
"C:\Users\Lenovo\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" server\index.js
pause
