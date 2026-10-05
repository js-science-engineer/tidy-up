// 备份 / 恢复（zip；恢复走 PowerShell Expand-Archive，恢复后需重启服务）
const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const archiver = require('archiver');
const { ok, wrap, ApiError } = require('../util');
const { DATA_DIR, IMAGES_DIR, BACKUPS_DIR, DB_FILE, CONFIG_FILE, ensureDirs } = require('../paths');

const router = express.Router();

function listBackups() {
  ensureDirs();
  return fs.readdirSync(BACKUPS_DIR)
    .filter((f) => /^backup-\d{8}-\d{9}\.zip$/.test(f))
    .sort()
    .reverse()
    .map((f) => {
      const st = fs.statSync(path.join(BACKUPS_DIR, f));
      return { file: f, size: st.size, created: st.mtime.toISOString() };
    });
}

function pruneKeep(n = 10) {
  const list = listBackups();
  for (const f of list.slice(n)) {
    try { fs.unlinkSync(path.join(BACKUPS_DIR, f.file)); } catch { /* ignore */ }
  }
}

async function zipDir() {
  ensureDirs();
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  // 文件名含毫秒（HHMMSSmmm），避免同一秒内多次备份互相覆盖
  const name = `backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${String(d.getMilliseconds()).padStart(3, '0')}.zip`;
  const dest = path.join(BACKUPS_DIR, name);
  // 先 checkpoint，保证 WAL 内容落盘到主库文件
  try { db_execRaw('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(dest);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    if (fs.existsSync(DB_FILE)) archive.file(DB_FILE, { name: 'tidy.db' });
    if (fs.existsSync(CONFIG_FILE)) archive.file(CONFIG_FILE, { name: 'config.json' });
    if (fs.existsSync(IMAGES_DIR)) archive.directory(IMAGES_DIR, 'images');
    archive.finalize();
  });
  pruneKeep(10);
  return name;
}

// index.js 注入的原生句柄（执行 checkpoint 用）
let db_execRaw = () => {};
router._setRawExec = (fn) => { db_execRaw = fn; };

router.get('/list', (req, res) => ok(res, listBackups()));

router.post('/', wrap(async (req, res) => {
  const file = await zipDir();
  ok(res, { file, backups: listBackups() });
}));

router.post('/restore', wrap(async (req, res) => {  const file = String(req.body.file || '');
  if (!/^backup-\d{8}-\d{9}\.zip$/.test(file)) throw new ApiError(400, '备份文件名不合法');
  const zipPath = path.join(BACKUPS_DIR, file);
  if (!fs.existsSync(zipPath)) throw new ApiError(404, '备份文件不存在');

  // 1) 恢复前应急备份当前数据
  const emergency = await zipDir();

  // 2) 解压到临时目录（Windows 内置 PowerShell Expand-Archive）
  const tmp = path.join(DATA_DIR, 'restore-tmp-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  await new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${tmp}" -Force`],
      { windowsHide: true, timeout: 60000 }, (err) => (err ? reject(new ApiError(500, '解压失败：' + err.message)) : resolve()));
  });

  // 3) 覆盖数据
  const newDb = path.join(tmp, 'tidy.db');
  if (fs.existsSync(newDb)) {
    for (const suffix of ['', '-wal', '-shm']) {
      const f = DB_FILE + suffix;
      if (fs.existsSync(f)) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    }
    fs.copyFileSync(newDb, DB_FILE);
  }
  const newCfg = path.join(tmp, 'config.json');
  if (fs.existsSync(newCfg)) fs.copyFileSync(newCfg, CONFIG_FILE);
  const newImages = path.join(tmp, 'images');
  if (fs.existsSync(newImages)) {
    fs.rmSync(IMAGES_DIR, { recursive: true, force: true });
    fs.renameSync(newImages, IMAGES_DIR);
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  ok(res, { restored: file, emergencyBackup: emergency, needRestart: true });
}));

// 启动自动备份：当天还没有备份时静默备份一次（F1）
async function autoBackupOnce() {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const prefix = `backup-${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}-`;
  if (listBackups().some((b) => b.file.startsWith(prefix))) return null;
  return zipDir();
}

module.exports = router;
module.exports.autoBackupOnce = autoBackupOnce;
