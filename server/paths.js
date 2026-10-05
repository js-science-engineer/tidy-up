// 统一路径管理：支持 TIDY_DATA_DIR 环境变量隔离（自动化测试用）
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.TIDY_DATA_DIR
  ? path.resolve(process.env.TIDY_DATA_DIR)
  : path.join(ROOT, 'data');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const BACKUPS_DIR = process.env.TIDY_BACKUP_DIR
  ? path.resolve(process.env.TIDY_BACKUP_DIR)
  : path.join(ROOT, 'backups');
const DB_FILE = path.join(DATA_DIR, 'tidy.db');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function ensureDirs() {
  for (const d of [DATA_DIR, IMAGES_DIR, UPLOADS_DIR, BACKUPS_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}
ensureDirs();

module.exports = { ROOT, DATA_DIR, IMAGES_DIR, UPLOADS_DIR, BACKUPS_DIR, DB_FILE, CONFIG_FILE, ensureDirs };
