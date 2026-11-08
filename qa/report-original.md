# ctf.vin 原站动效参考帧采集报告（task-3）

- 负责人：motion-qa ｜ 任务板：task-3
- 采集时间：2026-11-08 14:09–14:22（Asia/Shanghai）
- 被测站点：<https://www.ctf.vin/>（MilkDragonCTF // 奶龙杯 存档页）
- 工具：`qa/shoot.mjs`（纯 Node 零 npm 依赖，CDP over WebSocket）+ `qa/validate_shots.py`（Pillow 校验）+ `qa/make_baseline.py`（基准提炼）
- 结论：**原站参考帧与数值基准已就绪，可用于复刻站（task-4）逐项验收。**

---

## 0. TL;DR

| 项 | 结果 |
| --- | --- |
| 截图总数 | **29 张**：26 张桌面 1440×900（`qa/original/`）+ 3 张移动 375×812（`qa/original-mobile/`） |
| Pillow 校验 | **29/29 PASS**：尺寸正确、非空白（唯一色 228–256、亮度标准差 11.5–42.5） |
| 必选帧 | 10/10 全部抓取（`home-000ms` … `cert-view`） |
| JS 异常 | **0**（Runtime.exceptionThrown 三轮采集均为 0） |
| console error | **0**（Runtime.consoleAPICalled error/assert 为 0） |
| HTTP ≥400 | **仅 1 个 URL**：`https://www.ctf.vin/favicon.ico` 404（原站自身未提供 favicon；出现在 3 个桌面批次中） |
| 数值基准 | `qa/baseline-original.json`（26 帧）、`qa/baseline-original-mobile.json`（3 帧） |
| 原始探针 | `qa/original/_diagnostics.json`、`_decode-diagnostics.json`、`_extras-diagnostics.json`、`qa/original-mobile/_diagnostics.json` |

---

## 1. 采集环境

| 项 | 值 |
| --- | --- |
| 浏览器 | Chrome 156.0.8078.81（`--headless=new`），CDP 1.3 |
| 视口 | 桌面 1440×900，deviceScaleFactor=1；移动 375×812，mobile=true、touch=true，DSF=1 |
| Node | v24.21.0（使用内置全局 `WebSocket` / `fetch`，未安装任何 npm 依赖） |
| Python | 3.13.15 + Pillow 12.3.0 |
| Chrome 关键启动参数 | `--headless=new --hide-scrollbars --allow-file-access-from-files --force-color-profile=srgb --disable-lcd-text --font-render-hinting=none --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --user-data-dir=<临时目录>` |
| 其他 | `Page.bringToFront` + `Emulation.setDeviceMetricsOverride` 每次截图前生效；`Network.setCacheDisabled`；每轮独立 user-data-dir 并在结束后 `taskkill /T /F` 清理 |

### 1.1 线上站点与 `_recon/` 的一致性（已验证）

`curl https://www.ctf.vin/` 返回 HTTP 200，且三份文件字节数与 `_recon/` **完全一致**：

| 文件 | 线上字节 | `_recon/` 字节 |
| --- | --- | --- |
| index.html | 6008 | 6008 |
| styles.css | 13868 | 13868 |
| script.js | 22638 | 22638 |

说明 `_recon/` 与线上同版本，本报告中的实测值与 `_recon/` 源码分析可互相印证。

---

## 2. 工具链说明（位于 `qa/`，只读站点文件之外）

### 2.1 `qa/shoot.mjs` —— 零依赖 CDP 截图工具

```
node qa/shoot.mjs --url <url> --out <dir> --steps <steps.json>
                  [--width 1440 --height 900] [--mobile]
                  [--port 9333] [--nav-timeout 45000] [--chrome <path>]
                  [--diag <file>] [--label <name>]
```

- 启动 Chrome → 轮询 `/json/version`（上限 15s）→ `/json/list` 取 page target → 用全局 `WebSocket` 实现最小 CDP 客户端（请求/响应按 id 配对）。
- 步骤类型：`wait` / `shot` / `eval` / `hover` / `click` / `scroll` / `viewport` / `navigate`，按 JSON 数组顺序执行。
- **每次截图前自动采集 DOM 探针**（只读）：窗口/视图状态、关键元素 getBoundingClientRect、计算样式（font-size、letter-spacing、background、transform、box-shadow、clip-path 等）、`data-scramble` 元素的 span 数与 `#666` 乱码数、字体加载状态、证书/赞助数据数量等，写入诊断 JSON。
- 自动收集 `Runtime.exceptionThrown`、`Runtime.consoleAPICalled`(error/warning)、`Log.entryAdded`、`Network.responseReceived`(status≥400)、`Network.loadingFailed`。
- 截图前 `Page.bringToFront`；PNG 落盘后校验 PNG 魔数与 IHDR 宽高，尺寸不符则报步骤失败。
- 退出码：0 全成功 / 1 有步骤失败 / 2 致命错误（Chrome 启动失败等）。

**steps 文件（`qa/steps/`）**

| 文件 | 用途 |
| --- | --- |
| `original-desktop.json` | 必选 10 帧（含解码时点、hover、各 view） |
| `original-decode.json` | 字体就绪后重新触发 TextScramble，抓 5 帧解码序列 |
| `original-extras.json` | 顶栏括号 hover、证书大按钮 hover、视图交叉淡化、ARCHIVES、证书错误态、hover 重触发解码 |
| `original-mobile.json` | 375×812 移动端 3 帧 |

> 提示：同一站点重复采集时务必用 `--diag` 指定不同诊断文件，避免覆盖；截图输出目录同理。

### 2.2 `qa/validate_shots.py`

```
python qa/validate_shots.py qa/original --width 1440 --height 900 --json qa/validate-original.json
python qa/validate_shots.py qa/original-mobile --size 375x812 --json qa/validate-original-mobile.json
```

判定：可解码 PNG + 尺寸匹配 + 非空白（唯一色 >8、亮度标准差 ≥1、亮/暗像素占比达标）。结果文件：`qa/validate-original.json`、`qa/validate-original-mobile.json`。

### 2.3 `qa/make_baseline.py`

把多份 `_diagnostics.json` 合并为可 diff 的精简基准（保留布局矩形、计算样式、动画状态、字体、console/404；剔除随机的乱码 HTML）：

```
python qa/make_baseline.py --label original --out qa/baseline-original.json \
  --diag qa/original/_diagnostics.json --diag qa/original/_decode-diagnostics.json --diag qa/original/_extras-diagnostics.json
python qa/make_baseline.py --label original-mobile --out qa/baseline-original-mobile.json \
  --diag qa/original-mobile/_diagnostics.json
```

---

## 3. 截图清单

### 3.1 必选帧（桌面 1440×900，`qa/original/`）

时点均以 **load 事件** 为 t0（原站 DCL≈595–639ms / load≈814–905ms）；"实测 sinceLoad" 为探针采样时刻相对 load 的毫秒数。

| 文件 | 字节 | 名义时点 | 实测 sinceLoad | 状态摘要（取自探针） |
| --- | --- | --- | --- | --- |
| home-000ms.png | 93601 | load+0ms | +13ms | 解码进行中：brand 19 字符中 **8 个 #666 乱码 span**，文本 `MI}_D=AGO=C{F#// {#杯`；ENTER 4/5 字符乱码 |
| home-150ms.png | 95946 | load+150ms | +247ms | 解码完成：brand/ENTER 均无 #666 span，文本恢复 `MILKDRAGONCTF // 奶龙杯`、`ENTER` |
| home-600ms.png | 95946 | load+600ms | +766ms | 稳定态（与 150ms 帧一致） |
| home-1800ms.png | 95946 | load+1800ms | +2030ms | 稳定态 |
| home-hover-enter.png | 95698 | hover 后 400ms | +2520ms | ENTER：白底 `rgb(255,255,255)`、黑字、字距 20px、scale 1.05、辉光 `rgba(255,255,255,0.4) 0 0 50px` |
| data-2025.png | 95992 | 点 2025 后 900ms | +4292ms | data-view opacity=1；DETAIL 激活；5 行榜单已渲染 |
| tab-leaderboard.png | 116077 | 切 tab 后 700ms | +5137ms | LEADERBOARD 激活；表格 1160×444 @(200,303) |
| tab-sponsors.png | 117275 | 切 tab 后 700ms | +5982ms | SPONSORS 激活；7 张赞助卡（4 列网格） |
| sponsor-hover.png | 122474 | hover 后 600ms | +6683ms | 首卡 border `#fff`；`::after` opacity **0.15**，conic 渐变旋转中 |
| cert-view.png | 99732 | 点顶部 CERTIFICATE 后 700ms | +7570ms | cert-view opacity=1；**原站 bug：大标题 `CERTIFICATE ARCHIVE` 被清空**（`openCertView()` 在 view 尚未参与布局时读取 `title.innerText` 得到空串 → `setText('')`），仅副标题/年份按钮/表单可见；探针实测 `certTitle.text == ""` |

### 3.2 补充帧（桌面 1440×900，`qa/original/`）

| 文件 | 采集方式 | 观察要点 |
| --- | --- | --- |
| decode-000ms.png | 字体就绪后 `document.dispatchEvent(new Event('DOMContentLoaded'))` 重新触发解码 | 触发后 ~1ms：仍为最终文本（乱码尚未出现），说明首帧从原文起步 |
| decode-080ms.png | 同上，+156ms | brand 9 个 #666 span，文本 `—I>KDRA__N<TF{{_ ]龙杯`；ENTER 2 个 span |
| decode-200ms.png | 同上，+340ms | brand 仅剩 2 个 #666 span（`MILK#RAGONC!F // 奶龙杯`），ENTER 已收敛 |
| decode-400ms.png | 同上，+601ms | 全部收敛 |
| decode-800ms.png | 同上，+1050ms | 稳定 |
| header-hover-home.png | hover 顶栏 HOME | 文字 `#aaa→#fff`，`::before '['` / `::after ']'` opacity `0→1` |
| header-hover-certificate.png | hover 顶栏 CERTIFICATE | 同上（另一个按钮） |
| home-hover-cert-btn.png | hover 首页大号 CERTIFICATE 按钮 | 灰底 `rgb(170,170,170)`、黑字、字距 10→14px、辉光 `0 0 30px rgba(255,255,255,0.2)` |
| view-fade-1.png | `eval` 点击 2025 后立即截图 | 过渡启动初期，home-view 仍接近全不透明 |
| view-fade-2.png | 紧接上一张 | **交叉淡化实锤**：探针 home-view opacity **0.7407**、data-view opacity **0.2593**（两值互补，同一 0.3s 过渡） |
| tab-archives.png | 切 ARCHIVES 后 700ms | ARCHIVES 页布局（WRITEUPS / GITHUB 两个链接） |
| archives-hover-link.png | hover WRITEUPS | 背景微亮 + `padding-left 40px→50px` 位移 |
| cert-input-error.png | 空输入点 DOWNLOAD | `INPUT ERROR // 请输入队伍名称` |
| cert-notfound.png | 输入不存在队名点 DOWNLOAD | `NOT FOUND // 未查询到「不存在的队伍XYZ」在 所有年度 的证书` |
| home-hover-scramble-0ms.png | hover ENTER 后立即截图 | mouseenter **重新触发** TextScramble：ENTER 显示 `ENTE#`（1 个 #666 span）；hover 过渡刚开始（bg α=0.024、ls=15.11px、scale 1.0011） |
| home-hover-scramble-150ms.png | hover 后 +150ms | 文字已收敛为 ENTER；hover 过渡接近完成（bg α=0.984、ls=19.92px、scale 1.0492、辉光 49.2px） |

### 3.3 移动端（375×812，`qa/original-mobile/`）

| 文件 | 状态 |
| --- | --- |
| mobile-home.png | home-view 激活；顶栏仅 HOME/CERTIFICATE（品牌标题被 ≤480px 媒体查询隐藏） |
| mobile-data.png | 点击 2025 后 data-view；DETAIL 激活；榜单已渲染 |
| mobile-sponsors.png | 用 `eval` 切到 SPONSORS（原站移动端该 Tab 实际被裁剪，见 §6）；4 列网格降为单列 |

> 移动端补充帧为 task-4 移动端验收提供同尺寸对照；因尺寸与桌面不同，单独放 `qa/original-mobile/`，不混入 `qa/original/`。

---

## 4. 动效实测

### 4.1 TextScramble 文字解码（核心动效）

实现位置 `_recon/script.js` L25–77，字符集字符串值：`!<>-_\/[]{}—=+*^?#________`（源码 L28 写作 `'!<>-_\\/[]{}—=+*^?#________'`）。

参数（源码实测）：

- 每个字符独立随机：`start = rand(0..40)` 帧，`end = start + rand(0..40)` 帧，即最长约 80 帧；
- `frame >= end` 输出最终字符；`start <= frame < end` 输出乱码字符（**28% 概率每帧刷新**，否则沿用上一乱码字符）；
- 乱码字符渲染为 `<span style="color: #666">`，即灰色 #666；
- 触发点：① 页面 DOMContentLoaded 时品牌标题与 ENTER 按钮；② ENTER `mouseenter` 重新触发；③ 切换年份后当前 Tab 标题；④ 切换 Tab 时该 Tab 的 `section-title`；⑤ 打开证书页时 `CERTIFICATE ARCHIVE` 标题（**原站此处有 bug，标题实际被清空，详见 §6 第 9 条**）。

实测时间线（decode 序列，字体已就绪后重新触发）：

| 触发后 | #666 乱码 span（brand / ENTER） | 观察 |
| --- | --- | --- |
| +1ms | 0 / 0 | 首帧仍是原文（第 0 帧只有 start=0 的字符会变乱码） |
| +156ms | **9 / 2** | 乱码最密集期；文本如 `—I>KDRA__N<TF{{_ ]龙杯` |
| +340ms | 2 / 0 | 大部分字符已收敛；`MILK#RAGONC!F // 奶龙杯` |
| +601ms | 0 / 0 | 全部收敛 |
| +1050ms | 0 / 0 | 稳定 |

另一轮首屏采集（load 锚点）：load+13ms（≈DCL+279ms）时 brand 仍有 8 个 #666 span，load+247ms（≈DCL+513ms）已收敛。

**观感与节奏**：字符按随机顺序逐个"锁定"，不是从左到右匀速推进；乱码期字符为灰色、随机符号，正文为白色，因此视觉上呈现"灰白混杂闪烁 → 逐渐变白"的终端解码感；字体等宽，解码过程文本宽度稳定、无抖动/位移。中文（奶龙杯）同样参与乱码替换（随机 ASCII 符号）再还原。

> 时间说明：本次为 headless 环境（rAF 帧率与真实 60Hz 显示器不同，实测解码在触发后约 0.34–0.6s 内收敛）；按源码 80 帧上限估算，真实 60Hz 显示器约为 1.0–1.3s。**复刻站对比必须使用同一 headless 环境采集**，比较的是"存在乱码期→收敛"的结构与观感，而不是绝对墙钟时间。

### 4.2 视图切换（home / data / cert）

CSS（`_recon/styles.css` L152–166）：

```css
.view { position:absolute; inset:0; visibility:hidden; opacity:0;
        transition: opacity 0.3s cubic-bezier(0.4,0,0.2,1), visibility 0.3s cubic-bezier(0.4,0,0.2,1); }
.view.active { visibility:visible; opacity:1; }
```

- 三个 view 绝对定位叠层、**交叉淡入淡出 0.3s**，无位移/缩放；
- `#home-view` 额外有 `top:-60px; height:100vh; z-index:50`，激活前 `pointer-events:none`，因此 home→data 时 home 在上层淡出、data 在下层淡入；
- 实测 view-fade-2：home opacity **0.740697** / data opacity **0.259303**（互补），与 0.3s 同曲线的中间帧吻合；
- 切换逻辑：`switchYear()` 移除全部 `.view.active` 后给 data-view 加 active；`closeView()` 回 home；`openCertView()` 进证书页。

### 4.3 ENTER 主按钮 hover（反色 + 字距扩展 + 缩放 + 辉光）

基线（实测计算样式）：`font-size 48px / weight 900 / letter-spacing 15px / padding 20px 80px / border 2px solid #fff / min-width 400px / 尺寸 400×98 @(580,355) / clip-path: polygon(20px 0%, 100% 0%, calc(100% - 20px) 100%, 0% 100%)`，斜切角 20px，`transition: all .3s cubic-bezier(0.4,0,0.2,1)`。

hover 实测渐变（同一 `transition: all .3s`）：

| hover 后 | background | color | letter-spacing | transform | box-shadow |
| --- | --- | --- | --- | --- | --- |
| ~30ms | `rgba(255,255,255,0.024)` | `rgb(249,249,249)` | 15.11px | scale 1.0011 | `rgba(255,255,255,0.008) 0 0 1.1px` |
| ~180ms | `rgba(255,255,255,0.984)` | `rgb(4,4,4)` | 19.92px | scale 1.0492 | `rgba(255,255,255,0.392) 0 0 49.2px` |
| 400ms | `rgb(255,255,255)` | `rgb(0,0,0)` | **20px** | **scale 1.05** | **`rgba(255,255,255,0.4) 0 0 50px`** |

→ 白底黑字反色 + 字距 15→20px + 整体放大 5% + 白色辉光，约 300ms 完成；同时 `mouseenter` 会**重新触发一次 TextScramble**（实测 hover 后立即出现 `ENTE#`，约 150–200ms 后收敛）。

### 4.4 CERTIFICATE hover（大按钮 + 顶栏括号）

- **首页大按钮**（605×64 @(477,481)）：基线透明底/#aaa 文字/2px #aaa 边框/字距 10px/`font-size 22.4px`；hover 实测 `background rgb(170,170,170)`、`color rgb(0,0,0)`、字距 **14px**、`box-shadow 0 0 30px rgba(255,255,255,0.2)`，0.3s 过渡。
- **顶栏 HOME / CERTIFICATE**：基线 `color #aaa`、`letter-spacing 4px`、`padding 10px 0`；hover 实测文字变 `#fff`，`::before` content `[`、`::after` content `]`（各 `margin 0 8px`）opacity **0→1**，0.3s。
- 两处按钮 hover 时都**没有**背景填充（除大按钮的灰底反色），以文字色/字距/辉光为主。

### 4.5 年份切换与 Tab 切换

- 侧栏年份 `.year-item`：`font-size 17.6px / letter-spacing 2px / padding 25px 0 / color #aaa`；hover/active 变白并加 `background rgba(255,255,255,0.05)`；active 追加 **`border-right: 2px solid #fff`**（侧栏宽 120px）。
- 点击年份：data-view 0.3s 淡入；当前 Tab 标题重新解码（DETAIL 标题由 `2025 DETAIL` 触发 TextScramble）。
- Tab `.tab-btn`：`font-size 16px / letter-spacing 3px / color #aaa`，active 变 `#fff` 并显示 `::after` **1px 白色下划线**（`bottom:-5px; width:100%`）；tab 内容 `display:none ↔ display:block` 瞬时切换，不做淡入；切换时该 section 标题重新解码。
- 实测切换流畅：点击 → 700ms 后标题已收敛、表格/卡片已就绪（见 tab-leaderboard / tab-sponsors 帧）。

### 4.6 赞助卡片旋转描边

CSS（`_recon/styles.css` L345–386）：

```css
.sponsor-card { height:120px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.1);
                font-size:17.6px; letter-spacing:4px; transition:.3s cubic-bezier(.4,0,.2,1); position:relative; overflow:hidden; }
.sponsor-card:hover { border-color:#fff; }
.sponsor-card::after { content:''; position:absolute; top:-50%; left:-50%; width:200%; height:200%;
                       background:conic-gradient(transparent,transparent,transparent,#fff);
                       animation:rotateBorder 4s linear infinite; opacity:0; transition:opacity .3s; }
.sponsor-card:hover::after { opacity:.15; }
@keyframes rotateBorder { from{transform:rotate(0)} to{transform:rotate(360deg)} }
```

实测：网格首卡 **268×120 @(200,303)**，4 列；非 hover 时 `::after` opacity=0（但 animation 已在跑，实测 transform 为约 63.5° 的旋转矩阵）；hover 600ms 后 `::after` **opacity 0.15**、旋转矩阵约 126.5°，border 变纯白——呈现缓慢旋转的浅色扫光描边，4s/圈。

### 4.7 玻璃拟态 / 链接 hover

- 玻璃卡片：`background rgba(255,255,255,0.03)` + `border rgba(255,255,255,0.1)`；`.info-card` 另有 `backdrop-filter: blur(10px)`。
- ARCHIVES 链接 `.minimal-link`：hover 时背景微亮、`padding-left 40px→50px`（文字右移 10px），过渡 0.3s。
- 页面无滚动条（`--hide-scrollbars` 采集；桌面内容均在首屏内）。

### 4.8 布局与字体基准数据（供复刻逐项比对）

| 元素 | 实测值 |
| --- | --- |
| 页面底色 / 主文字 / 次文字 | `#000` / `#fff` / `rgb(170,170,170)`；边框 `rgba(255,255,255,0.1)`；玻璃底 `rgba(255,255,255,0.03)` |
| body 字体 | `"Share Tech Mono", "Noto Sans SC", sans-serif`，16px |
| 已加载字体 | **Share Tech Mono 400**、Noto Sans SC 400、Noto Sans SC 700（`document.fonts.status=loaded`） |
| global-header | 1440×60，`padding 0 30px`，玻璃底 + 1px 下边框 |
| 品牌标题 | 314×28 @(1096,16)，19.2px / ls 4px / weight 700 / 白色 / uppercase |
| 侧栏 | 120×840 @(0,60)，右边框 1px |
| content-area | 1320×840 @(120,60) |
| tab-nav | 1320×79 @(120,60)，`padding 30px 60px`，`gap 40px`，1px 下边框 |
| panel-container | 1320×761 @(120,139)，`padding 60px 80px` |
| section-title | 48px / ls 6px / weight 700，位于 @(200,199) |
| ENTER 按钮 | 400×98 @(580,355)（见 §4.3） |
| CERTIFICATE 大按钮 | 605×64 @(477,481)（见 §4.4） |
| 四角装饰文字 | 14px 高：`(180,40)` `(1176,40)` `(180,846)` `(1109,846)`，`opacity .4`，`font-size 0.75rem` |
| 中间装饰线 | 1320×1 @(120,450)，横向渐变透明→边框色→透明，opacity .2 |
| info-card 正文 | 20.8px / line-height 41.6px / 颜色 #aaa / max-width 900px |
| 榜单表格 | 1160×444 @(200,303)；th 内边距 25px、0.9rem、#aaa |
| 赞助卡 | 268×120 @(200,303)，4 列；行高 120px |
| 证书页 cert-inner | 1000 宽居中（x=280），y≈287–292；输入框 725×52 @(320,512)；DOWNLOAD 175×52 @(1065,512) |
| 证书年份按钮 | `ALL // 全部年份`（active）+ `2026` |

### 4.9 控制台与网络（原站）

- `Runtime.exceptionThrown`：0；
- `Runtime.consoleAPICalled`（error/assert）：0；
- `Log.entryAdded` error：0；
- HTTP ≥400：**仅 `https://www.ctf.vin/favicon.ico` → 404**（Chrome 默认请求，原站未提供 favicon；每批次各出现 1 次，非页面资源缺陷）；
- 失败请求（Network.loadingFailed，非 canceled）：0；
- 字体来自 Google Fonts 外链：首屏 DCL 595–639ms / load 814–905ms（桌面 3 次）、移动 645/1196ms——耗时随网络波动。

---

## 5. 移动端 375×812 实测与已知缺陷

| 项 | 实测值 / 现象 |
| --- | --- |
| 视口 | innerWidth 375 / innerHeight 812 / DPR 1 |
| global-header | 375×60；≤480px 媒体查询下品牌标题 `display:none`（移动端无品牌文字） |
| 顶栏按钮 | HOME / CERTIFICATE，`.home-icon-btn` 在 ≤480px 为 0.75rem / ls 2px |
| 侧栏 | 仍固定 120px 宽（≤768px 仅在证书页通过 `:has()` 隐藏） |
| content-area | 255px 宽（375-120） |
| tab-nav | 可视宽 255px，但 4 个 Tab 实际总宽 >255px，被 `content-area {overflow:hidden}` **裁剪**，无横向滚动容器 |
| ENTER 按钮 | 媒体查询 992px 下 `font-size: 4rem(64px)`、`min-width:400px` + padding → **实测 412×116 @(42,308)，右边缘 454 > 375，被裁掉右侧** |
| CERTIFICATE 大按钮 | 322×52 @(87,452)（≤768px 缩小 padding/字距后基本可容纳） |
| section-title | ≤992px 变 32px，255px 宽下换行（如 `2025` / `DETAIL` 两行） |
| panel-container | ≤992px padding 40px，可视内容宽 175px |

**结论**：原站移动端存在两处自身布局缺陷——① SPONSORS / ARCHIVES Tab 在 375px 下溢出且无法通过触摸切换；② 首页 ENTER 按钮超出视口被裁剪。复刻站沿用原 CSS 会自然复现同样表现，**task-4 不应把这些原站缺陷计为复刻缺陷**；若 Lead 选择修复，应作为"相对原站的改进项"单列并知会验收。

---

## 6. 异常、限制与风险

| # | 现象 | 级别 | 说明 / 处理 |
| --- | --- | --- | --- |
| 1 | `favicon.ico` 404 | Info | 原站自身未提供 favicon；仅此一个 404。复刻站若带本地 favicon，属改进，不算不一致 |
| 2 | Google Fonts 外链依赖网络 | 已知依赖 | 首屏 load 814–1196ms 受网络影响；离线/`file://` 下会回退字体 → 复刻站使用自托管字体（asset-prep 的 `assets/fonts/fonts.css`）是必要改进，验收字体时以自托管为准 |
| 3 | headless rAF 帧率影响 TextScramble 墙钟时长 | 采集条件 | 同一 headless 环境内复刻站与原站可比；不要直接拿本次 0.6s 当真实显示器时长 |
| 4 | 乱码内容每次随机 | 正常随机 | 对比解码帧时**不要比对文本内容/像素**，应比对结构（是否存在 #666 span、是否收敛、触发时机） |
| 5 | 品牌/文案被复刻为"广工杯 / GDUTCTF" | 预期差异 | 文案长度变化会影响解码字符数与布局宽度；验收阈值应允许文案差异，但字号/字距/位置/动效结构必须一致 |
| 6 | 移动端原站布局缺陷 | 原站问题 | 见 §5，不算复刻缺陷 |
| 7 | Chrome 版本差异 | 低 | 不同大版本字体栅格化/backdrop-filter 可能有 1–2px 级差异；建议 task-4 用同一 Chrome 与同一 `shoot.mjs` 采集 |
| 8 | `resize`/窗口相关：`#home-view height:100vh`、`#app-container height:calc(100vh - 60px)` | 信息 | 采集视口须严格 1440×900 / 375×812，否则 ENTER 垂直位置会变 |
| 9 | **原站证书页大标题 `CERTIFICATE ARCHIVE` 空白** | 原站缺陷（复刻站已修） | `openCertView()` 先 `classList.add('active')`、随后立刻读 `title.innerText`，此时元素尚未参与布局 → innerText 为空串 → `setText('')` 把标题永久清空（qa/original/cert-view.png 与探针 `certTitle.text==""` 均可复现）。复刻站改为 `baseText()` 缓存原文 + `scrambleEl()` 解码，属有意修复，task-4 验收中判 PASS |

---

## 7. 复现命令

```bash
# 必选 10 帧（桌面）
node qa/shoot.mjs --url https://www.ctf.vin/ --out qa/original \
  --steps qa/steps/original-desktop.json --label original-desktop

# 解码序列 5 帧
node qa/shoot.mjs --url https://www.ctf.vin/ --out qa/original \
  --steps qa/steps/original-decode.json --diag qa/original/_decode-diagnostics.json --label original-decode

# 补充 11 帧（顶栏括号/证书大按钮 hover、视图淡化、ARCHIVES、证书错误态、hover 重解码）
node qa/shoot.mjs --url https://www.ctf.vin/ --out qa/original \
  --steps qa/steps/original-extras.json --diag qa/original/_extras-diagnostics.json --label original-extras

# 移动端 3 帧
node qa/shoot.mjs --url https://www.ctf.vin/ --out qa/original-mobile \
  --steps qa/steps/original-mobile.json --label original-mobile

# 校验
python qa/validate_shots.py qa/original --width 1440 --height 900 --json qa/validate-original.json
python qa/validate_shots.py qa/original-mobile --size 375x812 --json qa/validate-original-mobile.json

# 生成基准
python qa/make_baseline.py --label original --out qa/baseline-original.json \
  --diag qa/original/_diagnostics.json --diag qa/original/_decode-diagnostics.json --diag qa/original/_extras-diagnostics.json
python qa/make_baseline.py --label original-mobile --out qa/baseline-original-mobile.json \
  --diag qa/original-mobile/_diagnostics.json
```

---

## 8. 给 task-4（复刻站验收）的使用建议

1. **同一工具、同一环境**：用 `qa/shoot.mjs` 对复刻站（`python -m http.server 8801` → `http://127.0.0.1:8801/index.html`）重跑**同一份 steps 文件**，输出到 `qa/clone/`；移动端单独 `qa/clone-mobile/`。
2. **结构对比优先**：`qa/baseline-original.json` 与复刻站 baseline 的 `shots[*].probe` 可直接逐字段 diff；重点字段：`rects`（±2px 容差）、`styles`（字体族/字号/字距/颜色/clip-path 完全一致）、`views`（opacity/visibility）、`scramble.greySpans`（0→乱码→0 的节奏）、`sponsorFirst.after.opacity`（hover=0.15）、`headerBtns.before/after.opacity`（hover=1）。
3. **文案差异豁免**：复刻站品牌改为"广工杯 / GDUTCTF"，解码字符数/文本内容必然不同；只校验"乱码期存在→最终文案收敛"。
4. **状态覆盖**：必选 10 状态 + 补充状态（视图中间帧、顶栏括号、证书大按钮 hover、hover 重解码、证书错误态）建议全部比对；移动端至少 home/data 两态。
5. **控制台门槛**：复刻站应 0 JS 异常、0 console error；资源 404 为 0（自托管字体/favicon 下不应出现外链 404）。`_diagnostics.json` 已自动记录，直接引用。
6. **产物命名**：与 `qa/original/` 同名，便于并排看图（`qa/clone/home-000ms.png` ↔ `qa/original/home-000ms.png`）。

---

## 9. 产物索引

| 路径 | 说明 |
| --- | --- |
| `qa/shoot.mjs` | CDP 截图工具（可复用于 task-4 及后续回归） |
| `qa/validate_shots.py` | Pillow 尺寸/非空白校验 |
| `qa/make_baseline.py` | 诊断 → 精简基准 JSON |
| `qa/steps/original-desktop.json` | 必选 10 帧步骤 |
| `qa/steps/original-decode.json` | 解码序列步骤 |
| `qa/steps/original-extras.json` | 补充状态步骤 |
| `qa/steps/original-mobile.json` | 移动端步骤 |
| `qa/original/*.png` | 26 张桌面参考帧（1440×900） |
| `qa/original-mobile/*.png` | 3 张移动参考帧（375×812） |
| `qa/original/_diagnostics.json` | 主批次完整探针与 console/网络诊断 |
| `qa/original/_decode-diagnostics.json` | 解码序列批次诊断 |
| `qa/original/_extras-diagnostics.json` | 补充状态批次诊断 |
| `qa/original-mobile/_diagnostics.json` | 移动批次诊断 |
| `qa/validate-original.json` / `qa/validate-original-mobile.json` | Pillow 校验明细（29/29 PASS） |
| `qa/baseline-original.json` / `qa/baseline-original-mobile.json` | 数值基准 |
