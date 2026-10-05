'use strict';

/**
 * Electron 冒烟自检入口（跨平台）。
 *
 * 为什么需要这个脚本：
 * 1. 某些宿主环境（含本仓库的开发终端）会预设 `ELECTRON_RUN_AS_NODE=1`，
 *    这会让 electron.exe 退化成纯 Node，跑出来的错误是
 *    `app.requestSingleInstanceLock is not a function`，具有很强误导性。
 * 2. 无 GPU 的机器上 Chromium GPU 进程会反复崩溃，需要走软件渲染
 *    （由主进程在 JS_PET_SMOKE 下自动 disableHardwareAcceleration）。
 *
 * 本脚本负责：清掉 ELECTRON_RUN_AS_NODE、注入 JS_PET_SMOKE=1、启动 electron 主进程、
 * 依据主进程打印的 SMOKE_OK / SMOKE_FAIL 决定退出码。
 */

const path = require('path');
const { spawnSync } = require('child_process');

const electronPath = require('electron');

const env = Object.assign({}, process.env, { JS_PET_SMOKE: '1' });
delete env.ELECTRON_RUN_AS_NODE;

const res = spawnSync(electronPath, ['.'], {
  cwd: path.resolve(__dirname, '..'),
  env,
  encoding: 'utf8',
});

if (res.error) {
  console.error('[smoke] 无法启动 Electron：' + res.error.message);
  console.error('[smoke] 若提示 EBUSY，说明当前环境限制了子进程创建；');
  console.error('[smoke] 可直接在终端执行：');
  console.error('       ' + electronPath + ' .');
  process.exit(1);
}

const out = (res.stdout || '') + (res.stderr || '');
process.stdout.write(out);

if (out.includes('SMOKE_OK')) {
  process.exit(0);
}

if (!out.includes('SMOKE_FAIL')) {
  console.error('\n[smoke] 未捕获到 SMOKE_OK / SMOKE_FAIL，视为失败。');
}

process.exit(1);
