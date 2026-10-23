'use strict';
// 字字动画(Zizi Animation) 工程解析
// 支持两代 video_prompt / paperwork 格式：
//   A 旧版(2026-09 早期)：  「镜头 N / SCn（起-止 秒）：」 + 【台词】/【画外音】/【OS】
//   B 新版(2026-09 后期)：  「[画面] 时长N秒（M字台词）。」 + 「台词：角色：内容」，时间靠累加
const fs = require('fs');
const path = require('path');

function readIniEntries(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const entries = [];
  let cur = null, buf = [];
  for (const raw0 of raw.split('\n')) {
    const ln = raw0.replace(/\r$/, '');
    const t = ln.trim();
    if (/^\[.*\]$/.test(t)) continue;
    const i = ln.indexOf('=');
    if (i >= 0 && !/^\s/.test(ln)) {
      if (cur) entries.push([cur, buf.join('')]);
      cur = ln.slice(0, i).trim();
      buf = [ln.slice(i + 1).trim()];
    } else {
      buf.push(t);
    }
  }
  if (cur) entries.push([cur, buf.join('')]);
  return entries;
}

function decodeIniValue(v) {
  const s = v.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  return Buffer.from(s + '='.repeat((4 - (s.length % 4)) % 4), 'base64');
}

const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
function sanitize(t) { return String(t).replace(CTRL, '\u0001').replace(/\ufffd/g, '\u0001'); }

function clean(s) {
  if (!s) return '';
  s = s.split('\ufffd')[0];
  s = s.replace(/[A-Za-z_]{3,}.*$/, '');
  return s.trim();
}
function cleanEp(s) {
  const ep0 = clean(s);
  if (!ep0) return null;
  const cut = ep0.split(/["“”]|->|—>|→/)[0].trim();
  const ep = (cut.length >= 4 && cut.length <= 40) ? cut : ep0.slice(0, 40);
  return ep || null;
}
const EP_SRC = '第([一二三四五六七八九十百零\\d]+)集[：:]([^\\n\\u0001]*)';
function findEpisode(txt) {
  const re = new RegExp(EP_SRC, 'g');
  const all = txt.match(re);
  if (!all || !all.length) return null;
  return cleanEp(all[all.length - 1]);
}

// ============ 旧格式 A ============
const HEAD = /镜头\s*(\d+)\s*\/\s*SC(\d+)（([\d.]+)\s*-\s*([\d.]+)\s*秒）：/;
function parseKv(block) {
  const d = {};
  for (const line of block.split('\n')) {
    const m = line.trim().match(/^【([^】]+)】\s*(.*)$/);
    if (m) d[m[1]] = clean(m[2]);
  }
  return d;
}
function splitLine(s) {
  s = clean(s);
  if (!s || s === '无') return ['', ''];
  const q = s.match(/[“"]([^”"]*)[”"]?/);
  if (q) {
    const pre = s.slice(0, q.index);
    const m = pre.match(/^([^（(：:]{1,14})/);
    return [m ? m[1].trim() : '', (q[1] || '').trim()];
  }
  const m = s.match(/^([^（(：:]{1,14})(?:[（(][^）)]*[）)])?\s*[：:]\s*([\s\S]*)$/);
  if (m) return [m[1].trim(), m[2].trim()];
  return ['', s];
}
// 剧本偶尔把导演备注写进台词里，比如"（原因：镜头内包含撬开铁皮箱的关键不可压缩动作，语速适当放缓）"，
// 这种不能当字幕打出来，必须在取词时就剔掉。
function stripNote(s) {
  return String(s || '')
    .replace(/[（(]\s*(原因|注|说明|备注|导演|镜头|画面|音效|配乐|此处|详见)[^）)]*[）)]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function parseOldFormat(txt, order, hash) {
  const it = { order, hash, format: 'A' };
  it.episode = findEpisode(txt);
  const tm = txt.match(/时长：([\d.]+)s/); it.total = tm ? parseFloat(tm[1]) : null;
  const pm = txt.match(/人物：([^\n\ufffd]*)/); it.persons_raw = pm ? clean(pm[1]) : '';
  const sm = txt.match(/场景：([^\n\ufffd]*)/); it.scene = sm ? clean(sm[1]) : null;

  let st = txt.indexOf('镜头 1 / SC1（');
  if (st < 0) st = txt.indexOf('镜头 1 / SC1');
  const shots = [];
  if (st >= 0) {
    let pos = st, expect = 1;
    while (true) {
      HEAD.lastIndex = 0;
      const m = HEAD.exec(txt.slice(pos));
      if (!m || parseInt(m[1], 10) !== expect) break;
      const abs = pos + m.index;
      const afterHead = abs + m[0].length;
      HEAD.lastIndex = 0;
      const nm = HEAD.exec(txt.slice(afterHead));
      const end = nm ? afterHead + nm.index : Math.min(txt.length, afterHead + 3000);
      const d = parseKv(txt.slice(afterHead, end));
      const [sp, tx] = splitLine(d['台词'] || '');
      const [osp, osx] = splitLine(d['OS'] || '');
      const [vsp, vx] = splitLine(d['画外音'] || '');
      let sub = '', src = '', spk = sp;
      if (tx) { sub = tx; src = '台词'; spk = sp; }
      else if (vx) { sub = vx; src = '画外音'; spk = vsp; }
      else if (osx) { sub = osx; src = 'OS'; spk = osp; }
      shots.push({ n: expect, start: parseFloat(m[3]), end: parseFloat(m[4]), speaker: spk, text: stripNote(sub), src });
      expect++;
      if (!nm) break;
      pos = afterHead + nm.index;
    }
  }
  it.shots = shots;
  const ps = [];
  for (let p of (it.persons_raw || '').split(/[，,、]/)) {
    p = p.replace(/[（(].*?[）)]/g, '').trim();
    if (p && ps.indexOf(p) < 0) ps.push(p);
  }
  it.persons = ps;
  return it;
}

// ============ 新格式 B ============
const DELIM = '_::~OUTPUT_START::~_';
const SHOT_RE = /\[画面\]\s*(?:时长\s*)?([\d.]+)\s*秒\s*（\s*(\d+)\s*字台词\s*）/g;
function splitDialogue(s) {
  s = String(s).trim();
  if (!s || s === '无') return ['', ''];
  const m = s.match(/^([^：:]{1,20})[：:]\s*([\s\S]*)$/);
  if (m) return [m[1].replace(/[（(][^）)]*[）)]/g, '').trim(), m[2].trim()];
  return ['', s];
}
function parseNewFormat(rawTxt, order, hash) {
  const txt = sanitize(rawTxt);
  const it = { order, hash, format: 'B' };
  // 两个可能的正文锚点，取靠前的那个（同一个 pickle 后面别的字段里也可能出现分隔符）
  const ti0 = txt.indexOf('本组总时长');
  const di0 = txt.indexOf(DELIM);
  let bodyStart, epTo;
  if (ti0 >= 0 && (di0 < 0 || ti0 < di0)) { bodyStart = ti0; epTo = ti0; }
  else if (di0 >= 0) { bodyStart = di0 + DELIM.length; epTo = di0; }
  else return null;
  it.episode = findEpisode(txt.slice(Math.max(0, epTo - 600), epTo));
  let body = txt.slice(bodyStart);
  const cut = body.search(/\u0001/);
  if (cut >= 0) body = body.slice(0, cut);
  body = body.replace(/\r/g, '').trim();
  it._text = body;

  const tm = body.match(/本组总时长：\s*([\d.]+)\s*(?:s|秒)/); it.total = tm ? parseFloat(tm[1]) : null;
  const bm = body.match(/背景：([^\n]*)/); it.bg = bm ? clean(bm[1]) : null;
  const hm = body.match(/看点：([^\n]*)/); it.highlight = hm ? clean(hm[1]) : null;
  const sc = body.match(/场景\d+：([^\n]*)/); it.scene = sc ? clean(sc[1]) : null;

  const marks = [];
  SHOT_RE.lastIndex = 0;
  let m;
  while ((m = SHOT_RE.exec(body))) {
    marks.push({ markStart: m.index, bodyStart: m.index + m[0].length, dur: parseFloat(m[1]), chars: parseInt(m[2], 10) });
  }
  const shots = [];
  let t = 0;
  for (let i = 0; i < marks.length; i++) {
    const chunk = body.slice(marks[i].bodyStart, i + 1 < marks.length ? marks[i + 1].markStart : body.length);
    const pic = chunk.match(/画面：([^\n]*)/);
    const lines = chunk.match(/台词：([^\n]*)/g) || [];
    let speaker = '';
    const texts = [];
    for (const L of lines) {
      const parts = splitDialogue(L.replace(/^台词：/, ''));
      if (!speaker && parts[0]) speaker = parts[0];
      if (parts[1]) texts.push(parts[1]);
    }
    const text = stripNote(texts.join(''));
    const start = t, end = t + (marks[i].dur || 0);
    shots.push({ n: i + 1, start: +start.toFixed(2), end: +end.toFixed(2), speaker, text, src: text ? '台词' : '', pic: pic ? clean(pic[1]) : '' });
    t = end;
  }
  it.shots = shots;
  it.shot_total = +t.toFixed(2);
  it.persons = [];
  it.persons_raw = '';
  return it;
}

function parseEntry(txt, order, hash) {
  if (txt.indexOf(DELIM) >= 0 || /\[画面\]\s*(?:时长\s*)?[\d.]+\s*秒/.test(txt)) return parseNewFormat(txt, order, hash);
  if (/镜头\s*1\s*\/\s*SC1/.test(txt)) return parseOldFormat(txt, order, hash);
  return null; // origin_text / reference_result 之类的非分镜键
}

// ============ 人物 ============
function parseCharacterFields(desc) {
  const d = {};
  for (const m of (desc || '').matchAll(/【([^】]+)】：([^\n]*)/g)) d[m[1]] = m[2].trim();
  return d;
}
function readCharacters(ziziDir) {
  const p = path.join(ziziDir, 'characters.json');
  if (!fs.existsSync(p)) return [];
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const arr = j.characters || j;
  return arr.map((c) => {
    const f = parseCharacterFields(c.description);
    return {
      name: c.name, alias: c.alias || '', character_id: String(c.character_id || ''),
      fields: f, identity: f['身份'] || '', age: f['年龄'] || '', show_in_main: c.show_in_main !== false,
    };
  });
}

function attachPersons(items, characters) {
  const keys = characters.map((c) => ({
    name: c.name,
    names: [c.name].concat(String(c.alias || '').split(/[,，、]/)).map((s) => s.trim()).filter((s) => s.length >= 2),
  }));
  for (const it of items) {
    const have = new Set(it.persons || []);
    const hay = (it._text || '') + ' ' + (it.shots || []).map((s) => s.speaker || '').join(' ');
    for (const k of keys) {
      if (have.has(k.name)) continue;
      for (const n of k.names) if (hay.indexOf(n) >= 0) { have.add(k.name); break; }
    }
    const out = [];
    for (const k of keys) if (have.has(k.name)) out.push(k.name);
    for (const p of it.persons || []) if (out.indexOf(p) < 0) out.push(p);
    it.persons = out;
  }
}

// 按 order 建索引：分镜条目里可能夹着 origin_text / reference_result 这类非分镜键，
// 所以不能用数组下标映射草稿片段号。
function itemIndex(items) {
  const m = new Map();
  for (const it of items) m.set(it.order, it);
  return m;
}

function parseProject(ziziDir) {
  const entries = readIniEntries(path.join(ziziDir, 'data.ini'));
  const characters = readCharacters(ziziDir);
  const items = [];
  for (let i = 0; i < entries.length; i++) {
    const it = parseEntry(decodeIniValue(entries[i][1]).toString('utf8'), i + 1, entries[i][0]);
    if (it) items.push(it);
  }
  attachPersons(items, characters);
  for (const it of items) if (it._text) { it.raw_len = it._text.length; delete it._text; }
  return { items, characters, entries: entries.length, format: items.length ? items[0].format : null };
}

module.exports = { parseProject, readCharacters, parseCharacterFields, attachPersons, itemIndex, decodeIniValue, readIniEntries, parseEntry };
