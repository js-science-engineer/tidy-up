@echo off
chcp 65001 >nul
rem ============================================================
rem  TidyLab 一键启动（Windows）
rem  启动本地服务并自动打开浏览器
rem  依赖：Node.js >= 22.5（推荐 22 LTS），需在 PATH 中可用
rem ============================================================
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [TidyLab] 未检测到 Node.js，请先安装 Node.js 22 LTS 或更高版本：
  echo           https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [TidyLab] 首次运行，正在安装依赖（npm install）...
  call npm install
  if errorlevel 1 (
    echo [TidyLab] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo [TidyLab] 正在启动服务，浏览器将自动打开 http://localhost:5175
echo          关闭本窗口即可停止服务。
start "" http://localhost:5175
node server\index.js
pause
