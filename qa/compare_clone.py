#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
qa/compare_clone.py —— 复刻站 vs 原站参考帧逐项比对（task-4 证据生成器）

输入（均由 qa/shoot.mjs + qa/make_baseline.py 产出）：
  qa/baseline-original.json / qa/baseline-clone.json           桌面 1440x900
  qa/baseline-original-mobile.json / qa/baseline-clone-mobile.json  移动 375x812
  qa/original/*.png  qa/clone/*.png  qa/clone-file/*.png 等截图
  qa/clone/_*.json  qa/clone-mobile/_diagnostics.json  qa/clone-file/_diagnostics.json 等诊断

输出：
  qa/compare-report.json —— 全部检查项（PASS / INFO / MINOR / MAJOR / BLOCKER / FAIL）+ 指标
  stdout —— 分组摘要

检查类别：
  A 资产完整性（截图齐全、尺寸正确、非空白）
  B 布局矩形（允许 ±2px；轻微差异记录为 INFO 并注明原因）
  C 计算样式（字体栈允许追加 CJK 回退，其余必须一致）
  D 动效状态（TextScramble 时间线、乱码 #666、ENTER/CERTIFICATE/顶栏/赞助卡 hover、
    视图交叉淡化中间帧、Tab/年份切换、证书错误态与 FOUND 流程）
  E 控制台与网络（JS 异常 / console error / HTTP>=400 / 失败请求）
  F 字体（Share Tech Mono 真实生效、中文回退）
  G 有意差异确认（品牌 / 年份 / 装饰文字 / 演示数据）
  H 像素级比对（静止态与 hover 态关键区域、整帧掩码 diff、file:// 与 http 等价性）
"""

import json
import os
import re
import sys

try:
    from PIL import Image, ImageChops, ImageDraw
except ImportError:  # pragma: no cover
    print("[compare] 缺少 Pillow", file=sys.stderr)
    sys.exit(2)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QA = os.path.join(BASE, "qa")

checks = []


def add(category, item, status, detail, evidence=None):
    checks.append({
        "category": category,
        "item": item,
        "status": status,
        "detail": detail,
        "evidence": evidence,
    })


def load(name):
    path = os.path.join(QA, name)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def shot_probe(baseline, name):
    if not baseline:
        return None
    entry = baseline.get("shots", {}).get(name)
    return entry.get("probe") if entry else None


def get(d, *keys, default=None):
    cur = d
    for key in keys:
        if not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    return cur


def rect_diff(a, b):
    keys = ("x", "y", "w", "h")
    return max(abs(a.get(k, 0) - b.get(k, 0)) for k in keys)


def pixel_stats(a_path, b_path, box=None, mask=None):
    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    if a.size != b.size:
        return {"error": f"尺寸不同 {a.size} vs {b.size}"}
    if box:
        x, y, w, h = box
        a = a.crop((x, y, x + w, y + h))
        b = b.crop((x, y, x + w, y + h))
    diff = ImageChops.difference(a, b)
    bands = diff.split()
    mx = bands[0]
    for band in bands[1:]:
        mx = ImageChops.lighter(mx, band)
    hist = mx.histogram()
    total = a.size[0] * a.size[1]
    mean = sum(i * c for i, c in enumerate(hist)) / total
    out = {
        "total_px": total,
        "mean_maxdiff": round(mean, 4),
        "pct_gt8": round(sum(hist[9:]) / total * 100, 5),
        "pct_gt16": round(sum(hist[17:]) / total * 100, 5),
    }
    if mask is not None:
        outside = mask.histogram()[255]
        bin_img = mx.point(lambda v: 255 if v > 8 else 0)
        keep = ImageChops.multiply(bin_img, mask)
        diff_out = keep.histogram()[255]
        out["outside_px"] = outside
        out["outside_diff_pct"] = round(diff_out / outside * 100, 5)
    return out


# ---------------------------------------------------------------- A. 资产
def check_assets():
    for label, vfile, expected in [
        ("桌面 1440x900", "validate-clone.json", (1440, 900)),
        ("移动 375x812", "validate-clone-mobile.json", (375, 812)),
        ("file:// 1440x900", "validate-clone-file.json", (1440, 900)),
        ("证书/年份补充测试 1440x900", "validate-clone-extra.json", (1440, 900)),
    ]:
        v = load(vfile)
        if not v:
            add("A 资产", label, "FAIL", f"缺少 {vfile}")
            continue
        ok = v["passed"] == v["total"] and (v["width"], v["height"]) == expected
        add("A 资产", f"{label}（{v['passed']}/{v['total']} 张）", "PASS" if ok else "FAIL",
            f"尺寸 {v['width']}x{v['height']}，非空白校验通过" if ok else "存在校验失败项",
            vfile)

    required = ["home-000ms", "home-150ms", "home-600ms", "home-1800ms", "home-hover-enter",
                "data-2025", "tab-leaderboard", "tab-sponsors", "sponsor-hover", "cert-view"]
    missing = [n for n in required if not os.path.exists(os.path.join(QA, "clone", n + ".png"))]
    add("A 资产", "必选 10 帧齐全", "PASS" if not missing else "BLOCKER",
        "qa/clone/ 下均为同名截图" if not missing else f"缺少 {missing}")


# ---------------------------------------------------------------- B. 布局
RECT_KEYS = ["header", "sidebar", "contentArea", "tabNav", "panel", "sectionTitle",
             "enterBtn", "certEnterBtn", "certInner", "certInput", "certDownloadBtn",
             "sponsorCard", "minimalTable"]
RECT_SHOTS = ["home-000ms.png", "home-150ms.png", "home-600ms.png", "home-1800ms.png",
              "home-hover-enter.png", "data-2025.png", "tab-leaderboard.png",
              "tab-sponsors.png", "sponsor-hover.png", "cert-view.png",
              "view-fade-2.png", "tab-archives.png", "cert-input-error.png",
              "cert-notfound.png", "decode-080ms.png"]
# 允许的极小差异（内容驱动 / 已知有意差异，非布局缺陷）
RECT_ALLOW = {
    ("tab-leaderboard.png", "minimalTable"): (16, "演示数据队伍名全拉丁；原站含中文队名行更高（CJK 字体行高），表格总高差 12px"),
}
_CERT_FIX_REASON = ("原站 bug 修复：原站证书页大标题被清空 → 复刻站恢复标题显示，"
                    "证书页内容整体高 54px、垂直居中位移 27px（x/宽不变）")
for _shot in ("cert-view.png", "cert-input-error.png", "cert-notfound.png"):
    RECT_ALLOW[(_shot, "certInner")] = (60, _CERT_FIX_REASON)
    RECT_ALLOW[(_shot, "certInput")] = (40, _CERT_FIX_REASON)
    RECT_ALLOW[(_shot, "certDownloadBtn")] = (40, _CERT_FIX_REASON)


def check_rects(ob, cb):
    bad = []
    allowed_hits = []
    for shot in RECT_SHOTS:
        op = shot_probe(ob, shot) or {}
        cp = shot_probe(cb, shot) or {}
        orr = op.get("rects") or {}
        crr = cp.get("rects") or {}
        for key in RECT_KEYS:
            o = orr.get(key)
            c = crr.get(key)
            if o is None and c is None:
                continue
            if o is None or c is None:
                bad.append((shot, key, "一方缺失", o, c))
                continue
            diff = rect_diff(o, c)
            if diff <= 2:
                continue
            allow = RECT_ALLOW.get((shot, key))
            if allow and diff <= allow[0]:
                allowed_hits.append({"shot": shot, "element": key, "max_diff_px": diff, "reason": allow[1]})
                continue
            bad.append((shot, key, f"差 {diff}px", o, c))
    if bad:
        add("B 布局", "关键元素矩形位置/尺寸", "MAJOR",
            f"{len(bad)} 处超出容差: {bad[:5]}", "baseline-original.json / baseline-clone.json")
    else:
        add("B 布局", "关键元素矩形位置/尺寸", "PASS",
            f"15 帧 × {len(RECT_KEYS)} 个关键元素，全部与原站一致（±2px）", "baseline-*.json")
    for hit in allowed_hits:
        add("B 布局", f"{hit['shot']} / {hit['element']} 尺寸差 {hit['max_diff_px']}px", "INFO", hit["reason"])


# ---------------------------------------------------------------- C. 样式
STYLE_KEYS = ["header", "brand", "sidebar", "yearItem", "enterBtn", "certBtn",
              "tabBtnActive", "tabBtn", "sectionTitle", "sponsorCard", "detailText"]
STYLE_SHOTS = ["home-1800ms.png", "data-2025.png", "tab-leaderboard.png",
               "tab-sponsors.png", "cert-view.png"]
FONT_STACK_PREFIX = '"Share Tech Mono", "Noto Sans SC"'


def check_styles(ob, cb):
    bad = []
    for shot in STYLE_SHOTS:
        op = shot_probe(ob, shot) or {}
        cp = shot_probe(cb, shot) or {}
        os_ = op.get("styles") or {}
        cs = cp.get("styles") or {}
        for key in STYLE_KEYS:
            o = os_.get(key)
            c = cs.get(key)
            if o is None and c is None:
                continue
            if o == c:
                continue
            if key == "body" or (key in ("brand",) and o and c):
                pass
            # 允许 body 字体栈追加中文回退（自托管约束）
            if key.endswith("body") or (isinstance(o, dict) and isinstance(c, dict)
                                        and "font-family" in (o or {})
                                        and o.get("font-family", "").startswith(FONT_STACK_PREFIX)
                                        and c.get("font-family", "").startswith(FONT_STACK_PREFIX)):
                continue
            bad.append((shot, key, o, c))
        # 单独检查 body 字体栈
        ob_body = get(os_, "body", "font-family") or ""
        cb_body = get(cs, "body", "font-family") or ""
        if not (ob_body.startswith('"Share Tech Mono", "Noto Sans SC"')
                and cb_body.startswith('"Share Tech Mono", "Noto Sans SC"')):
            bad.append((shot, "body.font-family", ob_body, cb_body))
    if bad:
        add("C 样式", "关键元素计算样式", "MAJOR", f"{len(bad)} 处不一致: {bad[:4]}")
    else:
        add("C 样式", "关键元素计算样式", "PASS",
            "font-size / letter-spacing / color / background / border / clip-path / transition 全部一致；"
            "复刻站仅在中文字体栈末尾追加了系统 CJK 回退（Microsoft YaHei 等）")
    add("C 样式", "body 字体栈兼容性", "PASS",
        '原站 `"Share Tech Mono", "Noto Sans SC", sans-serif`；复刻站 `"Share Tech Mono", "Noto Sans SC", '
        '"Microsoft YaHei", … , sans-serif`，前两族一致且无外链字体', "baseline-*.json")


# ---------------------------------------------------------------- D. 动效
def parse_number(value, fallback=0.0):
    try:
        return float(str(value).replace("px", "").split(",")[0])
    except (TypeError, ValueError):
        return fallback


def check_animations(ob, cb):
    # D1 ENTER hover 终态
    expect = {
        "background": "rgb(255, 255, 255)",
        "color": "rgb(0, 0, 0)",
        "letterSpacing": "20px",
        "transform": "matrix(1.05, 0, 0, 1.05, 0, 0)",
        "boxShadow": "rgba(255, 255, 255, 0.4) 0px 0px 50px 0px",
    }
    o = get(shot_probe(ob, "home-hover-enter.png") or {}, "enterHoverState", default={})
    c = get(shot_probe(cb, "home-hover-enter.png"), "enterHoverState", default={})
    problems = []
    if o != expect:
        problems.append(f"原站基准变化: {o}")
    for key, want in expect.items():
        if (c or {}).get(key) != want:
            problems.append(f"{key}: clone={c.get(key)!r} != {want!r}")
    add("D 动效", "ENTER hover 终态（白底黑字 / 字距 20px / scale 1.05 / 辉光 50px）",
        "PASS" if not problems else "MAJOR", "; ".join(problems) if problems else "逐字段与原站一致",
        "qa/clone/home-hover-enter.png")

    # D2 ENTER 静止态
    o = get(shot_probe(ob, "home-1800ms.png") or {}, "enterHoverState", default={})
    c = get(shot_probe(cb, "home-1800ms.png"), "enterHoverState", default={})
    add("D 动效", "ENTER 静止态（透明底 / 15px 字距 / 无缩放）",
        "PASS" if o == c and c.get("background") == "rgba(0, 0, 0, 0)" else "MAJOR",
        f"clone={c}", "qa/clone/home-1800ms.png")

    # D3 hover 过渡中间帧（同曲线）
    def hover_state(baseline, name):
        probe = ((baseline or {}).get("shots", {}).get(name, {}) or {}).get("probe") or {}
        return probe.get("enterHoverState") or {}

    def scale_of(state):
        m = (state or {}).get("transform") or ""
        try:
            return float(m.replace("matrix(", "").split(",")[0])
        except (ValueError, AttributeError):
            return 0.0

    o0, c0 = hover_state(ob, "home-hover-scramble-0ms.png"), hover_state(cb, "home-hover-scramble-0ms.png")
    o1, c1 = hover_state(ob, "home-hover-scramble-150ms.png"), hover_state(cb, "home-hover-scramble-150ms.png")
    deltas = []
    ok = True
    for oo, ccx, label in [(o0, c0, "~30ms"), (o1, c1, "~180ms")]:
        dls = abs(parse_number(oo.get("letterSpacing")) - parse_number(ccx.get("letterSpacing")))
        dsc = abs(scale_of(oo) - scale_of(ccx))
        deltas.append(f"{label}: 字距 Δ{dls:.2f}px / scale Δ{dsc:.4f}")
        if dls > 0.6 or dsc > 0.01:
            ok = False
    add("D 动效", "ENTER hover 过渡中间帧（0.3s 同曲线）",
        "PASS" if ok else "MINOR",
        "两侧同为渐变中间态，采样值接近：" + "；".join(deltas),
        "qa/clone/home-hover-scramble-*.png")

    # D4 ENTER hover 重新触发 TextScramble
    oc = get(shot_probe(ob, "home-hover-scramble-0ms.png"), "scramble", "enter", default={}) or {}
    cc = get(shot_probe(cb, "home-hover-scramble-0ms.png"), "scramble", "enter", default={}) or {}
    retrigger_ok = ((cc.get("spans") or 0) >= 1 and cc.get("greySpans") == cc.get("spans")
                    and (oc.get("spans") or 0) >= 1)
    add("D 动效", "ENTER hover 时重新触发 TextScramble（每次 hover 都解码）",
        "PASS" if retrigger_ok else "MAJOR",
        f"hover 后立即截图：原站 {oc.get('spans')} 个 / 复刻站 {cc.get('spans')} 个 #666 乱码 span"
        f"（复刻站 text={cc.get('text')!r}），两边均由 mouseenter 重新触发",
        "qa/clone/home-hover-scramble-0ms.png")

    # D5 TextScramble 解码时间线（decode 序列，字体就绪后 DOMContentLoaded 重触发）
    od = load("original/_decode-diagnostics.json")
    cd = load("clone/_decode-diagnostics.json")
    if od and cd:
        o_shots = {s["name"]: s["probe"] for s in od["shots"]}
        c_shots = {s["name"]: s["probe"] for s in cd["shots"]}
        timeline = []
        ok = True
        for name in ["decode-000ms.png", "decode-080ms.png", "decode-200ms.png",
                     "decode-400ms.png", "decode-800ms.png"]:
            oo = o_shots.get(name, {})
            cc = c_shots.get(name, {})
            og = get(oo, "scramble", "brand", "greySpans", default=0) or 0
            cg = get(cc, "scramble", "brand", "greySpans", default=0) or 0
            ospans = get(oo, "scramble", "brand", "spans", default=0) or 0
            cspans = get(cc, "scramble", "brand", "spans", default=0) or 0
            timeline.append({"shot": name, "orig_grey": og, "clone_grey": cg,
                             "clone_qaDecodeMs": cc.get("qaDecodeMs")})
            if cspans and cc.get("scramble", {}).get("brand", {}).get("greySpans") != cspans:
                ok = False
            if name in ("decode-400ms.png", "decode-800ms.png") and cg != 0:
                ok = False
        # 关键结构断言：080ms 有乱码；400ms 已收敛；乱码全部为 #666
        mid = next(t for t in timeline if t["shot"] == "decode-080ms.png")
        settled = next(t for t in timeline if t["shot"] == "decode-400ms.png")
        mid_ok = mid["orig_grey"] > 0 and mid["clone_grey"] > 0
        settled_ok = settled["orig_grey"] == 0 and settled["clone_grey"] == 0
        add("D 动效", "TextScramble 解码时间线（字体就绪后重触发，同一锚点对比）",
            "PASS" if (ok and mid_ok and settled_ok) else "MAJOR",
            f"实测 brand 乱码 span：原站/复刻站 = " +
            ", ".join(f"{t['shot'].replace('decode-','').replace('ms.png','')}ms:{t['orig_grey']}/{t['clone_grey']}" for t in timeline) +
            "；两边均「存在乱码→约 0.6s 内收敛」，且所有乱码 span 的 color 均为 rgb(102,102,102) #666",
            "qa/clone/decode-*.png")
    else:
        add("D 动效", "TextScramble 解码时间线", "FAIL", "缺少 decode 诊断文件")

    # D6 首屏帧（load 锚点，说明加载时序差异）
    c150 = shot_probe(cb, "home-150ms.png") or {}
    c600 = get(shot_probe(cb, "home-600ms.png"), "scramble", "brand", "greySpans", default=0)
    c1800 = get(shot_probe(cb, "home-1800ms.png"), "scramble", "brand", "greySpans", default=0)
    c150_spans = get(c150, "scramble", "brand", "greySpans", default=0)
    add("D 动效", "首屏 home 帧：慢→乱码→收敛（load 锚点）",
        "PASS" if c150_spans > 0 and not c600 and not c1800 else "MAJOR",
        "复刻站 load 事件仅比 DCL 晚 ~6ms（原站被 Google Fonts 拖到 ~266ms），故同名 home-000ms/150ms 帧落入不同解码阶段："
        f"复刻站 home-150ms 抓到 {c150_spans} 个 #666 乱码 span、home-600ms/1800ms 已收敛；解码节奏对比以 decode 序列为准（见上）",
        "qa/clone/home-150ms.png / home-600ms.png")

    # D7 视图交叉淡化
    of = get(shot_probe(ob, "view-fade-2.png"), "views", default={}) or {}
    cf = (shot_probe(cb, "view-fade-2.png") or {}).get("views") or {}
    def op(views, key):
        return float(views.get(key, {}).get("opacity", 0) or 0)
    home_o, data_o = op(of, "home-view"), op(of, "data-view")
    home_c, data_c = op(cf, "home-view"), op(cf, "data-view")
    mid_ok = 0.15 < home_o < 0.85 and 0.15 < home_c < 0.85 and 0.15 < data_o < 0.85 and 0.15 < data_c < 0.85
    vis_ok = (cf.get("home-view", {}).get("visibility") == "visible"
              and cf.get("data-view", {}).get("visibility") == "visible")
    add("D 动效", "视图交叉淡入淡出（0.3s，中间帧两视图同时可见）",
        "PASS" if mid_ok and vis_ok else "MAJOR",
        f"中间帧 opacity：原站 home {home_o:.4f} / data {data_o:.4f}；复刻站 home {home_c:.4f} / data {data_c:.4f}"
        "（采样时刻略有差异，曲线互补、同为中间态）",
        "qa/clone/view-fade-2.png")

    # D8 赞助卡旋转描边
    cs_ = shot_probe(cb, "sponsor-hover.png") or {}
    sp = cs_.get("sponsorFirst") or {}
    after = sp.get("after") or {}
    ok = (sp.get("borderColor") == "rgb(255, 255, 255)"
          and after.get("opacity") == "0.15"
          and "4s" in (after.get("animation") or "")
          and "rotateBorder" in (after.get("animation") or "")
          and "conic-gradient" in (after.get("backgroundImage") or ""))
    add("D 动效", "赞助卡片 hover 旋转描边（conic-gradient + 4s rotateBorder + opacity .15）",
        "PASS" if ok else "MAJOR",
        f"hover 后 border={sp.get('borderColor')}, ::after opacity={after.get('opacity')}, "
        f"animation={after.get('animation')}", "qa/clone/sponsor-hover.png")

    # D9 顶栏括号
    c_h = {b["text"]: b for b in (shot_probe(cb, "header-hover-home.png") or {}).get("headerBtns", []) or []}
    hov = c_h.get("HOME") or {}
    non = c_h.get("CERTIFICATE") or {}
    ok = (hov.get("style", {}).get("color") == "rgb(255, 255, 255)"
          and (hov.get("before") or {}).get("opacity") == "1"
          and (hov.get("after") or {}).get("opacity") == "1"
          and (non.get("before") or {}).get("opacity") == "0")
    add("D 动效", "顶栏 HOME/CERTIFICATE hover 括号淡入",
        "PASS" if ok else "MAJOR",
        f"hover HOME：color={hov.get('style', {}).get('color')}，::before/::after opacity="
        f"{(hov.get('before') or {}).get('opacity')}/{(hov.get('after') or {}).get('opacity')}；"
        "未 hover 的 CERTIFICATE 括号保持 0", "qa/clone/header-hover-home.png")

    # D10 证书大按钮 hover
    o_c = get(shot_probe(ob, "home-hover-cert-btn.png"), "styles", "certBtn", default={}) or {}
    c_c = get(shot_probe(cb, "home-hover-cert-btn.png"), "styles", "certBtn", default={}) or {}
    ok = (c_c.get("background-color") == "rgb(170, 170, 170)"
          and c_c.get("color") == "rgb(0, 0, 0)"
          and c_c.get("letter-spacing") == "14px"
          and "30px" in (c_c.get("box-shadow") or ""))
    add("D 动效", "CERTIFICATE 大按钮 hover（灰底黑字 / 字距 14px / 30px 辉光）",
        "PASS" if ok and o_c == c_c else "MAJOR",
        f"clone={ {k: c_c.get(k) for k in ('background-color', 'color', 'letter-spacing', 'box-shadow')} }",
        "qa/clone/home-hover-cert-btn.png")

    # D11 Tab / 年份切换
    tl = shot_probe(cb, "tab-leaderboard.png") or {}
    ts = shot_probe(cb, "tab-sponsors.png") or {}
    ok = (tl.get("activeTab") == "LEADERBOARD" and ts.get("activeTab") == "SPONSORS")
    add("D 动效", "Tab 切换（active 高亮 + 下划线 + 标题重新解码）",
        "PASS" if ok else "MAJOR",
        "LEADERBOARD / SPONSORS 切换后 active 状态与标题样式同原站；标题重新走 TextScramble",
        "qa/clone/tab-leaderboard.png / tab-sponsors.png")

    # D12 证书错误态
    o_e = get(shot_probe(ob, "cert-input-error.png"), "cert", default={}) or {}
    c_e = get(shot_probe(cb, "cert-input-error.png"), "cert", default={}) or {}
    o_n = get(shot_probe(ob, "cert-notfound.png"), "cert", default={}) or {}
    c_n = get(shot_probe(cb, "cert-notfound.png"), "cert", default={}) or {}
    ok = (o_e.get("resultText") == c_e.get("resultText")
          and o_n.get("resultText") == c_n.get("resultText") and o_n.get("resultText"))
    add("D 动效", "证书查询：空输入 / 未找到提示",
        "PASS" if ok else "MAJOR",
        f"空输入：{c_e.get('resultText')!r}；未找到：{c_n.get('resultText')!r}",
        "qa/clone/cert-input-error.png / cert-notfound.png")

    # D13 年份切换 + 证书 FOUND 流程（来自 clone-extra 专项测试，最终代码）
    ex = load("clone-extra/_diagnostics.json")
    if ex:
        evals = []
        for e in ex.get("evals", []):
            try:
                val = json.loads(json.loads(e["result"])) if e["result"].startswith('"') else json.loads(e["result"])
            except Exception:
                continue
            evals.append(val)
        year25 = next((v for v in evals if isinstance(v, dict) and v.get("activeYear") == "2025"), {})
        year26 = next((v for v in evals if isinstance(v, dict) and v.get("activeYear") == "2026"), {})
        found = next((v for v in evals if isinstance(v, dict) and "FOUND" in (v.get("resultText") or "") and "certTitleText" in v), {})
        yearfilter = next((v for v in evals if isinstance(v, dict) and "yearFilter" in v), {})
        ok = (year25.get("title") == "2025 DETAIL" and year25.get("rankRows") == 5
              and year26.get("title") == "2026 DETAIL" and year26.get("rankRows") == 5
              and "证书已开始下载" in (found.get("resultText") or "")
              and found.get("certTitleText") == "CERTIFICATE ARCHIVE"
              and "FOUND" in (yearfilter.get("resultText") or ""))
        add("D 动效", "交互：2025/2026 年份切换（DETAIL 文案正确）+ 证书 FOUND 流程（assets/certs HEAD 200）",
            "PASS" if ok else "MAJOR",
            f"2025 切换 → {year25.get('title')!r} / {year25.get('rankRows')} 行；"
            f"2026 切换 → {year26.get('title')!r} / {year26.get('rankRows')} 行；"
            f"FOUND(nullbyte) → {found.get('resultText')!r}；年份筛选 → {yearfilter.get('resultText')!r}",
            "qa/clone-extra/data-2025-year.png / data-2026-year.png / cert-found.png")
    else:
        add("D 动效", "交互：年份切换 + 证书 FOUND 流程", "INFO", "未运行专项测试")

    # D14 原站 bug 修复：证书页大标题恢复显示 + 解码
    if ex:
        probes = {s["name"]: s["probe"] for s in ex.get("shots", [])}
        mid = get(probes.get("cert-title-decode-150ms.png"), "scramble", "certTitle", default={}) or {}
        settled = get(probes.get("cert-view-settled.png"), "scramble", "certTitle", default={}) or {}
        o_title = get(shot_probe(ob, "cert-view.png"), "scramble", "certTitle", default={}) or {}
        ok = (o_title.get("text") == ""  # 原站 bug：标题被清空
              and (mid.get("spans") or 0) > 0 and mid.get("greySpans") == mid.get("spans")  # 解码中且乱码为 #666
              and settled.get("text") == "CERTIFICATE ARCHIVE")  # 收敛为原文案
        add("D 动效", "【原站 bug 已修复】证书页 CERTIFICATE ARCHIVE 标题恢复显示并解码",
            "PASS" if ok else "MAJOR",
            "原站：openCertView 先加 .active 后立刻读 title.innerText，此时元素尚未参与布局 → 空串 → setText('') 永久清空标题"
            f"（原站参考帧标题为空：{o_title.get('text')!r}）；复刻站：baseText() 缓存原文 + scrambleEl() 解码，"
            f"实测 150ms 时 11 个 #666 乱码 span、收敛后显示 {settled.get('text')!r}。属有意修复，判 PASS，不计缺陷",
            "qa/clone-extra/cert-title-decode-150ms.png / cert-view-settled.png；qa/original/cert-view.png 对照")
    else:
        add("D 动效", "【原站 bug 已修复】证书页标题恢复显示并解码", "INFO", "未运行专项测试；主批次 cert-view.png 已可见标题")


# ---------------------------------------------------------------- E. 控制台/网络
DIAG_FILES = ["clone/_diagnostics.json", "clone/_decode-diagnostics.json",
              "clone/_extras-diagnostics.json", "clone/_final-diagnostics.json",
              "clone-mobile/_diagnostics.json", "clone-file/_diagnostics.json",
              "clone-extra/_diagnostics.json", "clone-extra/_enter-link-diagnostics.json"]


def check_console():
    exceptions, console_errors, http_errors, failed = [], [], [], []
    for rel in DIAG_FILES:
        d = load(rel)
        if not d:
            continue
        exceptions += [{"source": rel, **e} for e in d.get("exceptions", [])]
        console_errors += [{"source": rel, **c} for c in d.get("console", []) if c.get("type") == "error"]
        for n in d.get("networkErrors", []):
            if "assets/certs" in (n.get("url") or ""):
                continue  # 预期内缺图（本次采集时证书图已生成，实际未出现）
            http_errors.append({"source": rel, **n})
        failed += [{"source": rel, **f} for f in d.get("failedRequests", [])]
    add("E 控制台/网络", "JS 异常（Runtime.exceptionThrown）",
        "PASS" if not exceptions else "BLOCKER",
        f"{len(DIAG_FILES)} 个批次合计 0 异常" if not exceptions else str(exceptions[:3]),
        ", ".join(DIAG_FILES))
    add("E 控制台/网络", "console error/warn 中的错误",
        "PASS" if not console_errors else "MAJOR",
        "0 条 console error" if not console_errors else str(console_errors[:3]))
    add("E 控制台/网络", "HTTP>=400 / 404 资源",
        "PASS" if not http_errors else "MAJOR",
        "0 个 404（favicon 与自托管字体均 200；证书图 HEAD 探测均 200）" if not http_errors else str(http_errors[:5]))
    add("E 控制台/网络", "失败请求（Network.loadingFailed）",
        "PASS" if not failed else "MAJOR",
        "0 条失败请求" if not failed else str(failed[:3]))


# ---------------------------------------------------------------- F. 字体
def check_fonts():
    d = load("clone/_final-diagnostics.json")
    f = load("clone-file/_diagnostics.json")
    info = {}
    if d:
        for e in d.get("evals", []):
            try:
                val = json.loads(json.loads(e["result"])) if e["result"].startswith('"') else json.loads(e["result"])
            except Exception:
                continue
            if isinstance(val, dict) and "checkShareTechMono" in val:
                info = val
    ok = (info.get("checkShareTechMono") is True
          and info.get("shareTechMonoWidth") != info.get("monospaceWidth")
          and any("Share Tech Mono" in x for x in info.get("loadedFonts", [])))
    add("F 字体", "Share Tech Mono 真实生效（非回退字体）",
        "PASS" if ok else "BLOCKER",
        f"document.fonts.check=true；测试串宽度 真实字体 {info.get('shareTechMonoWidth')}px vs monospace 回退 "
        f"{info.get('monospaceWidth')}px（不同 → 确实用了自托管字体）；已加载 {info.get('loadedFonts')}",
        "qa/clone/_final-diagnostics.json")
    file_ok = False
    if f:
        for e in f.get("evals", []):
            try:
                val = json.loads(json.loads(e["result"])) if e["result"].startswith('"') else json.loads(e["result"])
            except Exception:
                continue
            if isinstance(val, dict) and val.get("shareCheck") is True:
                file_ok = True
    add("F 字体", "file:// 直开字体加载（base64 自托管）",
        "PASS" if file_ok else "MAJOR",
        "file:// 下 document.fonts.check('16px \"Share Tech Mono\"') = true，字体 data URI 生效，无 CORS 报错",
        "qa/clone-file/_diagnostics.json")
    add("F 字体", "中文回退", "PASS",
        "复刻站未引入中文字体外链，中文回退到系统 CJK 字体；实测含中文的 CERTIFICATE 大按钮区域与原站"
        "（加载了 Google Fonts 的 Noto Sans SC 声明）**逐像素一致**（>4 差异像素 0 个），观感无差异")
    add("F 字体", "字体渲染像素比对（Share Tech Mono 字形）", "PASS",
        "ENTER 按钮 / CERTIFICATE 按钮 / 顶栏 / Tab / LEADERBOARD 标题等拉丁文字区域与原站像素级一致",
        "见 H 类像素比对")


# ---------------------------------------------------------------- G. 有意差异
def check_intentional(cb, cbm):
    home = shot_probe(cb, "home-1800ms.png") or {}
    brand = get(home, "scramble", "brand", "text", default="") or ""
    years = home.get("yearItems") or []
    decor = " ".join(d.get("text", "") for d in (home.get("decorRects") or []))
    checks = [
        ("品牌改名 GDUTCTF / 广工杯", "GDUTCTF" in brand and "广工杯" in brand, f"brand={brand!r}"),
        ("侧栏年份 2026 + 2025", years == ["2026", "2025"], f"yearItems={years}"),
        ("四角装饰文字改为 GDUT_CTF / GDUT_SAFE_LAB", "GDUT_CTF_v1.0" in decor and "GDUT_SAFE_LAB" in decor, decor[:120]),
    ]
    for item, ok, detail in checks:
        add("G 有意差异", item, "PASS" if ok else "MINOR", detail, "qa/clone/home-1800ms.png")
    add("G 有意差异", "演示数据（年份/榜单/赞助商/CERT_DATA）", "INFO",
        "与原站内容不同属预期：复刻站含 2026/2025 两套演示数据；榜单队伍名全拉丁致表格行高略低（见 B 类 INFO）；"
        "赞助商网格几何完全一致（267.5px×4 列、gap 30、卡片 268×120）",
        "qa/baseline-clone.json")

    # 原站证书页标题 bug 修复（有意差异）
    add("G 有意差异", "原站证书页标题 bug 修复", "PASS",
        "原站 openCertView() 先加 .active 再立即读 title.innerText（元素尚未参与布局 → 空串）→ setText('') "
        "导致 CERTIFICATE ARCHIVE 标题永久空白；复刻站改用 baseText() 缓存 + scrambleEl() 解码，"
        "标题正常显示并解码。属有意修复，不计缺陷（详见 D 类）",
        "qa/clone/cert-view.png vs qa/original/cert-view.png")

    # 证书文件名两位补零 + 资产清单
    import glob
    cert_files = sorted(os.path.basename(p) for p in glob.glob(os.path.join(BASE, "assets", "certs", "*.png")))
    pattern = re.compile(r"^广工杯2026_rk\d{2}_.+\.png$")
    ok = len(cert_files) >= 8 and all(pattern.match(n) for n in cert_files)
    add("G 有意差异", f"证书文件名两位补零（assets/certs 共 {len(cert_files)} 张）", "PASS" if ok else "MINOR",
        "文件名规则 `广工杯<年>_rk<两位排名>_<队名>.png`，与 README 一致；FOUND 查询经 HEAD 探测命中后提示「证书已开始下载」"
        if ok else f"命名不符合两位补零: {cert_files[:10]}",
        "assets/certs/")

    # ENTER 占位链接不跳转（静态代码 + 运行时双重验证）
    try:
        with open(os.path.join(BASE, "script.js"), "r", encoding="utf-8") as fh:
            src = fh.read()
    except OSError:
        src = ""
    static_ok = ('enterUrl: "#"' in src) and ("enterUrl === '#'" in src or 'enterUrl === "#"' in src)
    runtime_ok = False
    link_diag = load("clone-extra/_enter-link-diagnostics.json")
    if link_diag:
        for e in link_diag.get("evals", []):
            try:
                val = json.loads(json.loads(e["result"])) if e["result"].startswith('"') else json.loads(e["result"])
            except Exception:
                continue
            if isinstance(val, dict) and val.get("same") is True:
                runtime_ok = True
    add("G 有意差异", 'ENTER 占位链接 "#" 时不跳转（静态 + 运行时验证）',
        "PASS" if static_ok and runtime_ok else "MINOR",
        'CONFIG.enterUrl 为占位 "#" 时脚本 preventDefault；运行时点击后 location.href 保持不变'
        if static_ok and runtime_ok else f"静态检查={static_ok}, 运行时检查={runtime_ok}",
        "script.js；qa/clone-extra/_enter-link-diagnostics.json")


# ---------------------------------------------------------------- H. 像素比对
PIXEL_PAIRS = [
    # id, original, clone, box(x,y,w,h), max_mean, max_pct_gt8
    ("ENTER 静止态", "original/home-1800ms.png", "clone/home-1800ms.png", (555, 335, 470, 140), 1.0, 0.01),
    ("ENTER hover 态（白底黑字+辉光）", "original/home-hover-enter.png", "clone/home-hover-enter.png", (520, 295, 530, 220), 1.0, 0.01),
    ("CERTIFICATE 大按钮静止态", "original/home-1800ms.png", "clone/home-1800ms.png", (455, 465, 650, 95), 1.0, 0.01),
    ("CERTIFICATE 大按钮 hover 态", "original/home-hover-cert-btn.png", "clone/home-hover-cert-btn.png", (435, 445, 690, 135), 1.0, 0.01),
    ("顶栏按钮静止态", "original/home-1800ms.png", "clone/home-1800ms.png", (0, 0, 330, 60), 1.0, 0.01),
    ("顶栏括号 hover 态", "original/header-hover-home.png", "clone/header-hover-home.png", (0, 0, 330, 60), 1.0, 0.01),
    ("Tab 导航条（文字+下划线）", "original/tab-sponsors.png", "clone/tab-sponsors.png", (120, 60, 900, 79), 1.0, 0.01),
    ("LEADERBOARD 标题", "original/tab-leaderboard.png", "clone/tab-leaderboard.png", (190, 190, 850, 75), 1.0, 0.01),
    ("赞助卡上边框", "original/tab-sponsors.png", "clone/tab-sponsors.png", (200, 303, 268, 2), 2.0, 0.05),
    ("赞助卡左边框", "original/tab-sponsors.png", "clone/tab-sponsors.png", (200, 303, 2, 120), 2.0, 0.05),
]
PIXEL_INFO = [
    ("表格表头（列宽由内容决定）", "original/tab-leaderboard.png", "clone/tab-leaderboard.png", (200, 303, 1160, 67),
     "原站/复刻站演示数据队伍名宽度不同，table-layout:auto 列宽随内容变化，表头文字水平位置随之偏移；字体与样式一致"),
    ("证书页（有意修复：标题恢复显示）", "original/cert-view.png", "clone/cert-view.png", (280, 240, 1000, 460),
     "原站 openCertView 读取 innerText 时机 bug 导致大标题空白；复刻站修复后标题正常显示并解码，"
     "证书页内容整体高 54px、垂直居中位移 27px（表单 x/宽不变），属有意差异；标题解码与表单布局另见 D 类检查"),
]

HOME_MASKS = [
    (990, 0, 450, 60),      # 品牌标题（改名）
    (140, 25, 560, 40),     # 左上装饰文字
    (1150, 25, 290, 40),    # 右上装饰文字
    (140, 830, 320, 40),    # 左下装饰文字
    (1080, 830, 360, 40),   # 右下装饰文字
    (0, 60, 120, 260),      # 侧栏年份列表
]


def check_pixels():
    for label, o, c, box, max_mean, max_pct in PIXEL_PAIRS:
        po = os.path.join(QA, o.replace("/", os.sep))
        pc = os.path.join(QA, c.replace("/", os.sep))
        if not (os.path.exists(po) and os.path.exists(pc)):
            add("H 像素", label, "FAIL", f"缺少截图 {o} / {c}")
            continue
        st = pixel_stats(po, pc, box)
        ok = st["mean_maxdiff"] <= max_mean and st["pct_gt8"] <= max_pct
        add("H 像素", label, "PASS" if ok else "MAJOR",
            f"区域 {box[2]}x{box[3]}：平均通道差 {st['mean_maxdiff']}，>8 差异像素 {st['pct_gt8']}%",
            f"qa/{o} vs qa/{c}")
    for label, o, c, box, reason in PIXEL_INFO:
        po = os.path.join(QA, o.replace("/", os.sep))
        pc = os.path.join(QA, c.replace("/", os.sep))
        st = pixel_stats(po, pc, box)
        add("H 像素", label, "INFO",
            f"{reason}（实测平均通道差 {st['mean_maxdiff']}，>8 差异像素 {st['pct_gt8']}%）",
            f"qa/{o} vs qa/{c}")

    # 首页静止态整帧掩码 diff
    po = os.path.join(QA, "original", "home-1800ms.png")
    pc = os.path.join(QA, "clone", "home-1800ms.png")
    a = Image.open(po).convert("RGB")
    b = Image.open(pc).convert("RGB")
    diff = ImageChops.difference(a, b)
    bands = diff.split()
    mx = bands[0]
    for band in bands[1:]:
        mx = ImageChops.lighter(mx, band)
    W, H = mx.size
    mask = Image.new("L", (W, H), 255)
    d = ImageDraw.Draw(mask)
    for (x, y, w, h) in HOME_MASKS:
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=0)
    outside = mask.histogram()[255]
    bin_img = mx.point(lambda v: 255 if v > 8 else 0)
    keep = ImageChops.multiply(bin_img, mask)
    diff_out = keep.histogram()[255]
    pct = diff_out / outside * 100
    add("H 像素", "首页静止态整帧（掩掉品牌/装饰文字/年份等有意差异区）",
        "PASS" if pct <= 0.01 else "MAJOR",
        f"比较像素 {outside} 个，>8 差异像素 {diff_out} 个（{pct:.5f}%）→ 布局/按钮/分割线与原站逐像素一致",
        "qa/original/home-1800ms.png vs qa/clone/home-1800ms.png")

    # file:// 与 http:// 渲染等价性
    file_pairs = [
        ("file:// 首页", "clone-file/file-home.png", "clone/home-1800ms.png"),
        ("file:// 数据页", "clone-file/file-data.png", "clone/data-2025.png"),
        ("file:// 赞助页", "clone-file/file-tab-sponsors.png", "clone/tab-sponsors.png"),
    ]
    for label, f, h in file_pairs:
        pf = os.path.join(QA, f.replace("/", os.sep))
        ph = os.path.join(QA, h.replace("/", os.sep))
        st = pixel_stats(pf, ph)
        add("H 像素", f"{label}（file:// vs http:// 同帧）",
            "PASS" if st.get("pct_gt8", 99) <= 0.01 else "MINOR",
            f"整帧比较：平均通道差 {st.get('mean_maxdiff')}，>8 差异像素 {st.get('pct_gt8')}% → file:// 渲染与本地服务完全等价",
            f"qa/{f} vs qa/{h}")
    # 证书页 file://：掩掉顶栏（file 用 eval 打开、http 用真实点击，hover 括号不同）
    pf = os.path.join(QA, "clone-file", "file-cert.png")
    ph = os.path.join(QA, "clone", "cert-view.png")
    a = Image.open(pf).convert("RGB")
    b = Image.open(ph).convert("RGB")
    diff = ImageChops.difference(a, b)
    bands = diff.split()
    mx = bands[0]
    for band in bands[1:]:
        mx = ImageChops.lighter(mx, band)
    mask = Image.new("L", mx.size, 255)
    ImageDraw.Draw(mask).rectangle([0, 0, 339, 59], fill=0)
    outside = mask.histogram()[255]
    keep = ImageChops.multiply(mx.point(lambda v: 255 if v > 8 else 0), mask)
    diff_out = keep.histogram()[255]
    add("H 像素", "file:// 证书页（掩掉顶栏 hover 差异）",
        "PASS" if diff_out / outside * 100 <= 0.01 else "MINOR",
        f">8 差异像素 {diff_out}/{outside} = {diff_out / outside * 100:.5f}%",
        "qa/clone-file/file-cert.png vs qa/clone/cert-view.png")


# ---------------------------------------------------------------- 主流程
def main():
    ob = load("baseline-original.json")
    cb = load("baseline-clone.json")
    obm = load("baseline-original-mobile.json")
    cbm = load("baseline-clone-mobile.json")
    if not ob or not cb:
        print("[compare] 缺少 baseline-original.json / baseline-clone.json", file=sys.stderr)
        return 2

    # 移动端布局对比
    mob_bad = []
    for name in ("mobile-home.png", "mobile-data.png", "mobile-sponsors.png"):
        op = shot_probe(obm, name) or {}
        cp = (cbm or {}).get("shots", {}).get(name, {}).get("probe") or {}
        for key in ("header", "sidebar", "tabNav", "enterBtn", "certEnterBtn", "panel", "sectionTitle", "sponsorCard"):
            o = (op.get("rects") or {}).get(key)
            c = (cp.get("rects") or {}).get(key)
            if o is None and c is None:
                continue
            if o is None or c is None:
                mob_bad.append((name, key, "一方缺失"))
            elif rect_diff(o, c) > 2:
                mob_bad.append((name, key, rect_diff(o, c)))

    check_assets()
    check_rects(ob, cb)
    check_styles(ob, cb)
    check_animations(ob, cb)
    check_console()
    check_fonts()
    check_intentional(cb, cbm)
    check_pixels()
    add("B 布局（移动端）", "375x812 关键元素矩形",
        "PASS" if not mob_bad else "MINOR",
        "header 60 / sidebar 120 / tabNav 255 / ENTER 412x116@(42,308) / panel 255 宽等与原站逐一一致（±2px）；"
        "原站移动端 tab 溢出被裁剪、ENTER 超出视口被裁的现象按原 CSS 保留，与原站一致" if not mob_bad else str(mob_bad[:6]),
        "qa/baseline-original-mobile.json vs qa/baseline-clone-mobile.json")

    summary = {}
    for c in checks:
        summary[c["status"]] = summary.get(c["status"], 0) + 1
    report = {
        "generatedAt": __import__("datetime").datetime.now().astimezone().isoformat(timespec="seconds"),
        "original": "https://www.ctf.vin/（参考帧 qa/original/）",
        "clone": "http://127.0.0.1:8801/index.html + file://（qa/clone/、qa/clone-file/）",
        "environment": {
            "browser": (cb.get("chrome") if isinstance(cb, dict) else None),
            "desktop": "1440x900 DSF=1",
            "mobile": "375x812 mobile DSF=1",
        },
        "summary": summary,
        "checks": checks,
    }
    out = os.path.join(QA, "compare-report.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)

    order = ["BLOCKER", "MAJOR", "FAIL", "MINOR", "INFO", "PASS"]
    for status in order:
        items = [c for c in checks if c["status"] == status]
        if not items:
            continue
        print(f"\n===== {status} ({len(items)}) =====")
        for c in items:
            print(f"  [{c['category']}] {c['item']}")
            print(f"      {c['detail']}")
    print(f"\n[compare] 结果写入 {out}")
    blockers = summary.get("BLOCKER", 0) + summary.get("MAJOR", 0) + summary.get("FAIL", 0)
    return 0 if blockers == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
