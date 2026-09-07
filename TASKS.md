# Unboundry 当前任务

文档角色：`CURRENT_TASK`。项目现状见 [当前状态](spec/UNBOUNDRY_CURRENT_STATE.md)。

## 当前任务：生成状态查询加固 v0.7.16 发布

任务ID：`GENERATION-STATUS-QUERY-LOCAL-001`。状态：`LOCAL_IMPLEMENTED / TEST_REVIEW_PASS / LOCAL_USER_PASS / HELPER_SAVE_FIXED / RELEASE_PREPARING / NOT_DEPLOYED`。

用户授权：2026-09-07最新明确“允许自行递增一个小版本，完成发布检查、备份和回退演练，通过后上线”。本次允许版本递增、commit/push/PR/合并/tag/Release、精确包隔离Linux演练、当前数据冻结备份及恢复验证、维护排空与生产切换、失败时保留数据退回本次核验的旧包、发布后验证和治理文档同步。无真实/付费生成、schema迁移、历史数据或备份删除、云权限变更；每日自动备份及视频/音频空按钮继续暂停。此前“先不上线”已被本次明确授权替代。

身份：代码根`/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`，基线HEAD `955b9d2d89f76f8b91e71dd76cfb37ecad32cdc6`，从干净工作树创建分支`codex/status-query-local-hardening`；origin为`https://github.com/jasionia1991-max/unboundry.git`。远端main仍为该HEAD且v0.7.16未占用，候选0.7.16/schema43；实测生产仍0.7.15。

## 受影响合同

选中 [生成查询加固方案第2版](spec/GENERATION_STATUS_QUERY_HARDENING_PLAN_2026-09-07.md)第3、5、7节；[生成架构](spec/UNBOUNDRY_GENERATION_ARCHITECTURE.md)第2、3节保留原任务、结果发布和画布投影边界；[UI合同](spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md)5.9与第9节约束现有提示和交互。RB05纳入本次发布门，未通过不切换生产。

## 必须保留的行为

只对WithPause观察链的原任务GET进行有限重查；直接等待默认行为不变。保留正常取消、身份隔离、单节点/工作流互斥、未知付费结果保护、手动检查、结果自动回填、DATA-005及旧模板/UI修复；不新增生成提交、Canvas admission或重复保存。四类节点与仍在用的兼容路径分别验证。所有暂停项保持，两个永久保护JSON先按路径排除且禁止访问。

验证方法：使用unboundry-safe-tests流程，只经scripts/run-safe-tests.mjs；专用Node22.23.1/npm10.9.8、系统临时数据和动态loopback。先冻结基线与原有行为，再改动；预定m41查询/恢复，按实际影响覆盖m40/m27及工作流直接等待，类型/架构/构建和文档检查。新增Q01～Q11与本地RB01～RB04按证据逐项结算；不以测试定义或代码审查替代运行结果。测试运行时冻结写入，防止安全快照漂移。

## 施工与撤销基线

初始dirty为空。已保存两个产品模块、m41测试、既有验收helper/覆盖清单及相关文档的基线内容与SHA-256。私有证据根为`/var/folders/3f/ckfmzck51612dwqng3kcnyyr0000gn/T/unboundry-status-query-local-2wmp3tjo`，入口副本为外层`generation-status-query-local-20260907/evidence-location.json`，不含真实画布/数据库/媒体/凭据或保护JSON。

产品修改`client/src/generation/taskPolling.ts`、`generationTasks.ts`；完整撤销同时覆盖策略启用、循环、HTTP状态/JSON分类，不能只关闭次数。增量测试在m41；安全runner固定用例数及对应覆盖哈希随新增用例同步。验收helper已准备两个精确客户端构建、共用一个隔离后端及合成任务，限定git读取两份普通基线源码，不放宽sandbox。其他合法修改保留，禁止整目录覆盖、reset --hard或clean。

## 当前结果

产品代码实现完成：仅WithPause原任务GET在网络错误、超时或5xx时最多额外重查两次，分别等待1秒、2秒；第三次失败保留手动检查。取消和观察身份变化立即结束等待，直接wait默认不接入策略，未新增POST。

工程检查：原m41基线59/59通过；最终m41=76、m27=27、m40=17、m38=19，合计139/139通过，失败/重试/跳过均0；类型、架构、构建、源覆盖和文档门检查通过。最终日志为私有证据根candidate-final-4.log；产品与测试此后未变。安全快照及4173保持，测试外部请求0。早期失败及修正记录保留，不当作通过证据。

Q01～Q11：m41覆盖1/2次故障恢复、3次暂停、成功清零、手动双击、Abort及换画布/退出账号、并行任务隔离、401/403/404/409/429及坏JSON/结构、10秒超时与1800轮预算、旧终态/未知付费结果/发布投影、四类现代/兼容入口、共享by-idempotency/list。事实纠正：恢复的首次身份核对GET发生在WithPause之前，失败仍保留旧暂停行为；另在合法核对后向watch注入故障验证自动恢复，未扩大方案策略。

本地撤销：已执行新→完整旧→新，同一后端、临时数据目录、Canvas和四个原taskId。旧版一次500即停止查询，手动双击取得原文字结果；再启用后原视频/音频自动重查。图片及已完成文字的投影逐项相同，终态未倒退。最终0生成POST/DELETE、0浏览器Canvas写/command，1次明确种子写入及4次合成结果发布。独立单页的退避/在途关闭各观察超过5秒，新增GET和写入均0，在途响应记录ClientClosed；单任务最大在途1。证据为rollback-analysis.json、rb01/02/03/04对应JSON和rb-final-events.jsonl。早期有额外弹出标签的退出片段已排除，重新核对唯一观察页后重做，不掩盖失败。

证据边界：任务保存在同进程合成map/journal，通过Canvas GET叠加服务端投影模拟；不是generation_tasks真实表或Provider/计费/跨进程重启证据。用真实已完成的合成图片/文字比较素材与绑定，占位sentinel不作此证明。RB03由精确两模块回撤、原59项基线和实际旧版观察共同支持。RB05精确发布包的隔离Linux演练当前NOT_RUN，纳入本次发布。

独立复核：产品实现及RB01～RB04保持PASS，见私有根independent-review.json。验收helper此前检查后被用户发现新问题：文字任务已成功，但说明页不刷新、终态按钮仍可点，终态保护被泛化为500。已真实复现并留存user-helper-failure-status/journal.json；旧环境正常停止，退出0。

验收工具已修复：说明页实时刷新、已完成按钮禁用、终态409行内提示；改为文字自动恢复→图片手动恢复→媒体刷新保留三步，动作原子化并检查实际查询及失败次数，工程按钮不能代替正式步骤。内置浏览器实际确认文字500→503→200自动显示，图片3次503后暂停、恢复连接后仍等待手动按钮、点真实画布重新检查后回填；四类结果刷新保留，视频/音频readyState4且播放进度前进。未开画布、过早恢复/跳步、终态再次中断均明确拒绝，零生成POST/DELETE和浏览器Canvas写入。证据为helper-repair-*.json/log；两个复验环境均正常退出清理。独立增量复审的顺序绕过已修复，最终无阻断。原产品139项证据继续有效；收尾文档检查见helper-repair-docs-final.log。

用户验收：用户于2026-09-07明确“都通过了”，本次三项查询恢复登记LOCAL_USER_PASS。随后报告拖动或调整画布大小时出现保存报错。原45032会话已由用户正常结束（退出0、快照不变）；原请求体未留存，仅有相邻Canvas command 200/409，不将后续复现请求体冒充原请求证据。

保存报错已定位并修复验收工具：隔离复现中，缩放先触发commit-user-layout200，随后adopt-uploaded-asset因模拟音频未登记返回CANVAS_MEDIA_UNAVAILABLE409；旧helper只模拟媒体GET，未登记真实临时素材。现让图片/视频/音频经正常本地上传、登记、读取及字节校验，移除模拟媒体/元数据路由，保留产品保存校验。仅helper及文档改变，两个产品模块哈希不变。修复后真实浏览器连续缩放、滚动平移、刷新，8次Canvas command全部200，含三类素材adopt；刷新前后revision10、loadToken、viewport及四类结果一致，页面显示已保存到云端。3次素材上传仅为临时fixture，生成POST/DELETE为0。证据为canvas-save-before-fix.json、canvas-save-after-fix.json及canvas-save-registered-2.log；测试环境正常停止、退出0并清理。该验证针对验收数据与真实保存合同，不扩大为真实Provider或生产验证。

保存报错独立增量复核：检查当前helper及实际运行日志，真实登记/字节校验、版本保留、保存和刷新验证无阻断；未伪造保存成功，未改产品文件。回执为canvas-save-independent-review.json；收尾文档检查日志为canvas-save-docs-final.log。

## 下一步

本地工作与用户验收完成，进入v0.7.16发布：先版本/定向检查/独立复核与GitHub最终CI，再精确新包→旧0.7.15→新包的RB05、当前冻结备份/verify/fresh restore，全部通过才切换。发布后按实际结果同步文档。v0.7.16定向m38=19与m81=42已通过；版本负例已同步到0.7.17，前期失败日志保留。提交前发现helper把旧基线HEAD与候选HEAD混用，已拆开校验，将在提交后验证启动。发布证据根为外层status-query-v0716-release-ops-20260907；服务器预定根/var/lib/unboundry-v0716-status-query-20260907。
