---
name: jianying-manju-editor
version: 1.0.0
description: "把剪映(JianyingPro)草稿改造成爆款漫剧成片：从字字动画工程提取分镜时间轴，自动铺字幕轨、人物出场介绍卡、以及按剧情小段切情绪的配乐轨，非破坏性生成新草稿并注册进剪映草稿列表。触发方式：/jianying-manju-editor、「漫剧剪辑」「剪映加字幕」「按漫剧格式剪」「加配乐」「配乐切情绪」「人物出场介绍」「爆款漫剧格式」「把草稿做成漫剧版」。"
metadata: {"openclaw":{"source":"local","topic":"jianying-manju-automation"}}
---
# jianying-manju-editor：剪映草稿 → 爆款漫剧成片

把「剪映里刚导入完的一堆 AI 视频片段」变成能直接发布的漫剧成片。核心是三件事：
**字幕、配乐、人物出场介绍**。全部由脚本落盘到剪映草稿 JSON，不靠手点。

## 这个 skill 依赖什么

| 输入 | 说明 |
|---|---|
| 剪映草稿 | 已经有 video 轨、按顺序排好片段的草稿（通常是从字字动画 fast-import 进来的） |
| 字字动画工程目录 | 含 data.ini（分镜/台词）与 characters.json（人设）。字幕时间轴从这里来 |
| 曲库目录 | 一批纯音乐/伴奏，按情绪分类使用 |

脚本自带一份从真实草稿导出的剪映模板（scripts/lib/templates.json），**不依赖任何本机草稿**。

## 强制询问（先问再动手）

任何一次改造前，若本会话还没得到明确回答，必须先问，**不得先跑脚本**：

> 这次改造要哪些轨道？
> 1. 全套（字幕 + 人物出场介绍 + 配乐）
> 2. 只要字幕
> 3. 字幕 + 配乐（不出人物卡）
> 4. 其它组合
>
> 配乐怎么铺？
> 1. 按剧情小段切情绪（默认，平均 1~2 分钟换一次）
> 2. 一首曲子铺到底
> 3. 我自己指定

同一草稿已经问过且用户未改口 → 沿用。

## 环境检查（每次先跑）

1. **剪映是否在运行**：`Get-Process JianyingPro`。运行中也能生成新草稿，但
   **剪映退出时会覆盖草稿列表缓存 root_meta_info.json**，所以生成完要提醒用户：
   完全退出剪映（含托盘）再重开，若列表里没有，重新跑 `manju register`。
2. **默认不改原草稿**：一律复制源草稿再改。只有在**剪映打不开新建草稿**、用户明确要求时，
   才用 `--in-place` 原地改；用之前必须确认已经做了整目录备份。
3. 草稿根目录从 `root_meta_info.json` 里读，不要硬编码。
   注册表在 `%LOCALAPPDATA%/JianyingPro/User Data/Projects/com.lveditor.draft/root_meta_info.json`。

## 五步流程

```bash
# 1. 看一眼草稿和字字动画能不能对上（哈希匹配率必须接近 100%）
node scripts/manju.js scan --draft "<草稿名>" --zizi "<字字动画工程目录>"

# 2. 生成配置骨架（自动从 data.ini 抓集标题当 cue 起点）
node scripts/manju.js init --draft "<草稿名>" -o config.json

# 3. 填 config.json：曲库 library、每个 cue 的情绪 mood、字幕/人物卡样式
#    （mood 只能取 library 里已有的键；相邻同情绪的 cue 会自动连成一段）

# 4. 生成（默认同时注册进剪映草稿列表）
node scripts/manju.js build --config config.json --report 配乐铺排.md

# 5. 剪映没刷新出来时补注册
node scripts/manju.js register --config config.json

# 备用：剪映打不开新建的草稿时，直接原地改原草稿（自动备份）
node scripts/manju.js build --config config.json --in-place --report 配乐铺排.md
```

只想抽数据不生成草稿：

```bash
node scripts/manju.js extract --zizi "<字字动画工程目录>" -o items.json
```

## 关键规范（详细见 references/）

- **字幕**：只放台词，不带说话人名。默认新青年体 / 字号 6 / 金黄 RGB(255,222,0) / 黑描边 0.08 / y=-0.8。
  这套值是 1920x1080 漫剧的通用档（竖屏 1080x1920 请把字号换成 10）。
- **人物出场介绍**：`姓名 · 身份`，白字 + 半透明圆角底衬，放在与字幕相反的一端（默认 y=+0.55），
  同一条视频内多人首次出场自动错开。群体角色（围观街坊这类）默认跳过，写进 `style.intro.skip`。
- **配乐**：按 cue 表逐段换曲，段间 0.7s 淡入 / 1.0s 淡出，音量默认 0.32（台词在视频自带音轨里）。
  引擎会做两件自动优化：相邻同情绪合并、短于 20s 的碎段并回上一段。
- **时间轴来源**：字幕时间 = 该片段在时间线上的起点 + 镜头在分镜里的起止秒。
  片段与分镜靠视频文件名前 4 位数字对应，并用文件名里的 hash 校验。
  **但声明的秒数只是"生成计划"**——AI 视频模型实际说话的节奏常对不上，
  所以默认会用**音频对齐表**把每句字幕吸附到真实人声（见下节）；没有对齐表时才退回声明时间。

## 字幕要和配音对齐（默认开启）

字字动画写的是 `[画面] 时长4秒（17字台词）`，这是**生成计划**；真正决定字幕该何时出现的是
**视频里那条音轨**。实测：565 个片段实际渲染出来全是 12.26s，而声明总时长在 10~12s 之间，
个别句子实际比声明晚 1 秒以上——字幕按声明时间铺就会**提前显示**。

做法：对每个片段的音轨做**浊音检测（VAD）**，把台词行对到真实人声区间。

```bash
# 1. 先由草稿生成 plan.json（num / path / dur / 每句声明时间），再批量算对齐表（565 条约 30 秒）
node scripts/audio-align.js plan.json 输出_音频对齐.json <临时pcm目录> [ffmpeg]

# 2. 配置里指向它，build 会自动使用
#    "audioAlign": "<...>/输出_音频对齐.json"

### 更准的做法：语音识别（逐字时间戳）

浊音 VAD 只知道"这段有声音"，不知道"是哪一句在说"。一句台词只占人声区间一部分时，
VAD 会把整句塞进去，出现明显偏差。**语音识别给的是逐字时间戳**，精度高一个档次。

做法：对每个片段做中文语音识别（离线 FunASR paraformer），把剧本台词**逐字**对齐到识别出的字上
（Needleman-Wunsch），每句取首尾字真实发音的起止时间；识别不确认的句子退回浊音 VAD 结果。

```bash
# 1. 逐片段识别 -> 逐字时间戳（391 片段 / 1151 句，GPU 约 3 分钟）
<AsrTools 嵌入式 python> scripts/asr-run.py --plan plan.json --out 输出_ASR原始.json

# 2. 台词逐字对齐到识别结果；不确认的回退 --fallback 给的浊音VAD表
node scripts/asr-align.js --plan plan.json --asr 输出_ASR原始.json \
     --fallback 输出_音频对齐.json --out 输出_音频对齐_ASR.json --report 对齐报告.txt

# 3. 配置里指向 ASR 版本
#    "audioAlign": "<...>/输出_音频对齐_ASR.json"
```

**运行环境（本机实测可用）**：本机 torch/funasr 的原生扩展是 cp310，只有
`C:\Users\Administrator\Desktop\AsrTools-v1.0.1\runtime\python.exe` 能加载；
`D:\baishi\site-packages` 提供 torch 2.5.1+cu118 / funasr 1.1.18，
模型在 `D:\baishi\models\modelscope_cache\hub\iic`（seaco-paraformer-large + fsmn-vad）。
该运行时被裁剪过、缺 `_overlapped.pyd`，`asr-run.py` 会自动写个桩顶上去。

实测（391 片段 / 1151 句）：**1130 句（98.2%）锚定真实人声**（VAD 只有 1084 / 94.2%），
其中 378 句与 VAD 起点差 >0.4 秒。典型：分镜12「大勇，你小时候那场病，是姑借的钱。」
声明 0.00~3.50s，**实际人声 4.10~7.12s**；分镜336 第4句声明 9.00s、实际 7.01s。

**顺带能查出"音频和剧本对不上"的片段**：逐字相同率低 = 配音说的不是剧本的台词。
实测 1 个片段内容完全不同、13 个只念了一部分。这类片段任何时间对齐都救不了，
只能回字字动画重新生成——对齐报告会列出来，必须告知用户。
```

**为什么不能用 `silencedetect`**：音效和人声在语音频段里一样有能量（鞭炮、踹凳子都是宽频），
静音检测会把音效当成台词。而**浊音有强周期性**，用自相关（延迟 2.5~15ms，归一化峰 >0.32）
就能把人声挑出来。实测覆盖率 0.84→0.88 且精确率不降、40 条样本 38 条变好，
1266 句里 **1247 句（98.5%）找到了对应人声**。

归属规则（三级优先，缺一不可）：

- ① 人声段起点落在某句的**声明窗口内** —— 最可靠，边界上的音不会跑到下一句去；
- ② 否则取离"扩展窗口"最近的（前 0.15s / 后 0.30s，且距离不超过 0.45s）——
  短插话（"你——"）的起点常落在声明窗口**末尾之外**，只用①会漏掉它；
- ③ 再否则按最大重叠，重叠 ≤0.05s 就**丢掉** —— 这类是围观群众杂音/环境人声，不是台词。

每句再向外留 0.10s 进 / 0.30s 出，并限制单句位移不超过 ±1.5s，防止某段被误吸附拉飞。

## 常见坑（都踩过了）

1. `fs.cpSync` 在剪映草稿目录上会让 Node 直接崩（0xC0000409）→ 用自带 `copyTree` 递归拷贝。
2. 剪映草稿里的 `materials` 数组和 `tracks[].segments` 靠 UUID 交叉引用；
   加轨必须 **append 素材**，不能替换数组，否则视频轨会断链。
3. 重建时会产生没人引用的孤儿素材 → `pruneMaterials` 按「被任何 segment 引用」清理，
   保证脚本可反复运行不膨胀。
4. 字字动画的 data.ini 值是 URL-safe base64 的 pickle：
   先 `-`→`+`、`_`→`/` 再补 `=` 补齐；解码后按 UTF-8 replace 读。
5. 只取**第一段连续的**「镜头 N / SCn（起-止 秒）」块，否则会匹配到模型思考过程里的重复文本（镜头数会翻倍）。
5b. 字字动画有**两代** data.ini 格式（A：镜头/SC 给绝对秒；B：`[画面] 时长N秒` 靠累加）。
   脚本自动识别，细节和 6 个坑见 references/zizi-data-formats.md。格式 B 的正文锚点要
   取「本组总时长」和 `_::~OUTPUT_START::~_` 里**靠前的**那个，否则会切错字段。
6. data.ini 条目与草稿片段数可能不等（草稿可能缺号），**必须按文件名前 4 位数字映射**，
   不能按数组下标。
7. 集标题正则偶尔匹配到引用文本，解析后要按引号/箭头截断。
8. PowerShell 控制台会给中文参数加编码；本机实测直传中文参数没问题，
   但**稳妥做法是把中文写进 config.json（UTF-8）**，命令行只传 ASCII 路径。
9. **剪映打不开新建的草稿**：实测新草稿的 `draft_content.json` 与一个「能打开」的草稿逐字段对比
   **完全一致**（顶层键、轨道键、片段键、素材键、refs 数量都相同），说明问题不在内容，
   而在剪映对**新注册草稿条目**的接受度。这时别去文件结构里找原因浪费半天，
   直接用 `build --in-place`：原草稿的文件夹 / draft_id / 注册条目剪映本来就认，
   只替换 `draft_content.json` 就一定打得开。
   **代价是要先备份**——原地模式会自动写 `draft_content.json.before_manju`，
   配置里再给个 `backupRoot` 就会整目录备份。
10. **字幕轨加完剪映显示空白（视频都没了）→ 一定是文字片段的 `source_timerange` 不是 `null`。**
   文字素材没有源媒体，`source_timerange` 必须为 **`null`**；填成 `{start:0,duration:N}`
   剪映解析不出源时长，会把**整条时间轴判为无效**，打开后一片空白（视频轨也一起不显示）。
   **这是最难查的一类坑**：键集合、JSON 合法性、素材引用、文件大小全部正常，
   只有跟一个「能正常打开的同类草稿」逐字段比**值**才会暴露——
   所以**排这种坑必须拿一个已知能打开的草稿做逐字段 value diff，光比字段名没用**。
   音频/视频片段的 `source_timerange` 则是必须有值，别一起改错。
   另：比 value diff 时不要只打印前 100 字符，`source_timerange` 正是被截断挡住的。
11. **草稿在列表里、点开却是空白 → 先查 `draft_meta_info.json` 的 `draft_name` 是否等于文件夹名。**
   字字动画这类外部导入工具的流程是：剪映先建一个**空草稿**（名字是默认的日期，如 `"9月28日"`），
   导入工具随后**直接覆盖 `draft_content.json`**，并改**文件夹名 + `root_meta_info.json` 里的名字**，
   **但不会改 `draft_meta_info.json` 里的 `draft_name`**。
   于是草稿内部名字对不上，剪映就"列表里有、打开空的"。
   本机 84 个可读草稿里，只有出问题的那一个名字不一致——**这是最干净的判据，先查它**。
   一并补齐：外部导入的草稿还会缺 `draft.extra`(26 B，二进制，各草稿内容固定)、
   `key_value.json`(空 `{}` 即可)、`voices/` 空目录，
   注册表里 `draft_new_version` 会是 `""`（正常草稿都是 `"109.0.0"`）、
   `draft_root_path` 可能用反斜杠（正常是正斜杠）。
   **排查顺序：① meta.draft_name 是否等于文件夹名（最常见）→ ② 注册表 `draft_new_version`/`draft_root_path`
   → ③ 补 `draft.extra`/`key_value.json`/`voices/` → ④ 才去查 `draft_content.json` 内容。**
   注：`draft_meta_info.json` 的 `draft_materials` 条数和 `draft_segment_extra_info`（常为 0）
   与时间轴无关，别往那查。
12. **同一轨道内的片段必须按 `target_timerange.start` 升序排列，否则剪映构建轨道失败、打开一片空白
   （表现是"完全没有轨道"，不是"这条轨不见了"）。**
   最容易踩的是**人物出场介绍轨**：卡片是**按角色表顺序**生成的（遍历 `characters`，
   每个角色放到它首次出场的镜头位置），角色表顺序 ≠ 出场时间顺序，于是数组是乱的。
   注意**乱序必然伴随重叠**，但修法只要排序——排序后重叠自然消失，
   不需要额外"错开"逻辑（错开逻辑本身是对的）。
   `build.js` 已在组装 `tracks` 后统一加了一道
   "非视频轨排序 + 防重叠后移"，原视频轨原样保留。
   **自查方法**：对每条轨跑一遍
   `for i in 1..n: if seg[i].start < seg[i-1].start → 乱序; if seg[i].start < seg[i-1].start+seg[i-1].duration → 重叠`，
   两个都必须为 0。这条比任何素材级 diff 都快，**加轨后先跑它**。
13. **文字素材的 `font_path`/`font_resource_id` 绝不能是 `undefined`——JSON.stringify 会把键整个丢掉，
   变成"这条素材没有字体"，剪映渲染这条轨直接崩，表现又是"完全没有轨道"。**
   典型触发：**人物出场介绍卡**有自己的样式（`inStyle`：size/y/color/bg/bgAlpha/durationMs…），
   如果这份样式**没写 `fontPath`/`fontId`**，`textMaterial()` 里 `st.fontPath` 就是 `undefined`。
   字幕样式因为带了字体所以没事，**只有人物卡会中招**——于是"视频+字幕"能开、"视频+字幕+人物卡"打不开。
   注意**有两处地方都要有字体**，两处都会中招：
   ① 素材外层 `font_path` / `font_resource_id` / `fonts[]`；
   ② **`content` 字符串内部**的 `styles[0].font`——它是 `JSON.stringify({... font:{id:st.fontId,path:st.fontPath}})` 生成的，
   样式没带字体时会变成 **`"font":{}`（空对象）**，比外层更隐蔽（外层是键消失，这里是键还在但是空的）。
   同一个坑还有 `styles[0].strokes[0].width`（`st.strokeWidth` 为 undefined 时被丢掉）。
   `textMaterial()` 已改成 `st.fontId || TPL.textMaterial.font_resource_id`、`st.strokeWidth || TPL.textMaterial.border_width`
   回退，并在生成后补齐缺失键。
   另：`font_id` 必须留空串（全机 5.9 万条正常文字素材无一例外），字体 id 只放 `font_resource_id`。
   **自查 `content` 的方法**：`JSON.parse(m.content).styles[0]`，检查 `font` 非空、`strokes[0].width` 存在，
   并和一条正常草稿的素材比对 style 的键集合与嵌套键集合（只比顶层键会漏掉 `strokes[0].width` 这种嵌套缺失）。
14. **加完轨后要做的两项机械自查（比逐个字段 diff 有用得多）：**
   ① 每条轨的乱序/重叠数（第 12 条）；
   ② **字段缺失**：把所有正常草稿每个数组的**键并集**取出来，检查我的每条素材是否都齐；
      以及**常量类字段**（正常草稿里取值种类 ≤20 的）我的值是否在正常集合里。
      这两项一跑，"没有字体"和"font_id 非空"这种问题立刻就现形。
      经验：素材级"值看起来都对"不代表没问题，**缺字段**和**轨道顺序**是这类幽灵 bug 的两个主坑。
15. **原地模式（`--in-place`）必须可反复构建**：`build.js` 只在没有
    `draft_content.json.before_manju` 时创建它，之后每次构建都先从这个备份还原再改。
    否则每跑一次就会把字幕/人物卡/配乐轨**再叠一遍**（轨道数翻倍）。
    手动还原也是同样的道理：先把 `.before_manju` 拷回 `draft_content.json` 再构建。
16. **重新构建前先确认源草稿还是"只有 video 轨"的原始状态**（`tracks.length === 1`）。
    写完脚本先 `node --check` 再跑构建——构建是原地写草稿的。

## 文件说明

- `scripts/manju.js` — CLI（init / scan / extract / build / register）
- `scripts/lib/zizi.js` — 字字动画 data.ini 与 characters.json 解析
- `scripts/lib/jianying.js` — 剪映草稿读写、时间线映射、草稿列表注册
- `scripts/lib/bgm.js` — 配乐分段引擎（合并同情绪、游标轮换避免重复感）
- `scripts/lib/build.js` — 组装三条轨道并落盘
- `scripts/lib/templates.json` — 从真实草稿导出的剪映最小可用模板
- `scripts/audio-align.js` + `scripts/lib/audioalign.js` — 浊音 VAD，把字幕对齐到真实配音
  （`node audio-align.js <plan.json> <out.json> <pcmDir> [ffmpeg]`，565 条约 30 秒）
- `scripts/asr-run.py` — 离线中文语音识别，逐字时间戳（嵌入式 python310 + funasr）
- `scripts/asr-align.js` — 剧本台词逐字对齐到识别结果，输出对齐表（比 VAD 准，且能查出音画不符）
- `scripts/config.example.json` — 一个真实项目的完整配置（38 个情绪段）
- `references/` — 格式规范、草稿结构、配乐情绪映射、字字动画两代数据格式
