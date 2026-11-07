/* 小学习机 StudyHub — 今日任务 / DeepSeek 问答 / GitHub 存档同步 */
(function () {
  'use strict';

  var STORAGE_ARCHIVE = 'studyhub_archive_v1';
  var STORAGE_TASKS = 'studyhub_tasks_cache_v1';
  var STORAGE_CHAT = 'studyhub_chat_v1';
  var STORAGE_GH_TOKEN = 'studyhub_github_token';
  var STORAGE_GH_PREFS = 'studyhub_github_prefs';
  var STORAGE_DS_KEY = 'studyhub_deepseek_key';
  var STORAGE_DS_PREFS = 'studyhub_deepseek_prefs';
  var STORAGE_NOTES = 'studyhub_day_notes_v1';

  var DEFAULT_OWNER = 'yoreverse2423';
  var DEFAULT_REPO = 'my-agent';
  var TASKS_PATH = 'data/daily-tasks.json';
  var ARCHIVE_PATH = 'data/student-archive.json';
  var DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
  var DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-reasoner'];
  var APK_URL = 'downloads/xiaoxuexiji-watch-armeabi-v7a.apk';
  var PAGES_BASE = 'https://yoreverse2423.github.io/my-agent/';

  var SUBJECTS = ['综合', '数学', '英语', '物理', '化学', '语文', '地理'];

  var state = {
    view: 'today',
    tasksDoc: null,
    archive: null,
    chat: [],
    chatSubject: '综合',
    busy: false
  };

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
    state.chat = lsGet(STORAGE_CHAT, []) || [];
    var prefs = lsGet(STORAGE_DS_PREFS, {}) || {};
    state.chatSubject = prefs.lastSubject || '综合';
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

  function saveTasksCache() {
    lsSet(STORAGE_TASKS, state.tasksDoc);
  }

  function saveChat() {
    lsSet(STORAGE_CHAT, state.chat.slice(-80));
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

  function pullTasks() {
    var token = ghToken();
    return fetchJsonPreferRaw(TASKS_PATH, token).then(function (doc) {
      if (!doc || !Array.isArray(doc.tasks)) throw new Error('daily-tasks.json 格式不对');
      state.tasksDoc = doc;
      saveTasksCache();
      return doc;
    });
  }

  function pullArchive() {
    var token = ghToken();
    return fetchJsonPreferRaw(ARCHIVE_PATH, token).then(function (remote) {
      state.archive = mergeArchiveDays(remote || emptyArchive(), state.archive || emptyArchive());
      saveArchive();
      return state.archive;
    });
  }

  function pushArchive(attempt) {
    attempt = attempt || 0;
    var token = ghToken();
    if (!token) return Promise.reject(new Error('请先在设置里保存 GitHub Token'));
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
        if (put.ok) return merged;
        if (put.status === 409) {
          // remote moved under us: re-GET + re-merge, retry at most twice
          if (attempt < 2) return pushArchive(attempt + 1);
          throw new Error('上传冲突：合并重试 2 次后仍失败（HTTP 409）');
        }
        throw new Error('上传失败 HTTP ' + put.status + (put.data && put.data.message ? '：' + put.data.message : ''));
      });
    });
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
    return fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify(bodyObj)
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
          if (!response.status) msg = '无法连接 DeepSeek（网页可能被 CORS 拦截，请用手表 APK）';
          throw new Error(msg);
        }
        return data;
      });
    }).catch(function (err) {
      if (err && err.message) throw err;
      throw new Error('无法连接 DeepSeek（网页可能被 CORS 拦截，请用手表 APK）');
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
      html += '<div class="empty">还没有任务。点右上角「同步」或到「存档」拉取 GitHub 任务。</div>';
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
        toast('备注已保存到本地存档');
      });
    }
  }

  function renderChat() {
    var root = $('view-chat');
    if (!root) return;
    var opts = SUBJECTS.map(function (s) {
      return '<option value="' + s + '"' + (state.chatSubject === s ? ' selected' : '') + '>' + s + '</option>';
    }).join('');
    var log = state.chat.map(function (m) {
      return '<div class="bubble ' + m.role + '">' + escapeHtml(m.content) + '</div>';
    }).join('');
    if (!log) log = '<div class="bubble system">选科目，把题干贴过来。手表 APK 走原生请求，不受网页 CORS 影响。</div>';

    root.innerHTML =
      '<section class="card">' +
        '<h2 class="card-title">DeepSeek 问答</h2>' +
        '<div class="field"><label for="chat-subject">科目</label>' +
          '<select id="chat-subject">' + opts + '</select></div>' +
        '<div class="chat-log" id="chat-log">' + log + '</div>' +
        '<div class="field"><label for="chat-input">问题 / 题干</label>' +
          '<textarea id="chat-input" rows="4" placeholder="把题目贴这里…"></textarea></div>' +
        '<div class="btn-row">' +
          '<button type="button" class="btn" id="btn-ask">提问</button>' +
          '<button type="button" class="btn ghost" id="btn-chat-summary">生成今日摘要</button>' +
          '<button type="button" class="btn secondary" id="btn-chat-clear">清空本机会话</button>' +
        '</div>' +
        '<div class="status-line" id="chat-status"></div>' +
      '</section>';

    $('chat-subject').addEventListener('change', function () {
      state.chatSubject = $('chat-subject').value;
      saveDsPrefs({ lastSubject: state.chatSubject });
    });
    $('btn-ask').addEventListener('click', onAsk);
    $('btn-chat-clear').addEventListener('click', function () {
      state.chat = [];
      saveChat();
      renderChat();
    });
    $('btn-chat-summary').addEventListener('click', onChatSummary);
    var logEl = $('chat-log');
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  }

  function onAsk() {
    var q = (($('chat-input') && $('chat-input').value) || '').trim();
    if (!q) { toast('先写问题'); return; }
    if (state.busy) return;
    state.busy = true;
    setStatus('chat-status', 'busy', hasNativeDeepseek() ? '原生层请求中…' : '请求 DeepSeek…');
    state.chat.push({ role: 'user', content: q, subject: state.chatSubject, at: isoShanghai() });
    saveChat();
    renderChat();
    $('chat-input') && ($('chat-input').value = '');
    askDeepseek(q, state.chatSubject).then(function (ans) {
      state.chat.push({ role: 'assistant', content: ans, subject: state.chatSubject, at: isoShanghai() });
      saveChat();
      // also stash a brief into today's chatSummary buffer (full flush via button)
      var day = ensureDay(studyDate());
      day.chatSummary = day.chatSummary || [];
      day.chatSummary.push({
        subject: state.chatSubject,
        q: q.slice(0, 120),
        aBrief: briefAnswer(ans),
        at: isoShanghai()
      });
      saveArchive();
      state.busy = false;
      renderChat();
      setStatus('chat-status', 'ok', '已回答');
    }).catch(function (err) {
      state.busy = false;
      renderChat();
      setStatus('chat-status', 'err', err.message || String(err));
      toast(err.message || '提问失败');
    });
  }

  function onChatSummary() {
    var day = ensureDay(studyDate());
    var recent = state.chat.filter(function (m) { return m.role === 'user' || m.role === 'assistant'; }).slice(-12);
    if (!recent.length) { toast('还没有会话'); return; }
    // Rebuild summary from recent pairs
    var pairs = [];
    for (var i = 0; i < recent.length; i++) {
      if (recent[i].role === 'user') {
        var a = recent[i + 1] && recent[i + 1].role === 'assistant' ? recent[i + 1].content : '';
        pairs.push({
          subject: recent[i].subject || state.chatSubject,
          q: String(recent[i].content).slice(0, 120),
          aBrief: briefAnswer(a),
          at: recent[i].at || isoShanghai()
        });
      }
    }
    day.chatSummary = mergeChatSummary(day.chatSummary || [], pairs);
    // weakTopics heuristic: if notes mention 不会/薄弱
    saveArchive();
    toast('已写入今日存档摘要（记得上传）');
    setView('archive');
  }

  function renderArchive() {
    var root = $('view-archive');
    if (!root) return;
    var days = ((state.archive && state.archive.days) || []).slice().sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    }).slice(0, 14);

    var body = days.map(function (d) {
      var tags = (d.completedTaskIds || []).map(function (id) {
        return '<span class="tag">完成 ' + escapeHtml(id) + '</span>';
      }).join('');
      var weak = (d.weakTopics || []).map(function (w) {
        return '<span class="tag">' + escapeHtml((w.subject || '') + '·' + (w.topic || '')) + '</span>';
      }).join('');
      var chats = (d.chatSummary || []).slice(-3).map(function (c) {
        return '<div class="muted">Q: ' + escapeHtml(c.q || '') + '<br>A: ' + escapeHtml(c.aBrief || '') + '</div>';
      }).join('');
      return '<div class="archive-day card">' +
        '<h3>' + escapeHtml(d.date) + '</h3>' +
        '<div class="taglist">' + tags + weak + '</div>' +
        (d.notes ? '<p class="muted">' + escapeHtml(d.notes) + '</p>' : '') +
        chats +
        '</div>';
    }).join('') || '<div class="empty">本地还没有存档天数。</div>';

    root.innerHTML =
      '<section class="card">' +
        '<h2 class="card-title">存档同步</h2>' +
        '<p class="muted">任务只下载；学习存档可上传。冲突时先拉取远程按日期合并：完成项/摘要取并集，备注两侧保留，分钟取较大值。</p>' +
        '<div class="btn-row">' +
          '<button type="button" class="btn" id="btn-pull-tasks">拉取任务</button>' +
          '<button type="button" class="btn ghost" id="btn-pull-archive">拉取存档</button>' +
          '<button type="button" class="btn secondary" id="btn-push-archive">上传存档</button>' +
        '</div>' +
        '<div class="status-line" id="sync-status"></div>' +
      '</section>' +
      '<section class="card"><h2 class="card-title">最近本地存档</h2>' + body + '</section>';

    $('btn-pull-tasks').addEventListener('click', function () {
      setStatus('sync-status', 'busy', '拉取任务中…');
      pullTasks().then(function () {
        setStatus('sync-status', 'ok', '任务已更新');
        toast('任务已同步');
        renderToday();
      }).catch(function (e) {
        setStatus('sync-status', 'err', e.message || String(e));
      });
    });
    $('btn-pull-archive').addEventListener('click', function () {
      setStatus('sync-status', 'busy', '拉取存档中…');
      pullArchive().then(function () {
        setStatus('sync-status', 'ok', '存档已合并到本地');
        renderArchive();
      }).catch(function (e) {
        setStatus('sync-status', 'err', e.message || String(e));
      });
    });
    $('btn-push-archive').addEventListener('click', function () {
      setStatus('sync-status', 'busy', '上传中…');
      pushArchive().then(function () {
        setStatus('sync-status', 'ok', '存档已上传到 GitHub');
        toast('上传成功');
      }).catch(function (e) {
        setStatus('sync-status', 'err', e.message || String(e));
      });
    });
  }

  function renderSettings() {
    var root = $('view-settings');
    if (!root) return;
    var prefs = ghPrefs();
    var token = ghToken();
    var key = dsKey();
    var model = dsModel();
    var modelOpts = DEEPSEEK_MODELS.map(function (m) {
      return '<option value="' + m + '"' + (m === model ? ' selected' : '') + '>' + m + '</option>';
    }).join('');

    root.innerHTML =
      '<section class="card">' +
        '<h2 class="card-title">GitHub 同步</h2>' +
        '<p class="muted">默认仓库 <code>yoreverse2423/my-agent</code>。Token 只存本机 localStorage，不会进仓库。需要 Contents 读写权限。</p>' +
        '<div class="field"><label>Owner</label><input id="gh-owner" value="' + escapeAttr(prefs.owner) + '"></div>' +
        '<div class="field"><label>Repo</label><input id="gh-repo" value="' + escapeAttr(prefs.repo) + '"></div>' +
        '<div class="field"><label>Personal Access Token</label>' +
          '<input id="gh-token" type="password" autocomplete="off" placeholder="' +
          (token ? '已保存（输入新值可覆盖）' : 'github_pat_…') + '"></div>' +
        '<div class="btn-row">' +
          '<button type="button" class="btn" id="btn-save-gh">保存</button>' +
          '<button type="button" class="btn danger" id="btn-clear-gh">清除 Token</button>' +
        '</div>' +
        '<div class="status-line" id="gh-status">' + (token ? 'Token 已保存（' + mask(token) + '）' : '尚未保存 Token') + '</div>' +
      '</section>' +

      '<section class="card">' +
        '<h2 class="card-title">DeepSeek</h2>' +
        '<p class="muted">Key 只存本机。网页若遇 CORS 请用手表 APK（原生层请求）。</p>' +
        '<ol class="settings-list">' +
          '<li>打开 <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">platform.deepseek.com/api_keys</a> 创建密钥。</li>' +
          '<li>粘贴到下方保存。问答页用法和普通 agent 类似：贴题 → 提问。</li>' +
        '</ol>' +
        '<div class="field"><label>API Key</label>' +
          '<input id="ds-key" type="password" autocomplete="off" placeholder="' +
          (key ? '已保存（输入新值可覆盖）' : 'sk-…') + '"></div>' +
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
        '<p class="muted">armeabi-v7a · WebView 壳 · 已去焦点黄框 · DeepSeek 走原生请求。</p>' +
        '<div class="btn-row">' +
          '<a class="btn" href="' + APK_URL + '" download>下载手表 APK</a>' +
          '<a class="btn secondary" href="' + PAGES_BASE + APK_URL + '" target="_blank" rel="noopener noreferrer">Pages 链接</a>' +
        '</div>' +
        '<p class="muted" style="margin-top:10px">型号：OPPO / ColorOS Watch（非 Wear OS）。用电脑 ADB 安装：<code>adb install -r xiaoxuexiji-watch-armeabi-v7a.apk</code></p>' +
      '</section>' +

      '<section class="card">' +
        '<h2 class="card-title">关于</h2>' +
        '<p class="muted">小学习机 StudyHub v0.1.0 · 默认仓库 <code>yoreverse2423/my-agent</code> · 与监工头bot / 科目 bot 通过仓库 JSON 协作。协议见 docs/bot-protocol.md。</p>' +
      '</section>';

    $('btn-save-gh').addEventListener('click', function () {
      saveGhPrefs($('gh-owner').value, $('gh-repo').value);
      var t = normalizeToken($('gh-token').value);
      if (t) lsSetStr(STORAGE_GH_TOKEN, t);
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
        }).catch(function (e) {
          toast(e.message || '同步失败');
        }).then(function () { quick.disabled = false; });
      });
    }
  }

  function boot() {
    loadLocal();
    bindChrome();
    setView('today');
    // Try silent pull of packaged/sample tasks if cache empty
    if (!state.tasksDoc || !(state.tasksDoc.tasks || []).length) {
      fetch(TASKS_PATH + '?_=' + Date.now(), { cache: 'no-store' }).then(function (r) {
        if (!r.ok) return null;
        return r.json();
      }).then(function (doc) {
        if (doc && Array.isArray(doc.tasks)) {
          state.tasksDoc = doc;
          saveTasksCache();
          if (state.view === 'today') renderToday();
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
