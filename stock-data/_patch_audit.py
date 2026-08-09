# -*- coding: utf-8 -*-
"""一次性补丁：为现有 companies/*.json 的定期报告补充审计信息（事务所 + 意见类型）。

只解析 PDF 文本（含 3 次重试），不触碰其他数据字段。
"""
import io
import json
import sys
import time
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent / "scripts"))

import requests
import pymupdf
from fetch_data import COMPANIES_DIR, extract_audit

HEADERS = {"User-Agent": "Mozilla/5.0"}


def parse_pdf(url: str, is_annual: bool):
    last = None
    for _ in range(3):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=90)
            resp.raise_for_status()
            doc = pymupdf.open(stream=resp.content, filetype="pdf")
            text = "".join(page.get_text() for page in doc)
            doc.close()
            return extract_audit(text, is_annual)
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3)
    raise last


def main():
    total = ok = fail = 0
    for f in sorted(COMPANIES_DIR.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        changed = False
        for r in data.get("reports") or []:
            if r["category"] not in ("年报", "半年报"):
                continue
            total += 1
            try:
                firm, opinion = parse_pdf(r["pdf_url"], r["category"] == "年报")
                r["audit_firm"] = firm
                r["audit_opinion"] = opinion
                ok += 1
                print(f"  OK  {data['code']} {r['category']} {r['date']} | {firm} | {opinion}")
            except Exception as e:  # noqa: BLE001
                fail += 1
                r["audit_firm"] = None
                r["audit_opinion"] = None
                print(f"  FAIL {data['code']} {r['category']} {r['date']} | {e}")
            changed = True
        if changed:
            f.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n完成：共 {total} 份，成功 {ok}，失败 {fail}")


if __name__ == "__main__":
    main()
