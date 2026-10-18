# INC-ECOM-004｜电商模板封面发布

状态：`PRODUCTION_STATIC_COVERS_DEPLOYED / USER_VISUAL_REVIEW`

## 授权与范围

- 用户已明确授权发布模板封面，并另行确认本次仍使用 `v0.6.0`。
- 仅为 16 条已发布电商模板补充静态 JPG 封面及 `preview_image` 路径。
- 不修改并发、生成安全、OSS、模型或 Provider 配置；不创建生成任务，不调用付费 Provider。
- 不 push、tag 或 PR。生产发布采用当前可信 formal `v0.6.0` 产物上的有界静态内容叠加，不冒充重新执行过 formal builder 或 full regression。

## 内容证据

- 来源与授权：`spec/ecommerce-template-cover-sources.json`。
- 文件尺寸与 SHA-256：`spec/ecommerce-template-cover-receipt.json`。
- 本地验证：`scripts/verify-ecommerce-template-covers.mjs`。
- 生产模板路径事务：`scripts/apply-ecommerce-template-cover-paths.mjs`，默认 dry-run，只有显式 `--apply` 才写入；要求 schema39、quick_check ok、FK0、active generation 0，并拒绝覆盖非空的意外封面路径。
- release 内容叠加同时绑定源码静态目录 `client/public/templates` 与 Vite preview 实际服务目录 `dist/client/templates`，两份字节均纳入同一不可变 inventory。

## 发布门

1. 本地 16 张封面哈希、1200×675 尺寸和构建副本一致。
2. 受影响构建与公共模板专项测试通过。
3. 生产写入前 active generation 为 0，停服后形成一致备份并在临时副本验证 schema39、quick_check 和 FK。
4. 旧 release 与数据库备份均保留；新 release 清单绑定 base manifest、内容提交、来源清单、文件 receipt 和 16 个文件哈希。
5. 上线后公网 live/ready/version/root、16 个静态封面、模板数据库、任务/Provider计数及并发设置复核；实页视觉效果留给用户最终确认。

## 完成证据

- 本地最终内容commit：`d908c4b3824cd36638f02fec51cbe335f6aacd52`。`npm run build`通过，16张源文件/构建副本哈希一致；公共模板专项`9/9 PASS`，未执行fresh full regression。
- 生产base formal manifest：`5386c74440f8868719bb7942af31437a1a2dfcbb9de28d604ccf836ddc1478b1`。最终有界内容叠加manifest：`340452f7f407cb3ab18a15cd8d4b4ab73b42a860238ac0306df67047758ed7a9`；inventory：`1d795f29e256da4e8fefd8b446ba42f114a3d8ba2f431fb1220559a04b12f464`。
- 首轮叠加只包含`client/public/templates`，上线后公网逐文件哈希门发现Vite preview返回HTML fallback。该次没有被误记为成功；source-only release已保留在`/opt/unboundry/retired-releases/20260815T081400Z-inc-ecom-004-source-only/v0.6.0`。修正后的最终叠加对每张封面同时绑定源码静态目录与`dist/client/templates`实际服务目录，两份字节都纳入inventory。
- 最终公网复核：16/16路径均HTTP200、Content-Type为`image/jpeg`、字节数与SHA-256逐项匹配receipt；live/ready/version/root均200，service active、NRestarts0。
- 数据复核：schema39、quick_check ok、FK0、active generation0；19条模板中18条published全部有封面，`withoutPreview=0`。发布前后generation tasks均109、Provider attempts均107；未产生任务或付费请求。
- 配置边界：per-user/RPM/Text/Image/Video/Audio仍全部500，`generation_safety_settings`和`provider_profiles`与停机备份逐行一致，数据manifest SHA-256仍为`980e90a98f9dbaf8cfef09b83188a93f46c962aba2622d73107ae9f454e228d0`；OSS未改。
- 回滚：停机备份`/var/lib/unboundry-rollbacks/inc-ecom-004-20260815T080758Z`已在临时副本验证schema39/quick_check/FK0及109/107计数；原formal release保存在`/opt/unboundry/retired-releases/20260815T080758Z-pre-inc-ecom-004/v0.6.0`。
- 未push、tag或PR。当前只等待用户刷新模板面板，对16张封面的视觉选择作最终确认。
