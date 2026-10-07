// レポート HTML（番組の記録）と YouTube 用タイトル・説明文。Node 標準のみ。日本語向けに大きめ文字。
'use strict';

const { GENRES, EDITIONS } = require('./config.js');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function genreLabel(key) { const g = GENRES.find((x) => x.key === key); return g ? g.label : (key || ''); }
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

/** YouTube タイトル（95 字以内） */
function youtubeTitle(project) {
  const n = project.news || {};
  const d = new Date(project.createdAt || Date.now());
  const b = project.brief || {};
  const ed = EDITIONS[b.edition] || EDITIONS.world;
  const prefix = b.titlePrefix || (b.programName ? `${b.programName}｜` : '');
  const base = `${prefix}${ed.sub} ${d.getMonth() + 1}月${d.getDate()}日 ${n.headline || ''}`.trim();
  return base.slice(0, 95);
}

/** YouTube 説明文（出典 URL 付き） */
function youtubeDescription(project) {
  const n = project.news || {};
  const items = Array.isArray(n.items) ? n.items : [];
  const lines = [];
  if (n.lead) lines.push(n.lead, '');
  lines.push('▼ 今日のニュース');
  for (const it of items) {
    lines.push(`${it.no}. [${genreLabel(it.genre)}] ${it.title}`);
    if (it.japanAngle) lines.push(`   日本での着眼点: ${it.japanAngle}`);
  }
  if (n.japanOutlook && n.japanOutlook.summary) {
    lines.push('', '▼ 日本で過ごす上での構え', n.japanOutlook.summary);
    for (const a of n.japanOutlook.actions || []) lines.push(`- ${a}`);
  }
  const srcs = Array.isArray(n.sources) ? n.sources : [];
  if (srcs.length) {
    lines.push('', '▼ 出典（世界各地の報道・公的機関）');
    for (const s of srcs.slice(0, 40)) lines.push(`${s.publisher ? s.publisher + ': ' : ''}${s.url}`);
  }
  const b = project.brief || {};
  const L = b.links || {};
  lines.push('', b.edition === 'japan'
    ? 'この番組は日本国内の報道を複数の媒体で確かめ、特定の立場に寄らずにまとめた上で、暮らしの視点を添えています。内容は配信時点の報道に基づきます。'
    : 'この番組は世界各地の報道を多言語で集め、特定の立場に寄らずにまとめた上で、日本で暮らす視点を添えています。内容は配信時点の報道に基づきます。');
  lines.push('台本・背景イラスト・音声・投稿まで、AI（Codex サブスク＋自作ツール）で自動制作しています。');
  const links = [];
  if (L.ashura) links.push(`▼ AI 学習コミュニティ「Ashura」（こんなふうに AI で自動化・制作したい方へ。AI 制作ツールが使い放題）\n${L.ashura}`);
  if (L.book) links.push(`▼ ${L.bookTitle ? `『${L.bookTitle}』` : '本'}（Kindle）\n${L.book}${L.bookLp ? `\n書籍の紹介ページ: ${L.bookLp}` : ''}`);
  if (L.site) links.push(`▼ ${L.siteLabel || '公式サイト'}\n${L.site}`);
  if (links.length) lines.push('', ...links.join('\n\n').split('\n'));
  if (b.channelTag) lines.push('', b.channelTag);
  const shorts = b.aspect === '9:16' ? '#Shorts ' : '';
  lines.push('', shorts + (b.edition === 'japan' ? '#ニュース #日本のニュース #今日のニュース #AI' : '#ニュース #世界情勢 #国際ニュース #今日のニュース #AI'));
  return lines.join('\n').slice(0, 4900);
}

function renderHtml(project, opts) {
  opts = opts || {};
  const n = project.news || {};
  const items = Array.isArray(n.items) ? n.items : [];
  const o = project.outputs || {};
  const video = o.mp4 ? `<video controls playsinline src="${esc(o.mp4)}" style="max-width:100%;max-height:70vh;border-radius:12px;background:#000"></video>` : '';
  const yt = project.youtube && project.youtube.url ? `<p class="yt"><a href="${esc(project.youtube.url)}" target="_blank" rel="noopener">YouTube で見る: ${esc(project.youtube.url)}</a></p>` : '';
  const itemsHtml = items.map((it) => `
  <article class="item">
    <div class="meta"><span class="genre">${esc(genreLabel(it.genre))}</span><span>${esc(it.region || '')}</span><span>${esc(fmtDate(it.publishedAt))}</span></div>
    <h3>${esc(it.no)}. ${esc(it.title)}</h3>
    <p>${esc(it.summary)}</p>
    ${it.perspectives ? `<p class="persp"><b>見方の違い:</b> ${esc(it.perspectives)}</p>` : ''}
    <p class="japan"><b>日本で暮らす視点:</b> ${esc(it.japanAngle)}</p>
    <ul class="src">${(it.sources || []).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.publisher || '')}${s.lang ? ' (' + esc(s.lang) + ')' : ''}: ${esc(s.title || s.url)}</a></li>`).join('')}</ul>
  </article>`).join('');
  const outlook = n.japanOutlook ? `
  <section class="outlook">
    <h2>日本で過ごす上での構え</h2>
    <p>${esc(n.japanOutlook.summary)}</p>
    <ul>${(n.japanOutlook.actions || []).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
  </section>` : '';
  const unverified = (n.unverified || []).length ? `<section class="unv"><h2>確認できなかった点</h2><ul>${n.unverified.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></section>` : '';
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(n.headline || project.title)}</title>
<style>
html{font-size:17px}body{margin:0;background:#f6f5f0;color:#23262d;font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP",sans-serif;line-height:1.9;letter-spacing:.04em}
main{max-width:860px;margin:0 auto;padding:1.5rem 1rem 4rem}
header{background:linear-gradient(135deg,#1b2a4a,#2f4a7d);color:#f5f3ea;padding:2rem 1rem 1.6rem;text-align:center}
header h1{margin:0;font-size:1.8rem;letter-spacing:.12em}header p{margin:.5rem 0 0;opacity:.9}
h2{font-size:1.3rem;letter-spacing:.1em;color:#1b2a4a;border-bottom:2px solid #c9a84c;padding-bottom:.4rem;margin:2rem 0 1rem}
.lead{font-size:1.08rem;background:#fff;border:1px solid #e1e3dd;border-radius:12px;padding:1.2rem 1.4rem}
.item{background:#fff;border:1px solid #e1e3dd;border-radius:12px;padding:1.2rem 1.4rem;margin-top:1rem}
.item h3{margin:.3rem 0 .6rem;font-size:1.15rem;color:#1b2a4a}
.meta{display:flex;gap:.8rem;flex-wrap:wrap;font-size:.85rem;color:#6a6d66}.genre{background:#eef2fa;color:#2f4a7d;padding:0 .6em;border-radius:999px}
.japan{background:#fbf6e8;border-left:4px solid #c9a84c;padding:.5rem .9rem;border-radius:6px}
.persp{color:#4a4d55}.src{font-size:.88rem;padding-left:1.2rem;margin:.4rem 0 0}.src li{margin:.15rem 0;word-break:break-all}
.outlook{background:#fff;border:1px solid #e1e3dd;border-radius:12px;padding:1.2rem 1.4rem;margin-top:1.5rem}
.unv{font-size:.92rem;color:#6a6d66}.yt{font-size:1.05rem}.credit{margin-top:3rem;font-size:.85rem;color:#8a8d86;text-align:center}
video{display:block;margin:1rem auto}
</style></head><body>
<header><h1>${esc(n.headline || project.title)}</h1><p>${esc(n.date || '')}</p></header>
<main>
${video}${yt}
${n.lead ? `<p class="lead">${esc(n.lead)}</p>` : ''}
<h2>今日のニュース（${items.length} 本）</h2>
${itemsHtml}
${outlook}
${unverified}
${opts.credit ? `<p class="credit">${esc(opts.credit)}</p>` : ''}
</main></body></html>`;
}

module.exports = { renderHtml, youtubeTitle, youtubeDescription, genreLabel };
