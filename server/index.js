// 服务入口：静态托管 + API 路由 + 局域网监听
const express = require('express');
const path = require('path');
const os = require('os');
const multer = require('multer');
const fs = require('fs');

const cfg = require('./config');
const { initDb } = require('./db');
const { DATA_DIR, IMAGES_DIR, UPLOADS_DIR, ensureDirs } = require('./paths');
const { ApiError } = require('./util');

ensureDirs();
const db = initDb();
const app = express();
app.use(express.json({ limit: '6mb' }));

// 物品图片：带 ?w= 时按需生成缩略图（列表里几十张小图不再按原图解码），否则原图静态托管
app.use('/images', require('./thumb').serveThumb, express.static(IMAGES_DIR, {
  // 图片文件名带时间戳、内容不会原地变 → 允许长缓存，手机二次打开不用重新下载
  maxAge: '30d',
  immutable: true,
}));
// 前端静态
app.use(express.static(path.join(__dirname, '..', 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
      const ext = extMap[file.mimetype] || path.extname(file.originalname || '') || '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = file.originalname || '';
    if (/^image\//.test(file.mimetype) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(name)) cb(null, true);
    else cb(new ApiError(400, '仅支持图片文件（jpg/png/webp/gif/bmp/avif；HEIC 请先转 JPG）'));
  },
});

// ------- API -------
const api = express.Router();
api.use((req, res, next) => { req.db = db; next(); });

// 云配置（发布时生成；本地开发无此文件）
function readCloudConfig() {
  try {
    const cc = JSON.parse(fs.readFileSync(path.join(__dirname, 'cloud-config.json'), 'utf8'));
    if (cc.endpoint && cc.publishableKey) return { endpoint: cc.endpoint, publishableKey: cc.publishableKey };
  } catch { /* 无配置文件则视为本地模式 */ }
  return null;
}

// 请求是否来自云端公网域名（反向代理转发而来）
function isCloudHost(req, endpoint) {
  const raw = req.headers['x-forwarded-host'] || req.headers.host || '';
  const host = String(raw).split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
  if (!host) return false;
  let ep = '';
  try { ep = new URL(endpoint).hostname.toLowerCase(); } catch { return false; }
  return !!ep && host === ep;
}

api.get('/system/info', (req, res) => {
  const nets = os.networkInterfaces();
  const urls = [];
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) urls.push(`http://${n.address}:${cfg.load().port}`);
    }
  }
  // 云模式判定：存在 cloud-config.json，且（显式 TIDY_CLOUD=1 或当前请求域名与配置的 endpoint 同域）。
  // 加同域兜底是为了不依赖环境变量——重新发布时启动命令被重探会静默丢掉 TIDY_CLOUD，
  // 那样线上会无声退回本地单机模式（看不到登录页与实验室共享空间）。
  const cc = readCloudConfig();
  const cloud = (cc && (process.env.TIDY_CLOUD === '1' || isCloudHost(req, cc.endpoint))) ? cc : false;
  res.json({ ok: true, data: { port: cfg.load().port, lanUrls: urls, version: '0.9.0', engine: db.engine, cloud } });
});

api.use(require('./routes/items'));
api.use('/ai', require('./routes/ai'));
api.use('/search', require('./routes/search'));
api.use('/stats', require('./routes/stats'));
api.use('/settings', require('./routes/settings'));
const backupRouter = require('./routes/backup');
backupRouter._setRawExec((sql) => db.exec(sql));
api.use('/backup', backupRouter);
// 结构 CRUD 挂在根路径（/zones /cabinets /shelves /boxes），必须放在最后避免吞掉其他单段路由
api.use(require('./routes/structure'));

api.use((req, res) => res.status(404).json({ ok: false, error: '接口不存在: ' + req.path }));
app.use('/api', api);

// 全局错误中间件
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ ok: false, error: '上传失败：' + err.message });
  }
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ ok: false, error: err.message || '服务器内部错误' });
});

const PORT = Number(process.env.PORT ?? cfg.load().port ?? 5175);
const server = app.listen(PORT, '0.0.0.0', () => {
  // 打印"实际绑定端口"：PORT=0 时由系统分配空闲端口（测试用，杜绝端口碰撞串台）
  const actual = server.address().port;
  console.log(`TidyLab listening on http://localhost:${actual}`);
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`  手机访问: http://${n.address}:${actual}`);
    }
  }
  // 启动自动备份（F1）：当天无备份则静默备份一次
  require('./routes/backup').autoBackupOnce()
    .then((f) => { if (f) console.log('  已自动备份: ' + f); })
    .catch((e) => console.error('  自动备份失败:', e.message));
});
// 端口被占用等监听错误：打印明确标识（供测试识别）并退出，避免静默挂起
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') console.error(`EADDRINUSE 端口已被占用: ${PORT}`);
  else console.error('[listen error]', err);
  process.exit(1);
});

module.exports = { app, db };
