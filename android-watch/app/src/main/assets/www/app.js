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
  var STORAGE_BOCHA_KEY = 'studyhub_bocha_key';
  var STORAGE_TAVILY_KEY = 'studyhub_tavily_key';
  var STORAGE_NOTES = 'studyhub_day_notes_v1';
  var STORAGE_SYNC_PREFS = 'studyhub_sync_prefs_v1';

  var DEFAULT_OWNER = 'yoreverse2423';
  var DEFAULT_REPO = 'my-agent';
  var TASKS_PATH = 'data/daily-tasks.json';
  var ARCHIVE_PATH = 'data/student-archive.json';
  var DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
  var DEEPSEEK_MODELS = ['deepseek-flash', 'deepseek-chat', 'deepseek-reasoner'];
  var DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';
  var PAGES_BASE = 'https://yoreverse2423.github.io/my-agent/';
  var APK_URL = 'downloads/xiaoxuexiji-watch-armeabi-v7a.apk';
  var APK_VERSION = '0.3.4';
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
  var ASK_SEARCH_TIMEOUT_MS = 150000;
  var SEARCH_TIMEOUT_MS = 18000;
  var SEARCH_MAX_RESULTS = 6;

  function svgIcon(name, cls) {
    var c = cls || 'ico';
    var paths = {
      sync: '<path d="M21 12a9 9 0 1 1-2.6-6.3" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M21 3v6h-6" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>',
      ask: '<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H10l-4 3.5V15H7.5A2.5 2.5 0 0 1 5 12.5v-6Z" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>',
      search: '<circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="1.85"/><path d="m16 16 4 4" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round"/>',
      tasks: '<path d="M9 6h11M9 12h11M9 18h11" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M5 6.5 6.2 7.7 8 5.5M5 12.5 6.2 13.7 8 11.5M5 18.5 6.2 19.7 8 17.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>',
      clear: '<path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round"/>',
      send: '<path d="M5 12h12M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"/>',
      chev: '<path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>',
      download: '<path d="M12 4v10M8 10l4 4 4-4M5 18h14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>'
    };
    return '<svg class="' + c + '" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || '') + '</svg>';
  }

  function taskRowHtml(t, done, opts) {
    var checkable = !opts || opts.checkable !== false;
    var html = '<div class="task' + (done ? ' is-done' : '') + (checkable ? '' : ' is-readonly') + '" data-task-id="' + escapeAttr(t.id) + '">';
    if (checkable) html += '<input class="task-check" type="checkbox" ' + (done ? 'checked' : '') + ' aria-label="完成">';
    html += '<div>';
    html += '<div class="task-meta"><span class="dot ' + subjectClass(t.subject) + '"></span>';
    html += '<span>' + escapeHtml(t.subject || '') + '</span>';
    if (t.slot) html += '<span>· ' + escapeHtml(t.slot) + '</span>';
    html += '<span class="pill ' + (done ? 'ok' : 'todo') + '">' + (done ? '已完成' : '未完成') + '</span>';
    html += '</div>';
    html += '<h3 class="task-title">' + escapeHtml(t.title || '') + '</h3>';
    if (t.body) html += '<p class="task-body">' + escapeHtml(t.body) + '</p>';
    if (t.from) html += '<div class="task-from">来自 ' + escapeHtml(t.from) + '</div>';
    html += '</div></div>';
    return html;
  }

  function bindTaskChecks(root, dateGetter, after) {
    root.querySelectorAll('.task-check').forEach(function (box) {
      box.addEventListener('change', function () {
        var taskEl = box.closest('.task');
        var id = taskEl && taskEl.getAttribute('data-task-id');
        if (!id) return;
        var d = ensureDay(dateGetter());
        var set = {};
        (d.completedTaskIds || []).forEach(function (x) { set[x] = 1; });
        if (box.checked) set[id] = 1; else delete set[id];
        d.completedTaskIds = Object.keys(set);
        saveArchive();
        markArchiveDirty();
        if (after) after();
        toast(box.checked ? '已勾完成' : '已取消完成');
      });
    });
  }


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
    return DEEPSEEK_MODELS.indexOf(p.model) === -1 ? DEFAULT_DEEPSEEK_MODEL : p.model;
  }

  function saveDsPrefs(extra) {
    var p = lsGet(STORAGE_DS_PREFS, {}) || {};
    Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
    lsSet(STORAGE_DS_PREFS, p);
  }

  function searchEnabled() {
    var p = lsGet(STORAGE_DS_PREFS, {}) || {};
    return !!p.searchEnabled;
  }

  function bochaKey() {
    return normalizeToken(lsGetStr(STORAGE_BOCHA_KEY));
  }

  function tavilyKey() {
    return normalizeToken(lsGetStr(STORAGE_TAVILY_KEY));
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

  function buildSearchUserContent(question, results) {
    var list = results.map(function (r, i) {
      return (i + 1) + '. 标题：' + (r.title || '') +
        '\n   摘要：' + (r.snippet || '（无摘要）') +
        '\n   链接：' + (r.url || '');
    }).join('\n');
    return '学生问题：' + question + '\n\n' +
      '下面是我刚检索到的网页资料（可能有噪声或不完整）：\n' + list + '\n\n' +
      '请优先结合资料、再结合你的知识认真作答。引用资料时在句末用 [1] 这样的编号标注；' +
      '不要在正文里罗列完整链接，来源会在回答末尾统一附上。';
  }

  function appendSearchSources(content, results) {
    var lines = results.map(function (r, i) {
      return (i + 1) + '. ' + (r.title || '来源') + ' — ' + (r.url || '');
    });
    return String(content == null ? '' : content).replace(/\s+$/, '') +
      '\n\n参考来源：\n' + lines.join('\n');
  }

  function appendNoSourceNote(content) {
    return String(content == null ? '' : content).replace(/\s+$/, '') +
      '\n\n（未检索到网页来源，以上为模型直接回答。）';
  }

  function askDeepseek(question, subject, searchResults) {
    var key = dsKey();
    if (!key) return Promise.reject(new Error('请先在设置里填写 DeepSeek API Key'));
    var model = dsModel();
    var searched = Array.isArray(searchResults);
    var results = searched ? searchResults : [];
    var bodyObj = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt(subject) },
        {
          role: 'user',
          content: results.length ? buildSearchUserContent(question, results) : question
        }
      ]
    };
    if (model !== 'deepseek-reasoner') bodyObj.temperature = results.length ? 0.3 : 0.4;

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
      content = String(content);
      if (results.length) return appendSearchSources(content, results);
      if (searched) return appendNoSourceNote(content);
      return content;
    });
  }

  /* ---------- web search ---------- */

  function hasNativeHttpGet() {
    return !!(window.StudyHubNative && typeof window.StudyHubNative.httpGet === 'function');
  }

  function nativeHttpGet(url) {
    return new Promise(function (resolve, reject) {
      var id = 'hg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      var cb = '__studyhub_hg_cb_' + id;
      var timeout = setTimeout(function () {
        cleanup();
        reject(new Error('原生联网请求超时'));
      }, SEARCH_TIMEOUT_MS + 5000);
      function cleanup() {
        clearTimeout(timeout);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
      }
      window[cb] = function (err, text) {
        cleanup();
        if (err) {
          reject(new Error(String(err)));
          return;
        }
        resolve(String(text == null ? '' : text));
      };
      try {
        window.StudyHubNative.httpGet(id, cb, url);
      } catch (e) {
        cleanup();
        reject(e);
      }
    });
  }

  function httpFetch(url, opts, timeoutMs) {
    if (typeof fetch !== 'function') return Promise.reject(new Error('当前环境不支持联网'));
    var o = {};
    Object.keys(opts || {}).forEach(function (k) { o[k] = opts[k]; });
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null;
    if (controller) {
      o.signal = controller.signal;
      timer = setTimeout(function () {
        try { controller.abort(); } catch (e) {}
      }, timeoutMs || SEARCH_TIMEOUT_MS);
    }
    return fetch(url, o).then(function (res) {
      if (timer) clearTimeout(timer);
      return res;
    }, function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('联网请求超时');
      throw err;
    });
  }

  function decodeEntities(s) {
    return String(s == null ? '' : s)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#x([0-9a-f]+);/gi, function (m, hex) {
        try { return String.fromCharCode(parseInt(hex, 16)); } catch (e) { return ''; }
      })
      .replace(/&#(\d+);/g, function (m, dec) {
        try { return String.fromCharCode(parseInt(dec, 10)); } catch (e) { return ''; }
      })
      .replace(/\s+/g, ' ')
      .trim();
  }

  function unwrapBingUrl(raw) {
    var url = String(raw || '').trim().replace(/&amp;/g, '&');
    if (/^\/\//.test(url)) url = 'https:' + url;
    else if (/^\//.test(url)) url = 'https://www.bing.com' + url;
    if (!/^https?:\/\//i.test(url)) return '';
    var m = url.match(/[?&]u=a1([^&]+)/);
    if (m) {
      try {
        var b64 = decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        var decoded = atob(b64);
        if (/^https?:\/\//i.test(decoded)) return decoded;
      } catch (e) {}
    }
    // Keep Bing redirect links as last resort so users can still open the result.
    return url;
  }

  function looksLikeBingJunkTitle(title) {
    var t = String(title || '').trim();
    if (!t) return true;
    if (/^了解更多|更多结果|相关搜索|广告|Ad\b/i.test(t)) return true;
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\s|$)/i.test(t) && t.length < 40) return true;
    return false;
  }

  function parseBingHtml(html) {
    var chunks = String(html || '').split(/<li[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>/i);
    chunks.shift();
    var out = [];
    for (var i = 0; i < chunks.length && out.length < SEARCH_MAX_RESULTS; i++) {
      var block = chunks[i];
      var title = '';
      var url = '';
      var h2 = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (h2) {
        title = decodeEntities(h2[2]);
        url = unwrapBingUrl(h2[1]);
      }
      if (!url || looksLikeBingJunkTitle(title)) {
        var cite = block.match(/<cite[^>]*>([\s\S]*?)<\/cite>/i);
        var citeText = cite ? decodeEntities(cite[1]).replace(/\s*[›>]\s*.*$/, '').trim() : '';
        if (citeText && /^https?:\/\//i.test(citeText)) url = url || citeText;
        else if (citeText && /^[\w.-]+\.[a-z]{2,}/i.test(citeText)) url = url || ('https://' + citeText.split(/\s+/)[0]);
      }
      if (looksLikeBingJunkTitle(title)) {
        var p0 = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        if (p0) {
          var snip0 = decodeEntities(p0[1]);
          if (snip0) title = snip0.slice(0, 48) + (snip0.length > 48 ? '…' : '');
        }
      }
      if (!url || !title) continue;
      if (/bing\.com\/(search|account|images|videos|maps)/i.test(url)) continue;
      if (/support\.microsoft\.com/i.test(url)) continue;
      var p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      out.push({
        title: title,
        url: url,
        snippet: p ? decodeEntities(p[1]) : '',
        source: 'bing'
      });
    }
    return out;
  }

  function fetchBingSearch(query) {
    if (!hasNativeHttpGet()) return Promise.reject(new Error('当前环境不支持'));
    var url = 'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&setlang=zh-CN';
    return nativeHttpGet(url).then(function (html) {
      var results = parseBingHtml(html);
      if (!results.length) throw new Error('页面未解析到结果（可能触发验证）');
      return results;
    });
  }

  function fetchWikiSearch(query) {
    var url = 'https://zh.wikipedia.org/w/api.php?action=query&list=search' +
      '&srsearch=' + encodeURIComponent(query) +
      '&srlimit=' + SEARCH_MAX_RESULTS +
      '&srprop=snippet&format=json&origin=*&utf8=1';
    function viaFetch() {
      return httpFetch(url, { headers: { Accept: 'application/json' } }, SEARCH_TIMEOUT_MS)
        .then(function (res) {
          if (!res.ok) throw new Error('维基 HTTP ' + res.status);
          return res.json();
        });
    }
    // APK: native GET avoids WebView CORS; browser: fetch with origin=* works.
    var runner = hasNativeHttpGet()
      ? nativeHttpGet(url).then(function (text) {
          try { return JSON.parse(text); } catch (e) { throw new Error('维基返回无法解析'); }
        }).catch(viaFetch)
      : viaFetch();
    return runner.then(function (data) {
      var items = data && data.query && data.query.search;
      if (!Array.isArray(items)) throw new Error('维基返回格式异常');
      return items.map(function (it) {
        var title = (it && it.title) || '';
        return {
          title: title,
          url: title
            ? 'https://zh.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'))
            : '',
          snippet: decodeEntities((it && it.snippet) || ''),
          source: 'wikipedia'
        };
      }).filter(function (r) { return r.title && r.url; });
    });
  }

  function fetchBochaSearch(query, key) {
    return httpFetch('https://api.bochaai.com/v1/web-search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify({ query: query, count: SEARCH_MAX_RESULTS, summary: true })
    }, SEARCH_TIMEOUT_MS).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (e) {}
        if (!res.ok) {
          var httpMsg = data && (data.message || (data.error && data.error.message));
          throw new Error('博查 ' + (httpMsg || ('HTTP ' + res.status)));
        }
        if (!data) throw new Error('博查返回无法解析');
        if (data.code && Number(data.code) !== 200) {
          throw new Error('博查 ' + (data.message || ('错误 ' + data.code)));
        }
        var pages = data.data && data.data.webPages && data.data.webPages.value;
        if (!Array.isArray(pages)) pages = [];
        return pages.map(function (p) {
          return {
            title: decodeEntities(p && p.name),
            url: String((p && p.url) || ''),
            snippet: decodeEntities((p && (p.summary || p.snippet)) || ''),
            source: 'bocha'
          };
        }).filter(function (r) { return r.title && /^https?:\/\//i.test(r.url); });
      });
    });
  }

  function fetchTavilySearch(query, key) {
    return httpFetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify({
        api_key: key,
        query: query,
        max_results: SEARCH_MAX_RESULTS,
        search_depth: 'basic',
        include_answer: false
      })
    }, SEARCH_TIMEOUT_MS).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (e) {}
        if (!res.ok) {
          var httpMsg = data && (data.detail || data.message);
          throw new Error('Tavily ' + (httpMsg || ('HTTP ' + res.status)));
        }
        if (!data) throw new Error('Tavily 返回无法解析');
        var items = data.results;
        if (!Array.isArray(items)) throw new Error('Tavily 返回格式异常');
        return items.map(function (p) {
          return {
            title: decodeEntities(p && p.title),
            url: String((p && p.url) || ''),
            snippet: decodeEntities((p && p.content) || ''),
            source: 'tavily'
          };
        }).filter(function (r) { return r.title && /^https?:\/\//i.test(r.url); });
      });
    });
  }

  function mergeSearchResults(lists) {
    var out = [];
    var seen = {};
    (lists || []).forEach(function (list) {
      (list || []).forEach(function (r) {
        if (!r || !r.title || !r.url) return;
        var key = String(r.url).replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
        if (seen[key]) return;
        seen[key] = 1;
        out.push({
          title: String(r.title).slice(0, 200),
          url: String(r.url),
          snippet: String(r.snippet || '').slice(0, 400),
          source: r.source || ''
        });
      });
    });
    return out.slice(0, SEARCH_MAX_RESULTS);
  }

  function searchWeb(query) {
    var errors = [];
    function note(label, err) {
      var msg = err && err.message ? err.message : String(err || '失败');
      errors.push(label + '：' + msg);
      return [];
    }
    function freeSearch() {
      var tasks = [];
      if (hasNativeHttpGet()) {
        tasks.push(fetchBingSearch(query).catch(function (e) { return note('Bing', e); }));
      }
      tasks.push(fetchWikiSearch(query).catch(function (e) { return note('维基', e); }));
      return Promise.all(tasks).then(function (lists) {
        return { results: mergeSearchResults(lists), error: errors.join('；') };
      });
    }
    var bKey = bochaKey();
    var tKey = tavilyKey();
    if (bKey) {
      return fetchBochaSearch(query, bKey).then(function (results) {
        if (results.length) return { results: results, error: '' };
        errors.push('博查：无结果');
        return freeSearch();
      }).catch(function (e) {
        note('博查', e);
        return freeSearch();
      });
    }
    if (tKey) {
      return fetchTavilySearch(query, tKey).then(function (results) {
        if (results.length) return { results: results, error: '' };
        errors.push('Tavily：无结果');
        return freeSearch();
      }).catch(function (e) {
        note('Tavily', e);
        return freeSearch();
      });
    }
    return freeSearch();
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
    var doneN = 0;
    tasks.forEach(function (t) {
      if ((day.completedTaskIds || []).indexOf(t.id) !== -1) doneN += 1;
    });
    var total = tasks.length;
    var pct = total ? Math.round((doneN / total) * 100) : 0;
    var doneIds = day.completedTaskIds || [];
    var taskRows = tasks.map(function (t) {
      return taskRowHtml(t, doneIds.indexOf(t.id) !== -1);
    }).join('');
    var notesEl = $('day-notes');
    var notesDraft = notesEl ? notesEl.value : null;

    root.innerHTML =
      '<section class="panel">' +
        '<div class="panel-head"><h2 class="panel-title">今日进度</h2><span class="panel-meta">' + doneN + ' / ' + total + '</span></div>' +
        '<div class="progress-row">' +
          '<div class="progress-track" aria-hidden="true"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="progress-label">' + pct + '%</div>' +
        '</div>' +
        '<p class="muted" style="margin:8px 0 0">学习日 ' + escapeHtml(date) + '。勾选下方任务即可完成。</p>' +
      '</section>' +

      '<section class="panel">' +
        '<div class="panel-head"><h2 class="panel-title">今日任务</h2><span class="panel-meta">' + doneN + ' / ' + total + '</span></div>' +
        (total ? taskRows : '<div class="empty">今天还没有任务。点右上角同步，或到设置里拉取任务。</div>') +
      '</section>' +

      '<section class="panel">' +
        '<div class="panel-head"><h2 class="panel-title">今日备注</h2></div>' +
        '<div class="field"><textarea id="day-notes" rows="3" placeholder="今天哪里不会、想让她记住的…">' +
          escapeHtml(day.notes || '') + '</textarea></div>' +
        '<div class="btn-row"><button type="button" class="btn secondary" id="btn-save-notes">保存备注</button></div>' +
      '</section>';

    if (notesDraft !== null && $('day-notes')) $('day-notes').value = notesDraft;

    bindTaskChecks(root, function () { return studyDate(); }, function () { renderToday(); });

    var btn = $('btn-save-notes');
    if (btn) {
      btn.addEventListener('click', function () {
        var d = ensureDay(studyDate());
        d.notes = ($('day-notes') && $('day-notes').value) || '';
        saveArchive();
        markArchiveDirty();
        toast('备注已保存');
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
  }

  function clearAskTimer() {
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
      log = '<div class="bubble system">在底部输入问题后发送。清屏只藏界面，完整对话仍会保存并上传。</div>';
    }
    if (state.busy) {
      log += '<div class="bubble system is-thinking" id="bubble-thinking">正在思考，等待回复<span class="dots"></span></div>';
    }
    var searchOn = searchEnabled();

    root.innerHTML =
      '<div class="chat-shell">' +
        '<div class="chat-log" id="chat-log">' + log + '</div>' +
        '<div class="chat-status-bar status-line" id="chat-status"></div>' +
        '<div class="chat-search-row">' +
          '<button type="button" class="search-toggle' + (searchOn ? ' is-on' : '') + '" id="btn-search-toggle" aria-pressed="' + (searchOn ? 'true' : 'false') + '" title="联网搜索后再回答">' +
            svgIcon('search') + '<span>搜索</span>' +
          '</button>' +
          '<span class="search-toggle-hint" id="search-toggle-hint">' +
            (searchOn ? '先检索网页，再由 ' + escapeHtml(dsModel()) + ' 整理并附来源' : '直接问答（不联网检索）') +
          '</span>' +
        '</div>' +
        '<div class="chat-composer" id="chat-composer">' +
          '<button type="button" class="chat-clear-btn" id="btn-chat-clear" title="清屏（只藏界面，对话仍保留）" aria-label="清屏">' + svgIcon('clear') + '</button>' +
          '<input class="chat-input" id="chat-input" type="text" enterkeyhint="send" autocomplete="off" placeholder="把题干或疑问写在这里…">' +
          '<button type="button" class="chat-send" id="btn-ask">发送</button>' +
        '</div>' +
      '</div>';

    $('btn-ask').addEventListener('click', onAsk);
    $('btn-chat-clear').addEventListener('click', onClearChatUi);
    $('btn-search-toggle').addEventListener('click', onToggleSearch);
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
    if (!window.confirm('清屏只会隐藏当前界面上的对话，本机完整记录和上传内容不会删除。确定清屏吗？')) return;
    var all = ensureMsgIds(state.chat || []);
    var last = all.length ? all[all.length - 1] : null;
    state.chatUi = { clearedBeforeId: last ? last.id : '' };
    // If empty history, mark a synthetic barrier so refresh stays clear until new msgs
    if (!last) state.chatUi.clearedBeforeId = 'cleared_empty_' + Date.now().toString(36);
    saveChatUi();
    toast('已清屏（完整对话仍保留，上传不受影响）');
    renderChat();
  }

  function onToggleSearch() {
    var next = !searchEnabled();
    saveDsPrefs({ searchEnabled: next });
    var btn = $('btn-search-toggle');
    var hint = $('search-toggle-hint');
    if (btn) {
      btn.classList.toggle('is-on', next);
      btn.setAttribute('aria-pressed', next ? 'true' : 'false');
    }
    if (hint) {
      hint.textContent = next
        ? '先检索网页，再由 ' + dsModel() + ' 整理并附来源'
        : '直接问答（不联网检索）';
    }
    toast(next ? '已开启联网搜索' : '已关闭联网搜索');
    var input = $('chat-input');
    if (input) input.focus();
  }

  function onAsk() {
    var input = $('chat-input');
    var q = ((input && input.value) || '').trim();
    if (!q) { toast('先写问题'); return; }
    if (state.busy) return;
    var subject = state.chatSubject || '综合';
    var useSearch = searchEnabled();
    state.busy = true;
    if (input) input.value = '';
    appendChatMessage({ role: 'user', content: q, subject: subject });
    renderChat();
    setChatWaiting(true, useSearch ? '正在搜索' : '正在思考，等待 DeepSeek 回复');
    if ($('btn-ask')) $('btn-ask').disabled = true;

    var finished = false;
    function finishOk(ans) {
      if (finished) return;
      finished = true;
      clearAskTimer();
      stopThinkingAnim();
      appendChatMessage({ role: 'assistant', content: ans, subject: subject });
      state.busy = false;
      renderChat();
      setStatus('chat-status', 'ok', '已回答');
    }
    function finishErr(err) {
      if (finished) return;
      finished = true;
      clearAskTimer();
      stopThinkingAnim();
      state.busy = false;
      renderChat();
      var msg = (err && err.message) ? err.message : String(err || '请求失败');
      setStatus('chat-status', 'err', msg);
      toast(msg);
    }

    var totalMs = useSearch ? ASK_SEARCH_TIMEOUT_MS : ASK_TIMEOUT_MS;
    state.askTimer = setTimeout(function () {
      finishErr(new Error('等待超时（' + Math.round(totalMs / 1000) + 's），请检查网络或稍后重试'));
    }, totalMs);

    var searched = useSearch
      ? searchWeb(q).catch(function (e) {
          return { results: [], error: (e && e.message) ? e.message : String(e || '搜索失败') };
        })
      : Promise.resolve({ results: null, error: '' });

    searched.then(function (found) {
      if (finished) return null;
      var results = found && Array.isArray(found.results) ? found.results : null;
      if (useSearch) {
        if (results && results.length) {
          setChatWaiting(true, '正在整理');
        } else {
          var msg = '未检索到网页来源，正在直接作答';
          setChatWaiting(true, msg);
          toast(msg);
        }
      }
      return askDeepseek(q, subject, results);
    }).then(function (ans) {
      if (ans != null) finishOk(ans);
    }).catch(finishErr);
  }

  function renderArchive() {
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

    var chips = dates.map(function (d) {
      var short = String(d).slice(5);
      var label = d === studyDate() ? '今天' : short;
      return '<button type="button" class="date-chip' + (d === selected ? ' is-on' : '') + '" data-date="' + escapeAttr(d) + '">' +
        escapeHtml(label) + '</button>';
    }).join('');

    var body;
    if (!tasks.length) {
      body = '<div class="empty">这一天还没有缓存任务。点右上角同步，或到设置里拉取任务。</div>';
    } else {
      var groups = {};
      var order = [];
      tasks.forEach(function (t) {
        var g = t.subject || '综合';
        if (!groups[g]) { groups[g] = []; order.push(g); }
        groups[g].push(t);
      });
      body = order.map(function (g) {
        var rows = groups[g].map(function (t) {
          return taskRowHtml(t, completed.indexOf(t.id) !== -1, { checkable: false });
        }).join('');
        return '<div class="group-label">' + escapeHtml(g) + ' · ' + groups[g].length + '</div>' + rows;
      }).join('');
    }

    var doneN = tasks.filter(function (t) { return completed.indexOf(t.id) !== -1; }).length;

    root.innerHTML =
      '<section class="panel">' +
        '<div class="panel-head"><h2 class="panel-title">每日任务</h2><span class="panel-meta">' + doneN + '/' + tasks.length + ' 完成</span></div>' +
        '<p class="muted" style="margin:0 0 8px">按日期浏览（不含答案）；完成勾选请回首页。</p>' +
        '<div class="date-chips" id="tasks-date-chips">' + chips + '</div>' +
        body +
      '</section>';

    root.querySelectorAll('.date-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        state.tasksBrowseDate = chip.getAttribute('data-date') || studyDate();
        renderArchive();
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

    // 眼睛按钮标准逻辑，以 input.type 为唯一依据（不依赖易混的 visible 布尔）：
    // - password（密文隐藏）→ 睁眼图标 +「显示密码」+ aria-pressed=false
    // - text（明文可见）    → 划线眼图标 +「隐藏密码」+ aria-pressed=true
    function syncEye() {
      if (!eye) return;
      var hidden = input.type === 'password';
      var label = hidden ? '显示密码' : '隐藏密码';
      eye.innerHTML = hidden ? eyeOpenSvg : eyeOffSvg;
      eye.setAttribute('title', label);
      eye.setAttribute('aria-label', label);
      eye.setAttribute('aria-pressed', hidden ? 'false' : 'true');
    }

    if (eye) {
      eye.addEventListener('click', function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      if (ev && ev.preventDefault) ev.preventDefault();
        // 先切换 type，再根据切换后的 type 更新图标与文案
        input.type = input.type === 'password' ? 'text' : 'password';
        syncEye();
      });
    }
    syncEye();

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
    var bKey = bochaKey();
    var tKey = tavilyKey();
    var sp = syncPrefs();
    var modelOpts = DEEPSEEK_MODELS.map(function (m) {
      return '<option value="' + m + '"' + (m === model ? ' selected' : '') + '>' + m + '</option>';
    }).join('');

    function fold(id, title, hint, body, open) {
      return '<details class="fold" id="' + id + '"' + (open ? ' open' : '') + '>' +
        '<summary><span>' + title + '</span><span style="display:flex;align-items:center;gap:8px"><span class="fold-hint">' + hint + '</span>' +
        svgIcon('chev', 'fold-chev') + '</span></summary>' +
        '<div class="fold-body">' + body + '</div></details>';
    }

    var ghBody =
      '<p class="muted">默认仓库 yoreverse2423/my-agent。令牌只保存在本机。</p>' +
      '<div class="field"><label>Owner</label><input id="gh-owner" value="' + escapeAttr(prefs.owner) + '"></div>' +
      '<div class="field"><label>Repo</label><input id="gh-repo" value="' + escapeAttr(prefs.repo) + '"></div>' +
      '<div class="field"><label>访问令牌</label>' + secretFieldHtml('gh-token', token ? '已保存（输入新值可覆盖）' : 'github_pat_…') + '</div>' +
      '<div class="btn-row">' +
        '<button type="button" class="btn" id="btn-save-gh">保存</button>' +
        '<button type="button" class="btn danger" id="btn-clear-gh">清除令牌</button>' +
      '</div>' +
      '<div class="status-line" id="gh-status">' + (token ? '已保存（' + mask(token) + '）' : '尚未保存') + '</div>';

    var syncBody =
      '<p class="muted">任务只下载；学习记录可上传。冲突时会先合并再写入。</p>' +
      '<label class="check-row"><input id="auto-upload" type="checkbox"' + (sp.autoUpload ? ' checked' : '') + '>' +
        '<span>每 5 分钟自动上传<span class="muted" style="display:block;font-size:12px;font-weight:500">仅本应用打开时有效，关闭后不会在后台继续</span></span></label>' +
      '<div class="btn-row">' +
        '<button type="button" class="btn" id="btn-pull-tasks">拉取任务</button>' +
        '<button type="button" class="btn ghost" id="btn-pull-archive">拉取存档</button>' +
        '<button type="button" class="btn secondary" id="btn-push-archive">上传存档</button>' +
      '</div>' +
      '<div class="status-line" id="sync-backup-status"></div>';

    var dsBody =
      '<p class="muted">密钥只保存在本机。问答页发送后会显示等待状态。</p>' +
      '<div class="field"><label>API Key</label>' + secretFieldHtml('ds-key', key ? '已保存（输入新值可覆盖）' : 'sk-…') + '</div>' +
      '<div class="field"><label>模型</label><select id="ds-model">' + modelOpts + '</select></div>' +
      '<div class="btn-row">' +
        '<button type="button" class="btn" id="btn-save-ds">保存</button>' +
        '<button type="button" class="btn danger" id="btn-clear-ds">清除 Key</button>' +
      '</div>' +
      '<div class="status-line" id="ds-status">' +
        (key ? '已保存（' + mask(key) + '）· ' + (hasNativeDeepseek() ? '手表原生通道' : '浏览器直连') : '尚未保存') +
      '</div>';

    var searchKeyBits = [];
    if (bKey) searchKeyBits.push('博查 ' + mask(bKey));
    if (tKey) searchKeyBits.push('Tavily ' + mask(tKey));
    var freeSources = '维基百科' + (hasNativeHttpGet() ? ' / Bing' : '');
    var searchBody =
      '<p class="muted">免费来源：维基百科（网页 / 手表）；手表 APK 还会尝试 Bing。找高考原题建议填博查 / Tavily Key，或用手表 APK 联网搜索。</p>' +
      '<div class="field"><label>博查 Bocha API Key</label>' + secretFieldHtml('bocha-key', bKey ? '已保存（输入新值可覆盖）' : 'sk-…（可选）') + '</div>' +
      '<div class="field"><label>Tavily API Key</label>' + secretFieldHtml('tavily-key', tKey ? '已保存（输入新值可覆盖）' : 'tvly-…（可选）') + '</div>' +
      '<div class="btn-row">' +
        '<button type="button" class="btn" id="btn-save-search">保存搜索 Key</button>' +
        '<button type="button" class="btn danger" id="btn-clear-bocha">清除博查</button>' +
        '<button type="button" class="btn danger" id="btn-clear-tavily">清除 Tavily</button>' +
      '</div>' +
      '<div class="status-line" id="search-status">' +
        (searchKeyBits.length ? searchKeyBits.join(' · ') + '（优先使用）' : '未填 Key：使用免费来源（' + freeSources + '）') +
      '</div>';

    var aboutBody =
      '<p class="muted">版本 <strong>' + APK_VERSION + '</strong> · armeabi-v7a</p>' +
      '<div class="btn-row">' +
        '<a class="btn" href="' + APK_URL + '" download>' + svgIcon('download') + '下载手表版</a>' +
        '<a class="btn secondary" href="' + PAGES_BASE + APK_URL + '" target="_blank" rel="noopener noreferrer">网页直链</a>' +
      '</div>' +
      '<p class="muted" style="margin-top:10px">电脑安装：adb install -r xiaoxuexiji-watch-armeabi-v7a.apk</p>' +
      '<p class="muted" style="margin-top:8px">' + escapeHtml(BRAND_NAME) + ' · 仓库 yoreverse2423/my-agent</p>';

    root.innerHTML =
      fold('fold-gh', 'GitHub 与令牌', token ? '已配置' : '未配置', ghBody, !token) +
      fold('fold-sync', '同步与备份', sp.autoUpload ? '自动上传开' : '手动', syncBody, true) +
      fold('fold-ds', '问答密钥', key ? '已配置' : '未配置', dsBody, !key) +
      fold('fold-search', '联网搜索', (bKey || tKey) ? '已配置 Key' : '免费来源', searchBody, false) +
      fold('fold-about', '关于与下载', 'v' + APK_VERSION, aboutBody, false);

    bindSecretField('gh-token', token);
    bindSecretField('ds-key', key);
    bindSecretField('bocha-key', bKey);
    bindSecretField('tavily-key', tKey);
    refreshSyncStatusUi();

    $('btn-save-gh').addEventListener('click', function () {
      saveGhPrefs($('gh-owner').value, $('gh-repo').value);
      var tkn = normalizeToken($('gh-token').value);
      if (tkn) lsSetStr(STORAGE_GH_TOKEN, tkn);
      toast('GitHub 设置已保存');
      renderSettings();
    });
    $('btn-clear-gh').addEventListener('click', function () {
      if (!window.confirm('确定清除本机保存的 GitHub 令牌吗？仓库里的文件不会被删。')) return;
      lsSetStr(STORAGE_GH_TOKEN, '');
      toast('令牌已清除');
      renderSettings();
    });
    $('btn-save-ds').addEventListener('click', function () {
      var k = normalizeToken($('ds-key').value);
      if (k) lsSetStr(STORAGE_DS_KEY, k);
      saveDsPrefs({ model: $('ds-model').value });
      toast('问答设置已保存');
      renderSettings();
    });
    $('btn-clear-ds').addEventListener('click', function () {
      if (!window.confirm('确定清除本机保存的 DeepSeek API Key 吗？')) return;
      lsSetStr(STORAGE_DS_KEY, '');
      toast('Key 已清除');
      renderSettings();
    });
    $('btn-save-search').addEventListener('click', function () {
      var b = normalizeToken($('bocha-key').value);
      var t = normalizeToken($('tavily-key').value);
      if (b) lsSetStr(STORAGE_BOCHA_KEY, b);
      if (t) lsSetStr(STORAGE_TAVILY_KEY, t);
      toast((b || t) ? '搜索 Key 已保存' : '未填新 Key，保留原值');
      renderSettings();
    });
    $('btn-clear-bocha').addEventListener('click', function () {
      if (!window.confirm('确定清除本机保存的博查 API Key 吗？')) return;
      lsSetStr(STORAGE_BOCHA_KEY, '');
      toast('博查 Key 已清除');
      renderSettings();
    });
    $('btn-clear-tavily').addEventListener('click', function () {
      if (!window.confirm('确定清除本机保存的 Tavily API Key 吗？')) return;
      lsSetStr(STORAGE_TAVILY_KEY, '');
      toast('Tavily Key 已清除');
      renderSettings();
    });

    var auto = $('auto-upload');
    if (auto) {
      auto.addEventListener('change', function () {
        saveSyncPrefs({ autoUpload: !!auto.checked });
        if (auto.checked) {
          startAutoUploadLoop();
          toast('已开启每 5 分钟自动上传');
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
    if (dateEl) dateEl.textContent = studyDate();
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
