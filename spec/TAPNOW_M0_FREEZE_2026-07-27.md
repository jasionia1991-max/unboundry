# TapNow M0 空画布 Shell 冻结

日期：2026-07-27  
状态：`M0_PASS_FROZEN`

## 验收结果

- 用户已在内置浏览器查看本地 `shell.empty.primary` 并确认继续。
- `1135×917@2x`：29个固定元素坐标误差均不超过1 CSS px。
- `1440×900@1x`、`1920×1080@1x`：共58个固定元素坐标误差均不超过1 CSS px。
- 两个1x视口的当前截图与冻结PNG逐字节一致。
- 绿地污染检查、TypeScript、生产构建、生产fixture隔离检查通过。
- TapNow品牌图形和用户头像继续使用绿地占位图形，不复制品牌资产。

## 冻结文件 SHA-256

| 文件 | SHA-256 |
|---|---|
| `client/src/canvas/CanvasShell.tsx` | `db00731bd48db3a5ecb4959bd5b55efed8b8ed59a75ac6608f63ed0631a7e4` |
| `client/src/styles.css` | `ec123b37ff463589cf4fc2c73e33e68c75605f8f8fc8bdf9dccb740121f251d9` |
| `tests/m0-shell.spec.ts` | `1d242d8c712dc83862bdb8355f58dd2c5b5c729454af3a2db6c5343446914c4a` |
| `spec/m0-shell-responsive-baseline.json` | `2cda1dc35658a53df914ff66fbdeccf140a1307be3bde76e3ca910cb041d38bf` |
| `spec/reference/m0-shell/shell-empty-1440x900-1x.png` | `e98ecdc4a8c4f7abf508012739258ad1b6c4eff67e62614dbd07039052c6d74f` |
| `spec/reference/m0-shell/shell-empty-1920x1080-1x.png` | `9ab66de1e09739038d90708c687770a43399b50decfcd9c68b68349e98c74401` |

## M1 变更规则

- M1 可替换静态 world 层，但不得改变已冻结的 screen-space Shell 坐标。
- M1 必须从本仓库夹具实现世界坐标、pan/zoom、选择、拖拽、resize、snap、minimap和edge。
- 若M1需要改变本文件中的视觉基线，必须先记录真实 TapNow 新证据及差异原因。

## M1 点阵证据修正

2026-07-27 用户以 TapNow 实页截图指出：点阵应在放大时更清晰、缩小时更弱。内置浏览器随后测得 TapNow 当前 SVG pattern 的间距和圆点半径均随 zoom 等比例变化；原 M0 固定圆点半径会产生相反观感，因此按上方变更规则修正。

- screen-space Shell 坐标和布局不变。
- 点阵改为基础间距 20、基础圆点半径 0.5，间距和半径同步乘以 zoom。
- 两张 1x 冻结截图只因点阵渲染事实被更正而更新。
- 修正后 `1440×900@1x`、`1920×1080@1x` 的 58 个固定元素锚点仍满足 ≤1 CSS px。

| 修正文件 | SHA-256 |
|---|---|
| `client/src/styles.css` | `44fa3e474e00776c7039921d71bf07872aa3a50880f1e7ae9763b99befe82acb` |
| `tests/m0-shell.spec.ts` | `4ddd7836b26b9b756b49dd52b30617e56a66f484d822087763c90177e5d76d5a` |
| `spec/reference/m0-shell/shell-empty-1440x900-1x.png` | `6cc1624b2c12d58e5fac3426e070dea6340bee0fc38ff5779ca56af96396a265` |
| `spec/reference/m0-shell/shell-empty-1920x1080-1x.png` | `a777a82a415b36e8b64e51414dc3f98dcf21c896822f7edeb35eff1ce94a2860` |
