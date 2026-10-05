PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS cabinets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  door TEXT NOT NULL CHECK(door IN ('double','single','drawer')),
  floor INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  photo TEXT,                       -- 柜子实拍照片（用户上传，用于可视化与识别放置参照）
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS shelves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('shelf','drawer')),
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS boxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shelf_id INTEGER NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_preset INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  category_id INTEGER REFERENCES categories(id),
  size_class TEXT CHECK(size_class IN ('S','M','L')) DEFAULT 'S',
  note TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS item_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('user','web')),
  is_main INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS placements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  shelf_id INTEGER REFERENCES shelves(id),
  box_id INTEGER REFERENCES boxes(id),
  qty INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  CHECK (shelf_id IS NOT NULL OR box_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('in','out','move','edit','structure')),
  qty INTEGER DEFAULT 0,
  location TEXT,
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS intake_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','dismissed')),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

INSERT OR IGNORE INTO categories(name, is_preset) VALUES
 ('电子元件',1),('开发板/模块',1),('仪器设备',1),('线材/连接件',1),('工具',1),
 ('化学试剂',1),('耗材',1),('结构件/五金',1),('包装/收纳',1),('文档/资料',1),('其他',1);
