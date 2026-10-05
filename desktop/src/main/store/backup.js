'use strict';

/**
 * 备份与恢复
 * ---------------------------------------------------------------
 * 对应 PRD 7.4 / 7.5 与验收 B5 / F1 / F2。
 * 只依赖 node:fs / node:path，可单元测试。
 */

const fs = require('fs');
const path = require('path');

const BACKUP_KEEP = 5;

function pad(n, len) {
  return String(n).padStart(len || 2, '0');
}

function backupStamp(ts) {
  const d = new Date(Number.isFinite(ts) ? ts : Date.now());
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function backupFileName(ts) {
  return `pet-data-${backupStamp(ts)}.json`;
}

/** 从文件名解析时间戳；解析不出返回 null */
function stampToTime(name) {
  const m = /^pet-data-(\d{8})-(\d{6})\.json$/.exec(path.basename(name));
  if (!m) return null;
  const s = m[1], t = m[2];
  return new Date(
    Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)),
    Number(t.slice(0, 2)), Number(t.slice(2, 4)), Number(t.slice(4, 6))
  ).getTime();
}

/** 列出备份文件，按新→旧排序 */
async function listBackups(dir) {
  let names;
  try {
    names = await fs.promises.readdir(dir);
  } catch (_) {
    return [];
  }
  return names
    .filter((n) => /^pet-data-\d{8}-\d{6}\.json$/.test(n))
    .map((n) => ({ name: n, file: path.join(dir, n), time: stampToTime(n) || 0 }))
    .sort((a, b) => b.time - a.time);
}

async function writeBackup(dir, data, ts) {
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, backupFileName(ts));
  await fs.promises.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  return file;
}

/** 只保留最近 keep 份，返回删除数量 */
async function rotateBackups(dir, keep) {
  const k = Number.isFinite(keep) ? keep : BACKUP_KEEP;
  const list = await listBackups(dir);
  let removed = 0;
  for (let i = k; i < list.length; i++) {
    try {
      await fs.promises.unlink(list[i].file);
      removed++;
    } catch (_) { /* 删不掉就留着，不影响主流程 */ }
  }
  return removed;
}

/** 读取一份备份文件并 JSON.parse */
async function readBackup(file) {
  const text = await fs.promises.readFile(file, 'utf8');
  return JSON.parse(text);
}

module.exports = {
  BACKUP_KEEP, backupStamp, backupFileName, stampToTime,
  listBackups, writeBackup, rotateBackups, readBackup,
};
