// 数据层：SQLite 连接与初始化（better-sqlite3 优先，node:sqlite 兜底，二者 API 统一）
const fs = require('fs');
const path = require('path');
const { DB_FILE } = require('./paths');

function createDatabase(file) {
  let engine, db;
  try {
    const Better = require('better-sqlite3');
    db = new Better(file);
    engine = 'better-sqlite3';
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    return wrap(db, engine);
  } catch (e) {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(file);
    engine = 'node:sqlite';
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    return wrapNode(db, engine);
  }
}

// better-sqlite3 包装（其 API 与目标一致）
function wrap(db, engine) {
  return {
    engine,
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const st = db.prepare(sql);
      return {
        run: (...args) => {
          const info = st.run(...args);
          return { changes: Number(info.changes), lastInsertRowid: Number(info.lastInsertRowid) };
        },
        get: (...args) => st.get(...args),
        all: (...args) => st.all(...args),
      };
    },
  };
}

// node:sqlite 兜底包装（API 形状对齐；BigInt 结果转 Number）
function wrapNode(db, engine) {
  return {
    engine,
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const st = db.prepare(sql);
      return {
        run: (...args) => {
          const info = st.run(...args);
          return {
            changes: Number(info.changes),
            lastInsertRowid: Number(info.lastInsertRowid),
          };
        },
        get: (...args) => st.get(...args),
        all: (...args) => st.all(...args),
      };
    },
  };
}

function initDb() {
  const db = createDatabase(DB_FILE);
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema); // 幂等：全部 IF NOT EXISTS + INSERT OR IGNORE
  // 迁移：为没有任何层/抽屉的旧柜子补一个默认层（保证可入库）
  db.exec(`INSERT INTO shelves(cabinet_id,name,kind,sort)
           SELECT id,
                  CASE WHEN door='drawer' THEN '抽屉1' ELSE '第1层' END,
                  CASE WHEN door='drawer' THEN 'drawer' ELSE 'shelf' END,
                  1
           FROM cabinets
           WHERE id NOT IN (SELECT DISTINCT cabinet_id FROM shelves WHERE cabinet_id IS NOT NULL);`);

  // 迁移 v1.4：物品图片数据修复（用户已明确"不联网搜图、以用户照片为实物图"）
  // 1) 历史版本曾把联网配图写入库，且 mock 测试会残留 example.com 等无效地址 —— 全部清除
  db.exec(`DELETE FROM item_images WHERE source='web';`);
  // 2) 历史版本每次入库都会新增一条 is_main=1，却不清旧标记，导致一个物品有多条主图
  //    （主图查询取第一条，于是永远显示最旧的联网图而不是用户照片）—— 先全部清零
  db.exec(`UPDATE item_images SET is_main=0;`);
  //    再为每个物品指定唯一主图：优先"最新的用户照片"，没有用户照片则取最新一张
  db.exec(`UPDATE item_images SET is_main=1
           WHERE id IN (SELECT MAX(id) FROM item_images WHERE source='user' GROUP BY item_id);`);
  db.exec(`UPDATE item_images SET is_main=1
           WHERE id IN (SELECT MAX(id) FROM item_images
                        WHERE item_id NOT IN (SELECT item_id FROM item_images WHERE is_main=1)
                        GROUP BY item_id);`);

  // 迁移 v1.5：柜子可绑定"实体柜子实拍照片"（收纳空间可视化 + 识别放置参照，提升准确性）
  // 老库没有该列，ALTER 会抛错（列已存在），忽略即可
  try { db.exec('ALTER TABLE cabinets ADD COLUMN photo TEXT'); } catch { /* 列已存在 */ }
  return db;
}

module.exports = { initDb };
