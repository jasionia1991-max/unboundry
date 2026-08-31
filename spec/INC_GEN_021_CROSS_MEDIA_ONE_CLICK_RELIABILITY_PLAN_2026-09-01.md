# INC-GEN-021 图片/视频/音频一次点击可靠交付方案

状态：`V0_6_67_RELEASE_AUTHORIZED / RELEASE_IN_PROGRESS / REAL_GROUP_AUTHORIZED_NOT_RUN`

## 用户要的结果

用户只点击一次“整组执行”。图片、视频、音频只要 Provider 已经返回，系统就必须先保住原始结果，再由后台继续保存和恢复；普通用户不重复点击，也不去 Provider 平台回收结果。结果不明时只核对原任务，绝不借恢复流程发第二次 Provider POST。

## 当前结论

- 现网仍是 v0.6.66，不能因为页面按钮可点就宣称整组已经通过。截图只证明文字节点成功、首个图片节点以 `RESULT_SAVE_FAILED_NO_RETRY` 终止，其余下游没有运行。
- v0.6.66 的根因不只是提示文案：同步图片结果在 OSS 上传前没有可靠本地 staging；OSS 短暂失败后，已返回的图片字节可能随进程执行结束而丢失。视频和音频虽然已有 staging，但失败分支会立刻补偿并删除该份结果。
- 待提交生成媒体原来只在服务启动时恢复。运行中的 OSS 短暂故障可能要等重启，违反“一次点击后系统自己完成”的产品合同。

## 本地候选修复

1. 图片、视频、音频统一先写本地 publication staging，并校验容量、大小、格式和 SHA-256，再上传私有 OSS。
2. Provider 已返回且 staging 已完成后，如果 OSS/提交暂时失败，保留原任务、原 attempt 和原始字节；不补偿删除，不创建替代 publication，不进入 Provider 重新提交。
3. 30 秒后台恢复扫描会优先续传待提交媒体。上传成功后用原 publication 原子提交结果；relay 多结果任务再继续核对同一 Provider task id。
4. 有待提交媒体的 recovering 任务禁止同时轮询或匹配 Provider，避免同一付费 attempt 产生竞争结果。
5. 节点终态以 `RESULT_SAVE_FAILED_NO_RETRY` 为准，不再被旧的“自动找回中”checkpoint 文案覆盖。

## 不改变的边界

- Provider 请求编译、模型合同、计费准入、同一 task/attempt 身份和 Canvas 结果投影合同不变。
- `outcome-unknown` 仍只核对原任务；有 Provider task id 的任务仍轮询同一远端任务；没有恢复证据时不伪造成功。
- 本轮没有连接真实 Provider、没有真实 OSS 写入、没有发布、没有生产切换，也没有点击真实整组。

## 验收门

- 终态失败文案不能再显示“自动找回中”。
- 图片和流式音频在首次 OSS 上传失败后，后台必须使用逐字节相同的 staging 文件恢复并成功提交。
- 恢复前后 task attempt 保持 1；Provider paid request 计数不增加。
- 视频走与音频相同的 durable staging/deferred 分支；跨图片/视频/音频 Provider 协议回归保持通过。
- TypeScript、diff-check、直接相关 safe specs 通过；不为安心重复已经通过且源码依赖未变化的全量测试。
- 发布后才能做一次真实整组验收；只有拿到实际图片/视频/音频结果并确认没有用户补点，才能写生产通过。
- 候选冻结后的唯一正式 safe full 原始为 `1139/1140`；唯一未改动 m69 撤销观测超时在相同源码下最小复验 `6/6 PASS`。不重复full，也不把原始结果改写成全绿。

## 授权边界

用户已明确确认 v0.6.67，并一次性授权 commit、push、PR、CI、不可变 tag/Release、冻结备份、恢复演练和生产发布。发布成功后，另授权在目标 Canvas/group 只点击一次“整组执行”，预算上限 CNY 300 等值、最多 11 次 Provider POST、不重试；结果不明时只核对原任务。
