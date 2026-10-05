'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeAtomic, readJson, LocalAdapter } = require('../src/main/store/localAdapter');
const backupMod = require('../src/main/store/backup');
const { Repository } = require('../src/main/store/repository');
const schema = require('../src/main/store/schema');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `jspet-${tag}-`));
}

test('M2 · writeAtomic 是原子写：产物存在且不留 .tmp 残留（验收 B3）', async () => {
  const dir = tmpDir('atomic');
  const file = path.join(dir, 'pet-data.json');
  await writeAtomic(file, { a: 1 });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).a, 1);
  assert.equal(fs.existsSync(file + '.tmp'), false, '不应留下 .tmp 文件');
});

test('M2 · readJson：坏 JSON 返回 error 而不是抛出（验收 B4 前提）', async () => {
  const dir = tmpDir('badjson');
  const file = path.join(dir, 'x.json');
  fs.writeFileSync(file, '{ this is not json');
  const r = await readJson(file);
  assert.equal(r.value, undefined);
  assert.match(r.error, /JSON 解析失败/);
});

test('M2 · LocalAdapter.patch 走节流，不立刻写盘', async () => {
  const dir = tmpDir('throttle');
  const file = path.join(dir, 'pet-data.json');
  const a = new LocalAdapter(file, { throttleMs: 60 });
  await a.replace(schema.defaultData(1000));

  a.patch({ currentLookId: 'L1' });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).currentLookId, null, '节流窗口内不应已写盘');

  await sleep(120);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).currentLookId, 'L1', '节流窗口后应写盘');
  await a.close();
});

test('M2 · 主文件损坏 → 自动回退最新备份（验收 B4）', async () => {
  const dir = tmpDir('recover');
  const bdir = path.join(dir, 'backups');
  await backupMod.writeBackup(bdir, schema.normalize({ schemaVersion: 1, stats: { hunger: 11 } }), 1000);
  await backupMod.writeBackup(bdir, schema.normalize({ schemaVersion: 1, stats: { hunger: 22 } }), 2000);

  fs.writeFileSync(path.join(dir, 'pet-data.json'), '{ corrupted !!!');

  const a = new LocalAdapter(path.join(dir, 'pet-data.json'));
  const r = await a.load(await backupMod.listBackups(bdir));
  assert.equal(r.ok, true, '应能恢复');
  assert.equal(r.source, 'backup');
  assert.equal(a.data.stats.hunger, 22, '必须取最新的那份备份');
  assert.ok(a.recoveredFrom, '应记录恢复来源');
  // 恢复后主文件应被立即修复
  const fixed = JSON.parse(fs.readFileSync(path.join(dir, 'pet-data.json'), 'utf8'));
  assert.equal(fixed.stats.hunger, 22);
});

test('M2 · 主文件损坏且无备份 → 明确失败而不是返回半截数据', async () => {
  const dir = tmpDir('norecover');
  fs.writeFileSync(path.join(dir, 'pet-data.json'), 'garbage');
  const a = new LocalAdapter(path.join(dir, 'pet-data.json'));
  const r = await a.load([]);
  assert.equal(r.ok, false);
  assert.equal(a.data, null);
});

test('M2 · 备份轮转只保留最近 5 份（验收 B5）', async () => {
  const dir = tmpDir('rotate');
  const bdir = path.join(dir, 'backups');
  for (let i = 1; i <= 8; i++) await backupMod.writeBackup(bdir, { n: i }, 1000 + i * 1000);
  const removed = await backupMod.rotateBackups(bdir, backupMod.BACKUP_KEEP);
  assert.equal(removed, 3);
  const list = await backupMod.listBackups(bdir);
  assert.equal(list.length, 5);
  assert.equal(JSON.parse(fs.readFileSync(list[0].file, 'utf8')).n, 8, '留下的是最新的');
});

test('M2 · Repository：启动即建目录与主文件', async () => {
  const dir = tmpDir('repo1');
  const repo = new Repository(dir);
  await repo.init();
  assert.equal(fs.existsSync(path.join(dir, 'pet-data.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'backups')), true, '首次启动应生成 backups 目录');
  assert.equal(repo.data.schemaVersion, 1);
  await repo.close();
});

test('M2 · Repository：24h 内不重复自动备份，超时才备份', async () => {
  const dir = tmpDir('repo2');
  let now = 1_700_000_000_000;
  const repo = new Repository(dir, { clock: () => now, autoBackupInterval: 24 * 3600 * 1000 });
  await repo.init();
  assert.equal((await repo.listBackups()).length, 1, '首次启动应立即备份一份');

  now += 3600 * 1000;   // +1h
  const repo2 = new Repository(dir, { clock: () => now, autoBackupInterval: 24 * 3600 * 1000 });
  await repo2.init();
  assert.equal((await repo2.listBackups()).length, 1, '24h 内不应再备份');

  now += 25 * 3600 * 1000;   // +25h
  const repo3 = new Repository(dir, { clock: () => now, autoBackupInterval: 24 * 3600 * 1000 });
  await repo3.init();
  assert.equal((await repo3.listBackups()).length, 2, '超过 24h 应再备份');
  await repo3.close();
});

test('M2 · Repository：恢复旧备份后数据回到备份时刻（验收 F1）', async () => {
  const dir = tmpDir('repo3');
  const repo = new Repository(dir, { clock: () => 1_700_000_000_000 });
  await repo.init();
  repo.patch({ currentLookId: 'AFTER' });
  await repo.flush();

  // 手工造一份"过去"的备份
  const old = schema.normalize({ schemaVersion: 1, currentLookId: 'BEFORE', stats: { hunger: 5 } });
  const bfile = await backupMod.writeBackup(repo.backupDir, old, 1_699_000_000_000);

  const r = await repo.restoreFromFile(bfile);
  assert.equal(r.ok, true);
  assert.equal(repo.data.currentLookId, 'BEFORE');
  assert.equal(repo.data.stats.hunger, 5);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'pet-data.json'), 'utf8')).currentLookId, 'BEFORE');
  await repo.close();
});

test('M2 · Repository：版本不兼容的备份必须被拒绝（验收 F2）', async () => {
  const dir = tmpDir('repo4');
  const repo = new Repository(dir, { clock: () => 1_700_000_000_000 });
  await repo.init();
  const before = repo.data.currentLookId;

  const future = { schemaVersion: 99, stats: { hunger: 1 } };
  const bfile = await backupMod.writeBackup(repo.backupDir, future, 1_700_000_000_000);
  const r = await repo.restoreFromFile(bfile);
  assert.equal(r.ok, false, '必须拒绝');
  assert.match(r.reason, /版本|更新/);
  assert.equal(repo.data.currentLookId, before, '拒绝后数据不得被改动');
  await repo.close();
});

test('M2 · 并发 flush 串行化，不会交叉写出半截文件', async () => {
  const dir = tmpDir('concurrent');
  const file = path.join(dir, 'pet-data.json');
  const a = new LocalAdapter(file, { throttleMs: 1 });
  await a.replace({ n: 0 });
  await Promise.all(
    Array.from({ length: 20 }, (_, i) => {
      a.data = { n: i + 1 };
      return a.flush();
    })
  );
  const final = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(final.n, 20);
  assert.equal(fs.existsSync(file + '.tmp'), false);
});
