// 电子宠物（TidyLab）—— 由 pet-demo-v3.html 移植而来
//
// 与主站的关系：完全独立于 Vue，自己管理 DOM 与动画（大量 rAF / pointer 事件，
// 放进 Vue 组件反而别扭）。样式见 /css/pet.css，形象素材与图像库见 /pet-assets/。
// 接入方式：app.js 在 mount('#app') 之后调用 PetWidget.mount()，宠物即"蹦"到右下角。
//
// 保留下来的全部功能：
//   · 多只共存 / 复制 / 删除（至少保留一只）/ 隐藏与一键恢复
//   · 移动即拖的跟手拖拽（倾斜甩动 + 离地光影 + 弹性落地）
//   · 空闲时视线追踪鼠标
//   · 右键菜单：当前状态 + 12 种状态、大小（可填满屏幕）、复位、隐藏、复制、删除
//   · 自定义形象（一张形象图智能分析切分三视图 + 描述词，缺一不可）/ 恢复默认图像
(function () {
  // 宠物相关的 DOM：由本模块注入 body 末尾，主站 index.html 保持干净
  var HTML = [
    '<div class="pet-layer" id="petLayer"></div>',
    '<button class="ghost-bar" id="ghostBar" hidden></button>',
    '<div class="pet-menu" id="petMenu" hidden>',
    '  <div class="pm-head">',
    '    <span class="pm-title" id="pmTitle">宠物 #1</span>',
    '    <span class="pm-state" id="pmState">待机</span>',
    '  </div>',
    '  <div class="pm-sep"></div>',
    '  <div class="pm-label"><span>切换状态</span><span>点一下立刻表演</span></div>',
    '  <div class="pm-grid" id="pmStates"></div>',
    '  <div class="pm-sep"></div>',
    '  <div class="pm-label"><span>大小</span><span id="pmSizeV">150px</span></div>',
    '  <input type="range" class="pm-range" id="pmSize" min="100" max="900" value="150">',
    '  <button class="pm-btn" id="pmFill">⛶ 填满整个屏幕</button>',
    '  <div class="pm-sep"></div>',
    '  <div class="pm-label"><span>形象</span><span id="pmLookName">默认形象</span></div>',
    '  <button class="pm-btn" id="pmLook">🎨 更换形象（上传一张形象图 + 描述词）</button>',
    '  <button class="pm-btn" id="pmLookReset">↺ 恢复默认图像</button>',
    '  <div class="pm-sep"></div>',
    '  <button class="pm-btn" id="pmReset">⌂ 复位到右下角</button>',
    '  <button class="pm-btn" id="pmHide">🙈 隐藏这只宠物</button>',
    '  <button class="pm-btn" id="pmCopy">⧉ 复制这只宠物</button>',
    '  <button class="pm-btn danger" id="pmDel">🗑 删除这只宠物</button>',
    '</div>',
    '<div class="look-modal" id="lookModal" hidden>',
    '  <div class="lm-backdrop" id="lmBackdrop"></div>',
    '  <div class="lm-card" role="dialog" aria-label="自定义电子宠物形象">',
    '    <div class="lm-head">',
    '      <span class="lm-title">🎨 自定义电子宠物形象</span>',
    '      <button class="lm-x" id="lmClose" title="关闭">✕</button>',
    '    </div>',
    '    <div class="lm-hint">',
    '      更换形象只需 <b>一张形象图</b> + <b>一段形象描述词</b>，<b>两项缺一不可</b>。<br>',
    '      形象图里若含多个视角（正面 / 侧面 / 背面，并排或上下排布均可），系统会<b>自动识别并切分</b>，再按内置素材的基准对齐（同一缩放比例、角色高 860px、脚底贴齐、水平居中），用于 3D 转身贴图；描述词随形象一起保存与导出，供日后 AI 复刻或团队共享时对齐。',
    '    </div>',
    '    <div class="lm-scroll">',
    '      <div class="lm-sect">',
    '        <div class="lm-sect-h"><b>1 · 形象图（只需上传一张）</b><span class="lm-tag req" id="lmViewTag">必需 1 张</span>',
    '          <span class="lm-note">',
    '            上传<b>一张</b>角色图就行：图里<b>并排或上下排布多个视角</b>时，系统会自动识别视角数量、切成 <b>正面 / 侧面 / 背面</b> 并按<b>同一比例</b>对齐（默认按位置 左→右 / 上→下 = 正面、侧面、背面，判断不准可点「⇄ 换视角」纠正）。<br>',
    '            只上传单视角也可以：缺失的视角会用镜像近似补全。支持点击选择 / 直接拖入 / 复制图片后在面板内 Ctrl+V 粘贴；透明底、纯色底、棋盘格底都能自动处理。',
    '          </span>',
    '        </div>',
    '        <div class="lm-drop" id="lmDrop">',
    '          <input type="file" id="lmFile" accept="image/*" hidden>',
    '          <div class="lm-drop-ph" id="lmDropPh">',
    '            <span class="lm-drop-ico">🖼️</span>',
    '            <b>点击选择 / 拖到这里 / Ctrl+V 粘贴</b>',
    '            <small>推荐：一张横向排开的三视图（左→右 = 正面、侧面、背面）</small>',
    '          </div>',
    '          <div class="lm-drop-info" id="lmDropInfo" hidden></div>',
    '          <img class="lm-drop-src" id="lmDropSrc" alt="" hidden>',
    '        </div>',
    '        <div class="lm-split" id="lmSplit" hidden></div>',
    '      </div>',
    '      <div class="lm-sect">',
    '        <details class="lm-more">',
    '          <summary>＋ 补充其它视角与姿势（可选，提高还原度）</summary>',
    '          <div class="lm-sect-h sm"><b>可选素材</b>',
    '            <span class="lm-note">不提供时：另一侧面自动镜像生成；招手 / 打盹用正视图合成（动作会简化）</span>',
    '          </div>',
    '          <div class="lm-slots" id="lmSlotsOpt"></div>',
    '        </details>',
    '      </div>',
    '      <div class="lm-sect">',
    '        <div class="lm-sect-h"><b>2 · 形象描述词</b><span class="lm-tag req" id="lmDescTag">必需</span></div>',
    '        <label class="lm-field"><span>角色名称 *</span>',
    '          <input id="lmName" maxlength="24" placeholder="例：奶龙">',
    '        </label>',
    '        <label class="lm-field"><span>外观描述词 *（至少 10 个字）</span>',
    '          <textarea id="lmDesc" rows="3" placeholder="例：胖乎乎水滴状淡黄色哑光软胶身体，大圆眼、平直微笑线、短手短腿，头顶一对小圆角"></textarea>',
    '        </label>',
    '        <div class="lm-chips" id="lmChips"></div>',
    '        <div class="lm-count" id="lmCount">0 / 至少 10 字</div>',
    '        <details class="lm-more">',
    '          <summary>＋ 为每张视图补充朝向 / 差异说明（可选，导出形象包时会一并带上）</summary>',
    '          <label class="lm-field"><span>正面视图说明</span><input id="lmDescFront" maxlength="60" placeholder="例：朝前，眼睛居中，微笑线平直"></label>',
    '          <label class="lm-field"><span>侧面视图说明</span><input id="lmDescSide" maxlength="60" placeholder="例：身体朝画面右侧，可见单眼与侧腹弧线"></label>',
    '          <label class="lm-field"><span>背面视图说明</span><input id="lmDescBack" maxlength="60" placeholder="例：完全看不到五官，背部圆润无花纹"></label>',
    '        </details>',
    '      </div>',
    '      <div class="lm-sect">',
    '        <div class="lm-sect-h"><b>3 · 处理选项</b></div>',
    '        <label class="lm-check"><input type="checkbox" id="lmKey" checked> 自动去除背景（白底 / 棋盘格 / 纯色底）</label>',
    '        <label class="lm-check"><input type="checkbox" id="lmNorm" checked> 自动对齐各视角（同一缩放比例 + 脚底基准，避免切换形象忽大忽小）</label>',
    '      </div>',
    '    </div>',
    '    <div class="lm-checklist" id="lmCheck"></div>',
    '    <div class="lm-foot">',
    '      <button class="pm-btn" id="lmDefault">↺ 恢复默认形象</button>',
    '      <button class="pm-btn" id="lmExport">⤓ 导出形象包</button>',
    '      <button class="pm-btn" id="lmImport">⤒ 导入形象包</button>',
    '      <input type="file" id="lmPack" accept="application/json,.json" hidden>',
    '      <span class="lm-spacer"></span>',
    '      <button class="pm-btn" id="lmCancel">取消</button>',
    '      <button class="pm-btn primary" id="lmApply" disabled>✓ 应用形象</button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');

  var booted = false;

  /** 挂载电子宠物（幂等）。由 app.js 在 Vue 挂载完成后调用。 */
  function mount() {
    if (booted) return;
    booted = true;
    document.body.insertAdjacentHTML('beforeend', HTML);
    boot();
  }

  window.PetWidget = { mount: mount };

  function boot() {
  const layer = document.getElementById('petLayer');
  const menu  = document.getElementById('petMenu');
  const ghostBar = document.getElementById('ghostBar');
  const pmStates = document.getElementById('pmStates');
  const pmTitle  = document.getElementById('pmTitle');
  const pmState  = document.getElementById('pmState');
  const pmSize   = document.getElementById('pmSize');
  const pmSizeV  = document.getElementById('pmSizeV');
  const pmDel    = document.getElementById('pmDel');
  const pmLook   = document.getElementById('pmLook');
  const pmLookReset = document.getElementById('pmLookReset');
  const pmLookName = document.getElementById('pmLookName');

  const RATIO = 900 / 720;
  const LONG_PRESS = 140;      // 按住不动进入"预备拖"的等待；直接移动超过 4px 则立即开拖
  const EDGE_R = 22, EDGE_B = 16;
  const TURN_MS = 4200;        // 转身总时长（更慢）
  const EDGE = 60, FADE = 30;  // 贴图可见窗 ±60°（相邻窗重叠，交界处两面各半，永不黑屏）

  const ACTS = ['wave','excited','dance','jump','walk','look','turn','wiggle','surprise','nod'];
  const STATES = [
    ['idle','💤','待机'], ['wave','👋','打招呼'], ['excited','🙌','兴奋蹦跳'],
    ['dance','💃','摇摆舞'], ['jump','🦘','大跳'], ['walk','🚶','散步'],
    ['look','👀','3D 张望'], ['turn','🔄','3D 转身'], ['wiggle','🍑','3D 扭一扭'],
    ['surprise','😲','惊讶'], ['nod','🙇','点头'], ['sleep','😴','打盹'],
  ];
  const NAME = {}; STATES.forEach(s => NAME[s[0]] = s[2]);
  const SAY = {
    wave:['嗨～今天也要好好收纳哦','你好呀！','发现啦！有物品没归位~'],
    excited:['哇！！好多物品入库啦','太棒了吧！','嘿嘿嘿——'],
    dance:['动次打次～','跟着节奏摇起来','舞力全开！'],
    jump:['跳！','接住我！','蹦蹦跳跳~'],
    walk:['溜达溜达','去哪个柜子看看呢','散步有助于消化'],
    look:['咦？那边有什么','让我康康','左右看看~'],
    turn:['转一圈给你看！','咕噜咕噜~','我的背面也很圆哦'],
    wiggle:['扭扭更健康','圆滚滚的骄傲','摇摆摇摆~'],
    surprise:['哇！！吓我一跳','什么情况！','瞪大眼睛ing'],
    nod:['嗯嗯，说得对','收到收到','没错没错！'],
    sleep:['Zzz…（先眯一会）','好困呀…','梦里也在收纳…'],
    idle:['我先歇会儿','待机中…','有事叫我哦'],
    drag:['抓到我啦～随便放','放哪儿都行哦','我要搬家咯'],
    drop:['就住这儿啦！','这位置不错','安家完毕～'],
    hello:['我来啦！','新伙伴报到！','嗨，我是复制品~'],
    last:['我是最后一只啦，不能删哦','删掉我就没人陪你啦！']
  };

  /* ---------- 形象（内置默认 / 用户自定义） ---------- */
  // 形象存储键按用户隔离（本地模式 TIDY_UID='local'；云端模式为登录用户 id），换账号不串形象
  const LOOK_KEY = () => 'tidy-pet-look:' + (window.TIDY_UID || 'local');
  const DEFAULT_SRCS = {
    front:'/pet-assets/pet_front.png', side:'/pet-assets/pet_sideA.png',
    back:'/pet-assets/pet_back.png',  side2:'/pet-assets/pet_sideB.png',
    wave:'/pet-assets/pet_wave.png',  sleep:'/pet-assets/pet_sleep.png'
  };
  let currentLook = null;            // null = 内置默认形象

  function lookSrcs(){
    const L = currentLook;
    if (!L) return DEFAULT_SRCS;
    return {
      front: L.views.front, side: L.views.side, back: L.views.back,
      side2: L.views.side2 || L.views.side,
      wave:  L.views.wave  || L.views.front,
      sleep: L.views.sleep || L.views.front
    };
  }
  function tpl(){
    const s = lookSrcs();
    return `
    <div class="bubble"></div>
    <div class="pet-3d">
      <div class="pet-cyl">
        <img class="face s1 cur" src="${s.front}" draggable="false" alt="">
        <img class="face s2" src="${s.side}" draggable="false" alt="">
        <img class="face s3" src="${s.back}"  draggable="false" alt="">
        <img class="face s4" src="${s.side2}" draggable="false" alt="">
      </div>
    </div>
    <img class="pose-flat pose-wave"  src="${s.wave}"  draggable="false" alt="">
    <img class="pose-flat pose-sleep" src="${s.sleep}" draggable="false" alt="">
    <div class="zzz"><span>Z</span><span>z</span><span>z</span></div>
    <div class="pet-shadow"></div>
    <div class="pet-glow"></div>`;
  }
  function applyLookToAll(){
    const s = lookSrcs();
    pets.forEach(p => {
      const put = (sel, src) => {
        const im = p.el.querySelector(sel);
        if (im && im.getAttribute('src') !== src){ im.src = src; if (im.decode) im.decode().catch(() => {}); }
      };
      put('.face.s1', s.front); put('.face.s2', s.side);
      put('.face.s3', s.back);  put('.face.s4', s.side2);
      put('.pose-wave', s.wave); put('.pose-sleep', s.sleep);
      p.el.classList.toggle('custom-look', !!currentLook);
    });
    updateLookName();
    refreshMenu();
  }
  function loadLook(){
    try {
      const raw = localStorage.getItem(LOOK_KEY());
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !o.views || !o.views.front || !o.views.side || !o.views.back) return null;
      return o;
    } catch(_){ return null; }
  }
  function saveLook(look){
    try { localStorage.setItem(LOOK_KEY(), JSON.stringify(look)); return true; }
    catch(_){ return false; }
  }
  async function setLook(look){
    currentLook = look;
    let saved = true;
    if (look) saved = saveLook(look);
    else { try { localStorage.removeItem(LOOK_KEY()); } catch(_){} }
    applyLookToAll();
    return saved;
  }
  function updateLookName(){
    const label = currentLook ? (currentLook.name || '自定义形象') : '默认形象';
    if (pmLookName) pmLookName.textContent = label;
  }

  const pets = [];
  let seq = 0;

  const rand  = a => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- 尺寸 / 位置 ---------- */
  function maxPetSize(){ return Math.max(120, Math.round(Math.min(innerWidth, innerHeight * 720 / 900))); }
  function cornerPos(size){
    const w = size, h = size * RATIO;
    return { x: Math.max(0, innerWidth - w - EDGE_R), y: Math.max(0, innerHeight - h - EDGE_B) };
  }
  function setPos(p, x, y){ p.x = x; p.y = y; p.el.style.left = x + 'px'; p.el.style.top = y + 'px'; }
  function setSize(p, size){ p.size = size; p.el.style.setProperty('--pet-size', size + 'px'); }
  function resetCorner(p){ const c = cornerPos(p.size); setPos(p, c.x, c.y); }

  /* ---------- 气泡 ---------- */
  function say(p, text){
    const b = p.el.querySelector('.bubble');
    b.textContent = text;
    b.classList.add('show');
    clearTimeout(p._sayT);
    p._sayT = setTimeout(() => b.classList.remove('show'), 2200);
  }

  /* ---------- 动作 ---------- */
  function clearAct(p){
    cancelAnimationFrame(p._turnRaf || 0);
    p.el.querySelectorAll('.face').forEach((f, i) => {
      f.style.cssText = '';
      f.classList.toggle('cur', i === 0);
    });
    p.cyl.style.transition = ''; p.cyl.style.transform = '';
    [...p.el.classList].forEach(c => { if (c.indexOf('acting-') === 0) p.el.classList.remove(c); });
  }
  function setIdle(p){
    clearAct(p);
    clearTimeout(p._actT);
    p.cur = '';
    refreshMenu();
  }

  /* 连续 3D 转身：rAF 逐帧插值，贴图环绕 + 轻微起伏/侧倾，全程无跳变 */
  function startTurn(p, dur){
    const faces = [...p.el.querySelectorAll('.face')];
    const cyl = p.el.querySelector('.pet-cyl');
    cyl.style.transition = 'none';
    const t0 = performance.now();
    const easeInOut = t => t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;
    function frame(now){
      const t = Math.min(1, (now - t0) / dur);
      const ang = easeInOut(t) * 360;
      for (let i = 0; i < 4; i++){
        const d = ((i * 90 - ang) % 360 + 540) % 360 - 180;   // 最短角差
        const ad = Math.abs(d);
        const f = faces[i];
        if (ad > EDGE + 1){ f.style.visibility = 'hidden'; continue; }
        f.style.visibility = 'visible';
        f.style.transform = 'rotateY(' + d.toFixed(2) + 'deg)';
        f.style.opacity = ad <= EDGE - FADE ? '1' : Math.max(0, (EDGE - ad) / FADE).toFixed(3);
      }
      cyl.style.transform = 'translateY(' + (-10 * Math.sin(Math.PI * t)).toFixed(2) + 'px)' +
                            ' rotateZ(' + (3 * Math.sin(2 * Math.PI * t)).toFixed(2) + 'deg)';
      if (t < 1) p._turnRaf = requestAnimationFrame(frame);
      else {
        faces.forEach((f, i) => { f.style.cssText = ''; f.classList.toggle('cur', i === 0); });
        cyl.style.transition = ''; cyl.style.transform = '';
      }
    }
    p._turnRaf = requestAnimationFrame(frame);
  }

  function play(p, name, silent){
    if (name === 'idle'){ setIdle(p); if (!silent) say(p, rand(SAY.idle)); return; }
    clearAct(p);
    void p.el.offsetWidth;
    p.cur = name;
    p.el.classList.add('acting-' + name);
    if (!silent) say(p, rand(SAY[name] || ['嘿嘿']));
    clearTimeout(p._actT);
    if (name === 'turn'){
      startTurn(p, TURN_MS);
      p._actT = setTimeout(() => {
        if (p.cur === 'turn'){ clearAct(p); p.cur = ''; refreshMenu(); }
      }, TURN_MS + 150);
    } else {
      const dur = name === 'sleep' ? 6500
                : (name === 'dance' || name === 'wave') ? 4600 : 3200;
      p._actT = setTimeout(() => {
        if (p.cur === name){
          clearAct(p); p.cur = '';
          if (name === 'sleep') say(p, '睡饱啦！');
          refreshMenu();
        }
      }, dur);
    }
    refreshMenu();
  }
  function schedule(p){
    clearTimeout(p._schedT);
    p._schedT = setTimeout(() => {
      if (!p.hidden && !p.cur) play(p, rand(Math.random() < .14 ? ['sleep'] : ACTS), Math.random() < .4);
      schedule(p);
    }, 3800 + Math.random() * 4600);
  }

  /* ---------- 创建 / 复制 / 删除 / 隐藏 ---------- */
  function createPet(opt){
    opt = opt || {};
    const el = document.createElement('div');
    el.className = 'pet-stage' + (currentLook ? ' custom-look' : '');
    el.innerHTML = tpl();
    const size = opt.size || 150;
    el.style.setProperty('--pet-size', size + 'px');
    layer.appendChild(el);

    const p = { id: ++seq, el, cyl: el.querySelector('.pet-cyl'), size: size, cur: '', x: 0, y: 0, hidden: false, tr: { x: 0, z: 0 } };
    const pos = opt.pos || cornerPos(size);
    setPos(p, pos.x, pos.y);
    pets.push(p);

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('contextmenu', onCtx);
    el.querySelectorAll('img').forEach(im => {
      im.addEventListener('dragstart', e => e.preventDefault());
      if (im.decode) im.decode().catch(() => {});   // 预解码，避免首次显示卡顿
    });

    el.classList.add('spawn');
    const killSpawn = () => el.classList.remove('spawn');
    el.addEventListener('animationend', function h(e){
      if (e.animationName === 'petSpawn'){ killSpawn(); el.removeEventListener('animationend', h); }
    });
    setTimeout(killSpawn, 460);   // 兜底：动画被系统节流时 animationend 不触发，别把宠物锁在缩小态

    if (opt.say) setTimeout(() => say(p, rand(opt.say)), 120);
    schedule(p);
    return p;
  }
  function copyPet(src){
    /* 复制体必须完整落在视口内：源宠物贴近右/下边缘（默认就在右下角）时往回收，
       否则新宠物会大部分移出屏幕，看起来像"复制之后没有图像" */
    const w = src.size, h = src.size * RATIO;
    const pos = {
      x: clamp(src.x + 34, 8, Math.max(8, innerWidth  - w - 8)),
      y: clamp(src.y + 34, 8, Math.max(8, innerHeight - h - 8))
    };
    const p = createPet({ size: src.size, pos: pos, say: SAY.hello });
    setPos(p, pos.x, pos.y);
    return p;
  }
  function removePet(p){
    if (pets.length <= 1){ say(p, rand(SAY.last)); return; }   // 保护：至少保留一只
    clearTimeout(p._actT); clearTimeout(p._schedT); clearTimeout(p._sayT);
    cancelAnimationFrame(p._turnRaf || 0);
    p.el.style.transition = 'opacity .18s, transform .18s';
    p.el.style.opacity = '0';
    p.el.style.transform = 'scale(.7)';
    setTimeout(() => p.el.remove(), 180);
    const i = pets.indexOf(p);
    if (i >= 0) pets.splice(i, 1);
    if (menuPet === p) hideMenu();
  }
  function hidePet(p){
    setIdle(p);
    clearTimeout(p._schedT);
    p.hidden = true;
    p.el.classList.add('ghost');
    updateGhostBar();
    hideMenu();
  }
  function unhideAll(){
    pets.forEach(p => {
      if (p.hidden){ p.hidden = false; p.el.classList.remove('ghost'); schedule(p); }
    });
    updateGhostBar();
  }
  function updateGhostBar(){
    const n = pets.filter(p => p.hidden).length;
    ghostBar.hidden = n === 0;
    if (n) ghostBar.textContent = '🐾 有 ' + n + ' 只宠物隐藏中 · 点击恢复';
  }
  const petOf = el => pets.find(p => p.el === el);

  /* ---------- 拖拽（移动即拖 / 长按预备均可；带倾斜、离地光影、弹性落地） ---------- */
  let drag = null;
  function onDown(e){
    if (e.button !== 0) return;
    const p = petOf(e.currentTarget);
    if (!p) return;
    e.preventDefault();
    drag = {
      p, pid: e.pointerId,
      sx: e.clientX, sy: e.clientY,
      ox: p.el.offsetLeft, oy: p.el.offsetTop,
      active: false, moved: false,
      lx: e.clientX, vx: 0
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch(_){}
    p.el.classList.add('pressing');
    drag.timer = setTimeout(() => { if (drag && drag.p === p) beginDrag(); }, LONG_PRESS);
  }
  function beginDrag(){
    if (!drag || drag.active) return;
    drag.active = true;
    const p = drag.p;
    p.dragging = true;
    setIdle(p);
    p.el.style.setProperty('--drag-tilt', '0deg');
    p.el.classList.remove('pressing');
    p.el.classList.add('dragging');
    say(p, rand(SAY.drag));
  }
  function onMove(e){
    if (!drag || drag.pid !== e.pointerId) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.active){
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4){ clearTimeout(drag.timer); beginDrag(); }  // 移动即拖
      else return;
    }
    drag.moved = true;
    const p = drag.p, w = p.size, h = p.size * RATIO;
    setPos(p,
      clamp(drag.ox + dx, -w * .85, innerWidth  - w * .15),
      clamp(drag.oy + dy, -h * .5,  innerHeight - h * .2));
    // 速度→倾斜（甩动感）
    drag.vx = drag.vx * .72 + (e.clientX - drag.lx) * .28;
    p.el.style.setProperty('--drag-tilt', clamp(drag.vx * .5, -7, 7).toFixed(1) + 'deg');
    drag.lx = e.clientX;
  }
  function onUp(e){
    if (!drag || drag.pid !== e.pointerId) return;
    clearTimeout(drag.timer);
    const p = drag.p, was = drag.active, moved = drag.moved;
    p.dragging = false;
    p.el.classList.remove('dragging', 'pressing');
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch(_){}
    if (was){
      p.el.classList.add('settle');                                  // 弹性落地
      setTimeout(() => p.el.classList.remove('settle'), 420);
      if (moved) say(p, rand(SAY.drop));
    } else if (!moved){
      play(p, rand(ACTS));                                           // 单击 → 逗它玩
    }
    drag = null;
  }

  /* ---------- 视线追踪：空闲时宠物会"看"着鼠标（转头 + 微移），动作/拖动时自动让位 ---------- */
  const pointer = { x: 0, y: 0, has: false, last: 0 };
  let trackRaf = 0;
  window.addEventListener('pointermove', e => {
    pointer.x = e.clientX; pointer.y = e.clientY;
    pointer.has = true; pointer.last = performance.now();
    if (!trackRaf) trackRaf = requestAnimationFrame(trackStep);
  }, { passive: true });
  function trackStep(now){
    let active = false;
    const idle = now - pointer.last >= 1600;   // 鼠标静止较久 → 目标回正（否则保持注视）
    for (const p of pets){
      if (p.hidden) continue;
      const can = !p.cur && !p.dragging;
      let tx = 0;
      if (can && pointer.has && !idle){
        const dx = (pointer.x - (p.x + p.size / 2)) / (innerWidth * .42);
        tx = Math.abs(dx) < .06 ? 0 : clamp(dx, -1, 1);
      }
      const nx = p.tr.x + (tx - p.tr.x) * .09;
      const nz = p.tr.z + (tx * 20 - p.tr.z) * .09;
      if (Math.abs(nx - p.tr.x) > .0004 || Math.abs(nz - p.tr.z) > .004) active = true;
      p.tr.x = nx; p.tr.z = nz;
      if (can){
        if (Math.abs(nz) > .3){   // 有可感知朝向 → 应用并保持（收敛也不清，持续注视）
          p.cyl.style.transition = 'none';
          p.cyl.style.transform = 'rotateY(' + nz.toFixed(2) + 'deg) translateX(' + (nx * 7).toFixed(2) + 'px) rotateZ(' + (nx * 2.2).toFixed(2) + 'deg)';
        } else if (p.cyl.style.transform){
          p.cyl.style.transition = '';
          p.cyl.style.transform = '';
        }
      }
    }
    if (active) trackRaf = requestAnimationFrame(trackStep);
    else {
      trackRaf = 0;   // 收敛：已回正的清 inline；仍在注视的保留朝向
      pets.forEach(p => {
        if (p.cyl.style.transform && Math.abs(p.tr.z) < .3){
          p.cyl.style.transition = ''; p.cyl.style.transform = '';
        }
      });
    }
  }

  /* ---------- 右键菜单 ---------- */
  let menuPet = null;
  let lookResetArmed = false;   // 「恢复默认图像」二次确认
  let lookResetT = 0;
  const items = {};
  STATES.forEach(s => {
    const b = document.createElement('button');
    b.className = 'pm-item'; b.dataset.st = s[0];
    b.innerHTML = '<em>' + s[1] + '</em>' + s[2];
    b.addEventListener('click', () => { if (menuPet) play(menuPet, s[0]); });
    pmStates.appendChild(b);
    items[s[0]] = b;
  });

  function refreshMenu(){
    updateLookName();
    if (menu.hidden || !menuPet) return;
    const curName = menuPet.cur || 'idle';
    pmState.textContent = NAME[curName] || '待机';
    Object.keys(items).forEach(k => items[k].classList.toggle('on', k === curName));
    const mx = maxPetSize();
    pmSize.max = mx;
    pmSize.value = Math.min(menuPet.size, mx);
    pmSizeV.textContent = menuPet.size + 'px' + (menuPet.size >= mx - 2 ? '（满屏）' : '');
    const last = pets.length <= 1;
    pmDel.classList.toggle('protected', last);
    pmDel.textContent = last ? '🗑 至少保留一只宠物' : '🗑 删除这只宠物';
    // 恢复默认图像：已是默认形象时置灰提示；否则第一次点击进入二次确认
    const isDefaultLook = !currentLook;
    pmLookReset.classList.toggle('protected', isDefaultLook);
    pmLookReset.classList.toggle('arm', !isDefaultLook && lookResetArmed);
    pmLookReset.textContent = isDefaultLook ? '↺ 当前已是默认图像'
      : (lookResetArmed ? '↺ 再点一次确认恢复默认' : '↺ 恢复默认图像');
  }
  function openMenu(p, x, y){
    menuPet = p;
    lookResetArmed = false; clearTimeout(lookResetT);
    pmTitle.textContent = '宠物 #' + p.id;
    menu.hidden = false;
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = clamp(x, 8, Math.max(8, innerWidth  - mw - 8)) + 'px';
    menu.style.top  = clamp(y, 8, Math.max(8, innerHeight - mh - 8)) + 'px';
    refreshMenu();
  }
  function hideMenu(){
    menu.hidden = true; menuPet = null;
    lookResetArmed = false; clearTimeout(lookResetT);
  }
  function onCtx(e){
    e.preventDefault();
    const p = petOf(e.currentTarget);
    if (p) openMenu(p, e.clientX, e.clientY);
  }

  pmSize.addEventListener('input', () => {
    if (!menuPet) return;
    setSize(menuPet, +pmSize.value);
    pmSizeV.textContent = menuPet.size + 'px' + (menuPet.size >= maxPetSize() - 2 ? '（满屏）' : '');
  });
  document.getElementById('pmFill').addEventListener('click', () => {
    if (!menuPet) return;
    const s = maxPetSize();
    setSize(menuPet, s);
    setPos(menuPet, Math.round((innerWidth - s) / 2), Math.round((innerHeight - s * RATIO) / 2));
    refreshMenu();
  });
  document.getElementById('pmReset').addEventListener('click', () => { if (menuPet) resetCorner(menuPet); hideMenu(); });
  document.getElementById('pmHide').addEventListener('click', () => { if (menuPet) hidePet(menuPet); });
  document.getElementById('pmCopy').addEventListener('click', () => { if (menuPet) copyPet(menuPet); hideMenu(); });
  pmDel.addEventListener('click', () => { if (menuPet) removePet(menuPet); });
  pmLook.addEventListener('click', openLook);

  /* 右键菜单 · 恢复默认图像（二次确认，避免误触丢掉自定义形象） */
  pmLookReset.addEventListener('click', async () => {
    if (!currentLook){
      if (menuPet) say(menuPet, '现在就是默认图像哦');
      return;
    }
    if (!lookResetArmed){
      lookResetArmed = true;
      refreshMenu();
      clearTimeout(lookResetT);
      lookResetT = setTimeout(() => { lookResetArmed = false; refreshMenu(); }, 4000);
      return;
    }
    clearTimeout(lookResetT);
    lookResetArmed = false;
    const p = menuPet || pets[0];
    await setLook(null);          // 清空自定义形象 + 移除本地存储 + 全体套回内置素材
    FILES = {};                   // 面板暂存一并清空
    if (!lookModal.hidden) closeLook();
    updateLookName();
    refreshMenu();
    if (p) say(p, '换回默认图像啦');
    console.log('[pet] 已恢复默认图像');
  });
  ghostBar.addEventListener('click', unhideAll);

  document.addEventListener('pointerdown', e => {
    if (menu.hidden || e.button === 2) return;
    if (!menu.contains(e.target)) hideMenu();
  }, true);
  window.addEventListener('scroll', hideMenu, true);
  window.addEventListener('resize', hideMenu);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape'){ if (!lookModal.hidden) closeLook(); else hideMenu(); }
  });

  /* =================== 自定义形象面板（一张形象图 + 描述词，缺一不可） =================== */
  const lookModal  = document.getElementById('lookModal');
  const lmSlotsOpt = document.getElementById('lmSlotsOpt');
  const lmDrop     = document.getElementById('lmDrop');
  const lmFile     = document.getElementById('lmFile');
  const lmDropPh   = document.getElementById('lmDropPh');
  const lmDropInfo = document.getElementById('lmDropInfo');
  const lmDropSrc  = document.getElementById('lmDropSrc');
  const lmSplit    = document.getElementById('lmSplit');
  const lmViewTag  = document.getElementById('lmViewTag');
  const lmName = document.getElementById('lmName');
  const lmDesc = document.getElementById('lmDesc');
  const lmCount = document.getElementById('lmCount');
  const lmKey  = document.getElementById('lmKey');
  const lmNorm = document.getElementById('lmNorm');
  const lmCheck = document.getElementById('lmCheck');
  const lmApply = document.getElementById('lmApply');
  const lmPack  = document.getElementById('lmPack');
  const lmDefault = document.getElementById('lmDefault');

  // 描述词快捷标签：点一下追加进描述框，帮用户快速拼出"对应描述词"
  const DESC_CHIPS = ['水滴形胖身体','淡黄色配色','哑光软胶质感','大圆眼','平直微笑线','短手短腿','头顶一对小圆角','全身无花纹','卡通 Q 版三头身','圆滚滚'];
  const lmChips = document.getElementById('lmChips');
  DESC_CHIPS.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'lm-chip'; b.textContent = '＋' + t;
    b.addEventListener('click', () => {
      const cur = lmDesc.value.trim();
      if (cur.indexOf(t) >= 0) return;
      lmDesc.value = cur ? cur.replace(/[，,]\s*$/, '') + '，' + t : t;
      updateChecklist();
    });
    lmChips.appendChild(b);
  });

  const SLOTS = [
    { key:'front', label:'正面视图', req:true,  hint:'朝向镜头' },
    { key:'side',  label:'侧面视图', req:true,  hint:'身体朝向一侧' },
    { key:'back',  label:'背面视图', req:true,  hint:'看不到五官' },
    { key:'side2', label:'另一侧面', req:false, hint:'不填则镜像侧面' },
    { key:'wave',  label:'打招呼姿势', req:false, hint:'不填则用正视图' },
    { key:'sleep', label:'打盹姿势', req:false, hint:'不填则用正视图' }
  ];
  const REQUIRED = ['front', 'side', 'back'];
  const OPTIONAL = ['side2', 'wave', 'sleep'];
  const ROLE_ORDER = ['front', 'side', 'back'];
  const ROLE_NAME = { front:'正面', side:'侧面', back:'背面' };
  const SLOT_ORDER = SLOTS.map(s => s.key);
  const nameOf = k => { const s = SLOTS.find(x => x.key === k); return s ? s.label : k; };

  let FILES = {};            // key -> { file|null, url, meta, keep }
  let ANALYSIS = null;       // 形象图智能分析结果 { items, roles, axis, count, cut, srcW, srcH, ratio }
  let srcFile = null;        // 最近上传的原图（切换处理选项时重新分析）
  let srcPreviewUrl = '';
  let pickSeq = 0;           // 每次成功处理自增，用于预览签名（换图必定触发预览）
  let lookBusy = false;      // 正在处理图片
  let panelErr = '';         // 面板级错误（如导入包缺字段）
  let lookAtOpen = null;     // 打开面板时的形象，取消时还原
  let confirmedDefault = false;
  const mirrorCache = {};

  function slotEl(k){ return lookModal.querySelector('.lm-slot[data-key="' + k + '"]'); }

  function buildSlots(){
    const mk = (host, list) => {
      host.innerHTML = '';
      list.forEach(s => {
        const el = document.createElement('div');
        el.className = 'lm-slot';
        el.dataset.key = s.key;
        el.innerHTML =
          '<div class="lm-thumb"><img alt=""><span class="lm-ph">＋</span>' +
          '<button class="lm-del" type="button" title="移除这张">✕</button></div>' +
          '<div class="lm-slot-name">' + s.label + (s.req ? ' <i>*</i>' : '') + '</div>' +
          '<div class="lm-slot-meta">' + s.hint + '</div>' +
          '<input type="file" accept="image/*" hidden>';
        const input = el.querySelector('input');
        input.addEventListener('change', () => {
          const f = input.files && input.files[0];
          input.value = '';
          if (f) pick(s.key, f);
        });
        el.addEventListener('click', e => {
          if (e.target.classList.contains('lm-del')){ e.stopPropagation(); clearSlot(s.key); return; }
          if (!lookBusy) input.click();
        });
        el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
        el.addEventListener('dragleave', () => el.classList.remove('over'));
        el.addEventListener('drop', e => {
          e.preventDefault(); el.classList.remove('over');
          const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (f) pick(s.key, f);
        });
        host.appendChild(el);
      });
    };
    mk(lmSlotsOpt, SLOTS.filter(s => !s.req));
  }

  function slotMeta(k, text, cls){
    const el = slotEl(k); if (!el) return;
    const m = el.querySelector('.lm-slot-meta');
    m.textContent = text;
    m.classList.toggle('ok', cls === 'ok');
  }
  function renderSlot(k, url, meta){
    const el = slotEl(k); if (!el) return;
    el.querySelector('img').src = url;
    el.classList.add('filled');
    el.classList.remove('bad');
    slotMeta(k, meta, 'ok');
  }
  function clearSlot(k, quiet){
    if (lookBusy) return;
    delete FILES[k];
    const el = slotEl(k); if (!el) return;
    el.classList.remove('filled', 'bad');
    el.querySelector('img').removeAttribute('src');
    const s = SLOTS.find(x => x.key === k);
    slotMeta(k, s ? s.hint : '', '');
    if (!quiet){
      updateChecklist();
      previewSig = '';
      if (!REQUIRED.every(x => FILES[x])){ currentLook = lookAtOpen; applyLookToAll(); }
      else previewLook();
    }
  }

  async function pick(key, file){
    if (lookBusy || !file) return;
    if (!/^image\//.test(file.type || '')){
      panelErr = '「' + nameOf(key) + '」不是图片文件';
      const el0 = slotEl(key);
      if (el0){ el0.classList.add('bad'); slotMeta(key, '不是图片文件，请选 PNG / JPG / WebP'); }
      updateChecklist();
      return;
    }
    panelErr = '';
    lookBusy = true;
    const el = slotEl(key);
    if (el){ el.classList.add('busy', 'bad'); slotMeta(key, '处理中…'); }
    updateChecklist();
    try {
      const r = await PetLook.prepare(file, { key: lmKey.checked, norm: lmNorm.checked });
      FILES[key] = { file:file, url:r.url, meta:r, seq: ++pickSeq };
      renderSlot(key, r.url, (r.cut ? '已抠背景 · ' : '') + r.srcW + '×' + r.srcH);
      if (el) el.classList.remove('bad');
    } catch(err){
      delete FILES[key];
      if (el){ el.classList.remove('filled'); el.querySelector('img').removeAttribute('src'); }
      panelErr = '「' + nameOf(key) + '」处理失败：' + ((err && err.message) || '未知错误');
    } finally {
      lookBusy = false;
      updateChecklist();
      previewLook();
    }
  }

  /* ---------- 形象图：一次上传 + 智能分析切分视角 ---------- */
  function revokeSrcPreview(){
    if (srcPreviewUrl){ URL.revokeObjectURL(srcPreviewUrl); srcPreviewUrl = ''; }
  }

  async function acceptImage(file){
    if (lookBusy || !file) return;
    if (!/^image\//.test(file.type || '')){
      panelErr = '选择的文件不是图片（请用 PNG / JPG / WebP）';
      lmDrop.classList.add('bad');
      updateChecklist();
      return;
    }
    panelErr = '';
    lmDrop.classList.remove('bad');
    srcFile = file;
    lookBusy = true;
    lmDrop.classList.add('busy');
    lmDropPh.hidden = true;
    lmDropInfo.hidden = false;
    lmDropInfo.innerHTML = '⏳ 正在智能分析：抠除背景 → 识别视角 → 切分对齐…';
    updateChecklist();
    try {
      const r = await PetLook.analyze(file, { key: lmKey.checked, norm: lmNorm.checked });
      ANALYSIS = {
        items: r.views, axis: r.axis, count: r.count, cut: r.cut,
        srcW: r.srcW, srcH: r.srcH, ratio: r.ratio,
        roles: { front: 0, side: r.count >= 2 ? 1 : null, back: r.count >= 3 ? 2 : null }
      };
      revokeSrcPreview();
      srcPreviewUrl = URL.createObjectURL(file);
      lmDropSrc.src = srcPreviewUrl;
      lmDropSrc.hidden = false;
      lmDropInfo.innerHTML =
        '✅ 原图 ' + r.srcW + '×' + r.srcH + (r.cut ? ' · 已自动抠除背景' : ' · 保留原透明背景') +
        '<br>检测到 <b class="ok">' + r.count + ' 个视角</b>' +
        (r.axis === 'x' ? '（横向排列）' : r.axis === 'y' ? '（纵向排列）' : '（单张图）') +
        ' → 已切分并按同一比例对齐' +
        (r.ratio > 1.12 ? '<br>⚠️ 各视角高矮相差 ' + r.ratio.toFixed(2) + ' 倍，已统一缩放比例（转身不会忽大忽小）' : '');
      await syncFilesFromAnalysis();
      renderSplit();
    } catch(err){
      ANALYSIS = null; srcFile = null;
      lmDrop.classList.add('bad');
      lmDropSrc.hidden = true;
      lmDropInfo.innerHTML = '⚠️ 分析失败：' + ((err && err.message) || '未知错误');
      renderSplit();
    } finally {
      lookBusy = false;
      lmDrop.classList.remove('busy');
      updateChecklist();
      previewLook();
    }
  }

  /* 把分析结果铺进 FILES：缺的视角用镜像近似补全 */
  async function syncFilesFromAnalysis(){
    if (!ANALYSIS){ FILES = {}; return; }
    const A = ANALYSIS;
    ROLE_ORDER.forEach(role => {
      const idx = A.roles[role];
      if (idx == null){ delete FILES[role]; return; }
      const it = A.items[idx];
      FILES[role] = { file:null, url:it.url, seq:++pickSeq, from:idx,
                      meta:{ cut:A.cut, empty:false, srcW:A.srcW, srcH:A.srcH,
                             charRatio: it.charH / PetLook.OUT_H } };
    });
    A.approx = [];
    if (!FILES.front) return;
    if (!FILES.side){
      FILES.side = { file:null, url: await mirrorOf(FILES.front.url), seq:++pickSeq, mirror:true,
                     meta:{ cut:ANALYSIS.cut, empty:false, charRatio:0 } };
      A.approx.push('side');
    }
    if (!FILES.back){
      FILES.back = { file:null, url: await mirrorOf(FILES.front.url), seq:++pickSeq, mirror:true,
                     meta:{ cut:ANALYSIS.cut, empty:false, charRatio:0 } };
      A.approx.push('back');
    }
  }

  function renderSplit(){
    lmSplit.innerHTML = '';
    if (!ANALYSIS){
      lmSplit.hidden = true;
      lmViewTag.textContent = '必需 1 张';
      lmViewTag.classList.add('req'); lmViewTag.classList.remove('ok');
      return;
    }
    lmSplit.hidden = false;
    lmViewTag.textContent = '已切分 ' + ANALYSIS.count + ' 个视角';
    lmViewTag.classList.remove('req'); lmViewTag.classList.add('ok');
    const n = ANALYSIS.items.length;
    ROLE_ORDER.forEach(role => {
      const idx = ANALYSIS.roles[role];
      const approx = (idx == null);
      const card = document.createElement('div');
      card.className = 'lm-scard' + (approx ? ' approx' : '');
      card.dataset.role = role;
      card.innerHTML =
        '<div class="lm-thumb"><img alt=""></div>' +
        '<div class="lm-slot-name">' + ROLE_NAME[role] + (approx ? '' : ' <i>*</i>') + '</div>' +
        '<div class="lm-slot-meta' + (approx ? '' : ' ok') + '">' +
          (approx ? '镜像近似（图中未检测到）' : '来自视角 #' + (idx + 1)) + '</div>';
      const im = card.querySelector('img');
      if (FILES[role]) im.src = FILES[role].url;
      if (n >= 2){
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'lm-swap'; b.textContent = '⇄ 换视角';
        b.addEventListener('click', e => { e.stopPropagation(); cycleRole(role); });
        card.appendChild(b);
      }
      lmSplit.appendChild(card);
    });
  }

  /* 「⇄ 换视角」：把这个角色换成图中另一个视角；
     若所有视角都被占用，则与占用者互换（保证正/侧/背始终一一对应、不重复） */
  async function cycleRole(role){
    if (!ANALYSIS || lookBusy) return;
    const n = ANALYSIS.items.length;
    if (n < 2) return;
    const holder = {};
    ROLE_ORDER.forEach(r => { if (r !== role && ANALYSIS.roles[r] != null) holder[ANALYSIS.roles[r]] = r; });
    const cur = ANALYSIS.roles[role];
    const start = (cur == null ? -1 : cur);
    for (let i = 1; i <= n; i++){
      const cand = ((start + i) % n + n) % n;
      if (cand === cur) continue;
      if (holder[cand] != null){
        if (cur == null) continue;               // 自己当前是"镜像近似"，不能抢别人的
        ANALYSIS.roles[holder[cand]] = cur;      // 与占用者互换
      }
      ANALYSIS.roles[role] = cand;
      break;
    }
    lookBusy = true;
    await syncFilesFromAnalysis();
    renderSplit();
    lookBusy = false;
    updateChecklist();
    previewLook();
  }

  async function mirrorOf(url){
    if (mirrorCache[url]) return mirrorCache[url];
    const m = await PetLook.mirror(url);
    mirrorCache[url] = m;
    return m;
  }
  async function composeViews(){
    const v = { front:FILES.front.url, side:FILES.side.url, back:FILES.back.url };
    v.side2 = FILES.side2 ? FILES.side2.url : await mirrorOf(v.side);
    if (FILES.wave)  v.wave  = FILES.wave.url;
    if (FILES.sleep) v.sleep = FILES.sleep.url;
    return v;
  }

  // 实时预览：视角一齐就立刻套用到宠物身上（此时不写 localStorage）
  let previewSig = '';
  async function previewLook(){
    if (lookModal.hidden || lookBusy) return;
    if (!REQUIRED.every(k => FILES[k])) return;
    const sig = SLOT_ORDER.map(k => FILES[k] ? (FILES[k].seq || 0) : '-').join('|');
    if (sig === previewSig) return;
    previewSig = sig;
    const views = await composeViews();
    if (lookModal.hidden) return;
    currentLook = { v:1, name: lmName.value.trim() || '预览形象', desc: lmDesc.value.trim(),
                    viewDesc:{}, views:views, preview:true };
    applyLookToAll();
  }

  function checklistItems(){
    const out = [];
    if (panelErr) out.push({ ok:false, warn:true, text:panelErr });
    if (!ANALYSIS){
      out.push({ ok:false, text:'还没有形象图 → 上传 1 张（含正/侧/背三视图最佳，系统会自动切分）' });
    } else {
      const n = ANALYSIS.count;
      out.push({ ok:true, text:'形象图已智能分析：检测到 ' + n + ' 个视角（' +
        (ANALYSIS.axis === 'x' ? '横向排列' : ANALYSIS.axis === 'y' ? '纵向排列' : '单张图') +
        '）→ 正面 / 侧面 / 背面 已就位' });
      const approx = (ANALYSIS.approx || []);
      if (approx.length) out.push({ ok:false, warn:true,
        text: approx.map(r => ROLE_NAME[r]).join('、') + ' 图中未检测到 → 已用镜像近似补全（想更准可补上传，或用「⇄ 换视角」调整）' });
      if (ANALYSIS.ratio > 1.12) out.push({ ok:true, warn:true,
        text:'各视角高矮相差 ' + ANALYSIS.ratio.toFixed(2) + ' 倍 → 已按同一缩放比例对齐，转身不会忽大忽小' });
      out.push({ ok:true, text:'贴合度：原图 ' + ANALYSIS.srcW + '×' + ANALYSIS.srcH + '，' +
        (ANALYSIS.cut ? '已自动抠除背景' : '保留原透明背景') + '，等比缩放不变形（角色高按内置基准对齐）' });
    }
    const nm = lmName.value.trim();
    out.push({ ok: !!nm, text: nm ? '角色名称：' + nm : '未填写「角色名称」' });
    const dc = lmDesc.value.trim().length;
    out.push({ ok: dc >= 10, text: dc >= 10 ? '描述词已填写（' + dc + ' 字）' : '「外观描述词」至少 10 字（当前 ' + dc + ' 字）' });
    const optional = OPTIONAL.filter(k => FILES[k] && !FILES[k].mirror);
    out.push({ ok:true, text: optional.length
      ? '可选素材：' + optional.map(nameOf).join('、') + '（' + (FILES.side2 ? '' : '另一侧面将镜像生成；') + (FILES.wave && FILES.sleep ? '姿势图已自带' : '缺的姿势用正视图合成') + '）'
      : '未提供可选素材 → 另一侧面镜像生成，招手/打盹用正视图合成' });
    return out;
  }
  function updateChecklist(){
    const items = checklistItems();
    lmCheck.innerHTML = items.map(i =>
      '<div class="lm-ck ' + (i.ok ? 'ok' : (i.warn ? 'warn' : 'no')) + '"><em>' +
      (i.ok ? '✅' : (i.warn ? '⚠️' : '⭕')) + '</em><span>' + i.text + '</span></div>').join('');
    lmApply.disabled = lookBusy || items.some(i => !i.ok && !i.warn);
    lmApply.textContent = lookBusy ? '⏳ 处理中…' : (lmApply.disabled ? '✓ 应用形象（先上传形象图与描述词）' : '✓ 应用形象');
    const dc = lmDesc.value.trim().length;
    lmCount.textContent = dc + ' / 至少 10 字' + (dc >= 10 ? ' ✓' : '');
    lmCount.classList.toggle('ok', dc >= 10);
  }

  function resetPanel(){
    FILES = {}; panelErr = ''; previewSig = ''; confirmedDefault = false;
    ANALYSIS = null; srcFile = null;
    revokeSrcPreview();
    lmDrop.classList.remove('bad', 'busy', 'over');
    lmDropPh.hidden = false;
    lmDropInfo.hidden = true; lmDropInfo.innerHTML = '';
    lmDropSrc.hidden = true; lmDropSrc.removeAttribute('src');
    renderSplit();
    lookModal.querySelectorAll('.lm-slot').forEach(el => {
      el.classList.remove('filled', 'bad', 'busy', 'over');
      el.querySelector('img').removeAttribute('src');
      const s = SLOTS.find(x => x.key === el.dataset.key);
      el.querySelector('.lm-slot-meta').textContent = s ? s.hint : '';
      el.querySelector('.lm-slot-meta').classList.remove('ok');
    });
    lmDefault.textContent = '↺ 恢复默认形象';
  }

  function openLook(){
    hideMenu();
    lookAtOpen = currentLook;
    buildSlots();
    resetPanel();
    if (currentLook && !currentLook.preview){
      lmName.value = currentLook.name || '';
      lmDesc.value = currentLook.desc || '';
      const d = currentLook.viewDesc || {};
      document.getElementById('lmDescFront').value = d.front || '';
      document.getElementById('lmDescSide').value  = d.side  || '';
      document.getElementById('lmDescBack').value  = d.back  || '';
      const V = currentLook.views || {};
      ANALYSIS = { items: [], roles: {}, axis:'saved', count:0, cut:false,
                   srcW:0, srcH:0, ratio:1, saved:true, approx:[] };
      let vi = 0;
      ROLE_ORDER.forEach(k => {
        if (V[k]){
          ANALYSIS.items.push({ url:V[k], w:0, h:0, charH:0 });
          ANALYSIS.roles[k] = vi++;
          FILES[k] = { file:null, url:V[k], seq:++pickSeq, keep:true,
                       meta:{ charRatio:0, cut:false, empty:false } };
        } else ANALYSIS.roles[k] = null;
      });
      ANALYSIS.count = ANALYSIS.items.length;
      ROLE_ORDER.forEach(k => { if (ANALYSIS.roles[k] == null) ANALYSIS.approx.push(k); });
      ['side2','wave','sleep'].forEach(k => {
        if (!V[k]) return;
        FILES[k] = { file:null, url:V[k], seq:++pickSeq, keep:true, meta:{ charRatio:0, cut:false, empty:false } };
        renderSlot(k, V[k], '当前形象素材');
      });
      lmDropPh.hidden = true;
      lmDropInfo.hidden = false;
      lmDropInfo.innerHTML = '📦 当前形象素材已载入（' + ANALYSIS.count + ' 个视角）。想换形象 → 把新图片拖到上面 / 点这里重新选择。';
      renderSplit();
    } else {
      lmName.value = ''; lmDesc.value = '';
      document.getElementById('lmDescFront').value = '';
      document.getElementById('lmDescSide').value  = '';
      document.getElementById('lmDescBack').value  = '';
    }
    lookModal.hidden = false;
    updateChecklist();
  }
  function closeLook(){
    lookModal.hidden = true;
    if (currentLook && currentLook.preview){ currentLook = lookAtOpen; applyLookToAll(); }  // 取消预览
    FILES = {}; panelErr = '';
  }

  async function doApply(){
    if (lmApply.disabled || lookBusy) return;
    lookBusy = true; updateChecklist();
    try {
      const views = await composeViews();
      const look = {
        v: 1,
        name: lmName.value.trim(),
        desc: lmDesc.value.trim(),
        viewDesc: {
          front: document.getElementById('lmDescFront').value.trim(),
          side:  document.getElementById('lmDescSide').value.trim(),
          back:  document.getElementById('lmDescBack').value.trim()
        },
        views: views,
        norm: lmNorm.checked, keyed: lmKey.checked,
        updatedAt: new Date().toISOString()
      };
      let saved = await setLook(look);
      if (!saved){                                     // localStorage 写不下 → 降质重编码再试
        for (const k of Object.keys(views)) views[k] = await PetLook.requant(views[k], 0.62);
        saved = await setLook(look);
      }
      lookBusy = false;
      lookModal.hidden = true;
      FILES = {};
      const t = pets[0];
      if (t) say(t, saved ? ('形象更换成功！我是' + (look.name || '新角色') + '~') : '形象已换成，但太大存不进本地，建议先导出形象包');
      if (!saved) panelErr = 'localStorage 容量不足，形象只在本次会话生效';
      console[ saved ? 'log' : 'warn' ]('[pet] 形象已应用' + (saved ? '并已保存' : '（保存失败）'), look.name);
    } catch(err){
      lookBusy = false;
      panelErr = '应用失败：' + ((err && err.message) || '未知错误');
      updateChecklist();
    }
  }

  /* --- 面板事件 --- */
  document.getElementById('lmClose').addEventListener('click', closeLook);
  document.getElementById('lmCancel').addEventListener('click', closeLook);
  document.getElementById('lmBackdrop').addEventListener('click', closeLook);
  lmApply.addEventListener('click', doApply);
  [lmName, lmDesc].forEach(el => el.addEventListener('input', updateChecklist));
  [lmKey, lmNorm].forEach(c => c.addEventListener('change', async () => {
    const keys = Object.keys(FILES).filter(k => FILES[k] && FILES[k].file);
    for (const k of keys) await pick(k, FILES[k].file);
    if (srcFile) await acceptImage(srcFile);      // 形象图按新选项重新分析切分
    updateChecklist();
  }));

  lmDefault.addEventListener('click', async () => {
    if (!currentLook){ panelErr = '当前就是默认形象'; updateChecklist(); return; }
    if (!confirmedDefault){
      confirmedDefault = true;
      lmDefault.textContent = '↺ 再点一次确认恢复默认';
      updateChecklist();
      setTimeout(() => { if (confirmedDefault){ confirmedDefault = false; lmDefault.textContent = '↺ 恢复默认形象'; } }, 4000);
      return;
    }
    confirmedDefault = false;
    await setLook(null);
    lookModal.hidden = true; FILES = {};
    if (pets[0]) say(pets[0], '换回默认形象啦');
  });

  document.getElementById('lmExport').addEventListener('click', () => {
    const L = (REQUIRED.every(k => FILES[k]))
      ? { name: lmName.value.trim() || '自定义形象', desc: lmDesc.value.trim(),
          viewDesc:{ front:document.getElementById('lmDescFront').value.trim(),
                     side:document.getElementById('lmDescSide').value.trim(),
                     back:document.getElementById('lmDescBack').value.trim() },
          views: FILES, norm: lmNorm.checked }
      : (currentLook || { name:'默认形象', desc:'', viewDesc:{}, views:DEFAULT_SRCS });
    const pv = {};
    SLOT_ORDER.forEach(k => { if (L.views[k] && L.views[k].url) pv[k] = L.views[k].url; else if (L.views[k]) pv[k] = L.views[k]; });
    if (!pv.side2 && pv.side) pv.side2 = pv.side;
    const pack = { kind:'tidylab-pet-look', v:1, name:L.name, desc:L.desc, viewDesc:L.viewDesc || {},
                   norm:!!L.norm, views:pv, exportedAt:new Date().toISOString(),
                   note:'三视图 front/side/back 为必需；desc 为必需的形象描述词' };
    const blob = new Blob([JSON.stringify(pack)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pet-look-' + (pack.name || 'custom') + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  document.getElementById('lmImport').addEventListener('click', () => lmPack.click());
  lmPack.addEventListener('change', () => {
    const f = lmPack.files && lmPack.files[0];
    lmPack.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        const p = JSON.parse(rd.result);
        if (!p || !p.views || !p.views.front || !p.views.side || !p.views.back)
          throw new Error('形象包缺少必需的三视图（正面 / 侧面 / 背面）');
        await setLook({ v:1, name:p.name || '导入形象', desc:p.desc || '', viewDesc:p.viewDesc || {},
                        views:p.views, norm:p.norm !== false });
        lookModal.hidden = true; FILES = {}; panelErr = '';
        if (pets[0]) say(pets[0], '形象包导入成功！我是' + (p.name || '新角色'));
      } catch(e){
        panelErr = '导入失败：' + ((e && e.message) || '文件无法解析');
        updateChecklist();
      }
    };
    rd.readAsText(f);
  });

  /* 剪贴板粘贴图片 → 直接作为形象图分析（仅面板打开时响应，不影响页面其它粘贴） */
  document.addEventListener('paste', e => {
    if (lookModal.hidden || lookBusy) return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items){
      if (it.type && it.type.indexOf('image/') === 0){
        const f = it.getAsFile();
        if (f){ acceptImage(f); e.preventDefault(); }
        break;
      }
    }
  });

  /* 形象图上传区：点击 / 拖入 / 重新选择 */
  lmDrop.addEventListener('click', () => { if (!lookBusy) lmFile.click(); });
  lmFile.addEventListener('change', () => {
    const f = lmFile.files && lmFile.files[0];
    lmFile.value = '';
    if (f) acceptImage(f);
  });
  lmDrop.addEventListener('dragover', e => { e.preventDefault(); lmDrop.classList.add('over'); });
  lmDrop.addEventListener('dragleave', () => lmDrop.classList.remove('over'));
  lmDrop.addEventListener('drop', e => {
    e.preventDefault(); lmDrop.classList.remove('over');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) acceptImage(f);
  });

  /* ---------- 启动：恢复上次保存的形象 → 右下角蹦出第一只 ---------- */
  currentLook = loadLook();
  updateLookName();
  createPet({ size: 150 });
  // 调试/自动化测试钩子（控制播放与排程 + 形象读写）
  window.__petDebug = {
    pets, play, setIdle, schedule, pointer,
    look: () => currentLook,
    openLook, closeLook, setLook,
    slotKeys: SLOT_ORDER,
    files: () => FILES,
    srcs: () => lookSrcs(),
    defaults: DEFAULT_SRCS,
    analysis: () => ANALYSIS,
    acceptImage, cycleRole, mirrorOf,
    createPet, copyPet, hidePet, unhideAll, resetCorner, maxPetSize
  };
  }
})();
