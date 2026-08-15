# INC-ECOM-004｜电商模板封面发布

状态：`AUTHORIZED_IN_PROGRESS`

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
