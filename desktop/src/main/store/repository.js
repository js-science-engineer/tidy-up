'use strict';

/**
 * 仓储层：本地适配器的统一入口。
 * ---------------------------------------------------------------
 * PRD 决策 7：本地为主 + 预留云同步。业务代码只依赖本类的接口，
 * 将来加云同步时再实现一个 CloudAdapter 换进来即可，不需要改业务。
 *
 * 主进程是唯一写入者（PRD 6.1）。
 */

const path = require('path');
const schema = require('./schema');
const { LocalAdapter } = require('./localAdapter');
const backup = require('./backup');

const AUTO_BACKUP_INTERVAL = 24 * 60 * 60 * 1000;   // 24h

class Repository {
  /**
   * @param {string} dataDir 用户数据目录（%APPDATA%/js-pet 或 Application Support/js-pet）
   * @param {object} [opts] { throttleMs, autoBackupInterval, clock }
   */
  constructor(dataDir, opts) {
    this.dataDir = dataDir;
    this.backupDir = path.join(dataDir, 'backups');
    this.mainFile = path.join(dataDir, 'pet-data.json');
    this.opts = opts || {};
    this.adapter = new LocalAdapter(this.mainFile, { throttleMs: this.opts.throttleMs });
    this.notices = [];            // 启动自愈等需要告知用户的事项
    this._clock = this.opts.clock || (() => Date.now());
  }

  async init() {
    await this.adapter.load(await backup.listBackups(this.backupDir));
    if (this.adapter.recoveredFrom) {
      this.notices.push('检测到数据文件损坏，已自动从最近一次备份恢复。');
    }

    const migrated = schema.migrate(this.adapter.data);
    if (!migrated.ok) {
      this.notices.push('数据无法解析：' + migrated.reason + '，已重置为初始状态。');
      this.adapter.data = schema.defaultData(this._clock());
      await this.adapter.flush();
    } else {
      this.adapter.data = migrated.data;
    }

    await this.autoBackupIfDue();
    return this.data;
  }

  get data() {
    return this.adapter.data;
  }

  /** 浅合并 patch（一级字段），节流落盘 */
  patch(partial) {
    return this.adapter.patch(partial);
  }

  async flush() {
    return this.adapter.flush();
  }

  async close() {
    return this.adapter.close();
  }

  /** 启动后若距上次备份超过 24h（或从未备份过）则写一份 */
  async autoBackupIfDue() {
    const list = await backup.listBackups(this.backupDir);
    const interval = this.opts.autoBackupInterval || AUTO_BACKUP_INTERVAL;
    const now = this._clock();
    const newest = list.length ? list[0].time : 0;
    if (!list.length || now - newest >= interval) {
      await backup.writeBackup(this.backupDir, this.data, now);
      await backup.rotateBackups(this.backupDir, backup.BACKUP_KEEP);
      return true;
    }
    return false;
  }

  /** 手动备份（设置页"备份数据"），返回写入的文件路径 */
  async backupNow() {
    const file = await backup.writeBackup(this.backupDir, this.data, this._clock());
    await backup.rotateBackups(this.backupDir, backup.BACKUP_KEEP);
    return file;
  }

  listBackups() {
    return backup.listBackups(this.backupDir);
  }

  /**
   * 从备份文件恢复（对应验收 F1 / F2）
   * @returns {{ok:true, data:object}|{ok:false, reason:string}}
   */
  async restoreFromFile(file) {
    let raw;
    try {
      raw = await backup.readBackup(file);
    } catch (e) {
      return { ok: false, reason: '备份文件读取失败：' + e.message };
    }
    return this.restoreFromObject(raw);
  }

  async restoreFromObject(raw) {
    const v = schema.validateForRestore(raw);
    if (!v.ok) return v;
    const migrated = schema.migrate(raw);
    if (!migrated.ok) return { ok: false, reason: migrated.reason };
    this.adapter.data = migrated.data;
    await this.adapter.flush();
    return { ok: true, data: this.adapter.data };
  }

  /** 导出（设置页"备份数据"→ 保存到用户选的位置） */
  exportObject() {
    return JSON.parse(JSON.stringify(this.data));
  }
}

module.exports = { Repository, AUTO_BACKUP_INTERVAL };
