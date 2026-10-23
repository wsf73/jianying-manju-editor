'use strict';
// 配乐铺排引擎：把「剧情小段 -> 情绪」的 cue 表，铺成剪映可用的音频片段
// 规则：相邻同情绪自动连成一段；短于 minCueMs 的碎段并回上一段；
//       每首曲子维护一个游标，同曲复用时不总是从 0 秒开始，避免重复感。

function mergeCues(cues, segOf, total, minCueMs) {
  const merged = [];
  for (const c of cues) {
    if (merged.length && merged[merged.length - 1][1] === c[1]) {
      merged[merged.length - 1][2] += ' / ' + c[2];
      continue;
    }
    merged.push([c[0], c[1], c[2]]);
  }
  const out = [];
  for (let i = 0; i < merged.length; i++) {
    const a = segOf(merged[i][0]);
    const n = i + 1 < merged.length ? segOf(merged[i + 1][0]) : null;
    if (!a) continue;
    const len = (n ? n.start : total) - a.start;
    if (len < minCueMs && out.length) { out[out.length - 1][2] += ' / ' + merged[i][2]; continue; }
    out.push(merged[i]);
  }
  return out;
}

function planBgm(opts) {
  const { cues, tracks, segOf, total, volume, minCueMs, fadeInUs, fadeOutUs, innerFadeUs, makeMaterial, makeRefs, makeSegment, makeFade } = opts;
  const merged = mergeCues(cues, segOf, total, minCueMs);
  const materials = [], refs = [], segments = [], fades = [], report = [];
  const matByFile = new Map();
  const cursor = new Map();

  for (let i = 0; i < merged.length; i++) {
    const fromItem = merged[i][0], mood = merged[i][1], label = merged[i][2];
    const tr = tracks[mood];
    if (!tr) throw new Error('unknown mood in bgm.library: ' + mood);
    const a = segOf(fromItem);
    if (!a) continue;
    const n = i + 1 < merged.length ? segOf(merged[i + 1][0]) : null;
    const cueStart = a.start;
    const cueEnd = n ? n.start : total;
    if (cueEnd <= cueStart) continue;

    if (!matByFile.has(tr.file)) {
      const m = makeMaterial(tr.file, tr.durationMs);
      materials.push(m);
      matByFile.set(tr.file, m);
    }
    const mat = matByFile.get(tr.file);
    const srcDur = tr.durationMs * 1000;

    let cur = cueStart, k = 0;
    while (cur < cueEnd - 10000) {
      let off = cursor.get(tr.file) || 0;
      if (off > srcDur - 8000000) off = 0;
      let use = Math.min(srcDur - off, cueEnd - cur);
      if (use <= 200000) { off = 0; use = Math.min(srcDur, cueEnd - cur); }
      const isFirst = k === 0;
      const isLast = (cur + use) >= cueEnd - 10000;

      const fd = makeFade(isFirst ? fadeInUs : innerFadeUs, isLast ? fadeOutUs : innerFadeUs);
      fades.push(fd);
      const segRefs = makeRefs();
      segRefs.push(fd.id);

      const seg = makeSegment(mat.id, off, use, cur, use, volume, segRefs);
      segments.push(seg);
      for (const r of seg._refObjs || []) refs.push(r);

      cursor.set(tr.file, off + use);
      cur += use; k++;
    }
    report.push({
      item: fromItem, mood, label,
      file: String(tr.file).split(/[\\/]/).pop(),
      from: +(cueStart / 1e6).toFixed(1), to: +(cueEnd / 1e6).toFixed(1),
      len: +((cueEnd - cueStart) / 1e6).toFixed(1),
    });
  }
  return { mergedCueCount: merged.length, materials, refs, segments, fades, report };
}

module.exports = { planBgm, mergeCues };
