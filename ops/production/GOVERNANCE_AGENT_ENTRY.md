# Unboundry 服务器治理入口

本文件是服务器导航；规则和状态的唯一维护源是 GitHub 仓库 `jasionia1991-max/unboundry` 的当前治理文档。

先进入 `/opt/unboundry/governance/current`，核对 `.governance-manifest.json` 中的来源提交与文件哈希，再读 [工作规则](governance/current/AGENTS.md)、[当前状态](governance/current/spec/UNBOUNDRY_CURRENT_STATE.md)、[当前任务](governance/current/TASKS.md)。这些链接以本文件安装位置 `/opt/unboundry/AGENTS.md` 为基准；仓库里的本文件只作为安装源。

产品运行目录是 `/opt/unboundry/current`；旧 release 和资料目录里的说明是历史构建材料。治理镜像只用于查阅，不能把它或生产目录当开发工作树。代码修改和测试在核对过的 Git 工作树完成；服务器操作必须在用户当次授权范围内。

每次回复先用中文直说用户现在需要做什么；不需要操作就说明。不得把历史授权、旧 Mac 路径或聊天摘要当成当前施工依据。
