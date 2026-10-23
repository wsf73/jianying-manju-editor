'use strict';
// 组装爆款漫剧版草稿：字幕轨 + 人物出场介绍轨 + 配乐轨
const fs = require('fs');
const path = require('path');
const U = require('./util');
const Z = require('./zizi');
const J = require('./jianying');
const B = require('./bgm');
const TPL = require('./templates.json');

function resolve(p, base) { return path.isAbsolute(p) ? p : path.resolve(base || process.cwd(), p); }

function textMaterial(text, st) {
  const m = U.clone(TPL.textMaterial);
  m.id = U.uid();
  // 样式里没带字体时回退到模板值：否则 font_path/font_resource_id 会是 undefined，
  // 被 JSON.stringify 丢掉，素材就没有字体了，剪映渲染这条轨会直接失败（整个时间轴空白）。
  const fid = st.fontId || TPL.textMaterial.font_resource_id || '';
  const fpath = st.fontPath || TPL.textMaterial.font_path || '';
  m.font_size = st.size;
  // 字距/行距跟画布比例有关：1920x1080 实测 0.05/0.02，1080x1920 实测 0.1/0.12。
  // 不传就沿用模板值，老项目行为不变。
  if (st.letterSpacing !== undefined) m.letter_spacing = st.letterSpacing;
  if (st.lineSpacing !== undefined) m.line_spacing = st.lineSpacing;
  m.font_id = ''; // 剪映只认 font_resource_id；font_id 必须留空（全机 5.9 万条正常素材无一例外）
  m.font_path = fpath;
  m.font_resource_id = fid;
  m.content = JSON.stringify({
    styles: [{
      fill: { content: { render_type: 'solid', solid: { alpha: 1.0, color: st.color } } },
      font: { id: fid, path: fpath },
      range: [0, text.length],
      size: st.size,
      strokes: [{ alpha: 1.0, content: { render_type: 'solid', solid: { alpha: 1.0, color: st.strokeColor || [0, 0, 0] } }, width: st.strokeWidth || TPL.textMaterial.border_width || 0.08 }],
      useLetterColor: true,
    }],
    text,
  });
  if (st.bg) {
    m.background_style = 1;
    m.background_color = st.bgColor || '#000000';
    m.background_alpha = st.bgAlpha === undefined ? 0.55 : st.bgAlpha;
    m.background_round_radius = 0.35;
    m.background_width = st.bgWidth || 0.56;
    m.background_height = st.bgHeight || 0.16;
    m.background_horizontal_offset = 0;
    m.background_vertical_offset = 0;
  } else {
    m.background_style = 0;
    m.background_alpha = 1;
    m.background_width = 0.14;
    m.background_height = 0.14;
  }
  return m;
}

function textSegment(matId, animId, start, dur, y, renderIndex, trackRenderIndex) {
  const s = U.clone(TPL.textSegment);
  s.id = U.uid();
  s.material_id = matId;
  s.extra_material_refs = [animId];
  s.render_index = renderIndex;
  s.track_render_index = trackRenderIndex;
  if (!s.clip) s.clip = {};
  s.clip.transform = { x: 0, y };
  s.clip.scale = { x: 1, y: 1 };
  s.target_timerange = { start: Math.round(start), duration: Math.round(dur) };
  // 文字素材没有源媒体，这里必须是 null；填了对象剪映解析不出源时长，整条时间轴会显示为空。
  s.source_timerange = null;
  return s;
}

function audioMaterial(file, durationMs) {
  const m = U.clone(TPL.audioMaterial);
  m.id = U.uid();
  m.path = file;
  m.name = file;
  m.duration = Math.round(durationMs * 1000);
  m.music_id = U.uid();
  return m;
}
function audioRefSet() {
  return TPL.audioRefs.map((r) => ({ kind: r.kind, obj: Object.assign(U.clone(r.obj), { id: U.uid() }) }));
}
function audioSegment(matId, srcStart, srcDur, tgtStart, tgtDur, volume, refIds) {
  const s = U.clone(TPL.audioSegment);
  s.id = U.uid();
  s.material_id = matId;
  s.extra_material_refs = refIds;
  s.source_timerange = { start: Math.round(srcStart), duration: Math.round(srcDur) };
  s.target_timerange = { start: Math.round(tgtStart), duration: Math.round(tgtDur) };
  s.volume = volume;
  return s;
}
function audioFade(inUs, outUs) {
  return { fade_in_duration: Math.round(inUs), fade_out_duration: Math.round(outUs), fade_type: 0, id: U.uid(), type: 'audio_fade' };
}

// 重建时清掉没人引用的素材，保证可反复运行而不膨胀
function pruneMaterials(draft) {
  const used = new Set();
  for (const t of draft.tracks) for (const s of t.segments || []) {
    if (s.material_id) used.add(s.material_id);
    for (const r of s.extra_material_refs || []) used.add(r);
  }
  const kinds = ['texts', 'material_animations', 'audios', 'audio_fades', 'speeds', 'beats', 'sound_channel_mappings', 'vocal_separations'];
  let removed = 0;
  for (const k of kinds) {
    const arr = draft.materials[k];
    if (!Array.isArray(arr)) continue;
    const keep = arr.filter((m) => used.has(m.id));
    removed += arr.length - keep.length;
    draft.materials[k] = keep;
  }
  return removed;
}

function build(cfg) {
  const base = cfg._baseDir || process.cwd();
  const root = cfg.draftRoot;
  const srcDir = J.draftDir(root, cfg.sourceDraft);
  const outDir = J.draftDir(root, cfg.outputDraft);
  // 原地模式：直接改原草稿，保留它自己的 draft_id 与注册条目（剪映对新草稿条目有时不认）
  const inPlace = cfg.inPlace === true || String(cfg.outputDraft) === String(cfg.sourceDraft);
  const log = [];

  if (inPlace) {
    const curPath = srcDir + '/draft_content.json';
    const origPath = srcDir + '/draft_content.json.before_manju';
    if (!U.exists(origPath)) {
      fs.copyFileSync(curPath, origPath);
      log.push('已备份原 draft_content.json -> draft_content.json.before_manju');
    } else {
      // 已经构建过：从原始内容重来，否则每跑一次都会把字幕/配乐轨再叠一遍
      fs.copyFileSync(origPath, curPath);
      log.push('已从 draft_content.json.before_manju 还原原始内容（可反复构建）');
    }
    if (cfg.backupRoot) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const bdst = resolve(cfg.backupRoot, base) + '/' + String(cfg.sourceDraft).replace(/[\\/:*?"<>|]/g, '_') + '_' + stamp;
      U.copyTree(srcDir, bdst, cfg.copySkip || []);
      log.push('已整目录备份 -> ' + bdst);
    }
  }

  const draft = J.loadDraft(srcDir);
  const tl = J.timeline(draft);
  log.push('源草稿 ' + cfg.sourceDraft + '：' + tl.segs.length + ' 段 / ' + (tl.total / 1e6).toFixed(1) + 's');

  // 分镜数据：优先用现成 items.json，否则解析字字动画工程
  let items = null, characters = [];
  const itemsFile = cfg.itemsFile ? resolve(cfg.itemsFile, base) : null;
  if (itemsFile && U.exists(itemsFile)) {
    items = U.readJson(itemsFile);
  } else if (cfg.ziziProject) {
    const pr = Z.parseProject(resolve(cfg.ziziProject, base));
    items = pr.items; characters = pr.characters;
  }
  if (!items) throw new Error('需要 cfg.ziziProject 或 cfg.itemsFile 才能取到分镜/台词时间轴');
  log.push('分镜条目 ' + items.length + '，人物 ' + characters.length);
  const IM = Z.itemIndex(items);

  // 音频对齐表：由 scripts/audio-align.js 预先算好（浊音VAD），把每句字幕对到真实人声。
  // 字字动画的"时长X秒"只是生成计划，AI 视频模型实际说话的节奏常对不上，
  // 直接用声明时间铺字幕会"提前显示"。
  let ALIGN = null;
  const alignPath = cfg.audioAlign ? resolve(cfg.audioAlign, base) : null;
  if (alignPath && U.exists(alignPath)) {
    ALIGN = U.readJson(alignPath);
    const ok = Object.keys(ALIGN).filter((k) => ALIGN[k]).length;
    log.push('音频对齐表 ' + alignPath + '（' + ok + ' 个片段）');
  } else {
    log.push('!! 没有音频对齐表，字幕按声明的镜头时间铺（容易提前）');
  }

  let mism = 0;
  for (const s of tl.segs) { const it = IM.get(s.num); if (!it || it.hash !== s.hash) mism++; }
  log.push('片段<->分镜 hash 不匹配：' + mism + '（对照视频文件名前 4 位数字）');
  if (mism > tl.segs.length * 0.05) log.push('!! 警告：不匹配比例过高，itemsFile 可能不是这个草稿对应的工程');

  const st = cfg.style || {};
  const fontPath = (cfg.font && cfg.font.path) || TPL.font.path;
  const fontId = (cfg.font && cfg.font.id) || TPL.font.id;
  const subStyle = Object.assign({ size: 6, y: -0.8, color: [1.0, 0.8705882430076599, 0.0], strokeWidth: 0.07999999821186066, strokeColor: [0, 0, 0], renderIndex: 14000, trackRenderIndex: 1, minDurationMs: 300, fontId, fontPath }, st.subtitle);
  const inStyle = Object.assign({ size: 8, y: 0.55, color: [1, 1, 1], bg: true, bgAlpha: 0.55, durationMs: 3000, staggerMs: 3300, leadMs: 400, renderIndex: 15000, trackRenderIndex: 2, skip: [] }, st.intro);

  const texts = [], anims = [], subSegs = [], introSegs = [];
  const pushText = (label, style, start, dur) => {
    const m = textMaterial(label, style);
    texts.push(m);
    const a = U.clone(TPL.materialAnimation); a.id = U.uid(); anims.push(a);
    return textSegment(m.id, a.id, start, dur, style.y, style.renderIndex, style.trackRenderIndex);
  };

  // ---- 字幕 ----
  let subCount = 0, subChars = 0, subAligned = 0;
  for (const s of tl.segs) {
    const it = IM.get(s.num);
    if (!it) continue;
    const al = ALIGN && ALIGN[s.num] ? ALIGN[s.num].lines : null;
    let li = 0;
    for (const sh of it.shots || []) {
      if (!sh.text) continue;
      // 有对齐结果就用真实人声区间，否则退回声明的镜头时间
      let a = sh.start, b = sh.end;
      const rec = al && al[li] ? al[li] : null;
      if (rec && rec[2]) { a = rec[0]; b = rec[1]; subAligned++; }
      li++;
      const segEnd = s.start + s.dur;
      const emit = (text, aa, bb) => {
        const st0 = s.start + Math.round(aa * 1e6);
        let d = Math.round((bb - aa) * 1e6);
        if (d < subStyle.minDurationMs * 1000) d = subStyle.minDurationMs * 1000;
        if (st0 + d > segEnd) d = Math.max(subStyle.minDurationMs * 1000, segEnd - st0);
        if (d <= 0) return;
        subSegs.push(pushText(text, subStyle, st0, d));
        subCount++;
      };
      // 长句已被 asr-align 按标点切成多张卡，每张用自己的文字和时间
      if (rec && rec[3]) { for (const p of rec[3]) emit(p[2], p[0], p[1]); }
      else emit(sh.text, a, b);
      subChars += sh.text.length;
    }
  }
  log.push('字幕 ' + subCount + ' 条 / ' + subChars + ' 字（其中 ' + subAligned + ' 条按真实人声对齐）');

  // ---- 人物出场介绍 ----
  if (cfg.intro !== false && characters.length) {
    const first = new Map();
    for (const it of items) for (const p of (it.persons || [])) if (!first.has(p)) first.set(p, it.order);
    // skip 里的名字要先按上面同样的规则去掉括号备注再比，
    // 否则像"宴席亲戚（不同长相高矮胖瘦不一样的人物）"这种永远匹配不上
    const skip = (inStyle.skip || []).map((s) => String(s).replace(/（.*?）/g, '').trim());
    const perItem = new Map();
    for (const c of characters) {
      const name = String(c.name).replace(/（.*?）/g, '').trim();
      const at = first.get(name) || first.get(c.name);
      if (!at || skip.indexOf(name) >= 0) continue;
      const seg = tl.segOf(at);
      if (!seg) continue;
      // 字字动画的 characters.json 常常没有 identity，可用 cfg.style.intro.identities 覆盖
      const idOver = (inStyle.identities && (inStyle.identities[c.name] || inStyle.identities[name])) || '';
      let short = String(idOver || c.identity || '').split(/[,，、]/)[0].trim();
      const idMax = inStyle.identityMaxLen || 12;
      if (short.length > idMax) short = short.slice(0, idMax);
      const label = short ? (name + ' · ' + short) : name;
      const k = perItem.get(at) || 0;
      let start = seg.start + inStyle.leadMs * 1000 + k * inStyle.staggerMs * 1000;
      const dur = inStyle.durationMs * 1000;
      const segEnd = seg.start + seg.dur;
      if (start + dur > segEnd) start = Math.max(seg.start + 200000, segEnd - dur);
      introSegs.push(pushText(label, inStyle, Math.round(start), dur));
      perItem.set(at, k + 1);
    }
    log.push('人物出场介绍 ' + introSegs.length + ' 张');
  }

  // ---- 配乐 ----
  const bgmCfg = cfg.bgm || {};
  const library = {};
  for (const [k, v] of Object.entries(bgmCfg.library || {})) {
    library[k] = { file: resolve(v.file, base), durationMs: v.durationMs || Math.round((v.duration || 0) * 1000) };
  }
  let bgmRes = { segments: [], materials: [], refs: [], fades: [], report: [], mergedCueCount: 0 };
  if (bgmCfg.cues && bgmCfg.cues.length) {
    bgmRes = B.planBgm({
      cues: bgmCfg.cues,
      tracks: library,
      segOf: tl.segOf,
      total: tl.total,
      volume: bgmCfg.volume === undefined ? 0.32 : bgmCfg.volume,
      minCueMs: bgmCfg.minCueMs === undefined ? 20000 : bgmCfg.minCueMs,
      fadeInUs: (bgmCfg.fadeInMs === undefined ? 700 : bgmCfg.fadeInMs) * 1000,
      fadeOutUs: (bgmCfg.fadeOutMs === undefined ? 1000 : bgmCfg.fadeOutMs) * 1000,
      innerFadeUs: (bgmCfg.innerFadeMs === undefined ? 150 : bgmCfg.innerFadeMs) * 1000,
      makeMaterial: (file, durMs) => audioMaterial(file, durMs),
      makeRefs: () => { const rs = audioRefSet(); audioSegment._last = rs; return rs.map((r) => r.obj.id); },
      makeSegment: (matId, ss, sd, ts, td, vol, refIds) => {
        const seg = audioSegment(matId, ss, sd, ts, td, vol, refIds);
        seg._refObjs = audioSegment._last;
        return seg;
      },
      makeFade: (fi, fo) => audioFade(fi, fo),
    });
    for (const s of bgmRes.segments) delete s._refObjs;
    log.push('配乐 ' + bgmRes.report.length + ' 个情绪段 / ' + bgmRes.segments.length + ' 个片段 / ' + bgmRes.materials.length + ' 首曲子');
  } else {
    log.push('配乐：未配置 cues，跳过');
  }

  // ---- 组装 ----
  const M = draft.materials;
  M.texts = (M.texts || []).concat(texts);
  M.material_animations = (M.material_animations || []).concat(anims);
  M.audios = (M.audios || []).concat(bgmRes.materials);
  M.audio_fades = (M.audio_fades || []).concat(bgmRes.fades);
  for (const r of bgmRes.refs) M[r.kind] = (M[r.kind] || []).concat([r.obj]);

  const tracks = [draft.tracks.find((t) => t.type === 'video')];
  // 文字轨一律不带名字（正常草稿 100% 为 ""）；带名字的只有音频轨
  tracks.push({ attribute: 0, flag: 0, id: U.uid(), is_default_name: true, name: '', segments: subSegs, type: 'text' });
  if (introSegs.length) tracks.push({ attribute: 0, flag: 0, id: U.uid(), is_default_name: true, name: '', segments: introSegs, type: 'text' });
  if (bgmRes.segments.length) tracks.push({ attribute: 0, flag: 0, id: U.uid(), is_default_name: false, name: cfg.trackNames ? cfg.trackNames.bgm : '配乐', segments: bgmRes.segments, type: 'audio' });
  draft.tracks = tracks;
  // 剪映要求同一轨道上的片段按时间升序且互不重叠；否则轨道构建会失败，打开草稿一片空白。
  // 原视频轨原样保留，只规整我们新建的轨。
  for (const t of tracks) {
    if (t.type === 'video') continue;
    t.segments.sort((a, b) => a.target_timerange.start - b.target_timerange.start);
    for (let i = 1; i < t.segments.length; i++) {
      const prev = t.segments[i - 1].target_timerange;
      const cur = t.segments[i].target_timerange;
      const prevEnd = prev.start + prev.duration;
      if (cur.start < prevEnd) cur.start = prevEnd;
    }
  }
  const pruned = pruneMaterials(draft);
  if (pruned) log.push('清理未引用素材 ' + pruned + ' 个（支持重复运行）');
  draft.duration = tl.total;
  draft.update_time = Math.floor(Date.now() / 1000);

  // ---- 写盘 ----
  let out, newId;
  if (inPlace) {
    out = srcDir;
    U.writeJson(out + '/draft_content.json', draft);
    U.writeJson(out + '/draft_content.json.bak', draft);
    // 剪映会拿 template-2.tmp 当草稿快照，不同步的话草稿列表里可能显示旧内容 / 打不开
    U.writeJson(out + '/template-2.tmp', draft);
    newId = U.readJson(out + '/draft_meta_info.json').draft_id;
    log.push('原地改写完成，草稿 id 与注册条目保持原样：' + newId);
  } else {
    out = J.prepareOutput(root, cfg.sourceDraft, cfg.outputDraft, cfg.copySkip || []);
    U.writeJson(out + '/draft_content.json', draft);
    U.writeJson(out + '/draft_content.json.bak', draft);
    U.writeJson(out + '/template-2.tmp', draft);   // 同上，保持快照一致
    newId = J.updateMeta(out, cfg.outputDraft, root, tl.total);
  }

  const result = { log, outDir: out, draftId: newId, durationUs: tl.total, cueReport: bgmRes.report, subtitles: subCount, audioAligned: subAligned, intros: introSegs.length, inPlace };
  if (!inPlace && cfg.register !== false) {
    result.registration = J.registerDraft(cfg.registryPath, root, cfg.outputDraft, out, newId, tl.total, cfg.materialsSize);
    log.push('已注册到剪映草稿列表');
  }
  return result;
}

module.exports = { build, pruneMaterials, textMaterial, textSegment, resolve };
