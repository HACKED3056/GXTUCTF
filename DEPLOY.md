# 部署指南（GitHub + Vercel）

本站是**纯静态站点**：没有构建步骤、没有依赖、不需要 Node 环境。
把整个目录丢到任何静态托管上就能跑。下面是从零开始的两条路径。

- 路径 A：GitHub 仓库 → Vercel 自动部署（推荐，之后每次 push 自动更新）
- 路径 B：Vercel CLI 直接部署（不想建 GitHub 仓库时用）
- 路径 C：GitHub Pages（不想用 Vercel 时的备选）

---

## 0. 先检查本地目录

```
广工杯/
├── index.html          ← 入口
├── styles.css
├── script.js
├── assets/             ← 字体、图标（必须一起上传）
├── docs/               ← README 用的截图（可不传，不影响运行）
├── README.md
├── ANIMATION-NOTES.md
└── qa/                 ← 验收工具与证据（已在 .gitignore 中排除截图）
```

⚠️ **`assets/` 必须一起提交**，字体和 favicon 都在里面；漏了页面字体会退化成系统字体。

---

## 路径 A：GitHub → Vercel（推荐）

### A1. 推到 GitHub

先在 GitHub 网页上建一个空仓库（不要勾选 README / .gitignore / License）：

<https://github.com/new> → Repository name 例如 `gxtuctf-2026` → **Public** 或 Private 都行 → Create repository

然后在本目录（`广工杯/`）执行：

```bash
# 1) 初始化仓库
git init -b main

# 2) 设置提交身份（只需在仓库内设置一次，不影响全局配置）
git config user.name "你的名字"
git config user.email "你的邮箱@example.com"

# 3) 提交
git add -A
git commit -m "feat: GXTUCTF 2026 赛事归档页"

# 4) 关联远程仓库（把 <你的用户名>/<仓库名> 换成自己的）
git remote add origin https://github.com/<你的用户名>/gxtuctf-2026.git

# 5) 推送
git push -u origin main
```

> 推送时密码位置要填 **Personal Access Token**（GitHub 早已不支持账号密码）：
> Settings → Developer settings → Personal access tokens → Fine-grained tokens → 勾选仓库的 `Contents: Read and write` → 生成后复制，粘到密码处。
> 或者改用 SSH：`git remote set-url origin git@github.com:<用户名>/<仓库名>.git`（需已配置 SSH key）。

### A2. 在 Vercel 导入仓库

1. 打开 <https://vercel.com> → 用 **GitHub 账号登录**（Continue with GitHub）
2. **Add New… → Project**
3. 在 "Import Git Repository" 里找到刚推的仓库 → **Import**
4. 配置页填：

   | 选项 | 填什么 |
   | --- | --- |
   | Framework Preset | **Other** |
   | Root Directory | `./`（默认，不用改） |
   | Build Command | **留空**（覆盖默认值，删掉里面的 `npm run build`） |
   | Output Directory | **留空** |
   | Install Command | **留空** |
   | Environment Variables | 不需要 |

5. 点 **Deploy**，等 10～30 秒，拿到 `https://<仓库名>.vercel.app` 就上线了。

之后每次 `git push`，Vercel 会自动重新部署；每个分支/PR 还会有预览地址。

### A3. 绑定自己的域名（可选）

1. Vercel 项目 → **Settings → Domains → Add**，输入例如 `ctf.example.com`
2. 按提示到域名服务商加解析：
   - 根域名（`example.com`）：`A` 记录 → `76.76.21.21`
   - 子域名（`ctf.example.com`）：`CNAME` → `cname.vercel-dns.com`
   - 或者直接把域名的 **NS** 改成 `ns1.vercel-dns.com` / `ns2.vercel-dns.com`，让 Vercel 全权管理
3. 等 DNS 生效（几分钟到几小时），Vercel 会自动签发 HTTPS 证书。

---

## 路径 B：只用 Vercel CLI（不建 GitHub 仓库）

```bash
# 1) 安装 CLI（Node 已装的话）
npm i -g vercel

# 2) 在本目录登录并部署
cd 广工杯
vercel login          # 走邮箱或 GitHub 授权
vercel                # 首次会问几个问题，全部回车默认即可（framework 选 Other）
vercel --prod         # 正式发布，拿到生产域名
```

CLI 首次部署会问：

```
Set up and deploy?                     → Y
Which scope?                           → 选自己的账号
Link to existing project?              → N
What's your project's name?            → gxtuctf-2026
In which directory is your code?       → ./  （直接回车）
Want to modify these settings?         → N
```

---

## 路径 C：GitHub Pages（备选，纯免费、国内访问通常比 Vercel 稳一些）

推到 GitHub 后：仓库 → **Settings → Pages** →

- Source: `Deploy from a branch`
- Branch: `main` / 目录选 **`/ (root)`** → Save

等约 1 分钟，访问 `https://<用户名>.github.io/<仓库名>/`。
本站所有资源都是相对路径（`assets/...`、`styles.css`），放在子路径下也能正常工作。

---

## 上线前 checklist

- [ ] ENTER 按钮指向报名页：`script.js` → `CONFIG.enterUrl`
- [ ] 排行榜数据：`script.js` → `DATABASE["2026"].rank`（现在是空数组，页面显示 NO DATA）
- [ ] 品牌名 / 四角坐标：`script.js` → `CONFIG.brand`、`index.html` → `.home-decor`
- [ ] `assets/` 已提交（字体 + favicon）
- [ ] 手机上看一眼 DETAIL 页（窄屏表格是卡片式排版）
- [ ] 改了 `styles.css` / `script.js` 后，把 `index.html` 里的 `?v=` 版本号也改一下（破缓存）

---

## 常见问题

**Q：Vercel 部署后页面空白 / 只有黑底？**
多半是 `assets/` 没提交（字体 404 不至于白屏）或 `script.js` 404。打开浏览器控制台看 Network，确认 `script.js`、`styles.css` 都是 200。

**Q：部署后还是旧内容？**
浏览器缓存。`index.html` 里已用 `?v=YYYYMMDD` 给 css/js 加了版本号，改动时把这个数字一起改掉即可；临时验证用 Ctrl+F5。

**Q：国内访问 Vercel 慢或打不开？**
Vercel 的域名在国内没有备案，访问不稳定，比赛报名页这类场景建议：
- 换 **Cloudflare Pages**（免费、国内相对可访问）：Workers & Pages → Create → Pages → Connect to Git，构建命令留空、输出目录 `/`
- 或者用国内对象存储 + CDN（阿里云 OSS / 腾讯云 COS），但绑定自定义域名需要 ICP 备案
- 只想要个链接的话，GitHub Pages 也够用

**Q：要不要加 `vercel.json`？**
不需要。Vercel 对"没有任何构建步骤的静态仓库"会直接按静态站点托管根目录。
唯一可能需要它的场景是想自定义缓存头或重写规则（例如把 `/2026` 映射到 `index.html`）。
