# 动效拆解 · ANIMATION NOTES

参考站点：<https://www.ctf.vin/>　复刻实现：本项目 `styles.css` + `script.js`

全站只用 **少数几个动效**撑起观感，没有动画库、没有 GSAP、没有 WebGL。
原则只有两条：**黑白单色 + 硬边**，以及**一切过渡都用同一条缓动曲线**。

> 📌 当前版本按需求裁剪为：首页 + 数据页（**仅 DETAIL 与 LEADERBOARD 两个栏目**），
> 无证书查询、无 SPONSORS / ARCHIVES。
> 第 6、7 节的原站动效（赞助卡旋转描边、归档链接位移）**当前未启用**，
> 代码保留在本文里作为「加回来」的现成方案。

---

## 0. 全局基调（先记住这两个变量）

```css
--transition-fast: 0.3s cubic-bezier(0.4, 0, 0.2, 1);   /* 绝大多数交互 */
--transition-slow: 0.6s cubic-bezier(0.77, 0, 0.175, 1); /* 保留：慢速入场 */
```

`cubic-bezier(0.4, 0, 0.2, 1)` 就是 Material 的「标准曲线」：起步快、收尾缓。
站点观感统一的关键不是动画花哨，而是**所有元素共用同一条曲线与时长**。

配色只有三档：`#fff`（主）、`#aaa`（次）、`rgba(255,255,255,0.1)`（描边），
背景 `#000` 叠一层 `radial-gradient(circle at 50% 50%, #111 0%, #000 100%)`（中心微亮，避免死黑）。

---

## 1. 招牌动画：TextScramble 文字解码

**观感**：文字像终端信号不稳定一样，逐字符从乱码 `!<>-_\/[]{}—=+*^?#` 抖动，随机先后定格成目标文案。

**当前生效的触发点（4 处）**：

| 位置 | 时机 |
| --- | --- |
| 顶栏品牌标题 `.brand-title` | 页面加载（收敛为 `GXTUCTF // 广工杯`） |
| 主按钮 `.main-enter-btn` | 页面加载 **+ 每次 `mouseenter` 重新解码** |
| DETAIL 标题 | 点侧栏年份进入数据页时（`2026 DETAIL`） |
| LEADERBOARD 标题 | 切 Tab 时 |

**实现**（`script.js` → `class TextScramble`）：

```js
// 1) 新旧文本按位对齐，逐字符生成随机的起始/结束帧
for (let i = 0; i < length; i++) {
    const start = Math.floor(Math.random() * 40);       // 0~39 帧后开始抖
    const end   = start + Math.floor(Math.random() * 40); // 再抖 0~39 帧后定格
    this.queue.push({ from: oldText[i] || '', to: newText[i] || '', start, end });
}

// 2) 每帧重绘：未到 start 显示旧字符 → 到 start 显示乱码 → 到 end 定格
if (this.frame >= end)          output += to;
else if (this.frame >= start) {
    if (!char || Math.random() < 0.28) char = this.randomChar();  // 28% 概率刷新乱码
    output += `<span style="color: #666">${char}</span>`;         // 乱码是灰色
} else                          output += from;
```

**为什么好看**（也是复刻时最容易漏的细节）：

- 每个字符的 `start`/`end` 都随机 → 收敛顺序是**打散**的，不是从左到右刷屏；
- 乱码字符用 `<span style="color:#666">` 单独染色 → 灰→白的层次感，纯白乱码会很吵；
- 每帧重写 `el.innerHTML`，所以**必须**保证元素内没有别的子元素（按钮里只放文字）；
- 浏览器刷新率决定节奏：约 60fps 下 `0~78` 帧 ≈ **0.3~1.3 秒**完成，实测收敛在 0.34~0.6s。

**调参**：

| 想要的效果 | 改动 |
| --- | --- |
| 整体更慢/更快 | `Math.random() * 40` 两处同时改大/改小 |
| 乱码更狂躁 | `0.28` 改大（1.0 = 每帧都换） |
| 乱码更克制 | `0.28` 改小 |
| 换乱码字符集 | `this.chars = '!<>-_\\/[]{}—=+*^?#________'`（尾部多个 `_` 让「空白抖动」更自然） |

**无动画降级**：构造时检测 `prefers-reduced-motion`，命中则 `textContent` 直出并 `Promise.resolve()`，
调用方不用判断。

**取文案的坑**：直接读 `innerText` 会踩两脚刹车 ——

```js
// ❌ 错误示范（元素不可见时读到空串 → 标题被清空；动画中读到乱码 → 越点越乱）
new TextScramble(title).setText(title.innerText);

// ✅ 本项目做法：首次读取时把原文缓存进 data-base-text
function baseText(el) {
    if (el.dataset.baseText === undefined) el.dataset.baseText = el.textContent.trim();
    return el.dataset.baseText;
}
function scrambleEl(el, text) { new TextScramble(el).setText(text ?? baseText(el)); }
```

> 这组坑在参考站点上是实打实发作过的（它的证书页标题因此永远是空白），详见附录。

---

## 2. 视图交叉淡入淡出（home ⇄ data）

两个视图**同时存在于 DOM**，靠绝对定位叠在同一个 `content-area` 上，切的是 `opacity + visibility`：

```css
.view { position: absolute; inset: 0; visibility: hidden; opacity: 0;
        transition: opacity .3s cubic-bezier(.4,0,.2,1), visibility .3s cubic-bezier(.4,0,.2,1); }
.view.active { visibility: visible; opacity: 1; }
```

要点：

- `visibility` 一定要跟着过渡，否则隐藏层会**挡住鼠标事件**；
- 淡出层在过渡期间仍然可见，所以两屏内容会**短暂叠印**（0.3s 内）——这正是原站那种「显影」感；
- 切换逻辑（`switchYear` / `closeView`）统一走
  「先 `.remove('active')` 所有 `.view`，再给目标 `.add('active')`」，不写死动画方向，正反向都自然。

首页 `#home-view` 用 `top:-60px; height:100vh` 顶出固定 header 的高度，让装饰文字按**视口**四角对齐，
而不是按内容区对齐 —— 这是首页四角小字位置正确的关键。

---

## 3. ENTER 按钮：反色 + 字距扩张 + 辉光 + 斜切角

```css
.main-enter-btn {
    border: 2px solid #fff; padding: 20px 80px; font-size: 3rem; letter-spacing: 15px;
    clip-path: polygon(20px 0%, 100% 0%, calc(100% - 20px) 100%, 0% 100%); /* 上下边斜切 */
    transition: all .3s cubic-bezier(.4,0,.2,1); min-width: 400px;
}
.main-enter-btn:hover {
    background: #fff; color: #000;      /* 反色 */
    letter-spacing: 20px;               /* 字距 15px → 20px */
    transform: scale(1.05);             /* 轻微放大 */
    box-shadow: 0 0 50px rgba(255,255,255,.4); /* 白色辉光 */
}
```

三处细节：

1. **字距变化会改变文字宽度**，但按钮 `min-width:400px` 兜底，所以按钮本身只放大 1.05 倍，不会「弹跳」；
2. `clip-path` 把矩形切成平行四边形，切角处**边框也被切掉**，于是描边只剩上下两条长边 +
   两个角上的小勾（原站也是这个效果，属于 `border` + `clip-path` 的固有表现：斜边在盒子内部，边框画不到）。
   想让斜边也带描边，就别用 `border`，改用「外框 `::before` + 内缩 2px 的黑色遮罩」或直接上 SVG。
3. hover 时同时触发文字解码（`mouseenter` → `fx.setText("ENTER")`），于是**反色过渡与乱码抖动叠加**，
   这是全站最亮的一处交互。

---

## 4. 顶栏按钮的方括号 `[ ... ]`

```css
.home-icon-btn::before { content:'['; margin-right:8px; opacity:0; transition:var(--transition-fast); }
.home-icon-btn::after  { content:']'; margin-left:8px;  opacity:0; transition:var(--transition-fast); }
.home-icon-btn:hover::before, .home-icon-btn:hover::after { opacity:1; }
```

伪元素常驻但透明，只过渡 `opacity` → 不引起布局抖动，鼠标移上去像被「选中」。

---

## 5. 侧栏年份 / Tab：极简的「当前项」指示

```css
.year-item:hover, .year-item.active { color:#fff; background:rgba(255,255,255,.05); }
.year-item.active { border-right: 2px solid #fff; }          /* 侧栏：右侧指示条 */

.tab-btn.active::after {                                       /* Tab：下划线 */
    content:''; position:absolute; bottom:-5px; left:0; width:100%; height:1px; background:#fff;
}
```

不移动的指示条 + 单色高亮，配 `transition: var(--transition-fast)` 就是全部。

---

## 6. 赞助卡片：conic-gradient 旋转描边　〔当前版本未启用，留档〕

原站的 SPONSORS 栏目在卡片 hover 时有一道白光沿边缘扫过。当前站点按需求移除了该栏目，
以下是完整实现，想加回来照抄即可：

```css
.sponsor-card { position: relative; overflow: hidden; }        /* 关键：裁掉溢出 */
.sponsor-card::after {
    content:''; position:absolute; top:-50%; left:-50%; width:200%; height:200%;
    background: conic-gradient(transparent, transparent, transparent, #fff);
    animation: rotateBorder 4s linear infinite;
    opacity: 0; transition: opacity .3s;                        /* 默认不可见 */
}
.sponsor-card:hover::after { opacity: .15; }                    /* hover 才显影 */
@keyframes rotateBorder { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
```

- 一个比卡片大 4 倍的伪元素在卡片背后旋转，`conic-gradient` 只有 1/4 是白的 → 旋转时像一道光沿边缘扫过；
- 平时 `opacity:0` 但**动画一直在跑**（合成层，成本极低），hover 只改透明度 → 无启动延迟；
- `pointer-events:none` 保证不抢 hover。

---

## 7. 归档链接：hover 时整体右移　〔当前版本未启用，留档〕

```css
.minimal-link { padding: 40px; transition: var(--transition-fast); }
.minimal-link:hover { background: rgba(255,255,255,.05); padding-left: 50px; } /* 40 → 50 */
```

只改 `padding-left`，箭头 `→` 因为 `justify-content: space-between` 会被推着一起走，
形成「整行向里让位」的动势。

---

## 8. 玻璃拟态（backdrop-filter）

```css
--glass-bg:   rgba(255,255,255,.03);   /* 卡片/顶栏底 */
--acrylic-bg: rgba(20,20,20,.6);       /* 侧栏底 */
--blur-val: 20px;
backdrop-filter: blur(var(--blur-val));
```

- 顶栏、侧栏 20px 模糊；信息卡片 10px；
- 因为背景本身就是纯黑渐变，模糊后几乎看不出「毛玻璃」，真正的贡献是**让内容滚过时不出硬边**。

---

## 9. 其他小动作

| 效果 | 实现 |
| --- | --- |
| Tab 切换 | active 变白 + 1px 下划线，标题重新解码 |
| 滚动条 | `::-webkit-scrollbar { width:4px }` + 半透明滑块 |
| 选中文字 | `::selection { background:#fff; color:#000 }` |
| 键盘焦点 | `:focus-visible { outline:1px solid #aaa; outline-offset:4px }` |
| 入场层次 | `--transition-slow`（0.6s 强缓出）留给需要「慢入场」的场合，当前仅定义未大量使用 |

---

## 附：参考站点上踩过的一个坑（记录备查）

原站的证书页大标题 `CERTIFICATE ARCHIVE` 实际是**空白**的。根因就是第 1 节那个 `innerText` 陷阱：

```js
// 原站 openCertView()
certView.classList.add("active");                 // 刚由 visibility:hidden 变可见
new TextScramble(title).setText(title.innerText); // ← 此刻 innerText 仍读到空串
```

空串 → 长度为 0 的队列 → 立刻把 `innerHTML` 写成空 → **标题被永久清空**。

原站这个模块在本项目中已按需求移除，但**这套「缓存原文再解码」的写法保留了下来**
（`baseText()` / `scrambleEl()`），后续给任何新元素加解码动画都不会再踩同样的坑：

```js
document.querySelectorAll('[data-scramble]').forEach(el => scrambleEl(el));  // 元素内不要放子元素
```

---

## 复刻检查清单（想确认自己抄对了，逐条对）

- [ ] 刷新页面，品牌标题与 ENTER 是**乱码收敛**，不是淡入/打字机；
- [ ] 乱码字符是**灰色**，且收敛顺序是**随机打散**的；
- [ ] 鼠标反复划过 ENTER，每次都会**重新解码一次**；
- [ ] ENTER hover 时同时发生：反色 + 字距变宽 + 放大 1.05 + 白色辉光；
- [ ] 点侧栏 2026，首页是**交叉淡化**到数据页（能瞥见两屏叠印），不是直接切换；
- [ ] 切 DETAIL / LEADERBOARD 时，新标题会**重新解码**；
- [ ] 顶栏 HOME hover 出现 `[ HOME ]`；
- [ ] 系统开启「减少动态效果」后，页面**不加动画直接显示**（见 `prefers-reduced-motion` 块）。

---

## 二次创作的调参入口速查

```css
/* styles.css :root */
--bg-color / --text-primary / --text-secondary   /* 换配色 */
--transition-fast                                /* 全局交互节奏（0.3s → 0.5s 更从容） */
--blur-val                                       /* 玻璃模糊半径 */
```

```js
/* script.js */
CONFIG.brand            // 解码文案
CONFIG.enterUrl         // ENTER 去向
DATABASE["2026"]        // 简介 + 排行榜数据
```
