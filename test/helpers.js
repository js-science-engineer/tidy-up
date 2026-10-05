// 测试基建：启动隔离数据目录的服务实例 + API 调用封装
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 默认复用「正在运行测试的这个 Node 本体」，跨机器/CI 自动正确；
// 如需指定其它解释器，可设环境变量 NODE_EXE 覆盖。
const NODE = process.env.NODE_EXE || process.execPath;
const ROOT = path.join(__dirname, '..');

async function startServer({ dataDir: fixedData, backupDir: fixedBackup, timeoutMs = 25000 } = {}) {
  const dataDir = fixedData || fs.mkdtempSync(path.join(os.tmpdir(), 'tidy-test-'));
  const backupDir = fixedBackup || path.join(dataDir, 'backups');
  // PORT=0：由操作系统分配一个空闲端口。这样即使 node --test 并行跑多个文件，
  // 每个测试服务也独占端口，杜绝"随机端口撞车→把别人的服务当成自己的→数据串台"。
  // 真实端口从子进程日志中读取（见 server/index.js 的 listening 日志）。
  const proc = spawn(NODE, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: '0',
      TIDY_DATA_DIR: dataDir,
      TIDY_BACKUP_DIR: backupDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  proc.on('exit', () => { /* 退出状态由 exitCode 反映 */ });

  const deadline = Date.now() + timeoutMs;
  let port = 0;
  while (Date.now() < deadline) {
    const m = /TidyLab listening on http:\/\/localhost:(\d+)/.exec(out);
    if (m) { port = Number(m[1]); break; }
    if (proc.exitCode !== null) break; // 进程已退出（如端口错误）→ 不再等待
    await new Promise((r) => setTimeout(r, 80));
  }
  if (!port) {
    try { proc.kill(); } catch { /* ignore */ }
    throw new Error(`服务未能在 ${timeoutMs / 1000}s 内启动：\n` + out);
  }
  const base = `http://127.0.0.1:${port}`;
  // 再确认一次真实可达（日志已打印但极端情况下端口可能尚未 accept）
  let reachable = false;
  while (Date.now() < deadline && !reachable) {
    try { const r = await fetch(base + '/api/system/info'); if (r.ok) reachable = true; } catch { /* 再试 */ }
    if (!reachable) await new Promise((r) => setTimeout(r, 80));
  }
  if (!reachable) {
    try { proc.kill(); } catch { /* ignore */ }
    throw new Error('服务已打印监听日志但不可达：\n' + out);
  }
  return { proc, base, port, dataDir, backupDir, logs: () => out };
}

async function api(base, method, p, body) {
  const opt = { method };
  if (body !== undefined) {
    if (body instanceof FormData) {
      opt.body = body;
    } else {
      opt.headers = { 'Content-Type': 'application/json' };
      opt.body = JSON.stringify(body);
    }
  }
  const r = await fetch(base + '/api' + p, opt);
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

function stop(proc) {
  try { proc.kill(); } catch { /* ignore */ }
}

// 生成一张最小 PNG（1x1）作为测试图片
function tinyPng() {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  return Buffer.from(b64, 'base64');
}

module.exports = { startServer, api, stop, tinyPng };
