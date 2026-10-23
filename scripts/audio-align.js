'use strict';
// 批量：解出每个片段的 16k 单声道 PCM -> 浊音VAD -> 把台词行对齐到真实人声
// 用法: node audio-align.js <plan.json> <out.json> <pcmDir> [ffmpeg]
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const A = require('./lib/audioalign');

const argv = process.argv.slice(2);
const planFile = argv[0], outFile = argv[1], pcmDir = argv[2];
const FFMPEG = argv[3] || 'ffmpeg';
if (!planFile || !outFile || !pcmDir) { console.error('用法: node audio-align.js <plan.json> <out.json> <pcmDir> [ffmpeg]'); process.exit(2); }

const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
fs.mkdirSync(pcmDir, { recursive: true });
const out = {};
let done = 0, failed = 0, lineTotal = 0, lineAligned = 0;
const t0 = Date.now();
for (const c of plan) {
  const raw = path.join(pcmDir, c.num + '.raw');
  try {
    if (!fs.existsSync(raw)) {
      cp.execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', c.path, '-ac', '1', '-ar', '16000', '-f', 's16le', raw], { stdio: 'ignore' });
    }
    const segs = A.vadFloat(A.readPcmRaw(raw));
    const res = c.lines && c.lines.length
      ? A.assignLines(segs, c.lines.map((l) => ({ s: l.s, e: l.e })))
      : [];
    out[c.num] = {
      segs: segs.map((s) => [+s.s.toFixed(3), +s.e.toFixed(3)]),
      lines: res.map((r) => [+r.s.toFixed(3), +r.e.toFixed(3), r.aligned ? 1 : 0]),
    };
    lineTotal += res.length;
    lineAligned += res.filter((r) => r.aligned).length;
    done++;
  } catch (e) {
    failed++;
    out[c.num] = null;
  }
  try { fs.unlinkSync(raw); } catch (e) {}
  if (done % 25 === 0 && done) {
    const sec = (Date.now() - t0) / 1000;
    process.stderr.write('  已处理 ' + done + '/' + plan.length + '  用时 ' + sec.toFixed(0) + 's\n');
    fs.writeFileSync(outFile, JSON.stringify(out));   // 中途落盘，断了也能续
  }
}
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(JSON.stringify({ clips: plan.length, done, failed, lines: lineTotal, alignedLines: lineAligned, seconds: Math.round((Date.now() - t0) / 1000) }, null, 1));
