#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""对每个分镜的视频逐条做中文语音识别，输出逐字时间戳。

用法:
  <嵌入式python> asr-run.py --plan plan.json --out asr.json [--tmp 目录] [--limit N]

为什么用嵌入式 python: 本机 torch/funasr 的原生扩展是 cp310，
只有 AsrTools 自带的 python310 能加载（见 SKILL.md「语音识别对齐」一节）。
该运行时被裁剪过，缺 _overlapped.pyd，本脚本会自动生成一个桩顶上去。
"""
import os, sys, json, time, subprocess, argparse, tempfile

def _bootstrap():
    here = os.path.dirname(os.path.abspath(__file__))
    site = os.environ.get('MANJU_SITE_PACKAGES', r'D:\baishi\site-packages')
    # 嵌入式运行时缺 _overlapped，asyncio 导入会炸；放个桩在 sys.path 最前面
    stub = os.path.join(tempfile.gettempdir(), 'manju_asr_stub')
    os.makedirs(stub, exist_ok=True)
    p = os.path.join(stub, '_overlapped.py')
    if not os.path.exists(p):
        with open(p, 'w', encoding='utf-8') as f:
            f.write('class Overlapped:\n'
                    '    def __init__(self, *a, **k):\n'
                    "        raise RuntimeError('_overlapped stub')\n"
                    '\nclass OverlappedError(OSError):\n    pass\n')
    sys.path.insert(0, stub)
    sys.path.insert(1, site)
    os.environ.setdefault('MODELSCOPE_CACHE', r'D:\baishi\models\modelscope_cache')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plan', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--tmp', default=None)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--device', default='cuda:0')
    a = ap.parse_args()
    _bootstrap()
    base = os.environ.get('MANJU_ASR_MODELS',
                          r'D:\baishi\models\modelscope_cache\hub\iic')
    M   = os.path.join(base, 'speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch')
    VAD = os.path.join(base, 'speech_fsmn_vad_zh-cn-16k-common-pytorch')
    for d in (M, VAD):
        if not os.path.isdir(d):
            raise SystemExit('找不到模型目录: ' + d)
    from funasr import AutoModel
    t0 = time.time()
    model = AutoModel(model=M, vad_model=VAD, device=a.device,
                      disable_update=True, disable_pbar=True)
    print('模型加载 %.1fs' % (time.time() - t0), flush=True)

    plan = json.load(open(a.plan, encoding='utf-8'))
    if a.limit:
        plan = plan[:a.limit]
    tmp = a.tmp or os.path.join(tempfile.gettempdir(), 'manju_asr_wav')
    os.makedirs(tmp, exist_ok=True)
    done = {}
    if os.path.exists(a.out):
        try: done = json.load(open(a.out, encoding='utf-8'))
        except Exception: done = {}
    print('待识别 %d / 已有 %d' % (len(plan), len(done)), flush=True)

    t0 = time.time(); n = 0
    for it in plan:
        key = str(it['num'])
        if key in done:
            continue
        wav = os.path.join(tmp, 'c%04d.wav' % it['num'])
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', it['path'],
                        '-ac', '1', '-ar', '16000', wav], check=True)
        try:
            res = model.generate(input=wav, batch_size_s=60, return_raw_text=True)
            done[key] = {'dur': it['dur'],
                         'utts': [{'key': r.get('key', ''), 'text': r.get('text', ''),
                                   'ts': r.get('timestamp') or []} for r in res]}
        except Exception as e:
            done[key] = {'dur': it['dur'], 'utts': [], 'error': str(e)[:200]}
        os.remove(wav)
        n += 1
        if n % 20 == 0:
            json.dump(done, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False)
            el = time.time() - t0
            print('  %d/%d  %.0fs  eta %.0fs' % (len(done), len(plan), el,
                  el / n * (len(plan) - len(done))), flush=True)
    json.dump(done, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False)
    print('DONE %d clips %.0fs' % (len(done), time.time() - t0), flush=True)
    print('empty: %d' % sum(1 for v in done.values() if not v.get('utts')))

if __name__ == '__main__':
    main()
