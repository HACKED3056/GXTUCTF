#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
qa/validate_shots.py —— 用 Pillow 校验截图产物（尺寸 / 是否空白 / 亮度分布）

用法:
  python qa/validate_shots.py <dir> [<dir> ...] [--width 1440] [--height 900]
  python qa/validate_shots.py qa/original --width 1440 --height 900 --json qa/validate-original.json
  python qa/validate_shots.py qa/original-mobile --size 375x812 --json qa/validate-original-mobile.json

判定规则（每个 PNG）:
  1. PNG 可被 Pillow 解码，宽高与期望一致。
  2. 非空白：图像不是单一颜色（唯一色 > 8），并且
       亮像素（L >= 200）占比 > 0.1% 或 暗像素（L <= 40）占比 > 0.1%。
  3. 输出亮/暗像素占比、平均亮度、标准差、唯一色数量，便于人工复核。

退出码：全部 PASS → 0；有 FAIL → 1。
"""

import argparse
import glob
import json
import os
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    print("[validate] 缺少 Pillow：pip install pillow", file=sys.stderr)
    sys.exit(2)


def parse_size(text):
    w, h = text.lower().split("x")
    return int(w), int(h)


def flat_pixels(img):
    """兼容新旧 Pillow 的像素序列读取，避免 DeprecationWarning。"""
    getter = getattr(img, "get_flattened_data", None)
    if getter is not None:
        return list(getter())
    return list(img.getdata())


def analyze(path, width, height):
    rec = {"file": path, "name": os.path.basename(path)}
    try:
        with Image.open(path) as im:
            im.load()
            rec["format"] = im.format
            rec["mode"] = im.mode
            rec["width"], rec["height"] = im.size
            rgb = im.convert("RGB")
    except Exception as exc:  # noqa: BLE001
        rec.update(passed=False, reasons=[f"无法解码: {exc}"])
        return rec

    reasons = []
    if rec["format"] != "PNG":
        reasons.append(f"格式不是 PNG: {rec['format']}")
    if (rec["width"], rec["height"]) != (width, height):
        reasons.append(f"尺寸 {rec['width']}x{rec['height']} != 期望 {width}x{height}")

    # 缩略图统计亮度（速度快、不受整图尺寸影响）
    small = rgb.copy()
    small.thumbnail((480, 480))
    gray = small.convert("L")
    pixels = flat_pixels(gray)
    total = len(pixels)
    bright = sum(1 for p in pixels if p >= 200)
    dark = sum(1 for p in pixels if p <= 40)
    mean = sum(pixels) / total
    variance = sum((p - mean) ** 2 for p in pixels) / total
    std = variance ** 0.5

    color_list = small.getcolors(maxcolors=1024)
    unique = len(color_list) if color_list else 1024

    rec.update(
        bright_ratio=round(bright / total, 6),
        dark_ratio=round(dark / total, 6),
        mean_luma=round(mean, 2),
        std_luma=round(std, 2),
        unique_colors=unique,
        sampled_pixels=total,
    )

    if unique <= 8:
        reasons.append(f"图像近似单色（unique colors={unique}），视为空白")
    if rec["std_luma"] < 1.0:
        reasons.append("亮度标准差 < 1.0，视为空白")
    if rec["bright_ratio"] <= 0.001 and rec["dark_ratio"] <= 0.001:
        reasons.append("亮像素与暗像素占比均 <= 0.1%，视为无内容")

    rec["passed"] = len(reasons) == 0
    rec["reasons"] = reasons
    return rec


def main(argv=None):
    ap = argparse.ArgumentParser(description="校验截图 PNG 的尺寸与非空白")
    ap.add_argument("dirs", nargs="+", help="待校验目录（可多个）")
    ap.add_argument("--width", type=int, default=1440, help="期望宽度，默认 1440")
    ap.add_argument("--height", type=int, default=900, help="期望高度，默认 900")
    ap.add_argument("--size", default=None, help="等价写法 WxH，如 375x812")
    ap.add_argument("--json", default=None, help="把完整结果写入 JSON 文件")
    args = ap.parse_args(argv)

    if args.size:
        args.width, args.height = parse_size(args.size)

    results = []
    ok = True
    for d in args.dirs:
        files = sorted(glob.glob(os.path.join(d, "*.png")))
        print(f"\n=== {d}  ({len(files)} 个 PNG, 期望 {args.width}x{args.height}) ===")
        if not files:
            print("  [FAIL] 目录下没有 PNG")
            ok = False
            continue
        for f in files:
            rec = analyze(f, args.width, args.height)
            results.append(rec)
            status = "PASS" if rec.get("passed") else "FAIL"
            print(
                f"  [{status}] {rec['name']:26s} "
                f"{rec.get('width')}x{rec.get('height')}  "
                f"bright={rec.get('bright_ratio'):.4f} dark={rec.get('dark_ratio'):.4f} "
                f"std={rec.get('std_luma')} unique={rec.get('unique_colors')}"
            )
            for r in rec.get("reasons", []):
                print(f"         ! {r}")
                ok = False

    total = len(results)
    passed = sum(1 for r in results if r.get("passed"))
    print(f"\n[validate] 合计 {passed}/{total} 通过")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "dirs": args.dirs,
                    "width": args.width,
                    "height": args.height,
                    "total": total,
                    "passed": passed,
                    "results": results,
                },
                fh,
                ensure_ascii=False,
                indent=2,
            )
        print(f"[validate] 结果已写入 {args.json}")
    return 0 if ok and passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
