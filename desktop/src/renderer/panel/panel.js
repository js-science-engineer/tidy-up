/* ============================================================================
 * js-pet 面板逻辑（M5）：养成 / 形象 / 设置 三个页签
 * 数据一律走 window.jsPet（preload 桥），面板不碰任何 Node API。
 * ========================================================================== */
(function () {
  'use strict';

  const api = window.jsPet;
  const $ = (id) => document.getElementById(id);

  /* ---------------- 页签切换 ---------------- */
  function showTab(tab) {
    const btn = document.querySelector('.tab-btn[data-tab="' + tab + '"]');
    if (btn) btn.click();
  }
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      ['grow', 'looks', 'settings'].forEach(function (t) {
        $('tab-' + t).hidden = t !== btn.dataset.tab;
      });
      if (btn.dataset.tab === 'grow') refreshGrow();
      if (btn.dataset.tab === 'looks') refreshLooks();
      if (btn.dataset.tab === 'settings') refreshSettings();
    });
  });

  // M6：托盘/宠物右键菜单跳转到指定页签
  if (api.panel && api.panel.takeTab) {
    api.panel.takeTab().then(function (t) {
      if (t && t !== 'grow') showTab(t);
    }).catch(function () {});
  }
  if (api.on) {
    api.on('panel:showTab', function (t) { if (t) showTab(t); });
  }

  /* ---------------- 养成页签 ---------------- */
  const MOOD_TEXT = { critical: '快饿坏了…', low: '有点蔫蔫的', normal: '状态良好' };

  function renderGrow(s) {
    if (!s || !s.stats) return;
    $('gLevel').textContent = s.stats.level;
    $('gHunger').style.width = s.stats.hunger + '%';
    $('gHungerNum').textContent = Math.round(s.stats.hunger);
    $('gMood').style.width = s.stats.mood + '%';
    $('gMoodNum').textContent = Math.round(s.stats.mood);

    // 等级进度（复用 shared/stats 的规则）
    if (window.JsPetStats) {
      const p = window.JsPetStats.progressFor(s.stats.bond);
      if (p) {
        $('gBondBar').style.width = Math.round(p.ratio * 100) + '%';
        $('gBondText').textContent = '亲密度 ' + Math.round(p.cur) + ' / ' + p.need;
      }
    }

    const cls = window.JsPetStats ? window.JsPetStats.moodClass(s.stats) : 'normal';
    $('gMoodText').textContent = MOOD_TEXT[cls] || MOOD_TEXT.normal;
  }

  function refreshGrow() {
    api.state.load().then(renderGrow).catch(function () {});
  }

  function doAction(kind, okText) {
    api.stats.interact(kind).then(function (r) {
      if (r && r.ok) {
        $('gTip').textContent = okText;
      } else if (r && r.reason === 'cooldown') {
        $('gTip').textContent = '太频繁啦，歇一会再来～';
      } else {
        $('gTip').textContent = '';
      }
      refreshGrow();
    }).catch(function () {});
  }

  $('btnFeed').addEventListener('click', function () { doAction('feed', '开饭啦！'); });
  $('btnPet').addEventListener('click', function () { doAction('pet', '它蹭了蹭你～'); });
  $('btnPlay').addEventListener('click', function () { doAction('play', '玩得满地打滚！'); });
  setInterval(function () {
    if (!$('tab-grow').hidden) refreshGrow();
  }, 3000);

  /* ---------------- 形象页签 ---------------- */
  function thumbUrl(front) {
    // 内置形象返回 pet 页内的相对路径，面板页需要加前缀
    if (front && front.indexOf('looks/') === 0) return '../pet/' + front;
    return front;
  }

  function refreshLooks() {
    api.looks.list().then(function (list) {
      return api.state.load().then(function (s) {
        const cur = s ? s.currentLookId : null;
        const wrap = $('lookList');
        wrap.innerHTML = '';
        list.forEach(function (lk) {
          const card = document.createElement('div');
          card.className = 'look-card' + (lk.id === cur ? ' current' : '');

          const img = document.createElement('img');
          img.alt = lk.name;
          api.looks.getViews(lk.id).then(function (r) {
            if (r && r.ok && r.views && r.views.front) img.src = thumbUrl(r.views.front);
          }).catch(function () {});

          const name = document.createElement('div');
          name.className = 'look-name';
          name.textContent = lk.name;
          name.title = lk.name;

          card.appendChild(img);
          card.appendChild(name);
          if (lk.builtin) {
            const badge = document.createElement('div');
            badge.className = 'badge';
            badge.textContent = '内置';
            card.appendChild(badge);
          } else {
            const del = document.createElement('button');
            del.className = 'look-del';
            del.textContent = '✕';
            del.title = '删除该形象';
            del.addEventListener('click', function (e) {
              e.stopPropagation();
              if (!window.confirm('删除形象「' + lk.name + '」？')) return;
              api.looks.remove(lk.id).then(function (r) {
                if (r && r.ok) refreshLooks();
                else window.alert('删除失败：' + (r && r.reason));
              }).catch(function () {});
            });
            card.appendChild(del);
          }

          card.addEventListener('click', function () {
            api.looks.setCurrent(lk.id).then(function (r) {
              if (r && r.ok) refreshLooks();
              else window.alert('切换失败：' + (r && r.reason));
            }).catch(function () {});
          });
          wrap.appendChild(card);
        });
      });
    }).catch(function () {});
  }

  $('lookFile').addEventListener('change', function () {
    const f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function () {
      const bytes = new Uint8Array(reader.result);
      const name = f.name.replace(/\.[^.]+$/, '').slice(0, 24);
      api.looks.importLook(name, bytes).then(function (r) {
        if (r && r.ok) refreshLooks();
        else window.alert('导入失败：' + (r && r.reason));
      }).catch(function (e) { window.alert('导入失败：' + e); });
    };
    reader.onerror = function () { window.alert('读取图片失败'); };
    reader.readAsArrayBuffer(f);
  });

  /* ---------------- 设置页签 ---------------- */
  let applying = false;

  function refreshSettings() {
    api.settings.get().then(function (s) {
      if (!s || !s.settings) return;
      $('sizeRange').value = s.settings.size;
      $('sizeVal').textContent = s.settings.size;
      $('wanderChk').checked = s.settings.wanderEnabled;
      // 自启勾选态以系统实际状态为准
      $('autoStartChk').checked = !!s.autostart;
      $('ver').textContent = 'v' + s.version;
      $('aboutVer').textContent = '当前版本 v' + s.version;
    }).catch(function () {});
  }

  function applySettings(patch, done) {
    if (applying) return;
    applying = true;
    api.settings.apply(patch).then(function (r) {
      applying = false;
      if (r && r.ok) {
        $('sizeVal').textContent = r.settings.size;
        if (done) done(r.settings);
      } else {
        window.alert('设置失败：' + (r && r.reason));
        refreshSettings();
      }
    }).catch(function () { applying = false; });
  }

  let sizeTimer = 0;
  $('sizeRange').addEventListener('input', function () {
    $('sizeVal').textContent = this.value;
    clearTimeout(sizeTimer);
    const v = Number(this.value);
    sizeTimer = setTimeout(function () {
      applySettings({ size: v });
    }, 300);
  });
  $('wanderChk').addEventListener('change', function () {
    applySettings({ wanderEnabled: this.checked });
  });
  $('autoStartChk').addEventListener('change', function () {
    applySettings({ autoStart: this.checked }, function () {
      // 以系统回读为准刷新勾选态
      api.settings.get().then(function (s) { $('autoStartChk').checked = !!s.autostart; });
    });
  });

  /* ---------------- 备份 / 恢复 ---------------- */
  $('btnBackup').addEventListener('click', function () {
    api.data.backupNow().then(function (r) {
      window.alert(r && r.ok ? '已备份 ✓' : '备份失败：' + (r && r.reason));
    }).catch(function () {});
  });
  $('btnExport').addEventListener('click', function () {
    api.data.exportToFile().then(function (r) {
      if (r && r.ok) window.alert('已导出到：' + r.file);
    }).catch(function () {});
  });
  $('btnImport').addEventListener('click', function () {
    if (!window.confirm('恢复会覆盖当前养成数据，确定继续？')) return;
    api.data.importFromFile().then(function (r) {
      if (r && r.ok) {
        window.alert('恢复成功 ✓');
        refreshGrow(); refreshLooks(); refreshSettings();
      } else if (r && r.reason !== 'canceled') {
        window.alert('恢复失败：' + r.reason);
      }
    }).catch(function () {});
  });

  /* ---------------- 启动 ---------------- */
  refreshGrow();
  refreshLooks();
  refreshSettings();
})();
