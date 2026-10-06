// 番組（案件）の保存。~/NewsMovie-data/<id>/ に project.json と生成物を置く。Node 標準のみ。
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const STATUS_LABEL = { queued: '待機中', running: '制作中', done: '完了', error: '失敗' };

function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, obj) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

function stamp(d) {
  d = d || new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

function projectDir(dataDir, id) {
  if (!id || /[\\/]/.test(id) || id.startsWith('.')) return null;
  const p = path.join(dataDir, id);
  return fs.existsSync(path.join(p, 'project.json')) ? p : null;
}

function defaultTitle(brief) {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日の世界ニュース`;
}

function createProject(dataDir, brief) {
  const title = String(brief.title || '').trim() || defaultTitle(brief);
  const id = `${stamp()}_news`;
  const dir = path.join(dataDir, id);
  fs.mkdirSync(path.join(dir, 'work'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scenes'), { recursive: true });
  const project = {
    id, title, brief,
    status: 'queued', statusLabel: STATUS_LABEL.queued, error: '',
    stage: '',                 // research / script / images / render / upload
    news: null,                // 調査結果（news.json）
    script: null,              // 台本（script.json）
    outputs: {},               // { mp4, html, news, script, description }
    youtube: null,             // { url, videoId, uploadedAt, privacy }
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  writeJSON(path.join(dir, 'project.json'), project);
  return project;
}

function getProject(dataDir, id) {
  const dir = projectDir(dataDir, id);
  if (!dir) return null;
  const p = readJSON(path.join(dir, 'project.json'), null);
  if (p) p.dir = dir;
  return p;
}

function saveProject(dataDir, project) {
  const dir = path.join(dataDir, project.id);
  const copy = Object.assign({}, project);
  delete copy.dir;
  copy.updatedAt = Date.now();
  writeJSON(path.join(dir, 'project.json'), copy);
  project.updatedAt = copy.updatedAt;
  return project;
}

function listProjects(dataDir) {
  let names = [];
  try { names = fs.readdirSync(dataDir); } catch { return []; }
  const out = [];
  for (const n of names) {
    const p = readJSON(path.join(dataDir, n, 'project.json'), null);
    if (!p) continue;
    const items = (p.news && Array.isArray(p.news.items)) ? p.news.items : [];
    out.push({
      id: p.id, title: p.title, status: p.status, statusLabel: p.statusLabel, stage: p.stage,
      headline: p.news ? String(p.news.headline || '').slice(0, 80) : '',
      itemCount: items.length,
      hasVideo: !!(p.outputs && p.outputs.mp4),
      youtubeUrl: p.youtube ? p.youtube.url : '',
      createdAt: p.createdAt, updatedAt: p.updatedAt,
    });
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

function deleteProject(dataDir, id) {
  const dir = projectDir(dataDir, id);
  if (!dir) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

module.exports = { STATUS_LABEL, readJSON, writeJSON, stamp, projectDir, createProject, getProject, saveProject, listProjects, deleteProject };
