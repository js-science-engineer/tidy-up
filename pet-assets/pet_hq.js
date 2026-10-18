const { PNG } = require('pngjs');
const fs = require('fs'), path = require('path');
const DIR = 'C:/Users/Lenovo/Desktop/tidy-up/pet-assets';
const FILES = ['pet_front.png','pet_sideA.png','pet_back.png','pet_sideB.png','pet_wave.png','pet_sleep.png'];

const load = n => { const p = PNG.sync.read(fs.readFileSync(path.join(DIR, n))); return { name:n, w:p.width, h:p.height, d:p.data }; };

/* 1) 边缘去杂色（color decontamination）
   抠图后的半透明边缘像素，RGB 往往还是"角色×棋盘格"的混合色，在深色背景上就成了一圈灰白脏边。
   做法：从实心像素出发做 BFS，用最近的实心颜色覆盖这些半透明像素的 RGB（只改 RGB，不动 alpha）。 */
function decontaminate(img){
  const { w, h, d } = img, n = w*h;
  const done = new Uint8Array(n), q = [];
  for (let i = 0; i < n; i++) if (d[i*4+3] >= 250){ done[i] = 1; q.push(i); }
  let head = 0;
  while (head < q.length){
    const i = q[head++], x = i % w, y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy*w + xx;
      if (done[j]) continue;
      const a = d[j*4+3];
      if (a === 0) continue;               // 完全透明区域不扩散（避免无谓膨胀）
      d[j*4] = d[i*4]; d[j*4+1] = d[i*4+1]; d[j*4+2] = d[i*4+2];
      done[j] = 1; q.push(j);
    }
  }
}

/* 2) unsharp 锐化（只在实心区域；模糊只统计不透明邻居，避免把透明区颜色带进来产生白边） */
function unsharp(img, amount, thresh){
  const { w, h, d } = img;
  const src = Buffer.from(d);
  const K = [1,2,1, 2,4,2, 1,2,1];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = y*w + x;
    const a = src[i*4+3];
    if (a < 210) continue;
    for (let c = 0; c < 3; c++){
      let s = 0, ks = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy*w + xx;
        if (src[j*4+3] === 0) continue;
        const k = K[(dy+1)*3 + (dx+1)];
        s += src[j*4+c] * k; ks += k;
      }
      const b = ks ? s/ks : src[i*4+c];
      const diff = src[i*4+c] - b;
      if (Math.abs(diff) < (thresh || 0)) continue;
      d[i*4+c] = Math.max(0, Math.min(255, Math.round(src[i*4+c] + amount*diff)));
    }
  }
}

/* 3) 轻微提饱和（让黄色更"实"，观感更立体） */
function saturate(img, k){
  const { w, h, d } = img;
  for (let i = 0; i < w*h; i++){
    if (d[i*4+3] < 210) continue;
    const r = d[i*4], g = d[i*4+1], b = d[i*4+2];
    const l = 0.299*r + 0.587*g + 0.114*b;
    d[i*4]   = Math.max(0, Math.min(255, Math.round(l + (r-l)*k)));
    d[i*4+1] = Math.max(0, Math.min(255, Math.round(l + (g-l)*k)));
    d[i*4+2] = Math.max(0, Math.min(255, Math.round(l + (b-l)*k)));
  }
}

/* 4) 亮部/暗部微对比（S 曲线，幅度很小） */
function contrast(img, k){
  const { w, h, d } = img;
  for (let i = 0; i < w*h; i++){
    if (d[i*4+3] < 210) continue;
    for (let c = 0; c < 3; c++){
      const v = d[i*4+c]/255;
      const s = v + k * (v - 0.5) * (1 - Math.abs(v - 0.5) * 2 * 0.35);
      d[i*4+c] = Math.max(0, Math.min(255, Math.round(s*255)));
    }
  }
}

let total = 0, totalBefore = 0;
for (const n of FILES){
  const before = fs.statSync(path.join(DIR, n)).size;
  const img = load(n);
  decontaminate(img);
  unsharp(img, 0.42, 3);
  saturate(img, 1.06);
  contrast(img, 0.16);
  const buf = PNG.sync.write({ width: img.w, height: img.h, data: img.d });
  fs.writeFileSync(path.join(DIR, n), buf);
  total += buf.length; totalBefore += before;
  console.log(n.padEnd(16), (before/1024).toFixed(0).padStart(4)+'KB →', (buf.length/1024).toFixed(0).padStart(4)+'KB');
}
console.log('合计', (totalBefore/1024/1024).toFixed(2)+'MB →', (total/1024/1024).toFixed(2)+'MB');
