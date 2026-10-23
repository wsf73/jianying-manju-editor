#!/usr/bin/env node
'use strict';
// jianying-manju-editor CLI：把剪映草稿 + 字字动画工程，改造成爆款漫剧版草稿
const fs = require('fs');
const path = require('path');
const U = require('./lib/util');
const Z = require('./lib/zizi');
const J = require('./lib/jianying');
const B = require('./lib/bgm');
const Build = require('./lib/build');

function argv(list) {
  const o = { _: [] };
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (/^-{1,2}[A-Za-z]/.test(a)) {
      const k = a.replace(/^-+/, '');
      const n = list[i + 1];
      if (n === undefined || /^-{1,2}[A-Za-z]/.test(n)) o[k] = true;
      else { o[k] = n; i++; }
    } else o._.push(a);
  }
  return o;
}
function out(p, s) { fs.writeFileSync(p, s, 'utf8'); console.log('written -> ' + p); }
function pct(a, b) { return b ? ((a / b) * 100).toFixed(1) + '%' : '-'; }

function cmdScan(a) {
  const reg = J.loadRegistry(a.registry);
  const root = a.root || J.draftRoot(reg);
  const name = a.draft || a._[1];
  if (!name) throw new Error('用法: manju scan --draft <草稿名> [--root <草稿根目录>]');
  const dir = J.draftDir(root, name);
  const tl = J.timeline(J.loadDraft(dir));
  const lines = ['草稿: ' + name, '目录: ' + dir, '时长: ' + (tl.total / 1e6).toFixed(1) + 's', '视频段: ' + tl.segs.length, '前 5 段: ' + tl.segs.slice(0, 5).map((s) => '#' + s.num + '@' + (s.start / 1e6).toFixed(1) + 's').join(' ')];
  const zz = a.zizi;
  if (zz) {
    const pr = Z.parseProject(zz);
    let m = 0, tot = 0, chars = 0;
    const IM = Z.itemIndex(pr.items);
  for (const s of tl.segs) { const it = IM.get(s.num); tot++; if (!it || it.hash !== s.hash) m++; }
    for (const it of pr.items) for (const sh of it.shots) { if (sh.text) chars += sh.text.length; }
    const eps = pr.items.filter((i) => i.episode).map((i) => '#' + i.order + ' ' + i.episode);
    lines.push('', '字字动画工程: ' + zz, '分镜条目: ' + pr.items.length + '  人物: ' + pr.characters.length, 'hash 匹配: ' + pct(tot - m, tot) + ' (不匹配 ' + m + ')', '台词字数: ' + chars, '集标题 (' + eps.length + '): ' + eps.join(' | '));
    const first = new Map();
    for (const it of pr.items) for (const p of it.persons) if (!first.has(p)) first.set(p, it.order);
    lines.push('首次出场: ' + [...first.entries()].sort((x, y) => x[1] - y[1]).map((e) => e[0] + '#' + e[1]).join(' '));
  }
  const text = lines.join('\n');
  if (a.out) out(a.out, text); else console.log(text);
}

function cmdExtract(a) {
  const zz = a.zizi || a._[1];
  if (!zz) throw new Error('用法: manju extract --zizi <字字动画工程目录> -o items.json');
  const pr = Z.parseProject(zz);
  const dst = a.out || a.o || 'items.json';
  U.writeJson(dst, pr.items);
  const chars = pr.characters.map((c) => c.name + ' | ' + c.age + ' | ' + c.identity);
  console.log('条目 ' + pr.items.length + '  镜头 ' + pr.items.reduce((s, i) => s + i.shots.length, 0) + '  台词行 ' + pr.items.reduce((s, i) => s + i.shots.filter((x) => x.text).length, 0));
  console.log('人物 ' + pr.characters.length + ':');
  console.log(chars.join('\n'));
  console.log('items -> ' + dst);
}

function cmdBuild(a) {
  const cf = a.config;
  if (!cf) throw new Error('用法: manju build --config config.json [--no-register] [--out report.json]');
  const cfg = U.readJson(cf);
  cfg._baseDir = path.dirname(path.resolve(cf));
  if (a['no-register']) cfg.register = false;
  if (a['in-place']) { cfg.inPlace = true; cfg.outputDraft = cfg.sourceDraft; }
  if (a['dry-run']) { console.log('dry-run: 配置可解析，字段 ' + Object.keys(cfg).join(', ')); return; }
  const r = Build.build(cfg);
  console.log(r.log.join('\n'));
  console.log('输出草稿: ' + r.outDir);
  console.log('草稿 ID : ' + r.draftId);
  if (a.out) out(a.out, JSON.stringify(r, null, 1));
  if (a.report) {
    const rows = ['| 起 | 时长 | 情绪 | 剧情小段 | 曲目 |', '|---|---|---|---|---|'];
    for (const c of r.cueReport) {
      const mm = String(Math.floor(c.from / 60)).padStart(2, '0') + ':' + String(Math.floor(c.from % 60)).padStart(2, '0');
      rows.push('| ' + mm + ' | ' + c.len + 's | ' + c.mood + ' | ' + c.label + ' | ' + c.file + ' |');
    }
    fs.writeFileSync(a.report, '# 配乐铺排\n\n共 ' + r.cueReport.length + ' 个情绪段\n\n' + rows.join('\n') + '\n', 'utf8');
    console.log('written -> ' + a.report);
  }
}

function cmdRegister(a) {
  const cf = a.config;
  if (!cf) throw new Error('用法: manju register --config config.json');
  const cfg = U.readJson(cf);
  const root = cfg.draftRoot;
  const dir = J.draftDir(root, cfg.outputDraft);
  const meta = U.readJson(dir + '/draft_meta_info.json');
  const r = J.registerDraft(cfg.registryPath, root, cfg.outputDraft, dir, meta.draft_id, meta.tm_duration, cfg.materialsSize);
  console.log('已注册: ' + cfg.outputDraft + '  id=' + r.id + '  草稿列表 ' + r.store + ' 条');
}

// 从已有草稿反向生成配置骨架
function cmdInit(a) {
  const reg = J.loadRegistry(a.registry);
  const root = a.root || J.draftRoot(reg);
  const name = a.draft || a._[1];
  if (!name) throw new Error('用法: manju init --draft <草稿名> [-o config.json]');
  const dir = J.draftDir(root, name);
  const tl = J.timeline(J.loadDraft(dir));
  const firstWithPath = tl.segs.find((s) => s.path);
  const zz = a.zizi || (firstWithPath ? path.dirname(firstWithPath.path.replace(/\//g, path.sep)) : null);
  const cfg = {
    project: name,
    draftRoot: root,
    sourceDraft: name,
    outputDraft: name + '_漫剧版',
    ziziProject: zz,
    styleRef: null,
    font: require('./lib/templates.json').font,
    style: {
      subtitle: { size: 6, y: -0.8, color: [1.0, 0.8705882430076599, 0.0], strokeWidth: 0.07999999821186066, minDurationMs: 300 },
      intro: { size: 8, y: 0.55, color: [1, 1, 1], bg: true, bgAlpha: 0.55, durationMs: 3000, staggerMs: 3300, leadMs: 400, skip: [] },
    },
    bgm: { volume: 0.32, fadeInMs: 700, fadeOutMs: 1000, innerFadeMs: 150, minCueMs: 20000, library: {}, cues: [] },
    trackNames: { subtitle: '字幕', intro: '人物出场介绍', bgm: '配乐' },
    copySkip: ['.backup'],
  };
  if (zz && fs.existsSync(path.join(zz, 'data.ini'))) {
    const pr = Z.parseProject(zz);
    const eps = pr.items.filter((i) => i.episode);
    cfg.bgm.cues = eps.map((i) => [i.order, 'warm', i.episode]);
    console.log('自动生成 ' + eps.length + ' 个集级 cue，情绪的 library 与 mood 需要人工填写');
    console.log('分镜 ' + pr.items.length + ' 条，人物 ' + pr.characters.length + ' 个');
  }
  const dst = a.out || a.o || ('config.' + name + '.json');
  U.writeJson(dst, cfg);
  console.log('配置骨架 -> ' + dst);
}

function main() {
  const a = argv(process.argv.slice(2));
  const cmd = a._[0];
  if (cmd === 'scan') return cmdScan(a);
  if (cmd === 'extract') return cmdExtract(a);
  if (cmd === 'build') return cmdBuild(a);
  if (cmd === 'register') return cmdRegister(a);
  if (cmd === 'init') return cmdInit(a);
  console.log('jianying-manju-editor\n\n  manju init    --draft <草稿名> [-o config.json]\n  manju scan    --draft <草稿名> [--zizi <字字动画工程目录>] [--out report.txt]\n  manju extract --zizi <字字动画工程目录> [-o items.json]\n  manju build   --config <config.json> [--no-register] [--in-place] [--report bgm.md]\n  manju register --config <config.json>');
}
try { main(); } catch (e) { console.error('ERROR: ' + e.message); if (process.env.MANJU_DEBUG) console.error(e.stack); process.exit(1); }
