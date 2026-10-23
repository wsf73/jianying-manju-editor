#!/usr/bin/env node
'use strict';
// 由剪映草稿 + 字字动画工程生成 plan.json，供 audio-align.js 做音频对齐用。
// 每项：{ num, dur, path, total, lines:[{s,e,c,t}] }  —— s/e 是相对该片段起点的秒数
// 用法: node make-plan.js --draft "<草稿名>" --zizi "<字字动画工程目录>" -o plan.json [--root <草稿根目录>]
const fs = require('fs');
const J = require('./lib/jianying');
const Z = require('./lib/zizi');

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

const a = argv(process.argv.slice(2));
if (!a.draft || !a.zizi) {
  console.error('用法: node make-plan.js --draft <草稿名> --zizi <字字动画工程目录> -o plan.json [--root <草稿根目录>]');
  process.exit(2);
}
const reg = J.loadRegistry(a.registry);
const root = a.root || J.draftRoot(reg);
if (!root) throw new Error('读不到草稿根目录，请用 --root 指定');
const name = a.draft;
const dir = J.draftDir(root, name);
const tl = J.timeline(J.loadDraft(dir));

const pr = Z.parseProject(a.zizi);
const IM = Z.itemIndex(pr.items);

const plan = tl.segs.map((s) => {
  const it = IM.get(s.num);
  const lines = it
    ? (it.shots || []).filter((sh) => sh.text).map((sh) => ({
        s: +Number(sh.start).toFixed(3),
        e: +Number(sh.end).toFixed(3),
        c: String(sh.text).length,
        t: String(sh.text),
      }))
    : [];
  return { num: s.num, dur: +(s.dur / 1e6).toFixed(3), path: s.path, total: it ? it.total : null, lines };
});

const out = a.out || a.o || 'plan.json';
fs.writeFileSync(out, JSON.stringify(plan), 'utf8');
const withLines = plan.filter((p) => p.lines.length).length;
const chars = plan.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.c, 0), 0);
console.log('写入 ' + out);
console.log('  片段 ' + plan.length + '   有台词的 ' + withLines + '   台词行 ' + plan.reduce((n, p) => n + p.lines.length, 0) + '   字数 ' + chars);
console.log('  声明总时长与实际片段时长差 (秒): ' +
  (() => {
    const d = plan.filter((p) => p.total).map((p) => p.dur - p.total).sort((x, y) => x - y);
    if (!d.length) return '无数据';
    const q = (t) => d[Math.min(d.length - 1, Math.floor(d.length * t))].toFixed(2);
    return 'min ' + q(0) + ' / 25% ' + q(0.25) + ' / 中位 ' + d[Math.floor(d.length / 2)].toFixed(2) + ' / 75% ' + q(0.75) + ' / max ' + d[d.length - 1].toFixed(2);
  })());
