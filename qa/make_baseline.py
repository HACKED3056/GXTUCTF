#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
qa/make_baseline.py —— 从 qa/shoot.mjs 产出的 *_diagnostics.json 提炼精简基准 JSON

用途：把原站 / 复刻站多次采集的诊断数据合并成一份可 diff 的基准文件，
供 task-4 逐项比对（尺寸、布局矩形、计算样式、动画状态、console/404）。

用法:
  python qa/make_baseline.py --label original --out qa/baseline-original.json \
      --diag qa/original/_diagnostics.json \
      --diag qa/original/_decode-diagnostics.json \
      --diag qa/original/_extras-diagnostics.json

  python qa/make_baseline.py --label clone --out qa/baseline-clone.json \
      --diag qa/clone/_diagnostics.json --diag qa/clone/_decode-diagnostics.json

输出结构（节选）:
{
  "label": "original",
  "sites": ["https://www.ctf.vin/"],
  "chrome": "Chrome/156.0.8078.81",
  "viewports": [{"width":1440,"height":900,"mobile":false}],
  "nav": {"loadMs": 905, "domContentLoadedMs": 639, ...},
  "fonts": {"status": "loaded", "loaded": ["Share Tech Mono 400", ...]},
  "shots": { "<name>.png": { "width":1440, "height":900, "bytes":..., "msSinceNav":..., "probe": {...} } },
  "diagnostics": {"exceptions": [...], "consoleErrors": [...], "networkErrors": [...]}
}
"""

import argparse
import json
import os
from datetime import datetime, timezone

# 探针里保留的字段（去掉体积大且随机的 html 片段）
PROBE_KEYS = [
    "readyState", "href", "viewport", "views", "activeView",
    "rects", "styles", "scramble", "headerBtns", "tabBtns",
    "activeTab", "yearItems", "activeYear", "detailText",
    "rankRows", "sponsorCount", "sponsorNames", "sponsorFirst",
    "enterHoverState", "cert", "fonts", "decorRects", "qaDecodeMs",
]

SCRAMBLE_KEYS = ["text", "chars", "spans", "greySpans"]


def clean_probe(probe):
    if not isinstance(probe, dict):
        return probe
    out = {}
    for key in PROBE_KEYS:
        if key not in probe:
            continue
        val = probe[key]
        if key == "scramble" and isinstance(val, dict):
            out[key] = {
                name: ({k: part.get(k) for k in SCRAMBLE_KEYS} if isinstance(part, dict) else part)
                for name, part in val.items()
            }
        elif key == "sponsorNames":
            out[key] = val
        else:
            out[key] = val
    if "probeError" in probe:
        out["probeError"] = probe["probeError"]
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="从诊断 json 生成精简基准")
    ap.add_argument("--out", required=True, help="输出基准 json 路径")
    ap.add_argument("--label", required=True, help="基准标签，如 original / clone")
    ap.add_argument("--diag", action="append", required=True, help="*_diagnostics.json，可多次传入")
    args = ap.parse_args(argv)

    baseline = {
        "label": args.label,
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "sites": [],
        "chrome": None,
        "protocolVersion": None,
        "viewports": [],
        "nav": None,
        "fonts": None,
        "shots": {},
        "diagnostics": {"exceptions": [], "consoleErrors": [], "networkErrors": [], "failedRequests": []},
        "sources": [],
    }

    for diag_path in args.diag:
        with open(diag_path, "r", encoding="utf-8") as fh:
            diag = json.load(fh)
        baseline["sources"].append(os.path.basename(diag_path))
        if diag.get("url") and diag["url"] not in baseline["sites"]:
            baseline["sites"].append(diag["url"])
        if diag.get("browser") and not baseline["chrome"]:
            baseline["chrome"] = diag["browser"]
            baseline["protocolVersion"] = diag.get("protocolVersion")
        vp = diag.get("viewport")
        if vp and vp not in baseline["viewports"]:
            baseline["viewports"].append(vp)
        # 以第一次运行的导航耗时为准
        if diag.get("nav") and baseline["nav"] is None:
            baseline["nav"] = diag["nav"]

        for shot in diag.get("shots", []):
            entry = {k: shot.get(k) for k in (
                "width", "height", "bytes", "expectedWidth", "expectedHeight",
                "msSinceNav", "msSinceLoad", "probeMs", "captureMs",
            )}
            entry["probe"] = clean_probe(shot.get("probe") or {})
            baseline["shots"][shot.get("name") or shot.get("file")] = entry
            fonts = entry["probe"].get("fonts")
            if fonts and baseline["fonts"] is None:
                baseline["fonts"] = {
                    "status": fonts.get("status"),
                    "loaded": sorted(set(fonts.get("loaded") or [])),
                }

        for ex in diag.get("exceptions", []):
            baseline["diagnostics"]["exceptions"].append({"source": os.path.basename(diag_path), **ex})
        for c in diag.get("console", []):
            if c.get("type") == "error":
                baseline["diagnostics"]["consoleErrors"].append({"source": os.path.basename(diag_path), **c})
        for n in diag.get("networkErrors", []):
            baseline["diagnostics"]["networkErrors"].append({"source": os.path.basename(diag_path), **n})
        for f in diag.get("failedRequests", []):
            baseline["diagnostics"]["failedRequests"].append({"source": os.path.basename(diag_path), **f})

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(baseline, fh, ensure_ascii=False, indent=2)
    print(f"[baseline] 写入 {args.out}: {len(baseline['shots'])} 张截图, "
          f"viewports={baseline['viewports']}, exceptions={len(baseline['diagnostics']['exceptions'])}, "
          f"consoleErrors={len(baseline['diagnostics']['consoleErrors'])}, "
          f"httpErrors={len(baseline['diagnostics']['networkErrors'])}")


if __name__ == "__main__":
    main()
