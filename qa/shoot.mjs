#!/usr/bin/env node
/**
 * qa/shoot.mjs —— 零第三方依赖的 Headless Chrome 截图 / 动效帧采集工具
 *
 * 依赖：Node.js >= 22（使用内置全局 fetch / WebSocket，不需要 npm install）
 *       Google Chrome 或 Microsoft Edge（自动探测，可用 --chrome 指定）
 *
 * 用法：
 *   node qa/shoot.mjs --url <url> --out <dir> --steps <steps.json> [options]
 *
 * 选项：
 *   --url <url>         被测页面地址（必填，也可写在 steps json 的 url 字段）
 *   --out <dir>         截图输出目录（必填，不存在会自动创建）
 *   --steps <file>      steps json 路径（必填）
 *   --width <n>         视口宽，默认 1440
 *   --height <n>        视口高，默认 900
 *   --mobile            启用移动端仿真（viewport meta / touch），配合 --width 375 --height 812
 *   --port <n>          指定 Chrome 调试端口，默认自动挑空闲端口
 *   --nav-timeout <ms>  导航等待 load 超时，默认 45000
 *   --chrome <path>     指定 Chrome/Edge 可执行文件
 *   --diag <file>       诊断信息输出路径，默认 <out>/_diagnostics.json
 *   --label <name>      给本次运行打标签（original / clone ...），写入诊断 json
 *   -h, --help          显示帮助
 *
 * steps.json：数组（或 { url, width, height, mobile, label, steps: [...] }）
 *   支持的步骤对象（按顺序执行）：
 *   { "wait": 500 }                         等待毫秒
 *   { "shot": "home-000ms.png" }            Page.bringToFront + 探针采样 + 截图
 *   { "eval": "window.closeView()" }        在页面上下文执行 JS（会 await Promise）
 *   { "hover": ".main-enter-btn" }          鼠标移动到元素中心
 *   { "click": ".tab-btn:nth-child(2)" }    真实鼠标点击元素中心
 *   { "scroll": ".sponsor-card" }           元素滚入视口（也支持 [x, y] 直接 window.scrollTo）
 *   { "viewport": { "width": 375, "height": 812, "mobile": true } }  运行中切换视口
 *   { "navigate": "https://..." }           运行中导航（会等待 load）
 *
 * 每次截图前会自动采集一份 DOM 探针（elements/样式/动画状态/字体状态），
 * 连同 console 报错、JS 异常、HTTP >=400 响应、失败请求写入诊断 json，
 * 供原站复刻验收逐项比对。
 */

import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const CHROME_START_TIMEOUT = 15000;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const round = (n) => Math.round(n * 100) / 100;

function log(msg) {
  console.log(msg);
}

function short(s, n = 160) {
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  if (str === undefined) return 'undefined';
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

/* ------------------------------------------------------------------ */
/* 参数解析                                                             */
/* ------------------------------------------------------------------ */

function printHelp() {
  log(`qa/shoot.mjs —— 零依赖 CDP 截图工具

用法:
  node qa/shoot.mjs --url <url> --out <dir> --steps <steps.json> [--width 1440 --height 900 --mobile]
                     [--port 9333] [--nav-timeout 45000] [--chrome <path>] [--diag <file>] [--label <name>]

步骤类型: wait | shot | eval | hover | click | scroll | viewport | navigate
详见脚本头部注释。`);
}

function parseArgs(argv) {
  const args = {
    width: 1440,
    height: 900,
    mobile: false,
    navTimeout: 45000,
    label: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`参数 ${a} 缺少值`);
      return v;
    };
    switch (a) {
      case '--url': args.url = next(); break;
      case '--out': args.out = next(); break;
      case '--steps': args.steps = next(); break;
      case '--width': args.width = Number(next()); break;
      case '--height': args.height = Number(next()); break;
      case '--mobile': args.mobile = true; break;
      case '--port': args.port = Number(next()); break;
      case '--nav-timeout': args.navTimeout = Number(next()); break;
      case '--chrome': args.chrome = next(); break;
      case '--diag': args.diag = next(); break;
      case '--label': args.label = next(); break;
      case '--help':
      case '-h': args.help = true; break;
      default: throw new Error(`未知参数: ${a}（--help 查看用法）`);
    }
  }
  return args;
}

function loadSteps(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`steps 文件不存在: ${abs}`);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new Error(`steps 文件 JSON 解析失败 (${abs}): ${e.message}`);
  }
  if (Array.isArray(data)) return { steps: data, file: abs };
  if (data && Array.isArray(data.steps)) return { ...data, file: abs };
  throw new Error(`steps 文件格式错误，应为数组或 { steps: [...] } (${abs})`);
}

function findChrome(explicit) {
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`指定的浏览器不存在: ${explicit}`);
    return explicit;
  }
  for (const p of CHROME_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  throw new Error('未找到 Chrome/Edge。请用 --chrome 指定可执行文件路径，或设置 CHROME_PATH 环境变量。');
}

/* ------------------------------------------------------------------ */
/* 网络与进程辅助                                                       */
/* ------------------------------------------------------------------ */

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function fetchJson(url, timeoutMs = 4000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function waitForDevtools(port, timeoutMs, getStderr) {
  const deadline = now() + timeoutMs;
  let lastErr = null;
  while (now() < deadline) {
    try {
      return await fetchJson(`http://127.0.0.1:${port}/json/version`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(150);
  }
  throw new Error(
    `Chrome DevTools 端口 ${port} 在 ${timeoutMs}ms 内未就绪: ${lastErr && lastErr.message}\n` +
    `Chrome stderr 末尾:\n${getStderr() || '(空)'}`,
  );
}

async function waitForPageTarget(port, timeoutMs) {
  const deadline = now() + timeoutMs;
  let triedCreate = false;
  while (now() < deadline) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${port}/json/list`, 3000);
      const page = (Array.isArray(list) ? list : []).find(
        (t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string',
      );
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* Chrome 尚未就绪，继续轮询 */ }

    // 兜底：某些启动方式不会自动开 about:blank 页面，用 /json/new 主动建一个
    if (!triedCreate && now() > deadline - timeoutMs + 5000) {
      triedCreate = true;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
          method: 'PUT',
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const t = await res.json();
          if (t && t.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
        }
      } catch { /* ignore */ }
    }
    await sleep(150);
  }
  throw new Error(`等待页面 target 超时（${timeoutMs}ms）`);
}

function launchChrome(chromePath, port, tmpDir, width, height, stderrSink) {
  const userDataDir = path.join(tmpDir, 'profile');
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--window-size=${width},${height}`,
    '--hide-scrollbars',
    `--user-data-dir=${userDataDir}`,
    '--allow-file-access-from-files',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--disable-infobars',
    '--noerrdialogs',
    '--mute-audio',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--force-color-profile=srgb',
    '--disable-lcd-text',
    '--font-render-hinting=none',
    '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints,CalculateNativeWinOcclusion',
    'about:blank',
  ];
  const child = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  child.stderr.on('data', (d) => {
    stderrSink.buf = (stderrSink.buf + String(d)).slice(-8000);
  });
  child.on('error', (e) => { stderrSink.spawnError = e; });
  return child;
}

function killChromeTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 20000 });
    } else {
      child.kill('SIGKILL');
    }
  } catch { /* ignore */ }
}

function rmDirQuiet(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch { /* Windows 偶发文件占用，忽略 */ }
}

/* ------------------------------------------------------------------ */
/* 最小 CDP 客户端（全局 WebSocket）                                    */
/* ------------------------------------------------------------------ */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    this.events = 0;
  }

  static async connect(wsUrl, timeoutMs = 15000) {
    const ws = new WebSocket(wsUrl);
    const cdp = new CDP(ws);

    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error(`连接 CDP WebSocket 超时: ${wsUrl}`));
      }, timeoutMs);
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };
      ws.addEventListener('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', () => fail(new Error(`CDP WebSocket 连接失败: ${wsUrl}`)));
      ws.addEventListener('close', () => fail(new Error('CDP WebSocket 在建立连接前即关闭')));
    });

    ws.addEventListener('message', (ev) => cdp._onMessage(ev));
    ws.addEventListener('close', () => {
      cdp.closed = true;
      for (const { reject } of cdp.pending.values()) {
        reject(new Error('CDP 连接已关闭'));
      }
      cdp.pending.clear();
    });
    ws.addEventListener('error', () => { /* 交由 close 处理 */ });
    return cdp;
  }

  _onMessage(ev) {
    let msg;
    try {
      const raw = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8');
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) {
        reject(new Error(`${msg.error.message || 'CDP 错误'} (code ${msg.error.code})`));
      } else {
        resolve(msg.result || {});
      }
      return;
    }
    if (msg.method) {
      this.events++;
      const arr = this.listeners.get(msg.method);
      if (arr) {
        for (const fn of arr.slice()) {
          try { fn(msg.params || {}); } catch { /* 监听器异常不影响主流程 */ }
        }
      }
    }
  }

  on(method, fn) {
    const arr = this.listeners.get(method) || [];
    arr.push(fn);
    this.listeners.set(method, arr);
    return () => {
      const a = this.listeners.get(method) || [];
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    };
  }

  once(method, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      let off = null;
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        if (off) off();
        reject(new Error(`等待事件超时: ${method}`));
      }, timeoutMs);
      off = this.on(method, (params) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (off) off();
        resolve(params);
      });
    });
  }

  send(method, params = {}, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error(`CDP 已关闭，无法发送 ${method}`));
    this.nextId += 1;
    const id = this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP 调用超时 (${timeoutMs}ms): ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`发送 CDP 消息失败 (${method}): ${e.message}`));
      }
    });
  }

  close() {
    this.closed = true;
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

/* ------------------------------------------------------------------ */
/* 页面操作辅助                                                         */
/* ------------------------------------------------------------------ */

async function evaluate(cdp, expression, timeoutMs = 30000) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
    includeCommandLineAPI: false,
  }, timeoutMs);
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    const text = (d.exception && d.exception.description) || d.text || 'Runtime.evaluate 抛出异常';
    throw new Error(String(text).split('\n').slice(0, 3).join(' | '));
  }
  return res.result ? res.result.value : undefined;
}

async function elementCenter(cdp, selector) {
  const expr = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, reason: 'not-found' };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  })()`;
  const v = await evaluate(cdp, expr);
  if (!v || !v.ok) throw new Error(`选择器未命中元素: ${selector}`);
  if (!(v.w >= 1 && v.h >= 1)) throw new Error(`元素尺寸为 0: ${selector}`);
  return v;
}

async function mouseMove(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y, button: 'none', buttons: 0, clickCount: 0, pointerType: 'mouse',
  });
  await sleep(16);
}

async function mouseClick(cdp, x, y) {
  await mouseMove(cdp, x, y);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse',
  });
  await sleep(35);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse',
  });
}

async function applyViewport(cdp, width, height, mobile) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: !!mobile,
    screenWidth: width,
    screenHeight: height,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: !!mobile,
    maxTouchPoints: mobile ? 5 : 1,
  }).catch(() => { /* 老版本可能不支持 */ });
}

async function waitForLoad(cdp, url, navTimeout) {
  const tNav = now();
  const dclP = cdp.once('Page.domContentEventFired', navTimeout).then(() => now()).catch(() => null);
  const loadP = cdp.once('Page.loadEventFired', navTimeout).then(() => now()).catch(() => null);
  const nav = await cdp.send('Page.navigate', { url }, 30000);
  if (nav && nav.errorText) throw new Error(`导航失败: ${nav.errorText}`);
  const tDcl = await dclP;
  const tLoad = await loadP;
  return { tNav, tDcl, tLoad, navigated: nav };
}

function pngSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/* ------------------------------------------------------------------ */
/* 截图前的 DOM 探针：采集布局 / 样式 / 动画状态，全部只读               */
/* ------------------------------------------------------------------ */

const PROBE_JS = `(() => {
  const out = {};
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const pick = (el, props) => {
    const c = cs(el);
    if (!c) return null;
    const r = {};
    for (const p of props) r[p] = c.getPropertyValue(p);
    return r;
  };
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const scram = (el) => {
    if (!el) return null;
    const spans = Array.from(el.querySelectorAll('span'));
    let grey = 0;
    for (const s of spans) {
      const c = getComputedStyle(s).color;
      if (c === 'rgb(102, 102, 102)' || c === 'rgb(102,102,102)') grey++;
    }
    return {
      text: el.innerText,
      chars: (el.innerText || '').replace(/\\s/g, '').length,
      spans: spans.length,
      greySpans: grey,
      html: (el.innerHTML || '').slice(0, 800)
    };
  };
  try {
    out.t = Math.round(performance.now());
    out.readyState = document.readyState;
    out.href = location.href;
    out.qaDecodeMs = (typeof window.__qaDecodeT0 === 'number')
      ? Math.round(performance.now() - window.__qaDecodeT0)
      : null;
    out.viewport = { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, scrollY: window.scrollY };
    out.views = {};
    for (const v of $$('.view')) {
      const c = cs(v);
      out.views[v.id || '(noid)'] = {
        active: v.classList.contains('active'),
        opacity: c ? c.opacity : null,
        visibility: c ? c.visibility : null
      };
    }
    out.activeView = ($$('.view.active')[0] || {}).id || null;
    out.rects = {
      header: rect($('.global-header')),
      brand: rect($('.brand-title')),
      sidebar: rect($('.sidebar')),
      contentArea: rect($('.content-area')),
      tabNav: rect($('.tab-nav')),
      enterBtn: rect($('.main-enter-btn')),
      certEnterBtn: rect($('.cert-enter-btn')),
      centerContent: rect($('.center-content')),
      panel: rect($('.panel-container')),
      sectionTitle: rect($('.tab-content.active .section-title')),
      sponsorCard: rect($('.sponsor-card')),
      minimalTable: rect($('.minimal-table')),
      certInner: rect($('.cert-inner')),
      certInput: rect($('#cert-name-input')),
      certDownloadBtn: rect($('.cert-download-btn'))
    };
    out.styles = {
      body: pick(document.body, ['background-color', 'color', 'font-family', 'font-size', 'letter-spacing']),
      htmlFontSize: cs(document.documentElement).fontSize,
      header: pick($('.global-header'), ['height', 'background-color', 'border-bottom', 'display', 'padding']),
      brand: pick($('.brand-title'), ['font-size', 'letter-spacing', 'font-weight', 'color']),
      sidebar: pick($('.sidebar'), ['width', 'padding', 'border-right']),
      yearItem: pick($('.year-item.active') || $('.year-item'), ['font-size', 'letter-spacing', 'padding', 'color', 'border-right']),
      enterBtn: pick($('.main-enter-btn'), ['background-color', 'color', 'font-size', 'font-weight', 'letter-spacing', 'padding', 'transform', 'box-shadow', 'clip-path', 'border', 'min-width', 'transition']),
      certBtn: pick($('.cert-enter-btn'), ['background-color', 'color', 'font-size', 'letter-spacing', 'padding', 'transform', 'box-shadow', 'border', 'transition']),
      tabBtnActive: pick($('.tab-btn.active'), ['color', 'letter-spacing', 'font-size', 'border-bottom']),
      tabBtn: pick($('.tab-btn'), ['color', 'letter-spacing', 'font-size', 'border-bottom']),
      sectionTitle: pick($('.tab-content.active .section-title'), ['font-size', 'letter-spacing', 'color', 'font-weight']),
      sponsorCard: pick($('.sponsor-card'), ['background-color', 'border-color', 'height', 'font-size', 'letter-spacing', 'padding']),
      detailText: pick($('#detail-text'), ['font-size', 'line-height', 'color', 'letter-spacing'])
    };
    out.scramble = {
      brand: scram($('.brand-title')),
      enter: scram($('.main-enter-btn')),
      certEnter: scram($('.cert-enter-btn')),
      tabTitle: scram($('.tab-content.active .section-title')),
      certTitle: scram($('#cert-view .section-title'))
    };
    out.headerBtns = $$('.header-actions .home-icon-btn').map((el) => {
      const a = getComputedStyle(el, '::after');
      const before = getComputedStyle(el, '::before');
      return {
        text: (el.innerText || '').replace(/\\s+/g, ' ').trim(),
        style: pick(el, ['background-color', 'color', 'border', 'letter-spacing', 'padding', 'box-shadow']),
        after: { content: a.content, opacity: a.opacity, transform: a.transform },
        before: { content: before.content, opacity: before.opacity, transform: before.transform }
      };
    });
    out.tabBtns = $$('.tab-btn').map((el) => {
      const c = cs(el);
      return {
        text: (el.innerText || '').trim(),
        active: el.classList.contains('active'),
        color: c.color,
        letterSpacing: c.letterSpacing,
        borderBottom: c.borderBottom
      };
    });
    out.activeTab = (($('.tab-btn.active') || {}).innerText || '').trim() || null;
    out.yearItems = $$('.year-item').map((el) => (el.innerText || '').trim());
    out.activeYear = (($('.year-item.active') || {}).innerText || '').trim() || null;
    out.detailText = (($('#detail-text') || {}).innerText || '').trim() || null;
    out.rankRows = $$('#rank-tbody tr').length;
    out.sponsorCount = $$('.sponsor-card').length;
    out.sponsorNames = $$('.sponsor-card').map((el) => (el.innerText || '').trim());
    const sc = $('.sponsor-card');
    if (sc) {
      const c = cs(sc);
      const a = getComputedStyle(sc, '::after');
      out.sponsorFirst = {
        borderColor: c.borderColor,
        background: c.backgroundColor,
        after: { opacity: a.opacity, transform: a.transform, animation: a.animation, backgroundImage: (a.backgroundImage || '').slice(0, 140) }
      };
    }
    const enter = $('.main-enter-btn');
    if (enter) {
      const c = cs(enter);
      out.enterHoverState = {
        background: c.backgroundColor,
        color: c.color,
        letterSpacing: c.letterSpacing,
        transform: c.transform,
        boxShadow: c.boxShadow
      };
    }
    out.cert = {
      yearBtns: $$('.cert-year-btn').map((b) => (b.innerText || '').trim()),
      activeYear: (($('.cert-year-btn.active') || {}).innerText || '').trim() || null,
      inputValue: $('#cert-name-input') ? $('#cert-name-input').value : null,
      inputPlaceholder: $('#cert-name-input') ? $('#cert-name-input').placeholder : null,
      resultText: (($('#cert-result') || {}).innerText || '').trim().slice(0, 300) || null
    };
    out.fonts = {
      status: document.fonts ? document.fonts.status : null,
      loaded: document.fonts
        ? Array.from(document.fonts).filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.weight)
        : []
    };
    out.decorRects = $$('.home-decor').map((el) => {
      const r = rect(el);
      return { cls: el.className, text: (el.innerText || '').trim(), x: r ? r.x : null, y: r ? r.y : null, w: r ? r.w : null, h: r ? r.h : null };
    });
  } catch (e) {
    out.probeError = String((e && e.stack) || e);
  }
  return out;
})()`;

/* ------------------------------------------------------------------ */
/* 步骤执行                                                             */
/* ------------------------------------------------------------------ */

async function runStep(cdp, step, ctx) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    throw new Error(`步骤必须是对象: ${short(step)}`);
  }

  if ('wait' in step) {
    const ms = Math.max(0, Number(step.wait) || 0);
    await sleep(ms);
    return `wait ${ms}ms`;
  }

  if ('viewport' in step) {
    const v = Array.isArray(step.viewport)
      ? { width: Number(step.viewport[0]), height: Number(step.viewport[1]), mobile: false }
      : {
        width: Number(step.viewport.width),
        height: Number(step.viewport.height),
        mobile: !!step.viewport.mobile,
      };
    if (!(v.width >= 1 && v.height >= 1)) throw new Error(`非法视口: ${short(step.viewport)}`);
    await applyViewport(cdp, v.width, v.height, v.mobile);
    ctx.viewport = v;
    return `viewport ${v.width}x${v.height} mobile=${v.mobile}`;
  }

  if ('eval' in step) {
    const expr = String(step.eval);
    const r = await evaluate(cdp, expr);
    let serialized;
    try {
      serialized = r === undefined ? 'undefined' : JSON.stringify(r);
    } catch {
      serialized = String(r);
    }
    if (Array.isArray(ctx.diag.evals)) {
      ctx.diag.evals.push({
        index: ctx.stepIndex,
        expression: expr.slice(0, 4000),
        result: String(serialized).slice(0, 8000),
      });
    }
    return `eval -> ${short(serialized, 120)}`;
  }

  if ('navigate' in step) {
    const r = await waitForLoad(cdp, String(step.navigate), ctx.navTimeout);
    ctx.tNav = r.tNav;
    ctx.tDcl = r.tDcl;
    ctx.tLoad = r.tLoad || now();
    ctx.loadTimedOut = !r.tLoad;
    return `navigate ${short(String(step.navigate), 100)} (load ${r.tLoad ? r.tLoad - r.tNav : 'timeout'}ms)`;
  }

  if ('hover' in step) {
    const sel = String(step.hover);
    const info = await elementCenter(cdp, sel);
    await mouseMove(cdp, info.x, info.y);
    return `hover ${sel} @(${round(info.x)}, ${round(info.y)})`;
  }

  if ('click' in step) {
    const sel = String(step.click);
    const info = await elementCenter(cdp, sel);
    await mouseClick(cdp, info.x, info.y);
    return `click ${sel} @(${round(info.x)}, ${round(info.y)})`;
  }

  if ('scroll' in step) {
    if (Array.isArray(step.scroll)) {
      await evaluate(cdp, `window.scrollTo(${Number(step.scroll[0]) || 0}, ${Number(step.scroll[1]) || 0}); true`);
      return `scrollTo ${step.scroll[0]},${step.scroll[1]}`;
    }
    const sel = String(step.scroll);
    await evaluate(cdp, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.scrollIntoView({ block: 'center' }); return true; })()`);
    return `scrollIntoView ${sel}`;
  }

  if ('shot' in step) {
    const raw = step.shot;
    const name = typeof raw === 'string' ? raw : (raw && raw.name) || '';
    if (!name) throw new Error('shot 步骤缺少文件名');
    const safeName = path.basename(String(name));
    const file = path.join(ctx.outDir, safeName.endsWith('.png') ? safeName : `${safeName}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });

    // 1) 先采探针（几毫秒），记录该帧的 DOM/动画状态
    const probeStart = now();
    let probe = null;
    try {
      probe = await evaluate(cdp, PROBE_JS, 20000);
    } catch (e) {
      probe = { probeError: String((e && e.message) || e) };
    }
    const probeMs = now() - probeStart;

    // 2) 截图
    await cdp.send('Page.bringToFront', {}, 10000).catch(() => {});
    const capStart = now();
    const cap = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    }, 30000);
    const captureMs = now() - capStart;
    const buf = Buffer.from(cap.data, 'base64');
    const size = pngSize(buf);
    fs.writeFileSync(file, buf);

    const expected = ctx.viewport;
    ctx.diag.shots.push({
      name: safeName,
      file,
      bytes: buf.length,
      width: size ? size.width : null,
      height: size ? size.height : null,
      expectedWidth: expected.width,
      expectedHeight: expected.height,
      msSinceNav: probeStart - ctx.tNav,
      msSinceLoad: ctx.tLoad ? probeStart - ctx.tLoad : null,
      probeMs,
      captureMs,
      probe,
    });

    log(`           shot ${safeName}  ${size ? `${size.width}x${size.height}` : '?'}  ${buf.length}B  ` +
        `+${probeStart - ctx.tNav}ms(since nav)  probe ${probeMs}ms  capture ${captureMs}ms  -> ${file}`);

    if (!size) throw new Error(`截图不是合法 PNG: ${file}`);
    if (size.width !== expected.width || size.height !== expected.height) {
      throw new Error(`截图尺寸 ${size.width}x${size.height} 与期望 ${expected.width}x${expected.height} 不一致: ${file}`);
    }
    return `shot ${safeName} ${size.width}x${size.height} ${buf.length}B`;
  }

  throw new Error(`未知步骤类型: ${short(step)}`);
}

/* ------------------------------------------------------------------ */
/* 主流程                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  const stepsCfg = loadSteps(args.steps);
  const url = args.url || stepsCfg.url;
  if (!url) throw new Error('缺少 --url（或 steps json 中的 url 字段）');
  if (!args.out) throw new Error('缺少 --out');
  if (stepsCfg.width) args.width = Number(stepsCfg.width);
  if (stepsCfg.height) args.height = Number(stepsCfg.height);
  if (stepsCfg.mobile !== undefined) args.mobile = !!stepsCfg.mobile;
  if (!args.label && stepsCfg.label) args.label = String(stepsCfg.label);

  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const diagPath = args.diag ? path.resolve(args.diag) : path.join(outDir, '_diagnostics.json');
  fs.mkdirSync(path.dirname(diagPath), { recursive: true });

  const chromePath = findChrome(args.chrome);
  const port = args.port || await getFreePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-chrome-'));
  const stderrSink = { buf: '', spawnError: null };

  const diag = {
    tool: 'qa/shoot.mjs',
    label: args.label || '',
    url: String(url),
    finalUrl: null,
    stepsFile: stepsCfg.file,
    chrome: chromePath,
    viewport: { width: args.width, height: args.height, mobile: !!args.mobile },
    startedAt: new Date().toISOString(),
    chromePort: port,
    browser: null,
    protocolVersion: null,
    nav: null,
    shots: [],
    console: [],
    exceptions: [],
    logEntries: [],
    networkErrors: [],
    failedRequests: [],
    stepFailures: [],
    evals: [],
  };

  let child = null;
  let cdp = null;
  let exitCode = 0;

  try {
    log(`[qa] Chrome : ${chromePath}`);
    log(`[qa] 视口   : ${args.width}x${args.height}${args.mobile ? ' (mobile)' : ''}`);
    log(`[qa] 目标   : ${url}`);
    log(`[qa] 输出   : ${outDir}`);
    log(`[qa] 步骤   : ${stepsCfg.steps.length} 步 (${stepsCfg.file})`);

    child = launchChrome(chromePath, port, tmpDir, args.width, args.height, stderrSink);
    const info = await waitForDevtools(port, CHROME_START_TIMEOUT, () => stderrSink.buf);
    diag.browser = info.Browser || null;
    diag.protocolVersion = info['Protocol-Version'] || null;
    log(`[qa] 浏览器 : ${diag.browser || '(unknown)'} / CDP ${diag.protocolVersion || '?'}`);

    const pageWs = await waitForPageTarget(port, 15000);
    cdp = await CDP.connect(pageWs);
    log('[qa] 已连接页面 target');

    // 事件收集（console / 异常 / 404）
    const requestUrls = new Map();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});

    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type !== 'error' && p.type !== 'warning' && p.type !== 'assert') return;
      const text = (p.args || []).map((a) => {
        if (a.value !== undefined) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
        return a.description || a.unserializableValue || '';
      }).join(' ');
      const frame = (p.stackTrace && p.stackTrace.callFrames && p.stackTrace.callFrames[0]) || {};
      diag.console.push({ type: p.type, text: String(text).slice(0, 1500), url: frame.url || null, line: frame.lineNumber });
    });
    cdp.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails || {};
      const ex = d.exception || {};
      diag.exceptions.push({
        text: String(ex.description || d.text || 'unknown exception').slice(0, 2000),
        url: d.url || null,
        line: d.lineNumber,
        source: d.sourceURL || null,
      });
    });
    cdp.on('Log.entryAdded', (p) => {
      const e = p.entry || {};
      if (e.level !== 'error' && e.level !== 'warning') return;
      diag.logEntries.push({ level: e.level, source: e.source || null, text: String(e.text || '').slice(0, 1500), url: e.url || null });
    });
    cdp.on('Network.requestWillBeSent', (p) => {
      if (p.request && p.request.url) requestUrls.set(p.requestId, p.request.url);
    });
    cdp.on('Network.responseReceived', (p) => {
      const r = p.response || {};
      if (r.status >= 400) {
        diag.networkErrors.push({
          url: r.url,
          status: r.status,
          statusText: r.statusText || '',
          type: p.type || null,
          mimeType: r.mimeType || null,
        });
      }
    });
    cdp.on('Network.loadingFailed', (p) => {
      if (p.canceled) return;
      diag.failedRequests.push({
        url: requestUrls.get(p.requestId) || null,
        errorText: p.errorText || '',
        type: p.type || null,
      });
    });

    await applyViewport(cdp, args.width, args.height, args.mobile);

    log('[qa] 导航中 …');
    const nav = await waitForLoad(cdp, String(url), args.navTimeout);
    if (!nav.tLoad) log(`[qa] 警告: 等待 load 事件超时 (${args.navTimeout}ms)，继续执行步骤`);
    diag.finalUrl = await evaluate(cdp, 'location.href').catch(() => null);
    diag.nav = {
      requestedUrl: String(url),
      finalUrl: diag.finalUrl,
      loadMs: nav.tLoad ? nav.tLoad - nav.tNav : null,
      domContentLoadedMs: nav.tDcl ? nav.tDcl - nav.tNav : null,
      loadTimedOut: !nav.tLoad,
    };
    log(`[qa] 加载完成: DCL ${nav.tDcl ? `${nav.tDcl - nav.tNav}ms` : 'timeout'} / load ${nav.tLoad ? `${nav.tLoad - nav.tNav}ms` : 'timeout'}`);

    const ctx = {
      cdp,
      outDir,
      diag,
      navTimeout: args.navTimeout,
      viewport: { width: args.width, height: args.height, mobile: !!args.mobile },
      tNav: nav.tNav,
      tLoad: nav.tLoad || now(),
      loadTimedOut: !nav.tLoad,
    };

    for (let i = 0; i < stepsCfg.steps.length; i++) {
      const step = stepsCfg.steps[i];
      ctx.stepIndex = i;
      const t0 = now();
      const detail = JSON.stringify(step);
      try {
        const desc = await runStep(cdp, step, ctx);
        log(`[+${now() - ctx.tNav}ms] ${String(i + 1).padStart(2)}/${stepsCfg.steps.length} ${short(detail, 110)} → ${desc} (${now() - t0}ms)`);
      } catch (e) {
        exitCode = 1;
        const msg = (e && e.message) || String(e);
        diag.stepFailures.push({ index: i, step, error: msg, elapsedMs: now() - t0 });
        log(`[+${now() - ctx.tNav}ms] ${String(i + 1).padStart(2)}/${stepsCfg.steps.length} ${short(detail, 110)} → 失败: ${msg}`);
      }
    }

    diag.finishedAt = new Date().toISOString();
    diag.finalViewport = ctx.viewport;
    const errors = diag.exceptions.length + diag.console.filter((c) => c.type === 'error').length;
    log('');
    log(`[qa] 完成: ${diag.shots.length} 张截图, ${diag.stepFailures.length} 个步骤失败, ` +
        `JS 异常 ${diag.exceptions.length}, console error ${diag.console.filter((c) => c.type === 'error').length}, ` +
        `HTTP>=400 ${diag.networkErrors.length}, 失败请求 ${diag.failedRequests.length}`);
    if (errors > 0) {
      for (const ex of diag.exceptions.slice(0, 5)) log(`     [exception] ${short(ex.text, 200)}`);
    }
    if (diag.networkErrors.length > 0) {
      for (const ne of diag.networkErrors.slice(0, 8)) log(`     [http ${ne.status}] ${short(ne.url, 160)}`);
    }
  } catch (e) {
    exitCode = 2;
    diag.fatalError = String((e && e.stack) || e);
    log(`[qa] 致命错误: ${(e && e.message) || e}`);
    if (stderrSink.buf) log(`[qa] Chrome stderr 末尾:\n${stderrSink.buf.slice(-2000)}`);
  } finally {
    try {
      if (cdp) cdp.close();
    } catch { /* ignore */ }
    killChromeTree(child);
    await sleep(150);
    rmDirQuiet(tmpDir);
    try {
      diag.chromeStderrTail = stderrSink.buf ? stderrSink.buf.slice(-3000) : null;
      fs.writeFileSync(diagPath, `${JSON.stringify(diag, null, 2)}\n`, 'utf8');
      log(`[qa] 诊断信息: ${diagPath}`);
    } catch (e) {
      log(`[qa] 写入诊断信息失败: ${e.message}`);
    }
  }

  return exitCode;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => {
    console.error(`[qa] 未捕获错误: ${(e && e.stack) || e}`);
    process.exitCode = 2;
  });
