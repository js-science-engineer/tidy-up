'use strict';

/**
 * 本地存储适配器：原子写 + 节流 + 启动自愈
 * ---------------------------------------------------------------
 * 对应 PRD 7.3 的四条硬性要求与验收 B3 / B4。
 * 只依赖 node:fs / node:path，不依赖 electron，可完整单元测试。
 */

const fs = require('fs');
const path = require('path');

/** 原子写：先写同目录同名 .tmp，再 rename 覆盖。 */
async function writeAtomic(file, data) {
  const dir = path.dirname(file);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = file + '.tmp';
  const body = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(tmp, body, 'utf8');
  // rename 在同一分区内是原子操作；跨分区会失败，所以 tmp 必须与目标同目录
  await fs.promises.rename(tmp, file);
}

/** 读取 JSON；失败返回 null 而不是抛出 */
async function readJson(file) {
  let text;
  try {
    text = await fs.promises.readFile(file, 'utf8');
  } catch (_) {
    return null;
  }
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    return { error: 'JSON 解析失败: ' + e.message };
  }
}

/**
 * @param {string} filePath 主数据文件绝对路径
 * @param {object} [opts]
 * @param {number} [opts.throttleMs] 节流窗口，默认 2000
 */
class LocalAdapter {
  constructor(filePath, opts) {
    this.filePath = filePath;
    this.throttleMs = (opts && opts.throttleMs) || 2000;
    this.data = null;
    this.dirty = false;
    this._timer = null;
    this._writing = null;
    this.recoveredFrom = null;   // 启动自愈时记录来源，用于提示用户
  }

  /** 载入：主文件损坏时自动回退到 backups 目录里最新的可用备份 */
  async load(backups) {
    const main = await readJson(this.filePath);
    if (main && main.value !== undefined && !main.error) {
      this.data = main.value;
      return { ok: true, source: 'main' };
    }

    // 主文件损坏 / 不存在 → 尝试备份（兼容字符串数组与 listBackups 的对象数组）
    const files = (Array.isArray(backups) ? backups : [])
      .map((b) => (typeof b === 'string' ? b : b && b.file))
      .filter(Boolean);
    for (const file of files) {             // backups 已按新→旧排序
      const cand = await readJson(file);
      if (cand && cand.value !== undefined && !cand.error) {
        this.data = cand.value;
        this.recoveredFrom = file;
        // 立即把找回的数据写回主文件，避免下次启动又走一遍
        await writeAtomic(this.filePath, this.data);
        return { ok: true, source: 'backup', recoveredFrom: file };
      }
    }

    return { ok: false, error: main && main.error ? main.error : '主文件不存在' };
  }

  /** 替换整份数据并持久化 */
  async replace(data) {
    this.data = data;
    return this.flush();
  }

  /** 浅合并 patch（一级字段覆盖），按节流策略落盘 */
  patch(partial) {
    if (!this.data) throw new Error('尚未 load()，不能 patch');
    this.data = Object.assign({}, this.data, partial);
    if (this.data.meta && typeof this.data.meta === 'object') {
      this.data.meta = Object.assign({}, this.data.meta, { updatedAt: Date.now() });
    }
    this.dirty = true;
    this._schedule();
    return this.data;
  }

  _schedule() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush().catch(() => {});
    }, this.throttleMs);
    // 允许进程退出时不被这个 timer 卡住
    if (this._timer.unref) this._timer.unref();
  }

  /** 立即落盘；并发调用会串行化，避免交叉写入 */
  async flush() {
    if (!this.data) return false;
    if (this._writing) {
      await this._writing.catch(() => {});
      return this.flush();
    }
    this.dirty = false;
    this._writing = writeAtomic(this.filePath, this.data)
      .then(() => { this._writing = null; return true; })
      .catch((e) => { this._writing = null; throw e; });
    return this._writing;
  }

  /** 进程退出前调用：取消节流定时器并强制写盘 */
  async close() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this.dirty) await this.flush();
  }
}

module.exports = { LocalAdapter, writeAtomic, readJson };
