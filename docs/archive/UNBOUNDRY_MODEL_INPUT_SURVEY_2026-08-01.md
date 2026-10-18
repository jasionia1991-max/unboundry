# Unboundry 全节点、全模型入参活体勘测（2026-08-01）

- 参考页面：`https://app.unboundry.ai/canvas/b01e9bc1-1160-470c-baa7-dbf75218e9f5`
- Unboundry页面版本：`v2.12.11`
- 勘测方式：内置浏览器真实页面，新建Image、Video、Text、Audio空白测试节点，逐项切换模型并展开参数。
- 安全边界：所有提示词保持为空，所有Generate按钮均为禁用；未点击Generate，未创建真实生成任务，未调用收费Provider。
- 证据边界：订阅锁定或当前禁用的模型只能确认目录标签和状态，不能把其内部参数猜成已确认。

## 1. 总览

| 节点 | 模型总数 | 可查看完整入参 | 订阅锁定 | 当前禁用 |
|---|---:|---:|---:|---:|
| 图片 | 19 | 5 | 14 | 0 |
| 视频 | 44 | 5 | 27 | 12 |
| 文本 | 4 | 2 | 0 | 2 |
| 音频 | 5 | 2 | 3 | 0 |
| 合计 | 72 | 14 | 44 | 14 |

状态说明：

- 可查看：模型可切换，默认值、选项和禁用项已展开记录。
- 订阅锁定：点击后进入订阅/充值设置，未获得模型入参。
- 当前禁用：目录中可见，但当前账号页面不允许选择。

## 2. 图片模型目录

| # | 模型ID | 页面名称与标签 | 状态 | 当前默认摘要 |
|---:|---|---|---|---|
| 1 | `nano-banana-flash-lite` | Nano Banana 2 Lite / NEW / 1K | 可查看 | 2:3 · · · 1K |
| 2 | `doubao-seedream-5.0-lite` | Seedream 5.0 Lite / 2K | 可查看 | 1:1 · · · 2K |
| 3 | `doubao-seedream-5.0-pro` | Seedream 5.0 Pro / NEW / 2K | 可查看 | 2:3 · · · 2K |
| 4 | `doubao-seedream-4.0` | Seedream 4.0 / 4K | 可查看 | 自适应(4K) |
| 5 | `doubao-seedream-4.5` | Seedream 4.5 / 4K | 可查看 | 16:9 · · · 2K |
| 6 | `gpt-image-2` | GPT Image2 / 热门 / 4K | 订阅锁定 | — |
| 7 | `nano-banana-flash` | Banana 2 / 4K | 订阅锁定 | — |
| 8 | `tamar-google-gemini-pro` | Banana Pro / 4K | 订阅锁定 | — |
| 9 | `nano-banana` | Banana / 1080P | 订阅锁定 | — |
| 10 | `midjourney-v7` | MJ V7 / 1080P | 订阅锁定 | — |
| 11 | `midjourney-v8.1` | MJ V8.1 / 2K | 订阅锁定 | — |
| 12 | `midjourney-niji7` | MJ Niji7 / 1080P | 订阅锁定 | — |
| 13 | `flux-kontext-max` | Flux Max / 1080P | 订阅锁定 | — |
| 14 | `flux-kontext-pro` | Flux / 1080P | 订阅锁定 | — |
| 15 | `fal-recraft-v4` | Recraft V4 / 1080P | 订阅锁定 | — |
| 16 | `fal-recraft-v4-vector` | Recraft V4 矢量版 / 1080P | 订阅锁定 | — |
| 17 | `grok-2-image` | Grok2 Image / 1080P | 订阅锁定 | — |
| 18 | `grok-imagine-image` | Grok Imagine / NEW / 2K | 订阅锁定 | — |
| 19 | `grok-imagine-image-quality` | Grok Imagine Quality / NEW / 2K | 订阅锁定 | — |

### 2.1 可查看图片模型的完整参数

#### Nano Banana 2 Lite（`nano-banana-flash-lite`）

- 默认摘要：2:3 · · · 1K
- 参数面板：画质 / 1K / 比例 / 自适应 / 1:1 / 9:16 / 16:9 / 3:4 / 4:3 / 3:2 / 2:3 / 5:4 / 4:5 / 21:9
- 禁用项：无
- 数量：4× / 2× / 1×
- 附加控制：摄影机控制

#### Seedream 5.0 Lite（`doubao-seedream-5.0-lite`）

- 默认摘要：1:1 · · · 2K
- 参数面板：画质 / 2K / 3K / 比例 / 1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9
- 禁用项：无
- 数量：4× / 2× / 1×
- 附加控制：无

#### Seedream 5.0 Pro（`doubao-seedream-5.0-pro`）

- 默认摘要：2:3 · · · 2K
- 参数面板：画质 / 1K / 2K / 比例 / 1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9
- 禁用项：无
- 数量：4× / 2× / 1×
- 附加控制：无

#### Seedream 4.0（`doubao-seedream-4.0`）

- 默认摘要：自适应(4K)
- 参数面板：画质 / 自适应 / 比例 / 自适应(4K) / 1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9
- 禁用项：无
- 数量：4× / 2× / 1×
- 附加控制：高级设置

#### Seedream 4.5（`doubao-seedream-4.5`）

- 默认摘要：16:9 · · · 2K
- 参数面板：画质 / 2K / 4K / 比例 / 1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3
- 禁用项：无
- 数量：4× / 2× / 1×
- 附加控制：高级设置

补充观察：Nano Banana 2 Lite显示风格、Lens和摄影机控制；Seedream 5.0 Lite/Pro切换后这些控制消失。Seedream 4.0和4.5的高级设置包含“组图模式”，页面显示的开关初始为开启。

## 3. 视频模型目录

| # | 模型ID | 页面名称与标签 | 状态 | 当前默认摘要 |
|---:|---|---|---|---|
| 1 | `seedance-2.0-mini` | Seedance 2.0 Mini / 720P / 4-15S | 可查看 | 全能参考 · 1:1 · 480p · 5s · · |
| 2 | `seedance-1.5-pro` | Seedance 1.5 Pro / 1080P / 5-10S | 可查看 | 首尾帧 · 16:9 · 720p · 5s · · |
| 3 | `wanxiang-v2-6` | Wan 2.6 / 1080P / 2-15S | 可查看 | 首尾帧 · 16:9 · 720P · 5s · · |
| 4 | `minimax` | Hailuo-02 / 1080P / 6-10S | 可查看 | 首尾帧 · 自适应 · 768P · 6s |
| 5 | `viduq2` | Vidu Q2 / 1080P / 1-8S | 可查看 | 首尾帧 · 16:9 · 540p · 5s |
| 6 | `seedance-2.0` | Seedance 2.0 / 1080P / 4-15S | 订阅锁定 | — |
| 7 | `seedance-2.0-fast` | Seedance 2.0 Fast / 720P / 4-15S | 订阅锁定 | — |
| 8 | `seedance-2.5` | Seedance 2.5 / 1080P / 4-15S | 当前禁用 | — |
| 9 | `MiniMax-H3` | MiniMax H3 / NEW / 4折 / 2K / 5-15S | 订阅锁定 | — |
| 10 | `kling-video-o3` | Kling 3.0 Omni / 4K / 3-15S | 订阅锁定 | — |
| 11 | `gemini-omni-flash` | Gemini Omni Flash / NEW / 3-10S | 订阅锁定 | — |
| 12 | `kling-v3-pro` | Kling 3.0 / 4K / 3-15S | 订阅锁定 | — |
| 13 | `happyhorse-1.0` | HappyHorse 1.0 / 1080P / 3-15S | 订阅锁定 | — |
| 14 | `happyhorse-1.1` | HappyHorse 1.1 / NEW / 1080P / 3-15S | 订阅锁定 | — |
| 15 | `kling-video-o1` | Kling O1 / 1080P / 5-10S | 订阅锁定 | — |
| 16 | `veo3.1-lite` | VEO3.1-Lite / 1080P / 4-8S | 订阅锁定 | — |
| 17 | `veo3.1-fast` | VEO3.1-Fast / 6.7折 / 4K / 4-8S | 订阅锁定 | — |
| 18 | `veo3.1` | VEO3.1 / 4K / 4-8S | 订阅锁定 | — |
| 19 | `kling-v2-6` | Kling 2.6 / 5-10S | 订阅锁定 | — |
| 20 | `MiniMax-Hailuo-2.3` | Hailuo-2.3 / 1080P / 6-10S | 订阅锁定 | — |
| 21 | `doubao-seedance-pro` | Seedance 1.0 Pro / 1080P / 5-10S | 订阅锁定 | — |
| 22 | `viduq3-pro` | Vidu Q3 / 1080P / 1-16S | 订阅锁定 | — |
| 23 | `kling` | Kling 2.1 / 1080P / 5-10S | 订阅锁定 | — |
| 24 | `kling-v2-5-turbo-pro` | Kling 2.5 / 1080P / 5-10S | 订阅锁定 | — |
| 25 | `wanxiang-plus` | Wan 2.2 / 1080P / 5S | 订阅锁定 | — |
| 26 | `wanxiang-preview` | Wan 2.5 / 1080P / 5-10S | 订阅锁定 | — |
| 27 | `pixverse-v5.5` | PixVerse 5.5 / 1080P / 5-10S | 订阅锁定 | — |
| 28 | `pixverse-v5` | PixVerse 5.0 / 1080P / 5-8S | 订阅锁定 | — |
| 29 | `veo3` | VEO3 / 1080P / 4-8S | 订阅锁定 | — |
| 30 | `veo3-fast` | VEO3-Fast / 1080P / 4-8S | 订阅锁定 | — |
| 31 | `sora-2-standard` | Sora 2 / 720P / 4-12S | 订阅锁定 | — |
| 32 | `sora-2-pro` | Sora 2 Pro / 1080P / 4-12S | 订阅锁定 | — |
| 33 | `grok-imagine-video` | Grok Imagine / NEW / 720P / 1-15S | 订阅锁定 | — |
| 34 | `midjourney-video` | MJ Video / 720P | 当前禁用 | — |
| 35 | `happyhorse-1.0-edit` | HappyHorse 1.0 视频编辑 / 1080P | 当前禁用 | — |
| 36 | `kling-video-o3-edit` | Kling 3.0 Omni 视频编辑 / 1080P | 当前禁用 | — |
| 37 | `kling-video-o1-edit` | Kling O1 视频编辑 | 当前禁用 | — |
| 38 | `MiniMax-Hailuo-2.3-Fast` | Hailuo-2.3 Fast / 1080P / 6-10S | 当前禁用 | — |
| 39 | `viduq2-pro` | Vidu Q2 Pro / 1080P / 1-8S | 当前禁用 | — |
| 40 | `viduq2-turbo` | Vidu Q2 Turbo / 1080P / 1-8S | 当前禁用 | — |
| 41 | `kling-motion-control` | Kling 2.6 动作迁移 | 当前禁用 | — |
| 42 | `wanxiang-i2v-flash` | Wan 2.2 Flash / 720P / 5S | 当前禁用 | — |
| 43 | `grok-imagine-video-1.5` | Grok Imagine 1.5 / NEW / 1080P / 1-15S | 当前禁用 | — |
| 44 | `omnihuman-1.5` | OmniHuman 1.5 / 1080P | 当前禁用 | — |

### 3.1 可查看视频模型的完整参数

#### Seedance 2.0 Mini（`seedance-2.0-mini`）

- 默认摘要：全能参考 · 1:1 · 480p · 5s · ·
- 参数面板：生成方式 / 首尾帧 / 全能参考 / 比例 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 / 清晰度 / 480p / 720p / 生成时长 / 4s / 5s / 6s / 7s / 8s / 9s / 10s / 11s / 12s / 13s / 14s / 15s / 生成音频 / 开启 / 关闭
- 禁用项：720p / 6s / 7s / 8s / 9s / 10s / 11s / 12s / 13s / 14s / 15s
- 数量：2× / 1×

#### Seedance 1.5 Pro（`seedance-1.5-pro`）

- 默认摘要：首尾帧 · 16:9 · 720p · 5s · ·
- 参数面板：生成方式 / 首尾帧 / 比例 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 / 清晰度 / 480p / 720p / 1080p / 生成时长 / 5s / 10s / 生成音频 / 开启 / 关闭
- 禁用项：1080p / 10s
- 数量：2× / 1×

#### Wan 2.6（`wanxiang-v2-6`）

- 默认摘要：首尾帧 · 16:9 · 720P · 5s · ·
- 参数面板：生成方式 / 首尾帧 / 参考 / 比例 / 16:9 / 9:16 / 1:1 / 清晰度 / 720P / 1080P / 生成时长 / 5s / 10s / 15s / 生成音频 / 开启 / 关闭
- 禁用项：1080P / 10s / 15s
- 数量：2× / 1×

#### Hailuo-02（`minimax`）

- 默认摘要：首尾帧 · 自适应 · 768P · 6s
- 参数面板：生成方式 / 首尾帧 / 比例 / 自适应 / 清晰度 / 768P / 1080P / 生成时长 / 6s / 10s
- 禁用项：1080P
- 数量：2× / 1×

#### Vidu Q2（`viduq2`）

- 默认摘要：首尾帧 · 16:9 · 540p · 5s
- 参数面板：生成方式 / 首尾帧 / 参考 / 比例 / 16:9 / 9:16 / 1:1 / 3:4 / 4:3 / 清晰度 / 360p / 540p / 720p / 1080p / 生成时长 / 1s / 2s / 3s / 4s / 5s / 6s / 7s / 8s
- 禁用项：720p / 1080p / 6s / 7s / 8s
- 数量：2× / 1×

参考输入补充：

- Seedance 2.0 Mini：首尾帧或全能参考；全能参考最多9张图、3个视频、3段音频。
- Wan 2.6：首尾帧或参考；参考支持“最多3张图＋最多2个视频”或“最多5张图”；高级设置还有“多镜头”开关，初始为关闭。
- Vidu Q2：首尾帧或参考；参考最多7张图。
- Seedance 1.5 Pro和Hailuo-02当前可见面板只显示首尾帧。

## 4. 文本模型目录

| # | 模型ID | 页面名称与标签 | 状态 | 可见控制 |
|---:|---|---|---|---|
| 1 | `gemini-3.1-flash-lite` | Gemini 3.1 Flash Lite / 轻量快速 / 低成本 / 5 ~ 10s | 可查看 | Gemini 3.1 Flash Lite · 1× · 1 |
| 2 | `deepseek-v4-pro` | DeepSeek V4 Pro / NEW / 深度推理 / 高质量 / 10 ~ 20s | 可查看 | DeepSeek V4 Pro · 快速 · 1× · 2 |
| 3 | `gemini-3.1-pro` | Gemini 3.1 Pro / 增强推理 / 高质量 / 10 ~ 20s | 当前禁用 | — |
| 4 | `gemini-3-flash` | Gemini 3 Flash / 快速高效 / 通用 / 10 ~ 20s | 当前禁用 | — |

- Gemini 3.1 Flash Lite：提示词、模型、数量；数量可选4×、3×、2×、1×。
- DeepSeek V4 Pro：额外提供推理档位“关闭、快速、专家”；默认快速；数量可选4×、3×、2×、1×。
- Gemini 3.1 Pro和Gemini 3 Flash当前为禁用，未读取内部入参。
- 当前Unboundry文本节点没有统一显示“输出格式”和“创造性”两个参数。

## 5. 音频模型目录

| # | 模型ID | 页面名称与标签 | 状态 | 当前默认摘要 |
|---:|---|---|---|---|
| 1 | `Mureka V8` | Mureka V8 / 情感表达 | 可查看 | Mureka V8 · 音乐 · 自适应 · 10 |
| 2 | `Mureka O2` | Mureka O2 / 专业制作 | 可查看 | Mureka O2 · 音乐 · 自适应 · 10 |
| 3 | `MiniMax Music 2.6` | MiniMax Music 2.6 / NEW | 订阅锁定 | — |
| 4 | `ElevenLabs V3` | ElevenLabs V3 / NEW | 订阅锁定 | — |
| 5 | `Sonilo Music` | Sonilo Music / NEW | 订阅锁定 | — |

### 5.1 可查看音频模型的完整参数

#### Mureka V8（`Mureka V8`）

- 输入区：创作描述＋歌词，两块独立文本输入。
- 音乐：音乐 / 生成音乐；禁用项：无
- 自适应：歌词 / 自适应 / 自定义；禁用项：无
- 页面未显示通用的时长、输出格式或生成数量。

#### Mureka O2（`Mureka O2`）

- 输入区：创作描述＋歌词，两块独立文本输入。
- 音乐：音乐 / 生成音乐；禁用项：无
- 自适应：歌词 / 自适应 / 自定义；禁用项：无
- 页面未显示通用的时长、输出格式或生成数量。

MiniMax Music 2.6、ElevenLabs V3和Sonilo Music当前为订阅锁定，内部参数不能确认。

## 6. 对当前复刻项目的直接影响

当前本项目真实发布模型只有：

- 图片：GPT Image 2（OpenRouter，默认）。
- 视频：Seedance 2.0 Mini（火山方舟，默认）。
- 文本和音频：尚无真实发布Provider模型，生成按钮应继续禁用。

现有共享参数结构需要升级的原因：

1. 参数不能只用一套固定的比例、清晰度和时长。例如Hailuo出现768P，Vidu出现360p/540p。
2. 模型切换会改变整个输入区，而不只是改变一个模型名称。
3. 需要表达显示条件、禁用条件、默认值、参考素材组合和高级开关。
4. 文本模型可能有推理档位；音乐模型可能有歌词模式；这些都不能放进无差别的通用下拉框。
5. Unboundry页面可见行为只能作为交互参考；真实Provider字段和能力仍必须由官方Provider契约确认，不能照抄或猜测。

## 7. 本轮状态

- 十项验收计划第1项的活体勘测和证据整理已完成。
- 这不是用户PASS；等待用户查看并确认。
- 未更新`TASKS.md`及其他五份验收总文档；继续遵守每10次成功验收统一更新一次。

