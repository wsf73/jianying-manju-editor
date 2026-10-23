#!/usr/bin/env node
// 把剧本台词逐字对齐到语音识别的逐字时间戳，输出 build.js 用的对齐表。
//
//   node asr-align.js --plan plan.json --asr asr.json --fallback vad.json --out align.json
//        [--report r.txt] [--threshold 0.5] [--maxChars 30]
//
// 思路：语音识别给的是"真实人声在哪里"（逐字时间戳），剧本给的是"正确文字"。
// 用 Needleman-Wunsch 把两边逐字对齐，每句台词取它首尾字真实发音的起止时间。
// 识别不确认的句子（逐字相同率低于阈值）退回浊音 VAD 结果，再退回声明时间。
//
// 超过 maxChars 的长句（旁白经常一句五六十字）会按标点切成 2~3 张卡，
// 每一张用自己的逐字时间——否则一张卡糊满整屏 12 秒，没法看。
const fs = require('fs');

function parseArgs(argv) {
  const o = { threshold: 0.5, lead: 0.1, tail: 0.3, minDur: 0.3, gap: 0.05, maxChars: 30 };
  for (let i = 0; i < argv.length; i += 2) {
    const k = String(argv[i]).replace(/^--/, '');
    const v = argv[i + 1];
    if (['threshold', 'lead', 'tail', 'minDur', 'gap', 'maxChars'].indexOf(k) >= 0) o[k] = parseFloat(v);
    else o[k] = v;
  }
  return o;
}
const A = parseArgs(process.argv.slice(2));
if (!A.plan || !A.asr || !A.out) {
  console.error('用法: node asr-align.js --plan <plan.json> --asr <asr.json> [--fallback <vad.json>] --out <out.json> [--maxChars 30]');
  process.exit(2);
}
const plan = JSON.parse(fs.readFileSync(A.plan, 'utf8'));
const asr = JSON.parse(fs.readFileSync(A.asr, 'utf8'));
const vad = A.fallback && fs.existsSync(A.fallback) ? JSON.parse(fs.readFileSync(A.fallback, 'utf8')) : {};

const isKeep = (c) => /[\u4e00-\u9fff\u3400-\u4dbfA-Za-z0-9]/.test(c);
const PUNCT = '。！？；…，、：—「」『』（）';

function align(a, b) {
  const n = a.length, m = b.length;
  const dp = new Int32Array((n + 1) * (m + 1));
  const bt = new Uint8Array((n + 1) * (m + 1));
  const idx = (i, j) => i * (m + 1) + j;
  for (let i = 1; i <= n; i++) { dp[idx(i, 0)] = -i; bt[idx(i, 0)] = 1; }
  for (let j = 1; j <= m; j++) { dp[idx(0, j)] = -j; bt[idx(0, j)] = 2; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = dp[idx(i - 1, j - 1)] + (a[i - 1] === b[j - 1] ? 2 : -1);
      const up = dp[idx(i - 1, j)] - 1;
      const lf = dp[idx(i, j - 1)] - 1;
      let best = sub, d = 0;
      if (up > best) { best = up; d = 1; }
      if (lf > best) { best = lf; d = 2; }
      dp[idx(i, j)] = best; bt[idx(i, j)] = d;
    }
  }
  const map = new Int32Array(n).fill(-1);
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const d = (i === 0) ? 2 : (j === 0) ? 1 : bt[idx(i, j)];
    if (d === 0) { map[i - 1] = j - 1; i--; j--; }
    else if (d === 1) i--; else j--;
  }
  return map;
}

// 把一段文字按 maxChars 切成若干块，尽量落在标点后
function chunkText(text, maxChars) {
  const out = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (buf.length >= maxChars) {
      let cut = -1;
      const lo = Math.max(0, Math.floor(buf.length * 0.6));
      for (let k = buf.length - 1; k >= lo; k--) if (PUNCT.indexOf(buf[k]) >= 0) { cut = k; break; }
      if (cut >= 0 && cut < buf.length - 1) {
        out.push(buf.slice(0, cut + 1));
        buf = buf.slice(cut + 1);
      } else {
        out.push(buf);
        buf = '';
      }
    } else if (PUNCT.indexOf(ch) >= 0 && buf.length >= Math.floor(maxChars * 0.65)) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf) out.push(buf);
  return out.length ? out : [text];
}

const out = {};
let nAsr = 0, nVad = 0, nDecl = 0, nLine = 0, nSplit = 0, nCards = 0;
const clipRows = [];

for (const it of plan) {
  const num = it.num, lines = it.lines || [];
  const dur = it.dur || 0;
  const R = asr[String(num)];
  const vadLines = (vad[String(num)] || {}).lines || [];
  nLine += lines.length;

  const ac = [], as = [], ae = [];
  if (R && R.utts) {
    for (const u of R.utts) {
      const cs = String(u.text || '').split(/\s+/).filter(Boolean), ts = u.ts || [];
      const km = String(u.key || '').match(/-(\d+)-(\d+)$/);
      let off = 0;
      if (km && ts.length && ts[0][0] + 50 < +km[1]) off = +km[1];
      for (let k = 0; k < cs.length; k++) {
        if (!ts[k]) continue;
        ac.push(cs[k]); as.push((ts[k][0] + off) / 1000); ae.push((ts[k][1] + off) / 1000);
      }
    }
  }

  const lineChars = lines.map((ln) => {
    const arr = [];
    const t = String(ln.t || '');
    for (let k = 0; k < t.length; k++) if (isKeep(t[k])) arr.push(k);
    return arr;
  });

  const sc = [], sl = [];
  lines.forEach((ln, li) => {
    const t = String(ln.t || '');
    for (const k of lineChars[li]) { sc.push(t[k]); sl.push(li); }
  });

  const per = lines.map(() => ({ same: 0, tot: 0, lo: -1, hi: -1 }));
  const charT = lines.map(() => []);
  if (ac.length && sc.length) {
    const map = align(sc, ac);
    for (let k = 0; k < sc.length; k++) {
      const li = sl[k];
      per[li].tot++;
      const ai = map[k];
      if (ai < 0) { charT[li].push(null); continue; }
      if (sc[k] === ac[ai]) per[li].same++;
      if (per[li].lo < 0) per[li].lo = ai;
      per[li].hi = ai;
      charT[li].push([as[ai], ae[ai]]);
    }
  }
  const clipTot = per.reduce((s, p) => s + p.tot, 0);
  const clipSame = per.reduce((s, p) => s + p.same, 0);

  const times = lines.map((ln, li) => {
    const p = per[li];
    const frac = p.tot ? p.same / p.tot : 0;
    let rec;
    if (p.lo >= 0 && p.hi >= p.lo && frac >= A.threshold) {
      nAsr++;
      rec = [as[p.lo] - A.lead, ae[p.hi] + A.tail, 1];
    } else {
      const v = vadLines[li];
      if (v && v[2]) { nVad++; rec = [v[0], v[1], 1]; }
      else { nDecl++; rec = [ln.s, ln.e, 0]; }
    }

    const text = String(ln.t || '');
    if (text.length > A.maxChars) {
      const chunks = chunkText(text, A.maxChars);
      if (chunks.length > 1) {
        const ct = charT[li];
        const pos = [], ts2 = [];
        for (let k = 0; k < text.length; k++) {
          if (!isKeep(text[k])) continue;
          pos.push(k);
          ts2.push(ct.length > pos.length - 1 ? ct[pos.length - 1] : null);
        }
        const known = [];
        for (let k = 0; k < ts2.length; k++) if (ts2[k]) known.push(k);
        if (known.length) {
          const parts = [];
          let off2 = 0;
          let okAll = true;
          for (const c of chunks) {
            const cStart = off2, cEnd = off2 + c.length;
            off2 = cEnd;
            let i0 = -1, i1 = -1, t0 = 0, t1 = 0;
            for (let k = 0; k < pos.length; k++) {
              if (pos[k] >= cStart && pos[k] < cEnd) {
                if (i0 < 0) i0 = k;
                i1 = k;
                if (ts2[k]) { if (!t0) t0 = ts2[k][0]; t1 = ts2[k][1]; }
              }
            }
            if (i0 < 0) { okAll = false; break; }
            if (!t0) t0 = ts2[known[0]][0];
            if (!t1) t1 = ts2[known[known.length - 1]][1];
            parts.push([Math.max(0, t0 - A.lead), Math.min(dur || 1e6, t1 + A.tail), c]);
          }
          if (okAll && parts.length > 1 && parts.every((x) => x[1] > x[0])) {
            nSplit++;
            rec = [parts[0][0], parts[parts.length - 1][1], rec[2]];
            rec.push(parts);
          }
        }
      }
    }
    return rec;
  });

  let prevEnd = 0;
  for (let i = 0; i < times.length; i++) {
    const rec = times[i];
    let a = rec[0], b = rec[1];
    const f = rec[2], parts = rec[3];
    if (a < prevEnd) a = prevEnd;
    if (a < 0) a = 0;
    if (b > dur) b = dur;
    // 有些句子识别出的首尾字恰好挨得很近，字卡闪一下就没。
    // 按字数补一个可读下限，但绝不越过下一句的起点，保证不重叠。
    const nCh = parts ? parts.reduce((s2, p) => s2 + String(p[2]).length, 0) : String((lines[i] && lines[i].t) || '').length;
    const want = Math.max(A.minDur, nCh * 0.055);
    if (b - a < want) {
      const nextA = (i + 1 < times.length) ? times[i + 1][0] : dur;
      const cap = Math.max(a + A.minDur, Math.min(dur, nextA - A.gap));
      b = Math.min(Math.max(b, a + want), cap);
    }
    if (b - a < A.minDur) b = Math.min(dur, a + A.minDur);
    const o = [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000, f];
    if (parts) {
      tasks: {
        const pp = [];
        let pe = a;
        for (const p of parts) {
          let x = p[0], y = p[1];
          if (x < pe) x = pe;
          if (y > b) y = b;
          if (y - x < A.minDur) y = Math.min(b, x + A.minDur);
          if (y <= x) break tasks;
          pp.push([Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, p[2]]);
          pe = y + A.gap;
        }
        if (pp.length > 1) { o.push(pp); nCards += pp.length; }
        else nCards += 1;
      }
      if (o.length < 4) nCards += 1;
    } else nCards += 1;
    times[i] = o;
    prevEnd = b + A.gap;
  }
  // 兜底：按字数保证每张卡都有最短可读时长。只往后延、并且绝不越过下一张卡的起点，
  // 所以不会造成重叠，也不会打乱顺序。
  const cards = [];
  for (let i = 0; i < times.length; i++) {
    const rec = times[i];
    if (rec[3]) { for (const p of rec[3]) cards.push({ src: p, n: String(p[2]).length }); }
    else cards.push({ src: rec, n: String((lines[i] && lines[i].t) || '').length });
  }
  for (let k = 0; k < cards.length; k++) {
    const c = cards[k];
    const want = Math.max(A.minDur, c.n * 0.055);
    if (c.src[1] - c.src[0] >= want) continue;
    const nextT = k + 1 < cards.length ? cards[k + 1].src[0] : dur;
    const cap = Math.max(c.src[0] + A.minDur, Math.min(dur, nextT - A.gap));
    c.src[1] = Math.round(Math.min(Math.max(c.src[1], c.src[0] + want), cap) * 1000) / 1000;
  }
  for (let i = 0; i < times.length; i++) {
    const rec = times[i];
    if (rec[3]) { rec[0] = rec[3][0][0]; rec[1] = rec[3][rec[3].length - 1][1]; }
  }
  out[String(num)] = { dur, lines: times };
  clipRows.push({ num, frac: clipTot ? clipSame / clipTot : 0, tot: clipTot, asrChars: ac.length });
}

fs.writeFileSync(A.out, JSON.stringify(out), 'utf8');

clipRows.sort((x, y) => x.frac - y.frac);
const RP = [];
RP.push('台词句数 ' + nLine);
RP.push('  用语音识别真实人声定时间 ' + nAsr + ' (' + (nAsr / nLine * 100).toFixed(1) + '%)');
RP.push('  识别不确认, 退回浊音VAD        ' + nVad + ' (' + (nVad / nLine * 100).toFixed(1) + '%)');
RP.push('  都不可靠, 退回声明时间          ' + nDecl + ' (' + (nDecl / nLine * 100).toFixed(1) + '%)');
RP.push('  长句切成多张卡                  ' + nSplit + ' 句 / 共 ' + nCards + ' 张字幕卡');
RP.push('');
const sus = clipRows.filter((c) => c.tot >= 12 && c.frac < 0.45);
RP.push('=== 音频与剧本对不上的片段（逐字相同率 < 45%）===');
for (const c of sus) RP.push('  分镜 ' + c.num + '  ' + (c.frac * 100).toFixed(0) + '%  剧本' + c.tot + '字 / 识别' + c.asrChars + '字');
RP.push('合计 ' + sus.length + ' 个');
if (A.report) fs.writeFileSync(A.report, RP.join('\n') + '\n', 'utf8');
console.log(RP.join('\n'));
