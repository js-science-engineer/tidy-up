const fs = require('fs'), path = require('path');
const { PNG } = require('pngjs');
const DIR = 'C:/Users/Lenovo/Desktop/tidy-up/pet-assets';
const FILES = ['pet_front.png','pet_sideA.png','pet_back.png','pet_sideB.png','pet_wave.png','pet_sleep.png'];
const W = 720, H = 900;

function load(n){ const p = PNG.sync.read(fs.readFileSync(path.join(DIR, n))); return { name:n, w:p.width, h:p.height, d:p.data }; }

// 背景 = 低饱和灰白（棋盘格）或近黑（边条）
function isBg(d, i){
  const r=d[i], g=d[i+1], b=d[i+2];
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
  const sat = mx ? (mx-mn)/mx : 0, lum = mx/255;
  return (mx-mn < 26 && lum > 0.55) || (mx-mn < 30 && lum < 0.10);
}
function cutout(img){
  const {w,h,d}=img; const vis=new Uint8Array(w*h); const st=[];
  const push=(x,y)=>{ const k=y*w+x; if(!vis[k]){ vis[k]=1; if(isBg(d,k*4)) st.push(k); } };
  for(let x=0;x<w;x++){ push(x,0); push(x,h-1); }
  for(let y=0;y<h;y++){ push(0,y); push(w-1,y); }
  while(st.length){
    const k=st.pop(); const x=k%w, y=(k/w)|0; d[k*4+3]=0;
    if(x>0)push(x-1,y); if(x<w-1)push(x+1,y); if(y>0)push(x,y-1); if(y<h-1)push(x,y+1);
  }
}
// 只对透明边界做 3x3 alpha 均值羽化
function feather(img){
  const {w,h,d}=img; const a=new Float32Array(w*h);
  for(let i=0;i<w*h;i++) a[i]=d[i*4+3];
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const k=y*w+x; if(a[k]===0 || a[k]>=254) continue;
    let edge=false;
    for(let dy=-1;dy<=1&&!edge;dy++)for(let dx=-1;dx<=1;dx++){ if(a[k+dy*w+dx]===0){ edge=true; break; } }
    if(!edge) continue;
    let s=0; for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) s+=a[k+dy*w+dx];
    d[k*4+3]=Math.round(s/9);
  }
}
function bbox(img){
  const {w,h,d}=img; let x0=w,y0=h,x1=-1,y1=-1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    if(d[(y*w+x)*4+3]>12){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
  }
  return { x0,y0,x1,y1, w:x1-x0+1, h:y1-y0+1 };
}
function transRatio(img){ const {w,h,d}=img; let c=0; for(let i=0;i<w*h;i++) if(d[i*4+3]===0) c++; return c/(w*h); }
function resample(img, bb, t){
  const {w,h,d}=img; const scale=t.h/bb.h;
  const out=new PNG({width:W,height:H}); const od=out.data;
  const cx=(bb.x0+bb.x1+1)/2, by=bb.y1+1;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const sx=(x-t.cx)/scale+cx, sy=(y-t.by)/scale+by;
    if(sx<0||sy<0||sx>=w-1||sy>=h-1) continue;
    const x0=Math.floor(sx), y0=Math.floor(sy), fx=sx-x0, fy=sy-y0;
    const i00=(y0*w+x0)*4, i10=i00+4, i01=i00+w*4, i11=i01+4, o=(y*W+x)*4;
    for(let c=0;c<4;c++){
      od[o+c]=Math.round(d[i00+c]*(1-fx)*(1-fy)+d[i10+c]*fx*(1-fy)+d[i01+c]*(1-fx)*fy+d[i11+c]*fx*fy);
    }
  }
  return out;
}

const mode = process.argv[2] || 'audit';
const imgs = FILES.map(load);
console.log('文件               透明占比   包围盒(x0,y0)-(x1,y1)   尺寸');
for (const im of imgs){
  const bb = bbox(im), tr = transRatio(im);
  console.log(im.name.padEnd(16), (tr*100).toFixed(1).padStart(6)+'%',
    `(${String(bb.x0).padStart(3)},${String(bb.y0).padStart(3)})-(${String(bb.x1).padStart(3)},${String(bb.y1).padStart(3)})`,
    `${bb.w}x${bb.h}`);
}

if (mode === 'fix'){
  const fbb = bbox(imgs[0]);
  const target = { h:fbb.h, by:fbb.y1+1, cx:W/2 };
  console.log('\n基准(pet_front): 角色高=%d 底部y=%d 中心x=%d', target.h, target.by, target.cx);
  for (const im of imgs){
    if (transRatio(im) < 0.05){ cutout(im); feather(im); console.log('  已抠图:', im.name); }
    const bb = bbox(im);
    const need = Math.abs(bb.h-target.h)>2 || Math.abs((bb.y1+1)-target.by)>2 || Math.abs((bb.x0+bb.x1+1)/2-target.cx)>2;
    if (need){
      fs.writeFileSync(path.join(DIR, im.name), PNG.sync.write(resample(im, bb, target)));
      const nb = bbox(load(im.name));
      console.log('  已归一化:', im.name, '→', `${nb.w}x${nb.h} 底部=${nb.y1+1} 中心=${(nb.x0+nb.x1+1)/2}`);
    } else {
      console.log('  无需改动:', im.name);
    }
  }
}
