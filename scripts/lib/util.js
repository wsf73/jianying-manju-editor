'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const uid = () => crypto.randomUUID().toUpperCase();
const clone = (o) => JSON.parse(JSON.stringify(o));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o), 'utf8');
const exists = (p) => { try { fs.accessSync(p); return true; } catch (e) { return false; } };

// 注意：fs.cpSync 在剪映草稿目录上会直接崩（Node 24 报 0xC0000409），必须自己递归拷。
function copyTree(src, dst, skip) {
  skip = skip || [];
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.indexOf(e.name) >= 0) continue;
    const s = path.join(src, e.name), t = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, t, skip);
    else if (e.isFile()) fs.copyFileSync(s, t);
  }
}
function rmTree(p) { if (exists(p)) fs.rmSync(p, { recursive: true, force: true }); }
function ms(x) { return Math.round(x); }

module.exports = { uid, clone, readJson, writeJson, exists, copyTree, rmTree, ms };
