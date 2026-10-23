# jianying-manju-editor

把剪映（JianyingPro）草稿改造成「爆款漫剧成片」：从字字动画工程提取分镜时间轴，
自动铺**字幕轨**、**人物出场介绍卡**、以及按剧情小段切情绪的**配乐轨**。
非破坏性：默认复制源草稿生成新草稿，不碰原稿。

> 这是一份 Claude 技能（skill）。前端 metadata 在 SKILL.md 的 YAML frontmatter 里，
> 内容即 SKILL.md + references/ 规范 + scripts/ 可执行脚本。

## 它能做什么

| 能力 | 说明 |
|---|---|
| 字幕轨 | 从字字动画 data.ini 提取台词时间轴，铺成剪映文字轨。默认「新青年体 / 字号6 / 金黄 / 黑描边」，竖屏自动换 10 号 |
| 语音对齐 | 抽音轨跑**离线语音识别**（FunASR paraformer），逐字时间戳，把每句字幕吸附到真实人声起止。实测 98% 以上句子锚定真实人声 |
| 人物出场介绍 | 按角色**首次出场**的位置打「姓名 · 身份」名条，同一镜头多人自动错开 3.3 秒 |
| 配乐轨 | 按剧情 cue 表逐段换曲，段间淡入淡出，音量默认 0.32；相邻同情绪自动合并、碎段回收 |
| 音画核对 | 逐字对比剧本与识别结果，**能自动查出「配音和剧本对不上的片段」** |

## 快速开始

环境：Node 18+，剪映本机已安装；语音识别可选（见下）。

```bash
# 1. 检查草稿能和字字工程对上（哈希匹配率需接近 100%）
node scripts/manju.js scan --draft "<草稿名>" --zizi "<字字动画工程目录>"

# 2. 生成配置骨架
node scripts/manju.js init --draft "<草稿名>" -o config.json

# 3. 填 config.json：曲库 library、每个 cue 的 mood、字幕/人物卡样式

# 4. 生成（默认同时注册进剪映草稿列表）
node scripts/manju.js build --config config.json --report 配乐铺排.md

# 5. 剪映没刷新出来时补注册
node scripts/manju.js register --config config.json
```

完整五步流程、强制询问规则、以及 16 个踩过的坑都写在 [SKILL.md](SKILL.md)。

## 字幕为什么要和语音对齐

字字动画写的是「`[画面] 时长4秒（17字台词）`」——这是**生成计划**，不是实际节奏。
AI 视频模型渲染出的音轨说话时间常和声明对不上，字幕按声明铺会**提前显示**。

这个 skill 用两种精度逐级对齐：

1. **浊音 VAD**（默认，快）：自相关检测人声区间，565 条约 30 秒。
2. **语音识别逐字时间戳**（更准）：离线 FunASR，把剧本台词**逐字**对齐到识别字符
   （Needleman-Wunsch），每句取首尾字真实发音起止。

纯环境依赖：读 [`scripts/asr-run.py`](scripts/asr-run.py) 顶部的环境变量说明。

## 目录结构

```
jianying-manju-editor/
├── SKILL.md                 # 技能说明（frontmatter + 完整流程 + 踩坑记录）
├── README.md
├── references/
│   ├── jianying-draft-schema.md   # 剪映草稿 JSON 结构要点
│   ├── manju-format-spec.md       # 漫剧格式规范
│   ├── bgm-mood-map.md            # 情绪 → 曲风映射
│   └── zizi-data-formats.md       # 字字动画两代数据格式
└── scripts/
    ├── manju.js             # CLI：init / scan / extract / build / register
    ├── make-plan.js         # plan.json 生成
    ├── audio-align.js       # 浊音 VAD 对齐
    ├── asr-run.py           # 离线语音识别（逐字时间戳）
    ├── asr-align.js         # 剧本逐字对齐到识别结果
    ├── config.example.json  # 完整配置示例
    └── lib/                 # zizi / jianying / bgm / build / templates
```

## 依赖

- **Node 18+**
- **剪映（JianyingPro）** 本机已安装（读草稿与注册列表）
- 语音识别可选：嵌入式 python310 + funasr + torch（见 SKILL.md「运行环境」）

## 许可

MIT，见 [LICENSE](LICENSE)。
