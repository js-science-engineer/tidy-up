#!/usr/bin/env bash
# ============================================================
#  TidyLab 一键启动（macOS / Linux）
#  启动本地服务并自动打开浏览器
#  依赖：Node.js >= 22.5（推荐 22 LTS）
# ============================================================
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[TidyLab] 未检测到 Node.js，请先安装 Node.js 22 LTS 或更高版本：https://nodejs.org/"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[TidyLab] 首次运行，正在安装依赖（npm install）..."
  npm install
fi

echo "[TidyLab] 正在启动服务，浏览器将自动打开 http://localhost:5175"
echo "         按 Ctrl+C 停止服务。"

# 稍等服务起来再开浏览器
(
  sleep 1
  if command -v open >/dev/null 2>&1; then open http://localhost:5175
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:5175
  fi
) &

node server/index.js
