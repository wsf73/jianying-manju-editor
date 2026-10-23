# 剪映 draft_content.json 结构要点与坑

## 草稿目录

```
D:/JianyingPro Drafts/<草稿名>/
  draft_content.json        主文件（单行压缩 JSON）
  draft_content.json.bak
  draft_meta_info.json      草稿元信息 + draft_materials（导入的素材清单）
  draft_cover.jpg
  attachment_pc_common.json
  draft_settings / draft.extra / key_value.json / draft_virtual_store.json
  .backup/ matting/ smart_crop/ Resources/
```

草稿根目录不是固定的，要从注册表读：
`%LOCALAPPDATA%/JianyingPro/User Data/Projects/com.lveditor.draft/root_meta_info.json`
里任一 entry 的 `draft_root_path`。

## 草稿列表注册

`root_meta_info.json`：

```json
{
  "all_draft_store": [ { "draft_name": "...", "draft_fold_path": "...",
      "draft_json_file": "...", "draft_cover": "...", "draft_id": "<UUID>",
      "draft_root_path": "D:\\JianyingPro Drafts", "tm_duration": 3213866666,
      "tm_draft_create": ..., "tm_draft_modified": ..., "tm_draft_removed": 0 } ],
  "draft_ids": 100,
  "root_path": "..."
}
```

新建草稿 = 建文件夹 + 写 draft_content.json + 写 draft_meta_info.json + 往 all_draft_store 插一条。
`tm_draft_modified` 设成当前时间会排到列表最前。

**剪映运行时退出会重写这个文件**，外部写入可能被覆盖，需要重新注册。

## draft_content.json 顶层

`canvas_config` `color_space` `config` `cover` `create_time` `duration`
`extra_info` `fps` `free_render_index_mode_on` `group_container` `id`
`keyframe_graph_list` `keyframes` `last_modified_platform` `materials`
`mutable_config` `name` `new_version` `platform` `relationships`
`render_index_track_mode_on` `retouch_cover` `source` `static_cover_image_path`
`time_marks` `tracks` `update_time` `version`

## 交叉引用

`tracks[].segments[].material_id` 指向 `materials.<kind>[]` 里的素材；
`segments[].extra_material_refs` 指向附属素材（速度/节拍/声道/动画/淡入淡出）。

**加轨时必须 append 素材数组**，不能整体替换 `materials`，否则视频轨会断链。

参考草稿的引用构成：

- text 片段：`extra_material_refs = [1 个 material_animations]`
- audio 片段：`extra_material_refs = [speeds, beats, sound_channel_mappings, vocal_separations]`
  （加了淡入淡出就再挂一个 `audio_fades`）
- video 片段：引用 `speeds / sound_channel_mappings / vocal_separations` 等

## 关键素材字段

**text 素材**：`add_type: 2`、`type: "subtitle"`、`font_size`、`font_resource_id`、
`font_path`、`content`（内含 styles/text 的 JSON 字符串）、`background_style/color/alpha/width/height/round_radius`。

`content` 结构：

```json
{"styles":[{"fill":{"content":{"render_type":"solid",
   "solid":{"alpha":1.0,"color":[1.0,0.8705882430076599,0.0]}}},
   "font":{"id":"6740435892441190919","path":"...新青年体.ttf"},
   "range":[0,10],"size":6,
   "strokes":[{"alpha":1.0,"content":{"render_type":"solid",
     "solid":{"alpha":1.0,"color":[0,0,0]}},"width":0.08}],
   "useLetterColor":true}],
 "text":"台词"}
```

**text 片段**：`clip.transform = {x:0,y:-0.8}`、`clip.scale={x:1,y:1}`、
`render_index`、`track_render_index`、`target_timerange`、`source_timerange`（文本用 start 0、duration 同 target）。

**audio 素材**：`type: "extract_music"`、`path`/`name` 为绝对路径、`duration` 为微秒、
`music_id`、`category_name: "local_music"`。

**audio 片段**：`volume`、`source_timerange`（从曲子里哪一段开始）、`target_timerange`（落在时间线哪一段）。

**audio_fades**：`{fade_in_duration, fade_out_duration, fade_type: 0, id, type: "audio_fade"}`，单位微秒。

## 已踩过的坑

1. `fs.cpSync` 拷剪映草稿目录会让 Node 直接崩（0xC0000409，Node 24）→ 自己递归 `copyFileSync`。
2. 时间单位是**微秒**，帧率 30fps 时一个片段常是 12266667。
3. UUID 大小写混用是正常的，用 `crypto.randomUUID().toUpperCase()` 即可。
4. 重建草稿会留下没人引用的孤儿素材，按「被任何 segment 的 material_id 或 extra_material_refs 引用」
   清理 texts / material_animations / audios / audio_fades / speeds / beats / sound_channel_mappings / vocal_separations
   （不要动 videos / canvases 这些被素材互相引用的）。
5. 中文路径/参数在 PowerShell 里可能被控制台编码影响；把中文写进 UTF-8 的 JSON 配置再传 ASCII 路径最稳。
