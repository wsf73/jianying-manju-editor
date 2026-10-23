'use strict';
// 剪映( JianyingPro ) 草稿读写、时间线映射、草稿列表注册
const fs = require('fs');
const path = require('path');
const { uid, clone, readJson, writeJson, exists, copyTree, rmTree } = require('./util');

function registryPath() {
  const local = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
  return path.join(local, 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft', 'root_meta_info.json');
}
function loadRegistry(p) {
  const rp = p || registryPath();
  return { path: rp, json: readJson(rp) };
}
function draftEntry(reg, name) {
  const list = reg.json.all_draft_store || [];
  return list.find((e) => e.draft_name === name) ||
         list.find((e) => String(e.draft_fold_path || '').replace(/\\/g, '/').endsWith('/' + name));
}
function draftRoot(reg) {
  const e = (reg.json.all_draft_store || []).find((x) => x.draft_root_path);
  return e ? e.draft_root_path : null;
}
function draftDir(root, name) { return path.join(root, name).replace(/\\/g, '/'); }
function loadDraft(dir) { return readJson(path.join(dir, 'draft_content.json')); }

function timeline(draft) {
  const vt = draft.tracks.find((t) => t.type === 'video');
  if (!vt) throw new Error('draft has no video track');
  const segs = [];
  let total = 0;
  for (const s of vt.segments) {
    const mat = (draft.materials.videos || []).find((v) => v.id === s.material_id) || {};
    const nm = String(mat.material_name || '');
    const info = {
      index: segs.length,
      start: s.target_timerange.start,
      dur: s.target_timerange.duration,
      num: parseInt(nm.slice(0, 4), 10),
      hash: nm.split('_')[1] || '',
      path: mat.path || '',
    };
    total = Math.max(total, info.start + info.dur);
    segs.push(info);
  }
  const byNum = new Map(segs.map((x) => [x.num, x]));
  const segOf = (n) => byNum.get(n) || segs.filter((x) => x.num <= n).pop();
  return { segs, total, byNum, segOf };
}

// 把源草稿复制成一个新的输出草稿（非破坏性），返回输出目录
function prepareOutput(root, srcName, outName, skip) {
  const src = draftDir(root, srcName), dst = draftDir(root, outName);
  if (src === dst) throw new Error('source and output draft must differ: ' + src);
  rmTree(dst);
  copyTree(src, dst, skip || []);
  return dst;
}

function updateMeta(dir, name, rootPath, durationUs) {
  const p = path.join(dir, 'draft_meta_info.json');
  const mi = readJson(p);
  const newId = uid();
  mi.draft_id = newId;
  mi.draft_name = name;
  mi.draft_fold_path = dir;
  mi.draft_json_file = dir + '/draft_content.json';
  mi.draft_cover = dir + '/draft_cover.jpg';
  mi.draft_root_path = rootPath;
  mi.tm_duration = durationUs;
  mi.tm_draft_create = Date.now() * 1000;
  mi.tm_draft_modified = Date.now() * 1000;
  writeJson(p, mi);
  return newId;
}

// 写进剪映草稿列表；剪映若在运行，退出时可能覆盖，需重新注册
function registerDraft(regPath, rootPath, outName, dir, id, durationUs, materialsSize) {
  const reg = loadRegistry(regPath);
  const list = reg.json.all_draft_store || [];
  const proto = list.find((e) => String(e.draft_fold_path || '').replace(/\\/g, '/') === dir) ||
                list.find((e) => e.draft_root_path === rootPath) || list[0];
  const entry = Object.assign({}, proto, {
    draft_name: outName,
    draft_fold_path: dir,
    draft_json_file: dir + '/draft_content.json',
    draft_cover: dir + '/draft_cover.jpg',
    draft_id: id,
    draft_root_path: rootPath,
    draft_is_invisible: false,
    draft_new_version: '',
    draft_type: '',
    tm_duration: durationUs,
    tm_draft_create: Date.now() * 1000,
    tm_draft_modified: Date.now() * 1000,
    tm_draft_removed: 0,
  });
  if (typeof materialsSize === 'number') entry.draft_timeline_materials_size = materialsSize;
  const filtered = list.filter((e) => e.draft_name !== outName &&
    String(e.draft_fold_path || '').replace(/\\/g, '/') !== dir);
  filtered.unshift(entry);
  reg.json.all_draft_store = filtered;
  reg.json.draft_ids = filtered.length;
  writeJson(reg.path, reg.json);
  return { registered: true, store: filtered.length, id };
}

module.exports = {
  registryPath, loadRegistry, draftEntry, draftRoot, draftDir, loadDraft,
  timeline, prepareOutput, updateMeta, registerDraft,
};
