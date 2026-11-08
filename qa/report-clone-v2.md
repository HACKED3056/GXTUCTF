# 复刻站验收报告 · v2（裁剪版：仅 DETAIL + LEADERBOARD）

- 被测站点：`http://127.0.0.1:8801/index.html`（本地静态服务）与 `file://` 直开
- 基线对比：`qa/original/`（原站 <https://www.ctf.vin/> 参考帧）与 `qa/report-clone.md`（改版前 v1 报告）
- 工具：`qa/shoot.mjs`（零依赖 CDP），本次用 `qa/steps/v2-assertions.json` 重跑
- 采集时间：2026-11-08 14:46–14:52
- 结论：**通过**（0 JS 异常 / 0 console error / 0 404 / 0 失败请求 / 0 步骤失败）

---

## 1. 本版改动（相对 v1）

| 项 | v1 | v2（当前） |
| --- | --- | --- |
| 品牌 | GDUTCTF // 广工杯 | **GXTUCTF // 广工杯** |
| 年份 | 2026 + 2025 | **仅 2026** |
| 栏目 | DETAIL / LEADERBOARD / SPONSORS / ARCHIVES | **DETAIL / LEADERBOARD** |
| 证书查询 | 有（视图 + 查询 + 下载 + 8 张演示证书） | **整体移除**（DOM/CSS/JS/资源均无残留） |
| 顶栏按钮 | HOME + CERTIFICATE | **仅 HOME** |
| 动效实现 | — | **一行未改**（TextScramble / 视图淡化 / hover 全套保留） |

---

## 2. 结构断言（全部 PASS）

| 断言 | 实测值 |
| --- | --- |
| `.tab-btn` 数量与文案 | `2`，`["DETAIL","LEADERBOARD"]` |
| `section.tab-content` 数量 / id | `2` / `["detail","rank"]` |
| `.view` 数量 / id | `2` / `["home-view","data-view"]` |
| 顶栏按钮 `.home-icon-btn` | `1` |
| 证书残留（`.cert-*` / `#cert-view` / `[id*=cert]`） | `0` 个节点 |
| 赞助商残留（`#sponsor-container` / `.sponsor-*`） | `0` 个节点，`getComputedStyle('.sponsor-card')` 元素不存在 |
| 归档残留（`.minimal-link` / `#link-wp` / `#link-github` / `#links`） | `0` 个节点 |
| 全局函数残留 | `typeof openCertView = undefined`、`typeof downloadCertificate = undefined`、`typeof CERT_DATA = undefined` |
| 侧栏年份项 | `["2026"]`（1 项） |
| 页面标题 / meta | `GXTUCTF // 广工杯` / `GXTUCTF // 广工杯 CTF ARCHIVE` |
| `body.innerText` 含 `GDUT` / `GXUTCTF` | `false` / `false`（正确拼写仅 `GXTUCTF`） |
| 四角装饰 | `SYSTEM_VERSION: GXTUCTF_v1.0`、`NODE_STATUS: STABLE [OK]`、`LAT: 24.3264 \| LON: 109.4281`、`GXTU_SAFE_LAB // ARCHIVE_INIT` |
| 网络请求清单 | 只有 `fonts.css`、`styles.css`、`script.js`、`favicon.svg`（零证书/赞助商资源） |

---

## 3. 动效断言（全部 PASS）

| 项 | 实测值 |
| --- | --- |
| 品牌标题 | 收敛为 `GXTUCTF // 广工杯`（0 个残留 span） |
| TextScramble 解码（LEADERBOARD） | 切换后 80ms：`LEADER>O^RD`，2 个乱码 span（灰色 `rgb(102,102,102)`）；600ms：`LEADERBOARD`，0 span |
| TextScramble 解码（DETAIL） | 80ms：`2026 DETAI+`，1 个乱码 span；600ms：`2026 DETAIL` |
| ENTER 静止态 | `text=ENTER`、`bg=rgba(0,0,0,0)`、`color=rgb(255,255,255)`、`letter-spacing=15px`、`transform=none` |
| ENTER hover 终态 | `bg=rgb(255,255,255)`、`color=rgb(0,0,0)`、`letter-spacing=20px`、`transform=matrix(1.05,0,0,1.05,0,0)`、`box-shadow=rgba(255,255,255,0.4) 0 0 50px` |
| ENTER hover 重触发解码 | hover 前 300ms 内 DOM 变更 `0` 次；hover 后 `69` 次（解码重跑），移开后回到 `bg=rgba(0,0,0,0)`、`15px`、`none` |
| 视图过渡 | `transition-property: opacity, visibility`；`duration: 0.3s, 0.3s`；`timing: cubic-bezier(0.4, 0, 0.2, 1)` |
| 顶栏 HOME 括号 | 静止 `::before/::after` opacity `0`；hover 后 `1` / `1`，内容 `"["` / `"]"`，颜色 `#fff`；移开 opacity 回 `0`、颜色 `#aaa` |
| Tab 下划线 | `::after` 高 `1px`、白、`bottom:-5px`、与按钮同宽 |
| 年份 active | `border-right: 2px solid rgb(255,255,255)` |
| 字体 | `document.fonts.check('16px "Share Tech Mono"') === true`，`fonts.status = loaded` |
| 已移除的动效 | 赞助卡 conic-gradient 旋转描边、归档链接 hover 位移 —— 随栏目一并移除（有意，非缺陷） |

---

## 4. 交互断言（PASS）

| 项 | 实测值 |
| --- | --- |
| 点年份 2026 | `activeYear=2026`、`activeView=data-view`、`activeTab=DETAIL`、`detailTitle=2026 DETAIL`、`rankRows=5` |
| 切 LEADERBOARD | `activeTab=LEADERBOARD`、表格 5 行、列头 `["RANK","TEAM","SCORE"]`、标题解码后 `LEADERBOARD` |
| 切回 DETAIL | 标题解码后 `2026 DETAIL` |
| ENTER 占位链接 | `href="#"`，点击预置 `preventDefault`（不跳空白页） |
| **排行榜清空态**（后续变更） | `DATABASE["2026"].rank = []`；实测 `#rank-tbody` 只有 1 行、`class="table-empty"`、文案 `NO DATA // 暂无排行数据`、0 JS 异常（证据 `qa/clone-v2b/leaderboard-empty.png`） |

---

## 5. 运行环境验证

| 项 | 结果 |
| --- | --- |
| JS 异常 | 0（`exceptions: []`） |
| console error | 0（`console: []`） |
| HTTP ≥ 400 / 失败请求 | 0 / 0 |
| `file://` 直开 | 正常（`qa/clone-v2-file/`：字体、脚本、图片均 200/生效） |
| 移动端 375×812 | 正常（`qa/clone-v2-mobile/`） |

---

## 6. 复现命令

```bash
# 1) 在站点根目录起服务
python -m http.server 8801 --bind 127.0.0.1

# 2) 结构 + 动效断言（35 步，无截图）
node qa/shoot.mjs --url http://127.0.0.1:8801/index.html \
                  --out qa/clone-v2b --steps qa/steps/v2-assertions.json

# 3) 分状态截图
node qa/shoot.mjs --url http://127.0.0.1:8801/index.html --out qa/clone-v2        --steps qa/steps/v2-desktop.json
node qa/shoot.mjs --url http://127.0.0.1:8801/index.html --out qa/clone-v2-mobile --steps qa/steps/v2-mobile.json  --mobile
node qa/shoot.mjs --url "file:///…/index.html"           --out qa/clone-v2-file   --steps qa/steps/v2-file.json
```

## 7. 证据索引

| 文件 | 内容 |
| --- | --- |
| `qa/clone-v2b/_diagnostics.json` | 本次 35 步断言的完整原始返回值（含 20 条 eval 结果） |
| `qa/clone-v2/` | 新版各状态截图：home-000/150/600/1800ms、home-hover-enter、data-2026、tab-leaderboard、view-fade-1/2、header-hover-home、decode-* |
| `qa/clone-v2-docs/` | 供 docs/ 引用的 1200×750 成品图 |
| `qa/clone-v2-mobile/`、`qa/clone-v2-file/` | 移动端与 file:// 截图 |
| `qa/original/` | 原站参考帧（未改动） |
| `qa/report-clone.md` | 改版前 v1 报告（52 PASS 的完整比对，作为基线） |

> 说明：v1 中「与原站逐像素 0 差异」的结论建立在首页与数据页布局上，这两屏本轮**未改动**
> （品牌文字、年份数量属于内容差异），因此该结论仍成立；本轮重点是确认裁剪后无坏引用、动效未退化。
