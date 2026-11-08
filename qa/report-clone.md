# 复刻站验收报告（task-4）

- 负责人：motion-qa ｜ 任务板：task-4 ｜ 验收时间：2026-11-08 14:23–14:45（Asia/Shanghai）
- 被测对象：**「广工杯」复刻站**（工作区根目录 `index.html` / `styles.css` / `script.js` / `assets/`）
  - HTTP 方式：`python -m http.server 8801` → `http://127.0.0.1:8801/index.html`
  - file:// 方式：`file:///C:/Users/HACKED/Desktop/%E5%B9%BF%E5%B7%A5%E6%9D%AF/index.html`
- 参考基准：原站 <https://www.ctf.vin/> 参考帧 `qa/original/`（26 张 1440×900）与 `qa/original-mobile/`（3 张 375×812），见 `qa/report-original.md`
- 采集工具：`qa/shoot.mjs`（零依赖 CDP）；比对工具：`qa/compare_clone.py` → `qa/compare-report.json`
- 验收代码版本：包含 Lead 在验收期间的 3 处更新（证书标题 bug 修复 `baseText()/scrambleEl()`、`certFileName()` 两位补零、`enterUrl` 占位不跳转）

## 结论

**✅ 建议通过验收。** 自动化比对结果：**52 PASS / 13 INFO / 0 MINOR / 0 MAJOR / 0 BLOCKER**；41 张截图全部通过 Pillow 尺寸+非空白校验；必选 10 帧齐全；8 个采集批次 **0 JS 异常、0 console error、0 HTTP≥400、0 失败请求**。

| # | 验收项（task-4） | 结果 | 关键证据 |
| --- | --- | --- | --- |
| 1 | 字体：Share Tech Mono 真实生效、中文回退正常 | **PASS** | `document.fonts.check=true`；测试串 1242px（真实字体）vs 1150px（monospace 回退）；拉丁区域与原站逐像素一致 |
| 2 | 布局：header 60 / 侧栏 120 / ENTER 尺寸斜切 / 四角装饰 / section 标题 3rem | **PASS** | 15 帧 × 13 个关键元素矩形全部 ±2px；首页静止态整帧掩码 diff **0/1,186,750 像素** |
| 3 | TextScramble：乱码→收敛、乱码 #666 | **PASS** | 同锚点解码序列 原站/复刻站 grey span：0ms 0/2、80ms 9/7、200ms 2/0、400ms 0/0、800ms 0/0 |
| 4 | 视图/Tab 切换动效 + hover 态 | **PASS** | 交叉淡化中间帧两视图同现（0.785/0.215）；ENTER hover 逐字段一致；CERT hover 一致；顶栏括号；赞助卡旋转描边 |
| 5 | 交互：切年份标题、证书查询、证书页布局 | **PASS** | 2025 DETAIL / 2026 DETAIL 正确；空输入/未找到提示与原站一致；FOUND 命中 8 张演示证书；证书页标题修复后布局正常 |
| 6 | 控制台：JS 报错 / 404 | **PASS** | 8 批次 0 异常、0 console error、0 404（favicon 200、字体 200、证书图 HEAD 200） |
| 7 | file:// 直开（字体/脚本/图片） | **PASS** | base64 字体在 file:// 下 `check=true`；4 张 file:// 截图与 http:// 同帧**逐像素 0 差异** |
| 8 | 原站 bug 修复（证书页标题空白） | **PASS（有意修复）** | 复刻站 150ms 出现 11 个 #666 乱码 span、收敛后显示 `CERTIFICATE ARCHIVE`；原站该标题为空 |
| 9 | 移动端 375×812 响应式 | **PASS** | header 60 / sidebar 120 / tabNav 255 / ENTER 412×116@(42,308) 等与原站完全一致；原站溢出缺陷按原 CSS 保留 |
| 10 | 已知有意差异核对（品牌/年份/数据/favicon/移动端） | **PASS** | 逐项实测与 Lead 清单一致，无超范围差异 |

---

## 1. 交付物与证据索引

| 路径 | 说明 |
| --- | --- |
| `qa/clone/` | **27 张**复刻站 1440×900 截图：必选 10 帧 + 解码序列 5 + 补充 11 + `home-final.png` |
| `qa/clone-mobile/` | **3 张** 375×812 移动端截图（home / data / sponsors） |
| `qa/clone-file/` | **4 张** file:// 直开截图（home / data / sponsors / cert） |
| `qa/clone-extra/` | **7 张**专项截图：证书标题解码、FOUND、2025/2026 切换、2026 筛选 |
| `qa/clone/_diagnostics.json` 等 8 份 | 每帧 DOM 探针（布局/计算样式/动画状态）+ console/异常/网络诊断 |
| `qa/baseline-clone.json` / `baseline-clone-mobile.json` | 复刻站数值基准（与 `baseline-original.json` 同结构） |
| `qa/compare-report.json` | **逐项检查结果**（52 PASS / 13 INFO / 0 缺陷，含每项证据与实测值） |
| `qa/compare_clone.py` | 比对脚本（可复跑） |
| `docs/screenshot-home.png` | 取自 `qa/clone/home-final.png`（1440×900、完全静止、无 hover、字体已加载），供 README 引用 |
| `qa/validate-clone*.json` | Pillow 校验明细：27/27、3/3、4/4、7/7 全 PASS |

**必选 10 帧同名截图齐全**：`home-000ms` / `home-150ms` / `home-600ms` / `home-1800ms` / `home-hover-enter` / `data-2025` / `tab-leaderboard` / `tab-sponsors` / `sponsor-hover` / `cert-view`（`qa/clone/`，均 1440×900）。

---

## 2. 详细验收

### 2.1 字体（任务项 1）—— PASS

| 检查 | 实测 |
| --- | --- |
| Share Tech Mono 是否加载 | `document.fonts.check('16px "Share Tech Mono"')` = **true**；`FontFace` 状态 `Share Tech Mono / 400 / loaded` |
| 是否真实生效（非回退） | 100px 测试串真实字体宽度 **1242px**，monospace 回退 **1150px**（不相等 → 确实使用自托管字体） |
| 字体来源 | `assets/fonts/fonts.css` 内 base64 `data:font/woff2`，无任何外网字体请求 |
| file:// 直开 | `shareCheck=true`，fonts status=loaded，无 CORS 报错 |
| 中文回退 | 复刻站未引入中文字体外链，回退系统 CJK 字体；含中文的 CERTIFICATE 大按钮区域与原站**逐像素一致**（>4 差异像素 **0** 个） |
| 字形像素比对 | ENTER / CERTIFICATE / 顶栏 / Tab / LEADERBOARD 标题等拉丁文字区域与原站 **0%** 差异像素（>8） |

> 说明：原站通过 Google Fonts 声明了 Noto Sans SC，但实测其 CJK 字形在两边渲染结果相同（均落到系统 CJK 字体），因此中文观感无差异。复刻站 `body` 字体栈仅在中文字体族末尾追加了显式系统回退（`Microsoft YaHei` 等），前两族与原站一致。

### 2.2 布局（任务项 2）—— PASS

15 个状态帧 × 13 个关键元素矩形与 `baseline-original.json` 逐一比对，**全部在 ±2px 内**：

| 元素 | 实测（与原站一致） |
| --- | --- |
| global-header | 1440×60 @(0,0)；`padding 0 30px`，玻璃底 + 1px 下边框 |
| 侧栏 | 120×840 @(0,60) |
| content-area / tab-nav / panel | 1320×840；tab-nav 79 高；panel 1320×761 @(120,139)（`padding 60px 80px`） |
| ENTER 按钮 | **400×98 @(580,355)**，`font 48px/900`、`letter-spacing 15px`、`padding 20px 80px`、2px 白边、`min-width 400px`、`clip-path: polygon(20px 0%, 100% 0%, calc(100% - 20px) 100%, 0% 100%)` |
| CERTIFICATE 大按钮 | 605×64 @(477,481) |
| section-title | 48px / 字距 6px / weight 700，@(200,199) |
| 四角装饰文字 | (180,40)/(1176,40)/(180,846)/(1109,846)，14px 高（文字内容按约定改为 GDUT 版本） |
| 中间装饰线 | 1320×1 @(120,450) |
| 证书页 | cert-inner 1000 宽居中 x=280；输入框 725×52；DOWNLOAD 175×52（x/宽一致，y 因标题修复 +27px，见 2.8） |

**整帧像素证明**：首页静止态（掩掉品牌/装饰文字/年份列表等约定差异区）比较 1,186,750 像素，>8 差异像素 **0 个（0.00000%）** → 布局、按钮、分割线与原站逐像素一致。

仅有的 2 类差异均记录为 INFO（非缺陷）：

1. `tab-leaderboard` 表格总高 444→432px（**-12px**）：原站部分中文队名行行高 79px、拉丁队名行 73px；复刻站演示数据队名全拉丁 → 全 73px。字体/样式/表头完全一致，属内容驱动（`table-layout:auto` 列宽随内容变化，表头文字位置偏移为同类原因）。
2. 证书页整体高 +54px、垂直居中位移 27px：证书页标题 bug 修复后标题恢复显示所致（有意修复，见 2.8）。

移动端（375×812）关键元素矩形与原站逐一一致：header 60 / sidebar 120 / tabNav 255 宽 / ENTER 412×116 @(42,308) / panel 255 宽 / section-title 换行行为一致。**原站移动端 tab 溢出被裁剪、ENTER 超出视口被裁的现象在复刻站完全一致地保留**（按原 CSS 复刻，符合约定）。

### 2.3 TextScramble 文字解码（任务项 3）—— PASS

在字体就绪后以 `DOMContentLoaded` 重新触发（与原站同锚点），brand 乱码 span（灰色 #666）数量：

| 触发后 | 原站 | 复刻站 |
| --- | --- | --- |
| ~1ms | 0 | 2（随机 start=0 的字符） |
| ~155ms | 9 | 7 |
| ~340ms | 2 | 0 |
| ~600ms | 0（收敛） | 0（收敛） |
| ~1050ms | 0 | 0 |

- 两边均呈现「乱码期 → 约 0.6s 内收敛为最终文案」，且**所有乱码 span 的 computed color 均为 `rgb(102,102,102)`（#666）**（探针 `greySpans == spans` 恒成立）。
- 首屏帧（load 锚点）：复刻站 `home-150ms` 抓到 **8 个 #666 乱码 span**（文本如 `?工U>CTF]_+_广+=`），`home-600ms` / `home-1800ms` 已收敛为 `GDUTCTF // 广工杯`。
  > 原站 `home-000ms` 已有乱码而复刻站为解码前原文本，是因为原站 load 事件被 Google Fonts 拖到 DCL+266ms、复刻站仅 DCL+6ms —— 同名帧落在不同解码阶段，属采集锚点差异，不是行为差异；节奏对比以同一锚点的 decode 序列为准。
- ENTER hover **每次都会重新触发解码**：hover 后立即截图出现 **2 个 #666 乱码 span**（如 `]\nNTE\n]`），150ms 后收敛为 `ENTER`。

### 2.4 视图切换 / Tab / hover 动效（任务项 4）—— PASS

| 动效 | 复刻站实测 | 判定 |
| --- | --- | --- |
| 视图交叉淡化（0.3s cubic-bezier(0.4,0,0.2,1)） | 中间帧 home opacity **0.785** / data **0.215**，两视图同时 `visibility:visible`（原站同帧 0.7025/0.2975，采样时刻略异，曲线互补） | PASS |
| ENTER hover 终态 | `background rgb(255,255,255)`、`color rgb(0,0,0)`、`letter-spacing 20px`、`matrix(1.05,0,0,1.05,0,0)`、`box-shadow rgba(255,255,255,0.4) 0 0 50px` —— 与原站逐字段一致 | PASS |
| ENTER hover 过渡（0.3s） | 中间帧与原站差值：~30ms 字距 Δ0.06px / scale Δ0.0005；~180ms 字距 Δ0.08px / scale Δ0.0008；hover 区域像素 0% 差异 | PASS |
| CERTIFICATE 大按钮 hover | 灰底 `rgb(170,170,170)` + 黑字 + 字距 10→**14px** + `0 0 30px rgba(255,255,255,0.2)` 辉光，与原站一致 | PASS |
| 顶栏 HOME/CERTIFICATE hover 括号 | hover 项 `color #fff`、`::before '['` / `::after ']'` opacity **0→1**；未 hover 项保持 0 | PASS |
| Tab 切换 | active 白色 + `::after` 1px 下划线；标题重新 TextScramble（LEADERBOARD / SPONSORS 状态正确） | PASS |
| 赞助卡片旋转描边 | hover 后 `border rgb(255,255,255)`、`::after opacity 0.15`、`animation: 4s linear infinite rotateBorder`、`conic-gradient(...,#fff)`；非 hover opacity 0；卡片边框区域像素 0% 差异 | PASS |
| 年份 active | 侧栏 2025/2026 切换后 active 白字 + 右侧 2px 白边框、背景微亮 | PASS |

### 2.5 交互（任务项 5）—— PASS

| 交互 | 实测 |
| --- | --- |
| 切年份 + DETAIL 标题解码 | 点 2025 → `2025 DETAIL`（5 行榜单、2025 简介）；点 2026 → `2026 DETAIL`（5 行、2026 简介）；标题均重新解码 |
| 证书查询空输入 | `INPUT ERROR // 请输入队伍名称`（与原站文案一致） |
| 证书未找到 | `NOT FOUND // 未查询到「不存在的队伍XYZ」在 所有年度 的证书`（与原站一致） |
| 证书 FOUND | 输入 `nullbyte` → `FOUND // nullbyte · 2026 · RANK 01 · 一等奖 — 证书已开始下载`；HEAD 探测 `assets/certs/广工杯2026_rk01_nullbyte.png` **200**，无 404 |
| 年份筛选 + FOUND | 选 `2026` 后查 `KernelPanic` → `FOUND // KernelPanic · 2026 · RANK 06 · 三等奖 — 证书已开始下载` |
| 证书页布局 | 标题、副标题、年份按钮（ALL // 全部年份、2026）、输入框、DOWNLOAD 均正常（布局按修复后预期，见 2.8） |
| ENTER 占位链接 | `href="#"`、`target="_blank"`；点击后 `location.href` 保持不变（`preventDefault` 生效，无外链跳转） |

### 2.6 控制台与网络（任务项 6）—— PASS

采集批次：主流程 / 解码 / 补充状态 / 字体探针 / 移动端 / file:// / 证书专项 / ENTER 链接，共 **8 个批次**：

- `Runtime.exceptionThrown`：**0**
- `Runtime.consoleAPICalled`（error/assert）：**0**
- `Log.entryAdded` error：**0**
- HTTP ≥ 400：**0**（原站的 `favicon.ico` 404 已被 `assets/favicon.svg` 修复；自托管字体 200；`assets/certs` 证书图 HEAD 探测 200）
- 失败请求（loadingFailed，非 canceled）：**0**

### 2.7 file:// 直开 —— PASS

| 检查 | 结果 |
| --- | --- |
| 字体（base64 data URI） | `document.fonts.check('16px "Share Tech Mono"')` = true，`status=loaded`，无 CORS 报错 |
| 脚本 / 样式表 | 全部 `file://` 本地加载成功（script.js、styles.css、fonts.css、favicon.svg） |
| 页面渲染 | 4 张 file:// 截图与 http:// 同状态帧**逐像素 0 差异**（首页/数据页/赞助页整帧 0；证书页掩掉顶栏 hover 差异后 0/1,275,600 px） |

### 2.8 原站 bug 修复（有意差异，判 PASS）—— 重点核对项

**原站 bug**：`openCertView()` 先给 `.view` 加 `active`，紧接着读取 `title.innerText` —— 此时元素尚未参与布局，`innerText` 返回空串 → `setText("")` 把 `CERTIFICATE ARCHIVE` 标题**永久清空**。原站参考帧 `qa/original/cert-view.png` 中该标题确实空白（探针 `certTitle.text == ""`，已在 `qa/report-original.md` §6 记录）。

**复刻站修复验证**（Lead 更新 1：`baseText()` 缓存原文 + `scrambleEl()` 解码）：

| 时点 | 实测 |
| --- | --- |
| 打开证书页首帧 | 标题区空帧（1 帧，此时视图正在淡入，不可见） |
| +150ms | **11 个 #666 乱码 span**（如 `]ERTI+[[>]E \RC__**`）→ 正常解码动画 |
| 收敛后 | 显示 **`CERTIFICATE ARCHIVE`**（`cert-view.png`、`cert-found.png` 等均可见） |

该修复使证书页内容整体高 +54px、垂直居中位移 27px（表单 x/宽不变），属**有意差异**，不计缺陷。

---

## 3. 已知有意差异核对（Lead 清单）

| # | 约定差异 | 实测 | 判定 |
| --- | --- | --- | --- |
| 1 | 品牌 MilkDragonCTF/奶龙杯 → GDUTCTF/广工杯；四角装饰改为 GDUT 版本 | brand 收敛为 `GDUTCTF // 广工杯`，右对齐 @(1182,16)；装饰文字 `SYSTEM_VERSION: GDUT_CTF_v1.0` / `NODE_STATUS: STABLE [OK]` / `LAT: 23.0444 \| LON: 113.3918` / `GDUT_SAFE_LAB // ARCHIVE_INIT` | PASS（有意） |
| 2 | 侧栏 2026 + 2025 两个年份；榜单/赞助/简介为演示数据 | `yearItems = ['2026','2025']`，两套数据切换正常；赞助 5 家、榜单 5 行（网格几何与原站一致） | PASS（有意，INFO） |
| 3 | 补 `assets/favicon.svg`，不应有 favicon 404 | favicon 请求 **200**，8 批次 0 个 404 | PASS（有意） |
| 4 | 移动端 tab 溢出/ENTER 超宽保持原样 | 与原站一致：tabNav 可视宽 255px 裁剪、ENTER 412px 被裁 | PASS（有意保留） |
| 5 | 原站证书标题 bug 修复 | 标题恢复显示并解码（见 2.8） | PASS（有意修复） |
| 6 | `certFileName()` 两位补零 | `assets/certs/` 8 张均为 `广工杯2026_rk0X_<队名>.png`；FOUND 流程 HEAD 200 命中 | PASS（有意） |
| 7 | `CONFIG.enterUrl` 占位 `"#"` 不跳转 | 运行时点击后 URL 不变；原站为真实外链 | PASS（有意） |

---

## 4. INFO 清单（13 项，均为内容驱动或有意修复，不计缺陷）

1. 表格总高 -12px（演示数据队名全拉丁 vs 原站含中文队名行，CJK 行高差）—— B 布局
2. 表格表头列宽/文字位置偏移（`table-layout:auto` 随演示数据内容变化；字体/样式/表头一致；像素差 1.227%）
3–11. 证书页 3 帧 × 3 元素（certInner / certInput / certDownloadBtn）的 +54px / +27px 位移 —— 原站 bug 修复导致（x/宽不变）
12. 演示数据（2026/2025 年份、榜单、赞助商、CERT_DATA）
13. 证书页整体像素差 7.458%（标题恢复显示 + 副标题文案修改，有意差异）
    > 另有具体说明：证书页标题区在 150ms 帧与解码帧中可见完整 `#666` 乱码过程，见 `qa/clone-extra/cert-title-decode-150ms.png`。

---

## 5. 像素级比对摘要（H 类）

| 区域 | 结果 |
| --- | --- |
| ENTER 静止态 / hover 态（含辉光） | 0% 差异像素（>8） |
| CERTIFICATE 大按钮静止态 / hover 态 | 0% |
| 顶栏按钮静止态 / 括号 hover 态 | 0% |
| Tab 导航条（文字+active 下划线） | 0% |
| LEADERBOARD 标题 | 0% |
| 赞助卡上/左边框 | 0% |
| 首页静止态整帧（掩掉约定差异区） | **0 / 1,186,750 像素** |
| file:// 首页 / 数据页 / 赞助页 vs http:// | 0% |
| file:// 证书页（掩顶栏 hover） | 0 / 1,275,600 像素 |

---

## 6. 复现方法

```bash
# 1) 在站点根目录起服务（本次使用 8801）
python -m http.server 8801 --bind 127.0.0.1

# 2) 复刻站截图（与 task-3 原站同一脚本、同一 steps）
node qa/shoot.mjs --url http://127.0.0.1:8801/index.html --out qa/clone \
  --steps qa/steps/original-desktop.json --diag qa/clone/_diagnostics.json --label clone-desktop
node qa/shoot.mjs --url http://127.0.0.1:8801/index.html --out qa/clone \
  --steps qa/steps/original-decode.json --diag qa/clone/_decode-diagnostics.json --label clone-decode
node qa/shoot.mjs --url http://127.0.0.1:8801/index.html --out qa/clone \
  --steps qa/steps/original-extras.json --diag qa/clone/_extras-diagnostics.json --label clone-extras
node qa/shoot.mjs --url http://127.0.0.1:8801/index.html --out qa/clone \
  --steps qa/steps/clone-final.json --diag qa/clone/_final-diagnostics.json --label clone-final
node qa/shoot.mjs --url http://127.0.0.1:8801/index.html --out qa/clone-mobile \
  --steps qa/steps/original-mobile.json --diag qa/clone-mobile/_diagnostics.json --label clone-mobile
node qa/shoot.mjs --url "file:///C:/Users/HACKED/Desktop/%E5%B9%BF%E5%B7%A5%E6%9D%AF/index.html" \
  --out qa/clone-file --steps qa/steps/clone-file.json --diag qa/clone-file/_diagnostics.json --label clone-file
node qa/shoot.mjs --url http://127.0.0.1:8801/index.html --out qa/clone-extra \
  --steps qa/steps/clone-cert-tests.json --diag qa/clone-extra/_diagnostics.json --label clone-cert-tests
node qa/shoot.mjs --url http://127.0.0.1:8801/index.html --out /tmp/qa-enterlink \
  --steps qa/steps/clone-enter-link.json --diag qa/clone-extra/_enter-link-diagnostics.json --label clone-enter-link

# 3) 校验 + 基准 + 比对
python qa/validate_shots.py qa/clone --width 1440 --height 900 --json qa/validate-clone.json
python qa/validate_shots.py qa/clone-mobile --size 375x812 --json qa/validate-clone-mobile.json
python qa/validate_shots.py qa/clone-file --width 1440 --height 900 --json qa/validate-clone-file.json
python qa/validate_shots.py qa/clone-extra --width 1440 --height 900 --json qa/validate-clone-extra.json
python qa/make_baseline.py --label clone --out qa/baseline-clone.json \
  --diag qa/clone/_diagnostics.json --diag qa/clone/_decode-diagnostics.json \
  --diag qa/clone/_extras-diagnostics.json --diag qa/clone/_final-diagnostics.json
python qa/make_baseline.py --label clone-mobile --out qa/baseline-clone-mobile.json \
  --diag qa/clone-mobile/_diagnostics.json
python qa/compare_clone.py        # → qa/compare-report.json，退出码 0 = 无 BLOCKER/MAJOR/FAIL
```

---

## 7. 残余风险与建议（均不阻塞交付）

1. **演示数据替换后建议复跑本报告**：榜单表格行高/列宽、赞助商数量、简介文本均随数据变化，属内容差异，不影响样式与动效判定。
2. **证书页标题修复是相对原站的增强**：建议在 README/交付说明中向用户注明「原站证书页标题存在 bug，本复刻已修复」（`README.md`/`ANIMATION-NOTES.md` 已有说明可对照）。
3. **中文字体使用系统回退**：受「不引用外网资源、只自托管 Share Tech Mono」约束，中文走系统 CJK 字体；Windows 下与原站观感一致，在 macOS/Linux 打开时字形会随系统字体不同（布局仍一致）。如需跨平台完全一致，可后续追加中文子集字体（非本次验收范围）。
4. **headless 采集时序**：`home-000/150ms` 等 load 锚点帧的相位受页面加载速度影响（复刻站本地加载远快于原站外链字体），动效节奏判定以同锚点 decode 序列与探针数值为准；动画连续帧的像素比对不适用于随机乱码内容。
5. **移动端原站布局缺陷保留**：tab 溢出不可达、ENTER 超出视口被裁 —— 与原站一致，非复刻缺陷；若后续产品上要修复，建议作为单独改进项。

---

## 8. 结论

复刻站在 **字体、布局、TextScramble、视图/Tab 切换、全部 hover 态、移动端响应式、file:// 离线运行、控制台健康度** 上与原站达到像素级/数值级一致；3 处 script.js 更新（证书标题 bug 修复、证书文件名两位补零、ENTER 占位不跳转）均已实测验证通过；13 项 INFO 全部为演示数据内容驱动或约定的有意差异。**未发现 BLOCKER / MAJOR / MINOR 缺陷，建议通过验收。**

交付用首页截图：`docs/screenshot-home.png`（1440×900，取自 `qa/clone/home-final.png`，完全静止、无 hover、字体已加载，可被 README 直接引用）。
