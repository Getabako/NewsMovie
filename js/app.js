/* ニュース動画メーカー — 画面側（依存なし） */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(url, opts) { return fetch(url, opts).then(function (r) { return r.json(); }); }
  function postJSON(url, body) { return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); }
  function fmtDate(t) { var d = new Date(t); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  // ---------- ライセンス ----------
  var license = { mode: 'free' };
  function isFree() { return license.mode !== 'member' && license.mode !== 'full'; }
  function loadLicense() {
    return api('/api/license').then(function (d) {
      license = d;
      var b = $('license-banner');
      b.textContent = d.message || '';
      b.classList.toggle('member', !isFree());
      b.classList.toggle('hidden', !d.message);
      $('activate-panel').classList.toggle('hidden', !isFree());
    }).catch(function () {});
  }
  $('activate-btn').addEventListener('click', function () {
    var email = ($('activate-email').value || '').trim();
    if (!email) return;
    var msg = $('activate-msg');
    msg.textContent = '認証中…'; msg.classList.remove('hidden');
    postJSON('/api/activate', { email: email }).then(function (d) {
      msg.textContent = d.message || (d.activated ? '認証しました' : '認証できませんでした');
      if (d.activated) loadLicense();
    });
  });
  loadLicense();

  // ---------- タブ ----------
  var views = ['make', 'list', 'detail', 'settings'];
  function showView(name) {
    views.forEach(function (v) { $('view-' + v).classList.toggle('hidden', v !== name); });
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === name || (name === 'detail' && t.dataset.view === 'list')); });
    if (name === 'list') loadProjects();
    if (name === 'settings') loadConfig();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tab').forEach(function (t) { t.addEventListener('click', function () { showView(t.dataset.view); }); });
  $('btn-back').addEventListener('click', function () { showView('list'); });

  // ---------- 設定・環境 ----------
  var meta = { genres: [], sources: [], stages: [], stageLabels: {} };
  var config = {};
  function genreLabel(key) { var g = meta.genres.find(function (x) { return x.key === key; }); return g ? g.label : key; }
  function renderGenres() {
    var box = $('genre-grid');
    if (box.children.length) return;
    var on = String(config.genres || '').split(',');
    box.innerHTML = meta.genres.map(function (g) { var c = on.indexOf(g.key) >= 0 && !(g.defaultOff && !config.genres); return '<label class="' + (c ? 'on' : '') + '"><input type="checkbox" value="' + esc(g.key) + '"' + (c ? ' checked' : '') + '>' + esc(g.label) + '</label>'; }).join('');
    box.querySelectorAll('input').forEach(function (c) { c.addEventListener('change', function () { c.parentElement.classList.toggle('on', c.checked); }); });
  }
  function applyDefaultsToForm() {
    if (config.edition) $('f-edition').value = config.edition;
    if (config.itemCount) $('f-items').value = String(config.itemCount);
    if (config.durationSec) { var sel = $('f-duration'); if ([].some.call(sel.options, function (o) { return o.value === String(config.durationSec); })) sel.value = String(config.durationSec); }
    if (config.aspect) $('f-aspect').value = config.aspect;
    if (config.narrator) $('f-narrator').value = config.narrator;
    if (config.focus && !$('f-focus').value) $('f-focus').value = config.focus;
    if (config.upload) $('f-upload').value = config.upload;
    if (config.useCharacter) $('f-character').value = config.useCharacter;
    if (config.useCommentator) $('f-commentator').value = config.useCommentator;
    if (config.privacy) $('f-privacy').value = config.privacy;
  }
  function loadConfig() {
    return api('/api/config').then(function (d) {
      config = d.config || {};
      meta = { genres: d.genres || [], sources: d.sources || [], stages: d.stages || [], stageLabels: d.stageLabels || {} };
      renderGenres();
      applyDefaultsToForm();
      $('s-program').value = config.programName || '';
      $('s-promo').value = config.promoNarration || '';
      $('s-promohook').value = (config.promoHook || '').replace(/\n/g, '\\n');
      $('s-promospeech').value = config.promoSpeech || '';
      $('s-promosub').value = config.promoSubtitle || '';
      $('s-ashura').value = config.ashuraUrl || '';
      $('s-site').value = config.siteUrl || '';
      $('s-book').value = config.bookUrl || '';
      $('s-booklp').value = config.bookLpUrl || '';
      $('s-booktitle').value = config.bookTitle || '';
      $('s-datadir').value = config.dataDir || '';
      $('s-smdir').value = config.shortMovieDir || '';
      $('s-smport').value = config.shortMoviePort || '';
      $('s-model').value = config.codexModel || '';
      $('s-items').value = config.itemCount || '';
      $('s-duration').value = config.durationSec || '';
      $('s-aspect').value = config.aspect || '9:16';
      $('s-narrator').value = config.narrator || 'Japanese Female 1';
      $('s-speed').value = config.speakerSpeed || '';
      $('s-character').value = config.useCharacter || 'true';
      $('s-commentator').value = config.useCommentator || 'true';
      $('s-comvoice').value = config.commentatorNarrator || 'Japanese Male 2';
      $('s-chardir').value = config.charactersDir || '';
      $('s-upload').value = config.upload || 'false';
      $('s-privacy').value = config.privacy || 'PUBLIC';
      $('s-titleprefix').value = config.titlePrefix || '';
      $('s-focus').value = config.focus || '';
      $('s-channeltag').value = config.channelTag || '';
      $('config-path').textContent = d.configPath || '';
      $('source-list').innerHTML = meta.sources.map(function (s) { return '<li>' + esc(s.region) + ': ' + esc(s.items.join(' / ')) + '</li>'; }).join('');
      renderEnv(d.env || {});
    });
  }
  function renderEnv(env) {
    var rows = [
      ['codex CLI（調査・台本・背景イラスト。Web 検索も codex が行う）', env.codex, 'brew install codex のあと codex login してください（Windows: npm i -g @openai/codex）。0.150 以上が必要です'],
      ['Short Movie（音声合成と動画化のエンジン）' + (env.shortMovieDir ? ' : ' + env.shortMovieDir : ''), env.shortMovieDir, 'アシュラの「Short Movie」を導入するか、下の設定でフォルダを指定してください'],
      ['Short Movie がビルド済み', env.shortMovieBuilt, 'Short Movie を一度起動（bash ashura-start.sh）するとビルドされます'],
      ['Short Movie にレンダリング API がある', env.shortMovieRenderApi, 'Short Movie を最新版に更新してください'],
      ['VOICEPEAK（ナレーション音声）', env.voicepeak, '/Applications/voicepeak.app が必要です'],
      ['YouTube ログイン済み（投稿する場合のみ必要）', env.youtubeLogin, '下の「YouTube にログイン」を一度実行してください'],
      ['playwright（投稿する場合のみ必要）', env.playwright, 'このフォルダで npm install を実行してください'],
      ['解説キャスターの画像（public/characters または設定のフォルダ）', env.characters, '「caster_表情.png」の画像を置いてください'],
      ['コメンテーターの画像', env.commentator, '「commentator_表情.png」の画像を置いてください'],
      ['ffmpeg（背景生成に失敗したときの保険。無くても動く）', env.ffmpeg, 'brew install ffmpeg'],
    ];
    $('env-check').innerHTML = rows.map(function (r) {
      return '<div class="env-row"><span class="' + (r[1] ? 'ok' : 'ng') + '">' + (r[1] ? '○' : '×') + '</span><span>' + esc(r[0]) + (r[1] ? '' : '<br><span class="note">' + esc(r[2]) + '</span>') + '</span></div>';
    }).join('');
    var warn = $('env-warning');
    var problems = [];
    if (!env.codex) problems.push('codex CLI が見つかりません');
    if (!env.shortMovieDir) problems.push('Short Movie が見つかりません');
    else if (!env.shortMovieBuilt) problems.push('Short Movie がまだビルドされていません（一度起動してください）');
    if (!env.voicepeak) problems.push('VOICEPEAK が見つかりません');
    if (problems.length) { warn.textContent = problems.join(' / ') + '。設定タブの環境チェックを確認してください。'; warn.classList.remove('hidden'); }
    else warn.classList.add('hidden');
  }
  $('btn-save-settings').addEventListener('click', function () {
    postJSON('/api/config', {
      dataDir: $('s-datadir').value, shortMovieDir: $('s-smdir').value, shortMoviePort: $('s-smport').value, codexModel: $('s-model').value,
      itemCount: $('s-items').value, durationSec: $('s-duration').value, aspect: $('s-aspect').value, narrator: $('s-narrator').value, speakerSpeed: $('s-speed').value,
      upload: $('s-upload').value, privacy: $('s-privacy').value, titlePrefix: $('s-titleprefix').value, focus: $('s-focus').value, channelTag: $('s-channeltag').value,
      useCharacter: $('s-character').value, charactersDir: $('s-chardir').value,
      useCommentator: $('s-commentator').value, commentatorNarrator: $('s-comvoice').value,
      programName: $('s-program').value, promoNarration: $('s-promo').value, promoHook: $('s-promohook').value.replace(/\\n/g, '\n'),
      promoSpeech: $('s-promospeech').value, promoSubtitle: $('s-promosub').value,
      ashuraUrl: $('s-ashura').value, siteUrl: $('s-site').value, bookUrl: $('s-book').value, bookLpUrl: $('s-booklp').value, bookTitle: $('s-booktitle').value,
    }).then(function (d) { $('settings-msg').textContent = d.ok ? '保存しました。' : (d.error || '保存に失敗しました'); if (d.ok) { config = d.config; renderEnv(d.env || {}); applyDefaultsToForm(); } });
  });
  $('btn-env-refresh').addEventListener('click', function () { loadConfig(); });
  $('btn-yt-login').addEventListener('click', function () {
    postJSON('/api/youtube-login').then(function (d) { $('yt-login-msg').textContent = d.message || ''; });
  });
  $('btn-open-data').addEventListener('click', function () { postJSON('/api/open-data-dir'); });
  $('btn-open-data-list').addEventListener('click', function () { postJSON('/api/open-data-dir'); });
  loadConfig();

  // ---------- 番組を作る ----------
  function collectBrief() {
    var v = function (id) { return ($(id).value || '').trim(); };
    var genres = Array.prototype.map.call(document.querySelectorAll('#genre-grid input:checked'), function (c) { return c.value; });
    return {
      title: v('f-title'), edition: v('f-edition'), genres: genres.join(','), itemCount: v('f-items'), durationSec: v('f-duration'), aspect: v('f-aspect'),
      narrator: v('f-narrator'), focus: v('f-focus'), upload: v('f-upload'), privacy: v('f-privacy'),
    };
  }
  $('btn-submit').addEventListener('click', function () {
    var brief = collectBrief();
    if (!brief.genres) { alert('ジャンルを 1 つ以上選んでください。'); return; }
    if (brief.upload === 'true' && !confirm('完成した動画を YouTube に「' + ({ PUBLIC: '公開', UNLISTED: '限定公開', PRIVATE: '非公開' })[brief.privacy] + '」で投稿します。よろしいですか？')) return;
    var btn = $('btn-submit');
    btn.disabled = true;
    postJSON('/api/create', { brief: brief }).then(function (d) {
      if (d.error) { alert(d.error); return; }
      $('submit-note').textContent = '受け付けました。下の「処理状況」で進み具合が見え、完成したら「番組の記録」タブに並びます。画面を閉じても続きます。';
      pollJobs();
      $('jobs-card').scrollIntoView({ behavior: 'smooth' });
    }).catch(function () { alert('送信に失敗しました'); }).then(function () { btn.disabled = false; });
  });

  // ---------- 処理状況 ----------
  var jobTimer = null;
  var lastJobs = [];
  function renderJobs(jobs) {
    var box = $('jobs');
    if (!jobs.length) { box.innerHTML = '<p class="note">まだ処理はありません。</p>'; return; }
    box.innerHTML = jobs.slice(0, 12).map(function (j) {
      return '<div class="job ' + esc(j.stage) + '">' +
        '<div class="jl"><span class="jt">' + esc(j.label) + '</span><span class="js">' + esc(j.stageLabel) + ' ' + (j.progress || 0) + '%</span></div>' +
        '<div class="bar"><i style="width:' + (j.progress || 0) + '%"></i></div>' +
        (j.detail ? '<div class="jd">' + esc(j.detail) + '</div>' : '') +
        (j.error ? '<div class="je">' + esc(j.error) + '</div>' : '') +
        (j.stage === 'done' || j.stage === 'error' ? '<button type="button" class="secondary small" data-open="' + esc(j.projectId) + '">開く</button>' : '') +
        '</div>';
    }).join('');
    box.querySelectorAll('[data-open]').forEach(function (b) { b.addEventListener('click', function () { openDetail(b.dataset.open); }); });
  }
  function pollJobs() {
    api('/api/jobs').then(function (d) {
      var jobs = d.jobs || [];
      renderJobs(jobs);
      var active = jobs.some(function (j) { return j.stage !== 'done' && j.stage !== 'error'; });
      jobs.forEach(function (j) {
        var prev = lastJobs.find(function (p) { return p.id === j.id; });
        if (prev && prev.stage !== j.stage && (j.stage === 'done' || j.stage === 'error') && currentDetailId === j.projectId) openDetail(j.projectId);
      });
      lastJobs = jobs;
      clearTimeout(jobTimer);
      jobTimer = setTimeout(pollJobs, active ? 3000 : 10000);
    }).catch(function () { jobTimer = setTimeout(pollJobs, 10000); });
  }
  pollJobs();

  // ---------- 一覧 ----------
  var projects = [];
  function loadProjects() { return api('/api/projects').then(function (d) { projects = d.projects || []; renderProjects(); }); }
  function renderProjects() {
    var q = ($('list-search').value || '').trim();
    var list = projects.filter(function (p) { return !q || (p.title + ' ' + p.headline).indexOf(q) >= 0; });
    var box = $('project-list');
    if (!list.length) { box.innerHTML = '<p class="note">まだ記録がありません。「番組を作る」タブから始めてください。</p>'; return; }
    box.innerHTML = list.map(function (p) {
      return '<div class="pcard" data-id="' + esc(p.id) + '">' +
        '<div class="pk">' + esc(fmtDate(p.createdAt)) + ' <span class="status ' + esc(p.status) + '">' + esc(p.statusLabel) + '</span></div>' +
        '<div class="pt">' + esc(p.title) + '</div>' +
        '<div class="pm">' + (p.itemCount ? p.itemCount + ' 本' : '') + (p.hasVideo ? ' / 動画あり' : '') + (p.youtubeUrl ? ' / YouTube 投稿済み' : '') + '</div>' +
        '</div>';
    }).join('');
    box.querySelectorAll('.pcard').forEach(function (c) { c.addEventListener('click', function () { openDetail(c.dataset.id); }); });
  }
  $('list-search').addEventListener('input', renderProjects);

  // ---------- 詳細 ----------
  var currentDetailId = null;
  function fileUrl(p, rel) { return '/files/' + encodeURIComponent(p.id) + '/' + rel + '?t=' + Date.now(); }
  function openDetail(id) {
    currentDetailId = id;
    api('/api/projects/' + encodeURIComponent(id)).then(function (p) {
      if (p.error) { alert('見つかりませんでした'); return; }
      renderDetail(p);
      showView('detail');
    });
  }
  function renderDetail(p) {
    var o = p.outputs || {};
    var n = p.news || {};
    var h = '<section class="card"><div class="detail-head"><div><div class="pk">' + esc(fmtDate(p.createdAt)) + ' <span class="status ' + esc(p.status) + '">' + esc(p.statusLabel) + '</span></div><h2>' + esc(p.title) + '</h2></div></div>';
    if (p.error) h += '<div class="warning-box">' + esc(p.error) + '</div>';
    if (o.mp4) h += '<div class="video-box"><video controls playsinline src="' + esc(fileUrl(p, o.mp4)) + '"></video></div>';
    if (p.youtube && p.youtube.url) h += '<a class="yt-link" href="' + esc(p.youtube.url) + '" target="_blank" rel="noopener">YouTube で見る: ' + esc(p.youtube.url) + '</a>';
    h += '<div class="outputs" style="margin-top:0.8rem">' +
      (o.html ? '<a href="' + esc(fileUrl(p, o.html)) + '" target="_blank">記録ページ（HTML）</a>' : '') +
      (o.mp4 ? '<a href="' + esc(fileUrl(p, o.mp4)) + '" download="movie.mp4">動画をダウンロード</a>' : '') +
      (o.description ? '<a href="' + esc(fileUrl(p, o.description)) + '" target="_blank">タイトルと説明文</a>' : '') +
      (o.news ? '<a href="' + esc(fileUrl(p, o.news)) + '" target="_blank">調査 JSON</a>' : '') +
      (o.script ? '<a href="' + esc(fileUrl(p, o.script)) + '" target="_blank">台本 JSON</a>' : '') + '</div>';
    h += '<div class="actions">' +
      '<button type="button" class="secondary" id="d-open"><svg class="ic"><use href="#i-folder"/></svg>フォルダを開く</button>' +
      (o.mp4 && !(p.youtube && p.youtube.url) ? '<button type="button" class="secondary" id="d-upload"><svg class="ic"><use href="#i-upload"/></svg>この動画を YouTube に投稿する</button>' : '') +
      '<button type="button" class="secondary danger" id="d-delete"><svg class="ic"><use href="#i-trash"/></svg>削除</button></div>';
    if (p.status === 'error' || p.status === 'done') {
      h += '<h3>ステージを指定してやり直す</h3><div class="stage-row">' + meta.stages.filter(function (s) { return s !== 'report'; }).map(function (s) {
        return '<button type="button" class="secondary small" data-resume="' + esc(s) + '">' + esc((meta.stageLabels[s] || s).replace(/（.*$/, '')) + '</button>';
      }).join('') + '</div><p class="note">失敗した所から続きを作れます（例: 投稿だけやり直す）。前のステージの成果はそのまま使います。</p>';
    }
    if (n.items && n.items.length) {
      h += '<h3>' + esc(n.headline || '今日のニュース') + '（' + n.items.length + ' 本）</h3>';
      if (n.lead) h += '<p>' + esc(n.lead) + '</p>';
      h += n.items.map(function (it) {
        return '<div class="news-item"><div class="meta"><span class="genre">' + esc(genreLabel(it.genre)) + '</span><span>' + esc(it.region || '') + '</span><span>' + esc(it.publishedAt || '') + '</span></div>' +
          '<h4>' + esc(it.no) + '. ' + esc(it.title) + '</h4><p>' + esc(it.summary) + '</p>' +
          (it.perspectives ? '<p><b>見方の違い:</b> ' + esc(it.perspectives) + '</p>' : '') +
          '<p class="japan"><b>日本で暮らす視点:</b> ' + esc(it.japanAngle) + '</p>' +
          '<ul class="src">' + (it.sources || []).map(function (s) { return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.publisher || '') + (s.lang ? ' (' + esc(s.lang) + ')' : '') + ': ' + esc(s.title || s.url) + '</a></li>'; }).join('') + '</ul></div>';
      }).join('');
      if (n.japanOutlook) h += '<div class="outlook"><h3 style="margin-top:0">日本で過ごす上での構え</h3><p>' + esc(n.japanOutlook.summary) + '</p><ul>' + (n.japanOutlook.actions || []).map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>';
    }
    h += '</section>';
    $('detail').innerHTML = h;

    $('d-open').addEventListener('click', function () { postJSON('/api/projects/' + encodeURIComponent(p.id) + '/open'); });
    if ($('d-upload')) $('d-upload').addEventListener('click', function () {
      if (!confirm('この動画を YouTube に投稿します（公開範囲: ' + esc((p.brief && p.brief.privacy) || 'PUBLIC') + '）。よろしいですか？')) return;
      resume(p.id, 'upload');
    });
    $('d-delete').addEventListener('click', function () {
      if (!confirm('この番組をフォルダごと削除します。よろしいですか？')) return;
      api('/api/projects/' + encodeURIComponent(p.id), { method: 'DELETE' }).then(function () { showView('list'); });
    });
    document.querySelectorAll('[data-resume]').forEach(function (b) { b.addEventListener('click', function () {
      if (b.dataset.resume === 'upload' && !confirm('YouTube に投稿します。よろしいですか？')) return;
      resume(p.id, b.dataset.resume);
    }); });
  }
  function resume(id, stage) {
    postJSON('/api/projects/' + encodeURIComponent(id) + '/resume', { stage: stage }).then(function (d) {
      if (d.error) { alert(d.error); return; }
      alert('やり直しを開始しました。「番組を作る」タブの処理状況で進み具合が見えます。');
      pollJobs();
    });
  }
})();
