/* =========================================================================
   广工杯 / GXTUCTF — 站点脚本
   -------------------------------------------------------------------------
   动效与交互参考 https://www.ctf.vin/（MilkDragonCTF 落地页），纯原生 JS：

   1. CONFIG        —— 品牌、链接等可配置项（换品牌只改这里）
   2. DATABASE      —— 年份归档数据（当前只有 2026）
   3. TextScramble  —— 招牌「文字解码」动画（逐字随机乱码 → 收敛成文案）
   4. 交互逻辑      —— 年份切换 / 视图切换 / Tab 切换

   ⚠ 下面所有队伍、分数、赞助商均为「演示数据」，请替换为你的真实赛事数据。
   ========================================================================= */

const CONFIG = {
    // 品牌名：页面加载时品牌标题会解码成这段文字
    brand: "GXTUCTF // 广工杯",
    // ENTER 按钮跳转地址：比赛平台 / 报名页
    enterUrl: "https://youyue.info/competition_detail.php?id=6"
};

/* ============================== 归档数据 ============================== */

const DATABASE = {
    "2026": {
        /*
         * 赛事详情：支持 HTML（标题用 <h4>/<h5>，列表 <ul>/<li>，表格照抄下面的结构即可）。
         * 段落、列表、表格的样式在 styles.css 的 .detail-body 里。
         */
        detail: `
            <h4>一、参赛规则</h4>
            <ul>
                <li><strong>比赛时间：</strong>具体时间加群等待具体时间</li>
                <li><strong>队伍规模：</strong>个人赛</li>
                <li>比赛期间禁止私下交流赛题、交换 Flag 等 PY（不正当手段获取 flag）行为</li>
                <li>比赛期间禁止攻击赛事平台</li>
                <li>本次比赛不禁止 AI，但 WP 须人工处理，若 100% 由 AI 编写将取消队伍成绩</li>
                <li>赛后 3 小时内须将所解题目的 WriteUp 提交至邮箱
                    <a href="mailto:ss0t_hacked@qq.com">ss0t_hacked@qq.com</a>：
                    <ul>
                        <li>逾期未提交视为放弃成绩</li>
                        <li>缺少题目 WP 将扣除相应题目的分数</li>
                        <li>WP 错误或与其他队伍雷同，我们会提出质询</li>
                    </ul>
                </li>
            </ul>

            <h4>二、赛事规则</h4>
            <p>CTF（Capture the Flag）是一种网络安全竞赛，旨在让参赛者通过解决一系列的网络安全问题来获取旗帜（flag）。这些旗帜通常是一段特定的文本或者一种特定的格式，证明参赛者成功攻克了某个问题或系统。</p>
            <p>参赛队伍通过线下参与，以解决网络安全技术挑战题目的分值和时间来排名。题目主要包含 Reverse、Web、Crypto、pwn、misc 等类别。</p>
            <p>CTF 参赛团队登陆后，以闯关的方式进行攻击，每一关均有一个靶场或者附件，并且，分值不同的题目难度越高。考核的知识包括了渗透、破解、逆向、系统漏洞利用等。</p>

            <h4>三、提问的智慧</h4>
            <p>比赛期间若遇到问题，请在 QQ 群 <strong>1131732921</strong> 中联系群主解答。提问时请简要描述问题，并提供截图、代码等关键信息。</p>

            <h4>四、奖项设置</h4>
            <div class="table-wrapper">
                <table class="minimal-table">
                    <thead>
                        <tr><th>奖项</th><th>名额</th><th>奖品</th></tr>
                    </thead>
                    <tbody>
                        <tr><td data-label="奖项">一等奖</td><td data-label="名额">1 名</td><td data-label="奖品">AI 贴纸 1 份、证书一份、Opencode 一个月会员 / Deepseek api / GLM api（价值 66）</td></tr>
                        <tr><td data-label="奖项">二等奖</td><td data-label="名额">2 名</td><td data-label="奖品">AI 贴纸 1 份、证书一份、Kimi GO 一个月会员 / Deepseek API / GLM API（价值 49）</td></tr>
                        <tr><td data-label="奖项">三等奖</td><td data-label="名额">3 名</td><td data-label="奖品">AI 贴纸 1 份、证书一份、一杯奶茶 / Deepseek API / GLM API / Qoder 首月特惠（价值 20）</td></tr>
                        <tr><td data-label="奖项">鼓励奖</td><td data-label="名额">全体得分队伍</td><td data-label="奖品">AI 贴纸 1 份、证书 1 份</td></tr>
                    </tbody>
                </table>
            </div>
            <h5>特别奖项</h5>
            <ul>
                <li><strong>爽吃奖：</strong>赛后抽奖，送魔芋爽 1 盒</li>
            </ul>
        `,
        // 排行榜数据：已清空。要填真实成绩时按下面的格式追加，页面会自动渲染
        // （空数组时表格显示 NO DATA 占位行）
        rank: [
            // { rank: "01", name: "队伍名", score: "13501" },
        ]
    }
};

/* ========================== 文字解码动画 ========================== */
/*
 * 原理：
 *  - 把目标文本按字符拆成队列，每个字符有随机的 start / end 帧；
 *  - 帧数在 start 之前显示旧字符，[start, end) 之间随机显示「乱码字符」（灰色 #666），
 *    到达 end 后定格为目标字符；
 *  - 用 requestAnimationFrame 逐帧刷新，全部字符定格后 Promise resolve。
 * 调参：把 40 改大 → 动画更慢；把 0.28 改大 → 乱码跳变更频繁。
 */
class TextScramble {
    constructor(el) {
        this.el = el;
        // 乱码字符池（含 Unicode 破折号 —）
        this.chars = '!<>-_\\/[]{}—=+*^?#________';
        this.update = this.update.bind(this);
        this.reduceMotion = window.matchMedia
            ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
            : false;
    }

    setText(newText) {
        // 系统开启「减少动态效果」时直接落字，避免无谓动画
        if (this.reduceMotion) {
            this.el.textContent = newText;
            return Promise.resolve();
        }

        const oldText = this.el.innerText;
        const length = Math.max(oldText.length, newText.length);
        const promise = new Promise((resolve) => (this.resolve = resolve));
        this.queue = [];

        for (let i = 0; i < length; i++) {
            const from = oldText[i] || '';
            const to = newText[i] || '';
            const start = Math.floor(Math.random() * 40);
            const end = start + Math.floor(Math.random() * 40);
            this.queue.push({ from, to, start, end });
        }

        cancelAnimationFrame(this.frameRequest);
        this.frame = 0;
        this.update();
        return promise;
    }

    update() {
        let output = '';
        let complete = 0;
        const n = this.queue.length;

        for (let i = 0; i < n; i++) {
            let { from, to, start, end, char } = this.queue[i];
            if (this.frame >= end) {
                complete++;
                output += to;
            } else if (this.frame >= start) {
                // 每帧有 28% 概率换一个乱码字符，形成闪烁跳变
                if (!char || Math.random() < 0.28) {
                    char = this.randomChar();
                    this.queue[i].char = char;
                }
                output += `<span style="color: #666">${char}</span>`;
            } else {
                output += from;
            }
        }

        this.el.innerHTML = output;

        if (complete === n) {
            this.resolve();
        } else {
            this.frameRequest = requestAnimationFrame(this.update);
            this.frame++;
        }
    }

    randomChar() {
        return this.chars[Math.floor(Math.random() * this.chars.length)];
    }
}

/* ============================ 状态与初始化 ============================ */

let currentYear = null;
let currentTab = "detail";

/*
 * 取元素的「原始文案」并缓存到 data 属性。
 * 直接读 innerText 有两个坑：元素不可见时得到空串（会把标题清空）；
 * 解码动画进行中读到的是乱码（越点越乱）。缓存后怎么触发都收敛到正确文案。
 */
function baseText(el) {
    if (el.dataset.baseText === undefined) {
        el.dataset.baseText = el.textContent.trim();
    }
    return el.dataset.baseText;
}

// 对元素做一次解码动画（文案来自缓存，不受当前可见性/动画状态影响）
function scrambleEl(el, text) {
    if (!el) return;
    new TextScramble(el).setText(text === undefined ? baseText(el) : text);
}

document.addEventListener('DOMContentLoaded', () => {
    initYearList();

    // 品牌标题：加载时解码
    scrambleEl(document.querySelector('.brand-title'), CONFIG.brand);

    // ENTER 按钮：加载时 + 每次鼠标移入时重新解码
    const enterBtn = document.querySelector('.main-enter-btn');
    if (enterBtn) {
        const fx = new TextScramble(enterBtn);
        fx.setText("ENTER");
        enterBtn.addEventListener('mouseenter', () => fx.setText("ENTER"));

        const link = document.getElementById('enter-link');
        if (link && CONFIG.enterUrl) {
            link.href = CONFIG.enterUrl;
            // enterUrl 还是占位 "#" 时不跳转，避免点开一个空白副本
            if (CONFIG.enterUrl === '#') {
                link.addEventListener('click', (e) => e.preventDefault());
            }
        }
    }
});

/* ============================== 年份导航 ============================== */

function initYearList() {
    const container = document.getElementById('year-list-container');
    const years = Object.keys(DATABASE).sort((a, b) => b - a);

    container.innerHTML = years.map(year => `
        <li class="year-item" onclick="switchYear('${year}', this)">${year}</li>
    `).join('');
}

window.switchYear = function (year, element) {
    if (currentYear === year) return;

    currentYear = year;

    document.querySelectorAll('.year-item').forEach(el => el.classList.remove('active'));
    element.classList.add('active');

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('data-view').classList.add('active');

    renderData();
};

window.closeView = function () {
    currentYear = null;
    document.querySelectorAll('.year-item').forEach(el => el.classList.remove('active'));

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('home-view').classList.add('active');
};

window.switchTab = function (tabId, element) {
    if (currentTab === tabId) return;
    currentTab = tabId;

    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    element.classList.add('active');

    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(tabId);
    if (target) {
        target.classList.add('active');
        // 切换 Tab 时让新标题重新解码一次（DETAIL 标题跟随当前年份）
        const title = target.querySelector('[data-scramble]');
        if (title) {
            const isDetail = target.id === 'detail';
            scrambleEl(title, isDetail && currentYear ? `${currentYear} DETAIL` : undefined);
        }
    }
};

/* ============================== 渲染数据 ============================== */

function renderData() {
    const data = DATABASE[currentYear];
    if (!data) return;

    // 当前激活 Tab 的标题重新解码（年份变化时标题文案会变）
    const activeTabContent = document.querySelector('.tab-content.active');
    if (activeTabContent) {
        const title = activeTabContent.querySelector('[data-scramble]');
        if (title) {
            const baseTitle = activeTabContent.id === 'detail'
                ? `${currentYear} DETAIL`
                : baseText(title);
            scrambleEl(title, baseTitle);
        }
    }

    // detail 是富文本（支持 HTML），所以用 innerHTML
    document.getElementById('detail-text').innerHTML = data.detail;

    const tbody = document.getElementById('rank-tbody');
    const rank = data.rank || [];
    // 清空状态下给一行占位，避免表格只剩表头看起来很「坏掉」
    tbody.innerHTML = rank.length
        ? rank.map(team => `
            <tr>
                <td style="color: var(--text-secondary)">${team.rank}</td>
                <td style="font-weight: bold">${team.name}</td>
                <td>${team.score}</td>
            </tr>
        `).join('')
        : `<tr class="table-empty">
                <td colspan="3">NO DATA // 暂无排行数据</td>
           </tr>`;
}
