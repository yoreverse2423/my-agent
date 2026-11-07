/* Yore's agent — 今日任务 / DeepSeek 问答 / GitHub 存档同步 */
(function () {
  'use strict';

  var STORAGE_ARCHIVE = 'studyhub_archive_v1';
  var STORAGE_TASKS = 'studyhub_tasks_cache_v1';
  var STORAGE_CHAT = 'studyhub_chat_v1';
  var STORAGE_CHAT_UI = 'studyhub_chat_ui_v1';
  var STORAGE_GH_TOKEN = 'studyhub_github_token';
  var STORAGE_GH_PREFS = 'studyhub_github_prefs';
  var STORAGE_DS_KEY = 'studyhub_deepseek_key';
  var STORAGE_DS_PREFS = 'studyhub_deepseek_prefs';
  var STORAGE_NOTES = 'studyhub_day_notes_v1';
  var STORAGE_SYNC_PREFS = 'studyhub_sync_prefs_v1';

  var DEFAULT_OWNER = 'yoreverse2423';
  var DEFAULT_REPO = 'my-agent';
  var TASKS_PATH = 'data/daily-tasks.json';
  var ARCHIVE_PATH = 'data/student-archive.json';
  var DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
  var DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-reasoner'];
  var PAGES_BASE = 'https://yoreverse2423.github.io/my-agent/';
  var APK_URL = 'downloads/xiaoxuexiji-watch-armeabi-v7a.apk';
  var APK_VERSION = '0.2.2';
  var AUTO_UPLOAD_GAP_MS = 5 * 60 * 1000;
  var AUTO_UPLOAD_TICK_MS = 20 * 1000;
  var BRAND_NAME = "Yore's agent";

  var SUBJECTS = ['综合', '数学', '英语', '物理', '化学', '语文', '地理'];

  var state = {
    view: 'today',
    tasksDoc: null,
    archive: null,
    chat: [],
    chatSubject: '综合',
    busy: false,
    chatUi: { clearedBeforeId: '' },
    askTimer: null,
    thinkingDots: null,
    tasksBrowseDate: '',
    archiveDirty: false,
    pushInFlight: false,
    autoUploadTimer: null
  };

  var ASK_TIMEOUT_MS = 90000;

  /* ---------- utils ---------- */

  function $(id) { return document.getElementById(id); }

  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('is-on'); }, 2200);
  }

  function nowShanghai() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  }

  function studyDate(d) {
    var x = d ? new Date(d) : nowShanghai();
    if (x.getHours() < 4) x = new Date(x.getTime() - 24 * 3600 * 1000);
    var y = x.getFullYear();
    var m = String(x.getMonth() + 1).padStart(2, '0');
    var day = String(x.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function isoShanghai() {
    var x = nowShanghai();
    var y = x.getFullYear();
    var m = String(x.getMonth() + 1).padStart(2, '0');
    var d = String(x.getDate()).padStart(2, '0');
    var h = String(x.getHours()).padStart(2, '0');
    var mi = String(x.getMinutes()).padStart(2, '0');
    var s = String(x.getSeconds()).padStart(2, '0');
    return y + '-' + m + '-' + d + 'T' + h + ':' + mi + ':' + s + '+08:00';
  }

  function padB64(str) {
    // UTF-8 → base64 for GitHub Contents API
    return btoa(unescape(encodeURIComponent(str)));
  }

  function fromB64(b64) {
    return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
  }

  function lsGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function lsGetStr(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }

  function lsSetStr(key, val) {
    try {
      if (val) localStorage.setItem(key, val);
      else localStorage.removeItem(key);
    } catch (e) {}
  }

  function normalizeToken(t) {
    return String(t || '').trim().replace(/^Bearer\s+/i, '');
  }

  function newMsgId() {
    return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  function ensureMsgIds(list) {
    var arr = Array.isArray(list) ? list : [];
    for (var i = 0; i < arr.length; i++) {
      if (!arr[i]) continue;
      if (!arr[i].id) arr[i].id = newMsgId();
    }
    return arr;
  }

  function subjectClass(subject) {
    var s = String(subject || 'default');
    if (SUBJECTS.indexOf(s) === -1 || s === '综合') return 'subj-default';
    return 'subj-' + s;
  }

  /* ---------- data load ---------- */

  function emptyArchive() {
    return {
      schemaVersion: 1,
      timezone: 'Asia/Shanghai',
      updatedAt: isoShanghai(),
      days: []
    };
  }

  function emptyTasks() {
    return {
      schemaVersion: 1,
      timezone: 'Asia/Shanghai',
      updatedAt: isoShanghai(),
      tasks: []
    };
  }

  function loadLocal() {
    state.archive = lsGet(STORAGE_ARCHIVE, null) || emptyArchive();
    state.tasksDoc = lsGet(STORAGE_TASKS, null) || emptyTasks();
    state.chat = ensureMsgIds(lsGet(STORAGE_CHAT, []) || []);
    state.chatUi = lsGet(STORAGE_CHAT_UI, null) || { clearedBeforeId: '' };
    var prefs = lsGet(STORAGE_DS_PREFS, {}) || {};
    state.chatSubject = prefs.lastSubject || '综合';
    // migrate any archive chats without ids
    ((state.archive && state.archive.days) || []).forEach(function (d) {
      if (d) d.chats = ensureMsgIds(d.chats || []);
    });
  }

  function saveArchive() {
    state.archive.updatedAt = isoShanghai();
    // keep ~30 days
    if (state.archive.days && state.archive.days.length > 30) {
      state.archive.days = state.archive.days
        .slice()
        .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); })
        .slice(-30);
    }
    lsSet(STORAGE_ARCHIVE, state.archive);
  }

  function markArchiveDirty() {
    state.archiveDirty = true;
  }

  function syncPrefs() {
    var p = lsGet(STORAGE_SYNC_PREFS, null) || {};
    return {
      autoUpload: Boolean(p.autoUpload),
      lastAutoUploadAt: Number(p.lastAutoUploadAt) > 0 ? Number(p.lastAutoUploadAt) : 0,
      lastUploadAt: Number(p.lastUploadAt) > 0 ? Number(p.lastUploadAt) : 0,
      lastUploadOk: Boolean(p.lastUploadOk),
      lastUploadError: p.lastUploadError ? String(p.lastUploadError) : ''
    };
  }

  function saveSyncPrefs(patch) {
    var cur = syncPrefs();
    Object.keys(patch || {}).forEach(function (k) { cur[k] = patch[k]; });
    lsSet(STORAGE_SYNC_PREFS, cur);
    return cur;
  }

  function archiveHasLearningContent() {
    var days = (state.archive && state.archive.days) || [];
    for (var i = 0; i < days.length; i++) {
      var d = days[i] || {};
      if ((d.completedTaskIds || []).length) return true;
      if ((d.chats || []).length) return true;
      if (String(d.notes || '').trim()) return true;
      if (Number(d.minutesSpent) > 0) return true;
      if ((d.weakTopics || []).length) return true;
      if ((d.chatSummary || []).length) return true;
    }
    return false;
  }

  function formatSyncTime(ts) {
    if (!ts) return '尚无';
    try {
      var d = new Date(ts);
      var x = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
      var m = String(x.getMonth() + 1).padStart(2, '0');
      var day = String(x.getDate()).padStart(2, '0');
      var h = String(x.getHours()).padStart(2, '0');
      var mi = String(x.getMinutes()).padStart(2, '0');
      return m + '-' + day + ' ' + h + ':' + mi;
    } catch (e) {
      return '尚无';
    }
  }

  function syncStatusText() {
    var p = syncPrefs();
    if (state.pushInFlight) return '正在上传…';
    if (p.lastUploadAt) {
      return (p.lastUploadOk ? '最近上传成功 ' : '最近上传失败 ') + formatSyncTime(p.lastUploadAt) +
        (p.lastUploadOk ? '' : (p.lastUploadError ? '：' + p.lastUploadError : '')) +
        (state.archiveDirty ? ' · 有未上传改动' : '');
    }
    if (state.archiveDirty) return '有未上传的学习改动';
    if (p.autoUpload) return '已开启每 5 分钟自动上传（仅本页打开时）';
    return '自动上传已关闭';
  }

  function saveTasksCache() {
    lsSet(STORAGE_TASKS, state.tasksDoc);
  }

  function saveChat() {
    // Keep a generous local mirror; archive.days[].chats is the upload source of truth.
    lsSet(STORAGE_CHAT, ensureMsgIds(state.chat).slice(-400));
  }

  function saveChatUi() {
    lsSet(STORAGE_CHAT_UI, state.chatUi || { clearedBeforeId: '' });
  }

  function visibleChatMessages() {
    var all = ensureMsgIds(state.chat || []);
    var cut = (state.chatUi && state.chatUi.clearedBeforeId) || '';
    if (!cut) return all.slice();
    var idx = -1;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === cut) idx = i;
    }
    if (idx === -1) return all.slice();
    return all.slice(idx + 1);
  }

  function appendChatMessage(msg) {
    if (!msg.id) msg.id = newMsgId();
    if (!msg.at) msg.at = isoShanghai();
    state.chat.push(msg);
    saveChat();
    var day = ensureDay(studyDate());
    day.chats = ensureMsgIds(day.chats || []);
    // de-dupe by id when re-appending
    var exists = false;
    for (var i = 0; i < day.chats.length; i++) {
      if (day.chats[i] && day.chats[i].id === msg.id) { exists = true; break; }
    }
    if (!exists) day.chats.push({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      subject: msg.subject || '',
      at: msg.at
    });
    // keep last ~200 per day in archive
    if (day.chats.length > 200) day.chats = day.chats.slice(-200);
    saveArchive();
    markArchiveDirty();
    return msg;
  }

  function ensureDay(date) {
    var days = state.archive.days || (state.archive.days = []);
    for (var i = 0; i < days.length; i++) {
      if (days[i].date === date) return days[i];
    }
    var day = {
      date: date,
      completedTaskIds: [],
      notes: '',
      weakTopics: [],
      chatSummary: [],
      chats: [],
      minutesSpent: 0
    };
    days.push(day);
    return day;
  }

  function todayTasks() {
    var date = studyDate();
    var all = (state.tasksDoc && state.tasksDoc.tasks) || [];
    return all.filter(function (t) {
      return t && t.date === date && (t.status || 'active') !== 'cancelled';
    }).sort(function (a, b) {
      return (a.priority || 99) - (b.priority || 99);
    });
  }

  /* ---------- GitHub ---------- */

  function ghPrefs() {
    var p = lsGet(STORAGE_GH_PREFS, {}) || {};
    return {
      owner: p.owner || DEFAULT_OWNER,
      repo: p.repo || DEFAULT_REPO
    };
  }

  function saveGhPrefs(owner, repo) {
    lsSet(STORAGE_GH_PREFS, {
      owner: (owner || DEFAULT_OWNER).trim() || DEFAULT_OWNER,
      repo: (repo || DEFAULT_REPO).trim() || DEFAULT_REPO
    });
  }

  function ghToken() {
    return normalizeToken(lsGetStr(STORAGE_GH_TOKEN));
  }

  function repoSlug() {
    var p = ghPrefs();
    return p.owner + '/' + p.repo;
  }

  function contentsUrl(path) {
    return 'https://api.github.com/repos/' + repoSlug() + '/contents/' + path;
  }

  function rawUrl(path) {
    return 'https://raw.githubusercontent.com/' + repoSlug() + '/main/' + path;
  }

  function githubContents(method, path, token, body) {
    var headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(contentsUrl(path), {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    }).then(function (response) {
      return response.text().then(function (text) {
        var data = null;
        if (text) {
          try { data = JSON.parse(text); } catch (e) { data = { message: String(text).slice(0, 180) }; }
        }
        return { ok: response.ok, status: response.status, data: data };
      });
    });
  }

  function decodeContentsFile(data) {
    if (!data || !data.content) throw new Error('文件内容为空');
    return JSON.parse(fromB64(data.content));
  }

  function fetchJsonPreferRaw(path, token) {
    // Prefer Contents API when token present (works for private); else raw.
    if (token) {
      return githubContents('GET', path, token).then(function (got) {
        if (got.status === 200) return decodeContentsFile(got.data);
        if (got.status === 404) throw new Error('仓库里还没有 ' + path);
        if (got.status === 401 || got.status === 403) {
          throw new Error('令牌无效或没有 Contents 读权限');
        }
        throw new Error('拉取失败 HTTP ' + got.status);
      });
    }
    return fetch(rawUrl(path) + '?_=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('拉取失败 HTTP ' + r.status + '（公开 raw；私有库请填 Token）');
      return r.json();
    });
  }

  function mergeArchiveDays(remote, local) {
    var map = {};
    ((remote && remote.days) || []).forEach(function (d) {
      if (d && d.date) map[d.date] = JSON.parse(JSON.stringify(d));
    });
    ((local && local.days) || []).forEach(function (d) {
      if (!d || !d.date) return;
      var r = map[d.date];
      if (!r) {
        map[d.date] = JSON.parse(JSON.stringify(d));
        return;
      }
      // same date: union lists, concatenate distinct notes (local first), max minutes
      map[d.date] = {
        date: d.date,
        completedTaskIds: uniqueStrings([].concat(r.completedTaskIds || [], d.completedTaskIds || [])),
        notes: mergeNotes(d.notes, r.notes),
        weakTopics: mergeWeakTopics(r.weakTopics || [], d.weakTopics || []),
        chatSummary: mergeChatSummary(r.chatSummary || [], d.chatSummary || []),
        chats: mergeChats(r.chats || [], d.chats || []),
        minutesSpent: Math.max(Number(r.minutesSpent) || 0, Number(d.minutesSpent) || 0)
      };
    });
    var days = Object.keys(map).sort().map(function (k) { return map[k]; });
    return {
      schemaVersion: 1,
      timezone: 'Asia/Shanghai',
      updatedAt: isoShanghai(),
      days: days.slice(-30)
    };
  }

  function uniqueStrings(arr) {
    var seen = {};
    var out = [];
    arr.forEach(function (x) {
      var s = String(x || '');
      if (!s || seen[s]) return;
      seen[s] = 1;
      out.push(s);
    });
    return out;
  }

  function mergeNotes(localNotes, remoteNotes) {
    var local = String(localNotes == null ? '' : localNotes).trim();
    var remote = String(remoteNotes == null ? '' : remoteNotes).trim();
    if (!local) return remote;
    if (!remote) return local;
    if (local === remote) return local;
    // keep both sides so a multi-device merge never drops text
    return local + '\n---\n' + remote;
  }

  function mergeWeakTopics(a, b) {
    var seen = {};
    var out = [];
    a.concat(b).forEach(function (w) {
      if (w == null) return;
      var key = typeof w === 'string'
        ? w
        : [w.subject || '', w.topic || '', w.detail || ''].join('|');
      key = String(key).trim();
      if (!key || seen[key]) return;
      seen[key] = 1;
      out.push(w);
    });
    return out;
  }

  function mergeChatSummary(a, b) {
    var key = function (c) { return (c.at || '') + '|' + (c.q || ''); };
    var seen = {};
    var out = [];
    a.concat(b).forEach(function (c) {
      if (!c) return;
      var k = key(c);
      if (seen[k]) return;
      seen[k] = 1;
      out.push(c);
    });
    return out.slice(-40);
  }

  function mergeChats(a, b) {
    var map = {};
    var order = [];
    function put(c) {
      if (!c) return;
      var id = c.id || ('legacy_' + (c.at || '') + '_' + (c.role || '') + '_' + String(c.content || '').slice(0, 40));
      if (!c.id) c = {
        id: id,
        role: c.role,
        content: c.content,
        subject: c.subject || '',
        at: c.at || ''
      };
      if (!map[id]) {
        map[id] = c;
        order.push(id);
      } else {
        // prefer longer content if same id clash
        var cur = map[id];
        if (String(c.content || '').length > String(cur.content || '').length) map[id] = c;
      }
    }
    (a || []).forEach(put);
    (b || []).forEach(put);
    return order.map(function (id) { return map[id]; }).slice(-300);
  }

  function mergeTasksDoc(incoming) {
    var map = {};
    var order = [];
    function put(t) {
      if (!t || !t.id) return;
      var id = String(t.id);
      if (!map[id]) order.push(id);
      map[id] = t;
    }
    (((state.tasksDoc && state.tasksDoc.tasks) || [])).forEach(put);
    ((incoming && incoming.tasks) || []).forEach(put);
    var base = incoming && typeof incoming === 'object' ? incoming : emptyTasks();
    var out = {
      schemaVersion: base.schemaVersion || 1,
      timezone: base.timezone || 'Asia/Shanghai',
      updatedAt: base.updatedAt || isoShanghai(),
      demo: base.demo,
      demoNote: base.demoNote,
      tasks: order.map(function (id) { return map[id]; })
    };
    // drop cancelled-only noise older than 60 days is unnecessary; keep all cached ids
    return out;
  }

  function pullTasks() {
    var token = ghToken();
    return fetchJsonPreferRaw(TASKS_PATH, token).then(function (doc) {
      if (!doc || !Array.isArray(doc.tasks)) throw new Error('daily-tasks.json 格式不对');
      state.tasksDoc = mergeTasksDoc(doc);
      saveTasksCache();
      return state.tasksDoc;
    });
  }

  function tasksForDate(date) {
    var all = (state.tasksDoc && state.tasksDoc.tasks) || [];
    return all.filter(function (t) {
      return t && t.date === date && (t.status || 'active') !== 'cancelled';
    }).sort(function (a, b) {
      return (a.priority || 99) - (b.priority || 99);
    });
  }

  function taskDateList() {
    var set = {};
    ((state.tasksDoc && state.tasksDoc.tasks) || []).forEach(function (t) {
      if (t && t.date) set[t.date] = 1;
    });
    var today = studyDate();
    set[today] = 1;
    return Object.keys(set).sort(function (a, b) { return String(b).localeCompare(String(a)); });
  }

  function hydrateChatFromArchive() {
    var collected = [];
    ((state.archive && state.archive.days) || []).forEach(function (d) {
      ensureMsgIds(d.chats || []).forEach(function (c) { collected.push(c); });
    });
    state.chat = mergeChats(state.chat || [], collected);
    saveChat();
  }

  function pullArchive() {
    var token = ghToken();
    return fetchJsonPreferRaw(ARCHIVE_PATH, token).then(function (remote) {
      state.archive = mergeArchiveDays(remote || emptyArchive(), state.archive || emptyArchive());
      saveArchive();
      hydrateChatFromArchive();
      // clearedBeforeId unchanged → UI 清屏状态保留，数据不丢
      return state.archive;
    });
  }

  function pushArchive(attempt, opts) {
    attempt = attempt || 0;
    opts = opts || {};
    var token = ghToken();
    if (!token) return Promise.reject(new Error('请先在设置里保存 GitHub Token'));
    if (attempt === 0) {
      if (state.pushInFlight) return Promise.reject(new Error('正在上传，请稍候'));
      state.pushInFlight = true;
    }
    // Always GET remote → merge → PUT; never blind-overwrite another device's changes.
    return githubContents('GET', ARCHIVE_PATH, token).then(function (got) {
      var sha = '';
      var remote = emptyArchive();
      if (got.status === 200) {
        sha = got.data && got.data.sha ? String(got.data.sha) : '';
        try { remote = decodeContentsFile(got.data); } catch (e) { remote = emptyArchive(); }
      } else if (got.status !== 404) {
        if (got.status === 401 || got.status === 403) throw new Error('令牌无效或没有 Contents 写权限');
        throw new Error('读取远程存档失败 HTTP ' + got.status);
      }
      var merged = mergeArchiveDays(remote, state.archive || emptyArchive());
      state.archive = merged;
      saveArchive();
      var body = {
        message: 'sync student archive ' + studyDate(),
        content: padB64(JSON.stringify(merged, null, 2) + '\n'),
        branch: 'main'
      };
      if (sha) body.sha = sha;
      return githubContents('PUT', ARCHIVE_PATH, token, body).then(function (put) {
        if (put.ok) {
          state.archiveDirty = false;
          var now = Date.now();
          var patch = { lastUploadAt: now, lastUploadOk: true, lastUploadError: '' };
          if (opts.auto) patch.lastAutoUploadAt = now;
          saveSyncPrefs(patch);
          return merged;
        }
        if (put.status === 409) {
          // remote moved under us: re-GET + re-merge, retry at most twice
          if (attempt < 2) return pushArchive(attempt + 1, opts);
          throw new Error('上传冲突：合并重试 2 次后仍失败（HTTP 409）');
        }
        throw new Error('上传失败 HTTP ' + put.status + (put.data && put.data.message ? '：' + put.data.message : ''));
      });
    }).then(function (res) {
      state.pushInFlight = false;
      return res;
    }, function (err) {
      state.pushInFlight = false;
      saveSyncPrefs({
        lastUploadAt: Date.now(),
        lastUploadOk: false,
        lastUploadError: (err && err.message) ? String(err.message).slice(0, 120) : '上传失败'
      });
      throw err;
    });
  }

  function maybeAutoUpload() {
    var prefs = syncPrefs();
    if (!prefs.autoUpload) return;
    if (!ghToken()) return;
    if (!state.archiveDirty) return;
    if (state.pushInFlight) return;
    if (!archiveHasLearningContent()) return; // 首次开启空白不覆盖
    if (prefs.lastAutoUploadAt && (Date.now() - prefs.lastAutoUploadAt) < AUTO_UPLOAD_GAP_MS) return;
    saveSyncPrefs({ lastAutoUploadAt: Date.now() }); // 占位防并发重复触发；成功/失败再更新
    pushArchive(0, { auto: true }).then(function () {
      refreshSyncStatusUi();
    }).catch(function () {
      // dirty 保留，下次再试；不刷屏
      refreshSyncStatusUi();
    });
  }

  function startAutoUploadLoop() {
    if (state.autoUploadTimer) return;
    state.autoUploadTimer = setInterval(function () {
      try { maybeAutoUpload(); } catch (e) {}
    }, AUTO_UPLOAD_TICK_MS);
  }

  function refreshSyncStatusUi() {
    var el = $('sync-backup-status');
    if (!el) return;
    var prefs = syncPrefs();
    var kind = state.pushInFlight ? 'busy' : (prefs.lastUploadAt ? (prefs.lastUploadOk ? 'ok' : 'err') : '');
    setStatus('sync-backup-status', kind, syncStatusText());
  }

  /* ---------- DeepSeek ---------- */

  function dsKey() {
    return normalizeToken(lsGetStr(STORAGE_DS_KEY));
  }

  function dsModel() {
    var p = lsGet(STORAGE_DS_PREFS, {}) || {};
    return DEEPSEEK_MODELS.indexOf(p.model) === -1 ? 'deepseek-chat' : p.model;
  }

  function saveDsPrefs(extra) {
    var p = lsGet(STORAGE_DS_PREFS, {}) || {};
    Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
    lsSet(STORAGE_DS_PREFS, p);
  }

  function systemPrompt(subject) {
    return '你是广西高考一轮复习辅导老师，擅长' + (subject || '综合') +
      '。学生用中文提问。解题要步骤清晰，写出关键推理，不要只给最终答案糊弄；' +
      '如果题目信息不足，先指出缺什么再尽量给思路。简洁、可在手表小屏阅读。';
  }

  function hasNativeDeepseek() {
    return !!(window.StudyHubNative && typeof window.StudyHubNative.deepseekChat === 'function');
  }

  function nativeDeepseekChat(bodyObj) {
    return new Promise(function (resolve, reject) {
      var id = 'ds_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      var timeout = setTimeout(function () {
        cleanup();
        reject(new Error('DeepSeek 原生请求超时'));
      }, 120000);
      function cleanup() {
        clearTimeout(timeout);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
      }
      var cb = '__studyhub_ds_cb_' + id;
      window[cb] = function (err, text) {
        cleanup();
        if (err) {
          reject(new Error(String(err)));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch (e) {
          reject(new Error('原生层返回无法解析'));
        }
      };
      try {
        window.StudyHubNative.deepseekChat(id, cb, JSON.stringify(bodyObj));
      } catch (e) {
        cleanup();
        reject(e);
      }
    });
  }

  function browserDeepseekChat(bodyObj, key) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var abortTimer = null;
    if (controller) {
      abortTimer = setTimeout(function () {
        try { controller.abort(); } catch (e) {}
      }, ASK_TIMEOUT_MS);
    }
    return fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify(bodyObj),
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      return response.text().then(function (text) {
        var data = null;
        if (text) {
          try { data = JSON.parse(text); } catch (e) { data = { message: String(text).slice(0, 180) }; }
        }
        if (!response.ok) {
          var msg = (data && data.error && data.error.message) || (data && data.message) || ('HTTP ' + response.status);
          if (response.status === 401) msg = 'DeepSeek API Key 无效';
          if (response.status === 402) msg = 'DeepSeek 余额不足';
          if (response.status === 429) msg = '请求过于频繁，稍后再试';
          if (!response.status) msg = '无法连接 DeepSeek（网页可能被 CORS 拦截，当前以网页浏览器实测为准）';
          throw new Error(msg);
        }
        return data;
      });
    }).catch(function (err) {
      if (err && err.name === 'AbortError') throw new Error('等待超时（请求已中止）');
      if (err && err.message) throw err;
      throw new Error('无法连接 DeepSeek（网页可能被 CORS 拦截，当前以网页浏览器实测为准）');
    }).then(function (data) {
      if (abortTimer) clearTimeout(abortTimer);
      return data;
    }, function (err) {
      if (abortTimer) clearTimeout(abortTimer);
      throw err;
    });
  }

  function askDeepseek(question, subject) {
    var key = dsKey();
    if (!key) return Promise.reject(new Error('请先在设置里填写 DeepSeek API Key'));
    var model = dsModel();
    var bodyObj = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt(subject) },
        { role: 'user', content: question }
      ]
    };
    if (model !== 'deepseek-reasoner') bodyObj.temperature = 0.4;

    var runner;
    if (hasNativeDeepseek()) {
      runner = nativeDeepseekChat({
        apiKey: key,
        model: bodyObj.model,
        messages: bodyObj.messages,
        temperature: bodyObj.temperature
      }).catch(function () {
        return browserDeepseekChat(bodyObj, key);
      });
    } else {
      runner = browserDeepseekChat(bodyObj, key);
    }

    return runner.then(function (data) {
      var content = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : '';
      if (!content) throw new Error('DeepSeek 没有返回内容');
      return String(content);
    });
  }

  function briefAnswer(text) {
    var s = String(text || '').replace(/\s+/g, ' ').trim();
    if (s.length <= 80) return s;
    return s.slice(0, 78) + '…';
  }

  /* ---------- UI ---------- */

  function setView(name) {
    state.view = name;
    ['today', 'chat', 'archive', 'settings'].forEach(function (v) {
      var el = $('view-' + v);
      if (el) el.hidden = v !== name;
    });
    document.querySelectorAll('.tab-item').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-nav') === name);
    });
    var app = $('app');
    if (app) app.classList.toggle('is-chat', name === 'chat');
    render();
  }

  function setStatus(elId, stateName, msg) {
    var el = $(elId);
    if (!el) return;
    el.className = 'status-line' + (stateName ? ' is-' + stateName : '');
    el.textContent = msg || '';
  }

  function renderToday() {
    var root = $('view-today');
    if (!root) return;
    var date = studyDate();
    var day = ensureDay(date);
    var tasks = todayTasks();
    var html = '';
    html += '<section class="card"><h2 class="card-title">今日任务</h2>';
    html += '<p class="muted">学习日 ' + date + '（凌晨 4:00 换日）· 共 ' + tasks.length + ' 项</p>';
    if (!tasks.length) {
      html += '<div class="empty">还没有任务。点右上角「同步」或到「任务」页查看；设置里可拉取 GitHub 任务。</div>';
    } else {
      tasks.forEach(function (t) {
        var done = (day.completedTaskIds || []).indexOf(t.id) !== -1;
        html += '<div class="task' + (done ? ' is-done' : '') + '" data-task-id="' + escapeAttr(t.id) + '">';
        html += '<input class="task-check" type="checkbox" ' + (done ? 'checked' : '') + ' aria-label="完成">';
        html += '<div>';
        html += '<div class="task-meta"><span class="dot ' + subjectClass(t.subject) + '"></span>';
        html += '<span>' + escapeHtml(t.subject || '') + '</span>';
        if (t.slot) html += '<span>· ' + escapeHtml(t.slot) + '</span>';
        html += '</div>';
        html += '<h3 class="task-title">' + escapeHtml(t.title || '') + '</h3>';
        if (t.body) html += '<p class="task-body">' + escapeHtml(t.body) + '</p>';
        if (t.from) html += '<div class="task-from">来自 ' + escapeHtml(t.from) + '</div>';
        html += '</div></div>';
      });
    }
    html += '</section>';

    html += '<section class="card"><h2 class="card-title">今日备注</h2>';
    html += '<div class="field"><textarea id="day-notes" rows="3" placeholder="今天哪里不会、想让 bot 知道的…">' +
      escapeHtml(day.notes || '') + '</textarea></div>';
    html += '<div class="btn-row"><button type="button" class="btn secondary" id="btn-save-notes">保存备注</button></div>';
    html += '</section>';
    root.innerHTML = html;

    root.querySelectorAll('.task-check').forEach(function (box) {
      box.addEventListener('change', function () {
        var taskEl = box.closest('.task');
        var id = taskEl && taskEl.getAttribute('data-task-id');
        if (!id) return;
        var d = ensureDay(studyDate());
        var set = {};
        (d.completedTaskIds || []).forEach(function (x) { set[x] = 1; });
        if (box.checked) set[id] = 1; else delete set[id];
        d.completedTaskIds = Object.keys(set);
        saveArchive();
        markArchiveDirty();
        renderToday();
        toast(box.checked ? '已勾完成' : '已取消完成');
      });
    });
    var btn = $('btn-save-notes');
    if (btn) {
      btn.addEventListener('click', function () {
        var d = ensureDay(studyDate());
        d.notes = ($('day-notes') && $('day-notes').value) || '';
        saveArchive();
        markArchiveDirty();
        toast('备注已保存到本地存档');
      });
    }
  }

  function renderRich(text) {
    try {
      if (window.StudyHubRender && typeof window.StudyHubRender.render === 'function') {
        return window.StudyHubRender.render(String(text == null ? '' : text));
      }
    } catch (e) {}
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function stopThinkingAnim() {
    if (state.thinkingDots) {
      clearInterval(state.thinkingDots);
      state.thinkingDots = null;
    }
    if (state.askTimer) {
      clearTimeout(state.askTimer);
      state.askTimer = null;
    }
  }

  function setChatWaiting(on, detail) {
    var status = $('chat-status');
    var send = $('btn-ask');
    if (send) send.disabled = !!on || state.busy;
    if (!status) return;
    if (on) {
      status.className = 'status-line is-busy chat-waiting';
      var base = detail || '正在思考，等待 DeepSeek 回复';
      var n = 0;
      status.textContent = base + '…';
      stopThinkingAnim();
      state.thinkingDots = setInterval(function () {
        n = (n + 1) % 4;
        status.textContent = base + '…'.slice(0, n) + ['', '.', '..', '...'][n];
        // keep aria busy
      }, 400);
    } else {
      stopThinkingAnim();
    }
  }

  function renderChat() {
    var root = $('view-chat');
    if (!root) return;
    var msgs = visibleChatMessages();
    var log = msgs.map(function (m) {
      if (m.role === 'system') {
        return '<div class="bubble system" data-id="' + escapeAttr(m.id || '') + '">' + escapeHtml(m.content) + '</div>';
      }
      var cls = m.role === 'user' ? 'user' : 'assistant';
      var body = m.role === 'assistant' ? renderRich(m.content) : escapeHtml(m.content).replace(/\n/g, '<br>');
      return '<div class="bubble ' + cls + '" data-id="' + escapeAttr(m.id || '') + '"><div class="bubble-inner">' + body + '</div></div>';
    }).join('');
    if (!log) {
      log = '<div class="bubble system">把题干贴到底部输入框，点发送。清屏只藏界面记录，完整对话仍会进存档上传。</div>';
    }
    if (state.busy) {
      log += '<div class="bubble system is-thinking" id="bubble-thinking">正在思考，等待回复<span class="dots"></span></div>';
    }

    root.innerHTML =
      '<div class="chat-shell">' +
        '<div class="chat-log" id="chat-log">' + log + '</div>' +
        '<div class="status-line" id="chat-status"></div>' +
        '<div class="chat-composer" id="chat-composer">' +
          '<button type="button" class="chat-clear-btn" id="btn-chat-clear" title="清屏（仅隐藏界面）" aria-label="清屏">×</button>' +
          '<input class="chat-input" id="chat-input" type="text" enterkeyhint="send" autocomplete="off" placeholder="输入问题…">' +
          '<button type="button" class="btn chat-send" id="btn-ask">发送</button>' +
        '</div>' +
      '</div>';

    $('btn-ask').addEventListener('click', onAsk);
    $('btn-chat-clear').addEventListener('click', onClearChatUi);
    var input = $('chat-input');
    if (input) {
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && !ev.shiftKey) {
          ev.preventDefault();
          onAsk();
        }
      });
    }
    if (state.busy) {
      setChatWaiting(true, '正在思考，等待 DeepSeek 回复');
      if ($('btn-ask')) $('btn-ask').disabled = true;
    }
    var logEl = $('chat-log');
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  }

  function onClearChatUi() {
    var all = ensureMsgIds(state.chat || []);
    var last = all.length ? all[all.length - 1] : null;
    state.chatUi = { clearedBeforeId: last ? last.id : '' };
    // If empty history, mark a synthetic barrier so refresh stays clear until new msgs
    if (!last) state.chatUi.clearedBeforeId = 'cleared_empty_' + Date.now().toString(36);
    saveChatUi();
    toast('已清屏（完整对话仍保留，上传不受影响）');
    renderChat();
  }

  function onAsk() {
    var input = $('chat-input');
    var q = ((input && input.value) || '').trim();
    if (!q) { toast('先写问题'); return; }
    if (state.busy) return;
    state.busy = true;
    if (input) input.value = '';
    appendChatMessage({ role: 'user', content: q, subject: state.chatSubject || '综合' });
    renderChat();
    setChatWaiting(true, '正在思考，等待 DeepSeek 回复');
    if ($('btn-ask')) $('btn-ask').disabled = true;

    var finished = false;
    function finishOk(ans) {
      if (finished) return;
      finished = true;
      stopThinkingAnim();
      appendChatMessage({ role: 'assistant', content: ans, subject: state.chatSubject || '综合' });
      state.busy = false;
      renderChat();
      setStatus('chat-status', 'ok', '已回答');
    }
    function finishErr(err) {
      if (finished) return;
      finished = true;
      stopThinkingAnim();
      state.busy = false;
      renderChat();
      var msg = (err && err.message) ? err.message : String(err || '请求失败');
      setStatus('chat-status', 'err', msg);
      toast(msg);
    }

    state.askTimer = setTimeout(function () {
      finishErr(new Error('等待超时（' + Math.round(ASK_TIMEOUT_MS / 1000) + 's），请检查网络或稍后重试'));
    }, ASK_TIMEOUT_MS);

    askDeepseek(q, state.chatSubject || '综合').then(finishOk).catch(finishErr);
  }

  function renderArchive() {
    // 「任务」页：按日期浏览缓存的 daily-tasks（原 archive tab）
    var root = $('view-archive');
    if (!root) return;
    var dates = taskDateList();
    var selected = state.tasksBrowseDate || studyDate();
    if (dates.indexOf(selected) === -1) selected = dates[0] || studyDate();
    state.tasksBrowseDate = selected;
    var day = null;
    ((state.archive && state.archive.days) || []).forEach(function (d) {
      if (d && d.date === selected) day = d;
    });
    var completed = (day && day.completedTaskIds) || [];
    var tasks = tasksForDate(selected);
    var opts = dates.map(function (d) {
      return '<option value="' + escapeAttr(d) + '"' + (d === selected ? ' selected' : '') + '>' +
        escapeHtml(d) + (d === studyDate() ? '（今天）' : '') + '</option>';
    }).join('');

    var body;
    if (!tasks.length) {
      body = '<div class="empty">这一天还没有缓存任务。点右上角「同步」或到设置 → 同步与备份拉取。</div>';
    } else {
      body = tasks.map(function (t) {
        var done = completed.indexOf(t.id) !== -1;
        var html = '<div class="task' + (done ? ' is-done' : '') + '" data-task-id="' + escapeAttr(t.id) + '">';
        html += '<input class="task-check" type="checkbox" ' + (done ? 'checked' : '') + ' aria-label="完成">';
        html += '<div>';
        html += '<div class="task-meta"><span class="dot ' + subjectClass(t.subject) + '"></span>';
        html += '<span>' + escapeHtml(t.subject || '') + '</span>';
        if (t.slot) html += '<span>· ' + escapeHtml(t.slot) + '</span>';
        html += '<span class="tag" style="margin-left:6px">' + (done ? '已完成' : '未完成') + '</span>';
        html += '</div>';
        html += '<h3 class="task-title">' + escapeHtml(t.title || '') + '</h3>';
        if (t.body) html += '<p class="task-body">' + escapeHtml(t.body) + '</p>';
        if (t.from) html += '<div class="task-from">来自 ' + escapeHtml(t.from) + '</div>';
        html += '</div></div>';
        return html;
      }).join('');
    }

    root.innerHTML =
      '<section class="card">' +
        '<h2 class="card-title">每日任务</h2>' +
        '<p class="muted">浏览 bot 下发的任务缓存（不含答案）。默认今天，可切换历史日期。</p>' +
        '<div class="field"><label>日期</label><select id="tasks-date">' + opts + '</select></div>' +
        '<p class="muted">共 ' + tasks.length + ' 项</p>' +
        body +
      '</section>';

    var sel = $('tasks-date');
    if (sel) {
      sel.addEventListener('change', function () {
        state.tasksBrowseDate = sel.value || studyDate();
        renderArchive();
      });
    }
    root.querySelectorAll('.task-check').forEach(function (box) {
      box.addEventListener('change', function () {
        var taskEl = box.closest('.task');
        var id = taskEl && taskEl.getAttribute('data-task-id');
        if (!id) return;
        var d = ensureDay(state.tasksBrowseDate || studyDate());
        var set = {};
        (d.completedTaskIds || []).forEach(function (x) { set[x] = 1; });
        if (box.checked) set[id] = 1; else delete set[id];
        d.completedTaskIds = Object.keys(set);
        saveArchive();
        markArchiveDirty();
        renderArchive();
        toast(box.checked ? '已勾完成' : '已取消完成');
      });
    });
  }

  function secretFieldHtml(id, placeholder) {
    var eyeSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    return '<div class="secret-field">' +
      '<input id="' + id + '" class="secret-input" type="password" autocomplete="off" spellcheck="false" placeholder="' + escapeAttr(placeholder) + '">' +
      '<button type="button" class="secret-btn" data-secret-eye="' + id + '" title="显示密码" aria-label="显示密码" aria-pressed="false">' + eyeSvg + '</button>' +
      '<button type="button" class="secret-btn" data-secret-copy="' + id + '" title="复制" aria-label="复制">复制</button>' +
    '</div>';
  }

  function bindSecretField(inputId, savedValue) {
    var input = $(inputId);
    if (!input) return;
    var eye = document.querySelector('[data-secret-eye="' + inputId + '"]');
    var copy = document.querySelector('[data-secret-copy="' + inputId + '"]');

    var eyeOpenSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    var eyeOffSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

    function setVisible(visible) {
      input.type = visible ? 'text' : 'password';
      if (eye) {
        var label = visible ? '隐藏密码' : '显示密码';
        eye.setAttribute('title', label);
        eye.setAttribute('aria-label', label);
        eye.setAttribute('aria-pressed', visible ? 'true' : 'false');
        eye.innerHTML = visible ? eyeOffSvg : eyeOpenSvg;
      }
    }

    if (eye) {
      eye.addEventListener('click', function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      if (ev && ev.preventDefault) ev.preventDefault();
        setVisible(input.type === 'password');
      });
    }

    if (copy) {
      copy.addEventListener('click', function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      if (ev && ev.preventDefault) ev.preventDefault();
        var val = normalizeToken(input.value);
        if (!val) val = normalizeToken(savedValue || '');
        if (!val) {
          if (typeof toast === 'function') toast('没有可复制的内容');
          return;
        }
        function ok() {
          if (typeof toast === 'function') toast('已复制到剪贴板');
        }
        function fail(err) {
          var msg = (err && err.message) ? err.message : '剪贴板不可用';
          if (typeof toast === 'function') toast('复制失败：' + msg);
        }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(val).then(ok).catch(fail);
          } else {
            var ta = document.createElement('textarea');
            ta.value = val;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            try {
              if (document.execCommand('copy')) ok();
              else fail(new Error('execCommand 复制失败'));
            } catch (e) { fail(e); }
            document.body.removeChild(ta);
          }
        } catch (e) { fail(e); }
      });
    }
  }

  function renderSettings() {
    var root = $('view-settings');
    if (!root) return;
    var prefs = ghPrefs();
    var token = ghToken();
    var key = dsKey();
    var model = dsModel();
    var sp = syncPrefs();
    var modelOpts = DEEPSEEK_MODELS.map(function (m) {
      return '<option value="' + m + '"' + (m === model ? ' selected' : '') + '>' + m + '</option>';
    }).join('');

    root.innerHTML =
      '<section class="card">' +
        '<h2 class="card-title">GitHub</h2>' +
        '<p class="muted">默认仓库 <code>yoreverse2423/my-agent</code>。Token 只存本机，需要 Contents 读写。</p>' +
        '<div class="field"><label>Owner</label><input id="gh-owner" value="' + escapeAttr(prefs.owner) + '"></div>' +
        '<div class="field"><label>Repo</label><input id="gh-repo" value="' + escapeAttr(prefs.repo) + '"></div>' +
        '<div class="field"><label>Personal Access Token</label>' +
          secretFieldHtml('gh-token', token ? '已保存（输入新值可覆盖）' : 'github_pat_…') +
        '</div>' +
        '<div class="btn-row">' +
          '<button type="button" class="btn" id="btn-save-gh">保存</button>' +
          '<button type="button" class="btn danger" id="btn-clear-gh">清除 Token</button>' +
        '</div>' +
        '<div class="status-line" id="gh-status">' + (token ? 'Token 已保存（' + mask(token) + '）' : '尚未保存 Token') + '</div>' +
      '</section>' +

      '<section class="card">' +
        '<h2 class="card-title">同步与备份</h2>' +
        '<p class="muted">任务只下载；学习存档可上传。冲突时先拉远程再按日合并。清屏只藏界面，不删对话。</p>' +
        '<label class="check-row" style="display:flex;gap:8px;align-items:center;margin:10px 0">' +
          '<input id="auto-upload" type="checkbox"' + (sp.autoUpload ? ' checked' : '') + '>' +
          '<span>每 5 分钟自动上传存档</span>' +
        '</label>' +
        '<p class="muted">仅在网页/App 打开且已联网、Token 齐全时运行；关掉后不会在后台继续。</p>' +
        '<div class="btn-row">' +
          '<button type="button" class="btn" id="btn-pull-tasks">拉取任务</button>' +
          '<button type="button" class="btn ghost" id="btn-pull-archive">拉取存档</button>' +
          '<button type="button" class="btn secondary" id="btn-push-archive">上传存档</button>' +
        '</div>' +
        '<div class="status-line" id="sync-backup-status"></div>' +
      '</section>' +

      '<section class="card">' +
        '<h2 class="card-title">DeepSeek</h2>' +
        '<p class="muted">Key 只存本机。问答页发送后会显示思考等待。</p>' +
        '<div class="field"><label>API Key</label>' +
          secretFieldHtml('ds-key', key ? '已保存（输入新值可覆盖）' : 'sk-…') +
        '</div>' +
        '<div class="field"><label>模型</label><select id="ds-model">' + modelOpts + '</select></div>' +
        '<div class="btn-row">' +
          '<button type="button" class="btn" id="btn-save-ds">保存</button>' +
          '<button type="button" class="btn danger" id="btn-clear-ds">清除 Key</button>' +
        '</div>' +
        '<div class="status-line" id="ds-status">' +
          (key ? 'Key 已保存（' + mask(key) + '）· ' + (hasNativeDeepseek() ? '原生桥可用' : '浏览器直连') : '尚未保存 Key') +
        '</div>' +
      '</section>' +

      '<section class="card">' +
        '<h2 class="card-title">ColorOS 手表 APK</h2>' +
        '<p class="muted">版本 <strong>' + APK_VERSION + '</strong>（armeabi-v7a · 离线 WebView · 原生 DeepSeek）。</p>' +
        '<div class="btn-row">' +
          '<a class="btn" href="' + APK_URL + '" download>下载手表 APK</a>' +
          '<a class="btn secondary" href="' + PAGES_BASE + APK_URL + '" target="_blank" rel="noopener noreferrer">Pages 直链</a>' +
        '</div>' +
        '<p class="muted" style="margin-top:10px">电脑安装：<code>adb install -r xiaoxuexiji-watch-armeabi-v7a.apk</code></p>' +
      '</section>' +

      '<section class="card">' +
        '<h2 class="card-title">关于</h2>' +
        '<p class="muted">' + escapeHtml(BRAND_NAME) + ' v' + APK_VERSION + ' · 仓库 <code>yoreverse2423/my-agent</code>。协议见 docs/bot-protocol.md。</p>' +
      '</section>';

    bindSecretField('gh-token', token);
    bindSecretField('ds-key', key);
    refreshSyncStatusUi();

    $('btn-save-gh').addEventListener('click', function () {
      saveGhPrefs($('gh-owner').value, $('gh-repo').value);
      var tkn = normalizeToken($('gh-token').value);
      if (tkn) lsSetStr(STORAGE_GH_TOKEN, tkn);
      toast('GitHub 设置已保存');
      renderSettings();
    });
    $('btn-clear-gh').addEventListener('click', function () {
      lsSetStr(STORAGE_GH_TOKEN, '');
      toast('Token 已清除');
      renderSettings();
    });
    $('btn-save-ds').addEventListener('click', function () {
      var k = normalizeToken($('ds-key').value);
      if (k) lsSetStr(STORAGE_DS_KEY, k);
      saveDsPrefs({ model: $('ds-model').value });
      toast('DeepSeek 设置已保存');
      renderSettings();
    });
    $('btn-clear-ds').addEventListener('click', function () {
      lsSetStr(STORAGE_DS_KEY, '');
      toast('Key 已清除');
      renderSettings();
    });

    var auto = $('auto-upload');
    if (auto) {
      auto.addEventListener('change', function () {
        saveSyncPrefs({ autoUpload: !!auto.checked });
        if (auto.checked) {
          startAutoUploadLoop();
          toast('已开启：打开本应用时每 5 分钟尝试上传');
          // 不立刻上传空白
          maybeAutoUpload();
        } else {
          toast('已关闭自动上传');
        }
        refreshSyncStatusUi();
      });
    }
    $('btn-pull-tasks').addEventListener('click', function () {
      setStatus('sync-backup-status', 'busy', '拉取任务中…');
      pullTasks().then(function () {
        setStatus('sync-backup-status', 'ok', '任务已更新');
        toast('任务已同步');
        if (state.view === 'today') renderToday();
        if (state.view === 'archive') renderArchive();
      }).catch(function (e) {
        setStatus('sync-backup-status', 'err', e.message || String(e));
      });
    });
    $('btn-pull-archive').addEventListener('click', function () {
      setStatus('sync-backup-status', 'busy', '拉取存档中…');
      pullArchive().then(function () {
        setStatus('sync-backup-status', 'ok', '存档已合并到本地');
        toast('存档已合并');
      }).catch(function (e) {
        setStatus('sync-backup-status', 'err', e.message || String(e));
      });
    });
    $('btn-push-archive').addEventListener('click', function () {
      setStatus('sync-backup-status', 'busy', '上传中…');
      pushArchive().then(function () {
        refreshSyncStatusUi();
        toast('上传成功');
      }).catch(function (e) {
        refreshSyncStatusUi();
        setStatus('sync-backup-status', 'err', e.message || String(e));
      });
    });
  }

  function mask(s) {
    s = String(s || '');
    if (s.length <= 8) return '****';
    return s.slice(0, 4) + '…' + s.slice(-4);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escapeAttr(s) { return escapeHtml(s); }

  function render() {
    var dateEl = $('study-date');
    if (dateEl) dateEl.textContent = '学习日 ' + studyDate();
    if (state.view === 'today') renderToday();
    else if (state.view === 'chat') renderChat();
    else if (state.view === 'archive') renderArchive();
    else if (state.view === 'settings') renderSettings();
  }

  function bindChrome() {
    document.querySelectorAll('.tab-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setView(btn.getAttribute('data-nav'));
      });
    });
    var quick = $('btn-quick-sync');
    if (quick) {
      quick.addEventListener('click', function () {
        quick.disabled = true;
        pullTasks().then(function () {
          toast('任务已同步');
          if (state.view === 'today') renderToday();
          if (state.view === 'archive') renderArchive();
        }).catch(function (e) {
          toast(e.message || '同步失败');
        }).then(function () { quick.disabled = false; });
      });
    }
  }

  function boot() {
    loadLocal();
    state.tasksBrowseDate = studyDate();
    bindChrome();
    setView('today');
    if (syncPrefs().autoUpload) startAutoUploadLoop();
    // Try silent pull of packaged/sample tasks if cache empty
    if (!state.tasksDoc || !(state.tasksDoc.tasks || []).length) {
      fetch(TASKS_PATH + '?_=' + Date.now(), { cache: 'no-store' }).then(function (r) {
        if (!r.ok) return null;
        return r.json();
      }).then(function (doc) {
        if (doc && Array.isArray(doc.tasks)) {
          state.tasksDoc = mergeTasksDoc(doc);
          saveTasksCache();
          if (state.view === 'today') renderToday();
          if (state.view === 'archive') renderArchive();
        }
      }).catch(function () {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
