# Unboundry G0.2 实现基线冻结

日期：2026-07-27  
状态：`FROZEN_FOR_M0`

本文件冻结 M0 开工时使用的 Unboundry 产品证据。冻结不表示所有未知项已解决；`OPEN` 项继续按验收矩阵在对应实现阶段前补测，禁止用实现推测反向修改产品事实。

## 冻结计数

- 状态夹具：68
- 未知项：25
- 验收条目：146
- Unboundry 参考 PNG：40
- 产品代码：0

## SHA-256

| 文件 | SHA-256 |
|---|---|
| `unboundry-state-fixtures.json` | `0f9031c3bcf53183d5e26a28c064fefb8ec0221d9981f0d2a21cb6b3f11e2c0f` |
| `UNBOUNDRY_ACCEPTANCE_MATRIX.md` | `7efdc3677fc48ee7a16adb4ef19420cec70b71f91c38aeece0976348772284e4` |
| `upstream-reference-manifest.json` | `e7666eecd44b6550b9bf38de3921512cd303425eecff6037237c1cf7f38f19a3` |
| `upstream-reference-annotations.json` | `66185868504e2ec39928eeb07e9986c66b01614e7a7d49cedac2c404b7240e9d` |
| `UNBOUNDRY_REFERENCE_VISUAL_REVIEW.md` | `070afe023723ddcc223837cc917b3246b73e210605e8e261455bbbfa51586b02` |
| `UNBOUNDRY_REFERENCE_EVIDENCE_CATALOG.md` | `1387bef270136d0eb131a813ad5f01bf084ef301c3458e0ecaa7648811f6e2e1` |
| `UNBOUNDRY_G0_2_LIVE_SURVEY_2026-07-27.md` | `09123802ab08d6b526b3ecdd04b395b2d770bd8ca016a8867aea4083727292c2` |
| `REPLICA_CONSTRAINTS.md` | `a69d99ff817d4924e55d46570c8637194e74be31503c8e26e22391eaeee3c014` |
| 40 PNG 有序文件哈希集合 | `cb41fd6178857b5012cd1855f79bde11c5f4810678fa0113409f245135721023` |

## M0 使用规则

- 只从本仓库冻结证据实现，不读取 Lumino/Lumino Web 产品代码。
- M0 只实现 fixture 开发入口、空画布 Shell、坐标采集和最小视觉验收链。
- fixture 入口不得进入生产构建。
- 当前创建菜单不得添加 Storyboard/Table 或独立 Image Editor。
- 任何与冻结事实冲突的真实 Unboundry 新证据，先登记 source 和冲突，再形成下一版基线。
