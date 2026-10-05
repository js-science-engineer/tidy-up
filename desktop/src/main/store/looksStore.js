'use strict';

/**
 * L2 形象仓储：内置形象 + 用户自定义形象（上传/删除/切换）。
 * ---------------------------------------------------------------
 * 元数据存在 repo.data.looks（随主数据一起备份/恢复），
 * 图片文件落在 <userData>/looks/<id>/[front|side|back|wave|sleep].png。
 * 渲染进程通过 look://<id>/<view>.png 自定义协议加载（见 main/index.js）。
 *
 * 上传导入与内置素材构建走同一条归一化管线（src/main/image/normalizeLook.js），
 * 保证"白底/绿幕原图能正确换装"（PRD 验收 D2）。
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { normalizeToPngBuffer } = require('../image/normalizeLook');
const { VIEW_KEYS } = require('../../shared/lookSlots');

const BUILTIN_ID = 'builtin-classic';
const BUILTIN_NAME = '经典小圆';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

class LooksStore {
  /** @param {import('./repository')} repo */
  constructor(repo) {
    this.repo = repo;
    this.root = path.join(repo.dataDir, 'looks');
  }

  init() {
    fs.mkdirSync(this.root, { recursive: true });
  }

  /** 内置形象（永远存在，不可删除） */
  builtinEntry() {
    return { id: BUILTIN_ID, name: BUILTIN_NAME, builtin: true, createdAt: 0 };
  }

  /** 形象列表（内置在前） */
  list() {
    const custom = (this.repo.data.looks || []).map((l) => ({
      id: String(l.id),
      name: String(l.name || '未命名形象'),
      builtin: false,
      createdAt: Number(l.createdAt) || 0,
    }));
    return [this.builtinEntry()].concat(custom);
  }

  has(id) {
    return id === BUILTIN_ID || (this.repo.data.looks || []).some((l) => l.id === id);
  }

  dirOf(id) {
    // 防目录穿越：id 只允许安全字符
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error('非法的形象 id');
    return path.join(this.root, id);
  }

  /** 某形象各视图的加载 URL；文件缺失的视图回退 front（渲染层还会再兜底） */
  viewsFor(id) {
    if (id === BUILTIN_ID || !id) {
      return {
        front: 'looks/front.png',
        side: 'looks/side.png',
        back: 'looks/back.png',
        side2: null, // 渲染层用侧面镜像
        wave: 'looks/wave.png',
        sleep: 'looks/sleep.png',
      };
    }
    const dir = this.dirOf(id);
    const out = { front: null, side: null, back: null, side2: null, wave: null, sleep: null };
    for (const k of VIEW_KEYS) {
      const p = path.join(dir, k + '.png');
      if (fs.existsSync(p)) out[k] = `look://${id}/${k}.png`;
    }
    if (!out.front) throw new Error(`形象 ${id} 缺少正面图`);
    // 缺失视图回退正面（转身时三面同图，招手/打盹同正面）
    for (const k of VIEW_KEYS) if (!out[k]) out[k] = out.front;
    out.side2 = null; // 恒用侧面镜像
    return out;
  }

  /**
   * 导入一张原图为自定义形象。
   * @param {{name:string, buffer:Buffer|Uint8Array}} p
   * @returns {{id:string, name:string}}
   */
  importPng(p) {
    const name = String((p && p.name) || '').trim().slice(0, 24) || '我的形象';
    const buf = p && p.buffer;
    if (!buf || !buf.length) throw new Error('没有收到图片数据');
    if (buf.length > MAX_UPLOAD_BYTES) throw new Error('图片超过 20MB，请压缩后再上传');

    const { buffer: outBuf, info } = normalizeToPngBuffer(buf, { label: name });

    // 生成 id（时间戳 + 随机尾巴，避免同毫秒冲突）
    const id = 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const dir = this.dirOf(id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'front.png'), outBuf);

    const meta = { id, name, createdAt: Date.now() };
    const looks = (this.repo.data.looks || []).concat([meta]);
    this.repo.patch({ looks, currentLookId: id });
    return { id, name, info };
  }

  /** 删除自定义形象（含磁盘文件）；删除当前形象时回退内置 */
  remove(id) {
    if (id === BUILTIN_ID) throw new Error('内置形象不能删除');
    const looks = (this.repo.data.looks || []);
    const hit = looks.some((l) => l.id === id);
    if (!hit) throw new Error('形象不存在');
    const next = looks.filter((l) => l.id !== id);
    const patch = { looks: next };
    if (this.repo.data.currentLookId === id) patch.currentLookId = null;
    this.repo.patch(patch);
    try { fs.rmSync(this.dirOf(id), { recursive: true, force: true }); } catch (_) {}
    return true;
  }

  /** 切换当前形象（校验存在性） */
  setCurrent(id) {
    if (!this.has(id)) throw new Error('形象不存在: ' + id);
    this.repo.patch({ currentLookId: id });
    return this.viewsFor(id);
  }
}

module.exports = { LooksStore, BUILTIN_ID, BUILTIN_NAME, MAX_UPLOAD_BYTES };
