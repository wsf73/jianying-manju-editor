'use strict';
// 用"浊音检测"从片段音频里找出真正的人声区间，再把台词行对齐上去。
// 为什么需要它：字字动画的\`时长X秒\`只是生成计划，AI 视频模型实际说话的节奏常对不上，
// 字幕按计划时间铺就会"提前显示"。静音检测区分不了人声和音效（鞭炮、撞击声都是宽频），
// 而浊音有强周期性，用自相关就能把人声挑出来。
const fs = require('fs');

const SR = 16000, WIN = 512, HOP = 256, MERGE = 0.18;
const LAG_MIN = 40, LAG_MAX = 240, LAG_STEP = 3;   // 2.5ms ~ 15ms 的基音周期
const VOICED = 0.32;                                // 自相关峰阈值
const MIN_SEG = 0.12;                               // 短于此的人声段丢掉（多半是噪声）
const ENERGY_ABS = 1e-5, ENERGY_REL = 0.004;

const LEAD = 0.10, TAIL = 0.30, CLAMP = 1.5, MIN_DUR = 0.3;

function vadFloat(x) {
  const n = x.length;
  const frames = [];
  let emax = 1e-9;
  for (let p = 0; p + WIN <= n; p += HOP) {
    let e = 0;
    for (let i = 0; i < WIN; i++) e += x[p + i] * x[p + i];
    e /= WIN;
    frames.push({ t: p / SR, e });
    if (e > emax) emax = e;
  }
  for (const f of frames) {
    if (f.e < ENERGY_ABS || f.e < emax * ENERGY_REL) { f.v = 0; continue; }
    const p = Math.round(f.t * SR);
    let s0 = 0;
    for (let i = 0; i < WIN; i++) s0 += x[p + i] * x[p + i];
    let best = 0;
    for (let lag = LAG_MIN; lag <= LAG_MAX; lag += LAG_STEP) {
      let s = 0;
      const lim = WIN - lag;
      for (let i = 0; i < lim; i++) s += x[p + i] * x[p + i + lag];
      const r = s / (s0 || 1e-9);
      if (r > best) best = r;
    }
    f.v = best > VOICED ? 1 : 0;
  }
  const segs = [];
  let cur = null;
  for (const f of frames) {
    if (f.v) {
      if (!cur) cur = { s: f.t, e: f.t + HOP / SR };
      else if (f.t + 0.001 - cur.e <= MERGE) cur.e = f.t + HOP / SR;
      else { if (cur.e - cur.s >= MIN_SEG) segs.push(cur); cur = { s: f.t, e: f.t + HOP / SR }; }
    } else if (cur) {
      if (f.t - cur.e > MERGE) { if (cur.e - cur.s >= MIN_SEG) segs.push(cur); cur = null; }
    }
  }
  if (cur && cur.e - cur.s >= MIN_SEG) segs.push(cur);
  return segs;
}

function readPcmRaw(file) {
  const buf = fs.readFileSync(file);
  const n = Math.floor(buf.length / 2);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(i * 2) / 32768;
  return x;
}

// segs: [{s,e}] 人声区间；lines: [{s,e}] 声明台词时间（相对片段起点）
function assignLines(segs, lines) {
  const buckets = lines.map(() => []);
  for (const sg of segs) {
    let bi = -1;
    // ① 起点落在某行的声明窗口内 —— 最可靠，边界上的音不会跑到下一句去
    for (let i = 0; i < lines.length; i++) {
      if (sg.s >= lines[i].s && sg.s <= lines[i].e) { bi = i; break; }
    }
    // ② 起点在窗口外一点：取离"扩展窗口"最近的，但不能太远
    //    （短插话的起点常落在声明窗口末尾之外，例如"你——"）
    if (bi < 0) {
      let bd = Infinity;
      for (let i = 0; i < lines.length; i++) {
        const lo = lines[i].s - 0.15, hi = lines[i].e + 0.30;
        const d = sg.s < lo ? lo - sg.s : (sg.s > hi ? sg.s - hi : 0);
        if (d < bd) { bd = d; bi = i; }
      }
      if (bd > 0.45) bi = -1;
    }
    // ③ 兜底：按最大重叠
    if (bi < 0) {
      let bo = 0;
      for (let i = 0; i < lines.length; i++) {
        const o = Math.max(0, Math.min(sg.e, lines[i].e) - Math.max(sg.s, lines[i].s));
        if (o > bo) { bo = o; bi = i; }
      }
      if (bo <= 0.05) bi = -1;   // 和任何台词都不沾边 → 多半是群众杂音/环境人声，丢掉
    }
    if (bi >= 0) buckets[bi].push(sg);
  }
  const out = lines.map((li, i) => {
    const b = buckets[i];
    if (!b.length) return { s: li.s, e: li.e, aligned: false };
    let s = Infinity, e = -Infinity;
    for (const g of b) { if (g.s < s) s = g.s; if (g.e > e) e = g.e; }
    let st = s - LEAD, en = e + TAIL;
    if (st < li.s - CLAMP) st = li.s - CLAMP;
    if (st > li.s + CLAMP) st = li.s + CLAMP;
    if (en < li.e - CLAMP) en = li.e - CLAMP;
    if (en > li.e + CLAMP) en = li.e + CLAMP;
    if (st < 0) st = 0;
    if (en < st + MIN_DUR) en = st + MIN_DUR;
    return { s: st, e: en, aligned: true };
  });
  for (let i = 1; i < out.length; i++) {
    if (out[i].s < out[i - 1].e + 0.05) out[i].s = out[i - 1].e + 0.05;
    if (out[i].e < out[i].s + MIN_DUR) out[i].e = out[i].s + MIN_DUR;
  }
  return out;
}

module.exports = { vadFloat, readPcmRaw, assignLines, SR };
