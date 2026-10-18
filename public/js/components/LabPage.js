// 实验室共享空间：创建 / 邀请 / 成员管理 / 个人数据导入 / 退出与删除
// 仅云端模式可用；本地模式（单机 SQLite）无账号体系，页面给出说明
(function () {
  const c = window.Components = window.Components || {};
  c.LabPage = {
    data: () => ({
      loading: true,
      busy: false,
      err: '',
      msg: '',
      overview: null,
      newName: '',
      editName: '',
      joinCode: '',
      confirmDelete: false,
      confirmUpgrade: false,
      confirmRegen: false,
    }),
    computed: {
      isCloud() { return window.store.mode === 'cloud'; },
      space() { return window.store.space || { type: 'personal', labId: null }; },
      labs() { return window.store.labs || []; },
      lab() {
        const s = this.space;
        if (s.type !== 'lab' || !s.labId) return null;
        return this.labs.find((l) => Number(l.id) === Number(s.labId)) || null;
      },
      labName() { return window.spaceLabel(); },
      isOwner() { return !!(this.lab && this.lab.isOwner); },
      members() { return (this.lab && this.lab.members) || []; },
      inviteLink() { return this.lab ? location.origin + '/?join=' + this.lab.inviteCode : ''; },
      stats() { return (this.overview && this.overview.stats) || null; },
      expiry() {
        if (!this.lab || !this.lab.inviteExpiresAt) return '';
        try { return String(this.lab.inviteExpiresAt).slice(0, 10); } catch { return ''; }
      },
      defaultSpace() { return window.store.defaultSpace || null; },
      defaultLabel() {
        const d = this.defaultSpace;
        if (!d) return t('lab.defaultNone');
        if (d.type === 'lab') {
          const l = this.labs.find((x) => Number(x.id) === Number(d.labId));
          return l ? l.name : t('lab.unknown');
        }
        return t('lab.personal');
      },
      isDefaultCurrent() {
        const key = (s) => (s && s.type === 'lab' && s.labId ? 'lab:' + Number(s.labId) : 'personal');
        return key(this.defaultSpace) === key(this.space);
      },
    },
    watch: {
      // 顶栏切换空间 → 本页数据整体换一份
      'store.space'() { this.err = ''; this.msg = ''; this.confirmDelete = false; this.confirmUpgrade = false; this.load(); },
    },
    mounted() { this.load(); },
    methods: {
      async load() {
        if (!this.isCloud) { this.loading = false; return; }
        this.loading = true;
        try {
          const [labs, overview] = await Promise.all([
            window.__cloudApi.api('GET', '/labs'),
            window.__cloudApi.api('GET', '/stats/overview').catch(() => null),
          ]);
          window.store.labs = Array.isArray(labs) ? labs : [];
          this.overview = overview;
          this.err = '';
        } catch (e) { this.err = (e && e.message) || t('lab.loadFail'); }
        finally { this.loading = false; }
      },
      reset() { this.msg = ''; this.err = ''; },
      async copy(text, what) {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
          }
          this.msg = t('lab.copied', { what });
        } catch { this.msg = text; }
      },
      goPersonal() { window.__tidySetSpace({ type: 'personal', labId: null }); },

      setDefault() {
        window.__tidySetDefaultSpace(this.space);
        this.msg = t('lab.defaultSet', { name: this.labName });
      },
      clearDefault() {
        window.__tidySetDefaultSpace(null);
        this.msg = t('lab.defaultCleared');
      },

      async createLab() {
        this.reset();
        const name = this.newName.trim();
        if (!name) { this.err = t('lab.needName'); return; }
        this.busy = true;
        try {
          const lab = await window.__cloudApi.api('POST', '/labs', { name, displayName: window.store.myName });
          this.newName = '';
          await window.__tidyRefreshLabs();
          window.__tidySetSpace({ type: 'lab', labId: lab.id });
          this.msg = t('lab.created', { name: lab.name });
        } catch (e) { this.err = (e && e.message) || t('lab.createFail'); }
        finally { this.busy = false; }
      },

      async joinLab() {
        this.reset();
        const code = this.joinCode.trim();
        if (!code) { this.err = t('lab.needCode'); return; }
        this.busy = true;
        try {
          const lab = await window.__cloudApi.api('POST', '/labs/join', { code, displayName: window.store.myName });
          this.joinCode = '';
          await window.__tidyRefreshLabs();
          window.__tidySetSpace({ type: 'lab', labId: lab.id });
          this.msg = t('lab.joined', { name: lab.name });
        } catch (e) { this.err = (e && e.message) || t('lab.joinFail'); }
        finally { this.busy = false; }
      },

      async rename() {
        if (!this.lab) return;
        const name = (this.editName || '').trim();
        if (!name) { this.err = t('lab.needName'); return; }
        this.busy = true; this.reset();
        try {
          await window.__cloudApi.api('PATCH', '/labs/' + this.lab.id, { name });
          await window.__tidyRefreshLabs();
          this.editName = '';
          this.msg = t('lab.renameDone');
        } catch (e) { this.err = (e && e.message) || t('lab.fail'); }
        finally { this.busy = false; }
      },

      async regen() {
        if (!this.lab) return;
        if (!this.confirmRegen) { this.confirmRegen = true; return; }
        this.confirmRegen = false;
        this.busy = true; this.reset();
        try {
          const r = await window.__cloudApi.api('PATCH', '/labs/' + this.lab.id, { regenerateInvite: true });
          await window.__tidyRefreshLabs();
          this.msg = t('lab.regenDone');
          if (r && r.inviteCode) this.inviteCode = r.inviteCode;
        } catch (e) { this.err = (e && e.message) || t('lab.fail'); }
        finally { this.busy = false; }
      },

      async removeMember(m) {
        this.reset();
        if (!window.confirm(t('lab.removeConfirm', { name: this.displayName(m) }))) return;
        this.busy = true;
        try {
          await window.__cloudApi.api('DELETE', '/labs/members/' + m.id);
          await window.__tidyRefreshLabs();
          this.msg = t('lab.removed');
          await this.load();
        } catch (e) { this.err = (e && e.message) || t('lab.fail'); }
        finally { this.busy = false; }
      },

      async upgrade() {
        if (!this.lab) return;
        if (!this.confirmUpgrade) { this.confirmUpgrade = true; return; }
        this.confirmUpgrade = false;
        this.busy = true; this.reset();
        try {
          const r = await window.__cloudApi.api('POST', '/labs/' + this.lab.id + '/upgrade');
          this.msg = t('lab.upgraded', { n: (r && r.moved) || 0 });
          await this.load();
        } catch (e) { this.err = (e && e.message) || t('lab.fail'); }
        finally { this.busy = false; }
      },

      async leave() {
        if (!this.lab) return;
        this.reset();
        if (!window.confirm(t('lab.leaveConfirm', { name: this.lab.name }))) return;
        this.busy = true;
        try {
          await window.__cloudApi.api('POST', '/labs/' + this.lab.id + '/leave');
          await window.__tidyRefreshLabs();
          window.__tidySetSpace({ type: 'personal', labId: null });
          this.msg = t('lab.left');
        } catch (e) { this.err = (e && e.message) || t('lab.fail'); }
        finally { this.busy = false; }
      },

      async removeLab() {
        if (!this.lab) return;
        if (!this.confirmDelete) { this.confirmDelete = true; return; }
        this.confirmDelete = false;
        this.busy = true; this.reset();
        try {
          await window.__cloudApi.api('DELETE', '/labs/' + this.lab.id);
          await window.__tidyRefreshLabs();
          window.__tidySetSpace({ type: 'personal', labId: null });
          this.msg = t('lab.deleted');
        } catch (e) { this.err = (e && e.message) || t('lab.fail'); }
        finally { this.busy = false; }
      },

      displayName(m) { return m.name || (t('lab.member') + ' ' + String(m.userId || '').slice(0, 4)); },
      roleLabel(r) {
        if (r === 'owner') return t('lab.roleOwner');
        if (r === 'viewer') return t('lab.roleViewer');
        return t('lab.roleEditor');
      },
      joinedAt(m) { return m.createdAt ? String(m.createdAt).slice(0, 10) : ''; },
      switchTo(l) { window.__tidySetSpace({ type: 'lab', labId: l.id }); },
    },
    template: `
    <section class="screen">
      <div class="page-title">{{ t('lab.pageTitle') }}</div>
      <div class="page-sub">{{ t('lab.pageSub') }}</div>

      <!-- 本地模式：无账号体系，说明即可 -->
      <div v-if="!isCloud" class="glass card">
        <div class="empty">{{ t('lab.localOnly') }}</div>
      </div>

      <template v-else>
        <!-- 当前空间 -->
        <div class="glass card" style="margin-bottom:18px">
          <h3 class="sec">{{ t('lab.curSpace') }}</h3>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <span class="chip on" style="font-size:13px">{{ space.type === 'lab' ? '🧪' : '👤' }} {{ labName }}</span>
            <span v-if="lab && isOwner" class="chip">{{ t('lab.admin') }}</span>
            <span v-if="lab" class="chip">{{ t('lab.memberCount', { n: members.length }) }}</span>
            <div style="flex:1"></div>
            <button v-if="space.type === 'lab'" class="btn-ghost" @click="goPersonal">{{ t('lab.backPersonal') }}</button>
          </div>
          <div v-if="stats" style="display:flex;gap:26px;margin-top:16px;flex-wrap:wrap">
            <div><div style="font-size:20px;font-weight:700">{{ stats.itemCount }}</div><div style="color:var(--text-3);font-size:12px">{{ t('lab.statItems') }}</div></div>
            <div><div style="font-size:20px;font-weight:700">{{ stats.zoneCount }}</div><div style="color:var(--text-3);font-size:12px">{{ t('lab.statZones') }}</div></div>
            <div><div style="font-size:20px;font-weight:700">{{ stats.cabinetCount }}</div><div style="color:var(--text-3);font-size:12px">{{ t('lab.statCabinets') }}</div></div>
            <div><div style="font-size:20px;font-weight:700">{{ stats.inStock }}</div><div style="color:var(--text-3);font-size:12px">{{ t('lab.statInStock') }}</div></div>
          </div>
        </div>

        <!-- 默认空间：决定下次打开网站时先进入哪个空间 -->
        <div class="glass card" style="margin-bottom:18px">
          <h3 class="sec">📌 {{ t('lab.defaultTitle') }}</h3>
          <div style="color:var(--text-2);font-size:13px;margin-bottom:12px">{{ t('lab.defaultTip') }}</div>
          <div class="form-row">
            <span class="chip" :class="{on: !!defaultSpace}">{{ t('lab.defaultCur') }}：{{ defaultLabel }}</span>
            <div style="flex:1"></div>
            <button v-if="!isDefaultCurrent" class="btn-ghost" :disabled="busy" @click="setDefault">{{ t('lab.setDefault') }}</button>
            <button v-else class="btn-ghost btn-danger" :disabled="busy" @click="clearDefault">{{ t('lab.clearDefault') }}</button>
          </div>
        </div>

        <div v-if="msg" class="glass card" style="margin-bottom:18px;padding:14px 22px;color:var(--text-2);font-size:13px">✅ {{ msg }}</div>
        <div v-if="err" class="glass card" style="margin-bottom:18px;padding:14px 22px;color:#fca5a5;font-size:13px">⚠️ {{ err }}</div>

        <!-- 邀请成员（仅当前在实验室空间） -->
        <div v-if="lab" class="glass card" style="margin-bottom:18px">
          <h3 class="sec">🔗 {{ t('lab.inviteTitle') }}</h3>
          <div style="color:var(--text-2);font-size:13px;margin-bottom:14px">{{ t('lab.inviteTip') }}</div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
            <code style="flex:1;min-width:220px;padding:11px 14px;border-radius:12px;background:var(--glass-2);border:1px solid var(--rim-lo);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ inviteLink }}</code>
            <button class="btn-ghost" @click="copy(inviteLink, t('lab.linkWord'))">{{ t('lab.copyLink') }}</button>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span style="font-size:12.5px;color:var(--text-3)">{{ t('lab.orCode') }}</span>
            <b style="font-size:19px;letter-spacing:3px">{{ lab.inviteCode }}</b>
            <button class="btn-ghost" @click="copy(lab.inviteCode, t('lab.codeWord'))">{{ t('lab.copyCode') }}</button>
            <div style="flex:1"></div>
            <span v-if="expiry" style="font-size:12px;color:var(--text-3)">{{ t('lab.expires', { date: expiry }) }}</span>
            <button v-if="isOwner" class="btn-ghost btn-danger" :disabled="busy" @click="regen">
              {{ confirmRegen ? t('lab.regenConfirm') : t('lab.regen') }}
            </button>
          </div>
        </div>

        <!-- 成员 -->
        <div v-if="lab" class="glass card" style="margin-bottom:18px">
          <h3 class="sec">👥 {{ t('lab.membersTitle') }}（{{ members.length }}）</h3>
          <div v-for="m in members" :key="'m'+m.id"
               style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--rim-lo)">
            <div class="recog-img" style="width:38px;height:38px;font-size:15px;border-radius:12px">{{ m.isMe ? '🙋' : '🧑‍🔬' }}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13.5px">{{ displayName(m) }}<span v-if="m.isMe" style="color:var(--text-3)"> {{ t('lab.me') }}</span></div>
              <div style="color:var(--text-3);font-size:11.5px">{{ t('lab.joinedAt', { date: joinedAt(m) }) }}</div>
            </div>
            <span class="chip" :class="{on: m.role === 'owner'}">{{ roleLabel(m.role) }}</span>
            <button v-if="isOwner && !m.isMe && m.role !== 'owner'" class="btn-ghost btn-danger" :disabled="busy" @click="removeMember(m)">{{ t('lab.remove') }}</button>
          </div>
          <div v-if="!members.length" class="empty">{{ t('lab.noMembers') }}</div>
        </div>

        <!-- 管理员操作 -->
        <div v-if="lab && isOwner" class="glass card" style="margin-bottom:18px">
          <h3 class="sec">⚙️ {{ t('lab.manageTitle') }}</h3>
          <div class="form-row">
            <input v-model="editName" :placeholder="lab.name" style="flex:1">
            <button class="btn-ghost" :disabled="busy" @click="rename">{{ t('lab.rename') }}</button>
          </div>
          <div style="color:var(--text-2);font-size:12.5px;margin:14px 0 10px">{{ t('lab.upgradeTip') }}</div>
          <div class="form-row">
            <button class="btn-ghost" :disabled="busy" @click="upgrade">
              {{ confirmUpgrade ? t('lab.upgradeConfirm', { name: lab.name }) : t('lab.upgrade') }}
            </button>
          </div>
          <div style="color:#fca5a5;font-size:12.5px;margin:16px 0 10px">{{ t('lab.deleteWarning') }}</div>
          <div class="form-row">
            <button class="btn-ghost btn-danger" :disabled="busy" @click="removeLab">
              {{ confirmDelete ? t('lab.deleteConfirm', { name: lab.name }) : t('lab.deleteLab') }}
            </button>
          </div>
        </div>

        <!-- 非管理员：退出 -->
        <div v-else-if="lab" class="glass card" style="margin-bottom:18px">
          <h3 class="sec">🚪 {{ t('lab.leaveTitle') }}</h3>
          <div style="color:var(--text-2);font-size:12.5px;margin-bottom:12px">{{ t('lab.leaveTip') }}</div>
          <button class="btn-ghost btn-danger" :disabled="busy" @click="leave">{{ t('lab.leave') }}</button>
        </div>

        <!-- 我的实验室 / 加入 / 新建 -->
        <div class="glass card">
          <h3 class="sec">🧪 {{ t('lab.myLabs') }}</h3>
          <div v-for="l in labs" :key="'l'+l.id"
               style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--rim-lo)">
            <div style="flex:1;min-width:0">
              <div style="font-size:13.5px">{{ l.name }}</div>
              <div style="color:var(--text-3);font-size:11.5px">
                {{ t('lab.memberCount', { n: (l.members||[]).length }) }} · {{ l.ownerName || t('lab.admin') }}
              </div>
            </div>
            <button class="btn-ghost" @click="switchTo(l)">{{ t('lab.switchTo') }}</button>
          </div>
          <div v-if="!labs.length" class="empty">{{ t('lab.none') }}</div>

          <h3 class="sec" style="margin-top:20px">🔗 {{ t('lab.joinTitle') }}</h3>
          <div class="form-row">
            <input v-model="joinCode" :placeholder="t('lab.codePh')" style="flex:1;text-transform:uppercase" @keyup.enter="joinLab">
            <button class="btn-ghost" :disabled="busy" @click="joinLab">{{ t('lab.joinBtn') }}</button>
          </div>

          <h3 class="sec" style="margin-top:16px">✨ {{ t('lab.createTitle') }}</h3>
          <div class="form-row">
            <input v-model="newName" :placeholder="t('lab.namePh')" style="flex:1" @keyup.enter="createLab">
            <button class="btn-main" :disabled="busy" @click="createLab">{{ t('lab.createBtn') }}</button>
          </div>
        </div>
      </template>
    </section>`,
  };
})();
