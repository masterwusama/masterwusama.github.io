#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""抓取 A 股财务数据，生成供 GitHub Pages 托管的静态 JSON。

数据源（全部为公开免费接口，无需 token）：
- 财务指标（ROE/毛利率/净利率等）：同花顺摘要接口
- 三大报表（利润表/资产负债表/现金流量表）：新浪财经
- 最新估值快照（最新价/PE/PB/市值）：腾讯行情接口
- 分红历史：巨潮资讯
- 定期报告 PDF 链接：巨潮资讯

用法：
    python fetch_data.py                 # 抓取全部配置的公司
    python fetch_data.py --limit 2       # 只抓前 2 家（快速测试）
"""

import argparse
import json
import os
import sys
import time
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

import akshare as ak
import requests

from config import DEFAULT_COMPANIES, REQUEST_INTERVAL

# 输出目录：<仓库>/stock-data/data
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data"
COMPANIES_DIR = OUTPUT_DIR / "companies"

# 新浪/同花顺源一次请求返回的报告期上限（最新 N 期，20 期 ≈ 5 年）
MAX_PERIODS = 20

# 巨潮资讯定期报告类别（年报/半年报/一季报/三季报）
REPORT_CATEGORIES = ["年报", "半年报", "一季报", "三季报"]

# 中国大陆时区（用于 updated_at 时间戳）
CN_TZ = timezone(timedelta(hours=8))


def sina_symbol(code: str) -> str:
    """6/9 开头 → sh，0/2/3 开头 → sz，其余（4/8）→ bj"""
    if code.startswith(("6", "9")):
        return "sh" + code
    if code.startswith(("0", "2", "3")):
        return "sz" + code
    return "bj" + code


def parse_number(value):
    """把 '1.47亿'、'23.38%'、'--' 等原始字符串解析为 float，无法解析返回 None。

    单位规则：万亿/亿/万 后缀为数量级倍率；% 后缀除以 100（比率统一为小数）。
    """
    if value is None:
        return None
    s = str(value).strip().replace(",", "")
    if not s or s in ("--", "-", "False", "None", "nan", "NaN"):
        return None
    mult = 1.0
    for suffix, factor in (("万亿", 1e12), ("亿", 1e8), ("万", 1e4)):
        if s.endswith(suffix):
            mult = factor
            s = s[: -len(suffix)]
            break
    if s.endswith("%"):
        s = s[:-1]
        mult = mult / 100.0
    try:
        return round(float(s) * mult, 4)
    except ValueError:
        return None


def to_iso(date_value) -> str:
    """'20251231' / '2025-12-31' → '2025-12-31'；无法识别原样返回"""
    s = str(date_value).strip()
    if not s:
        return None
    digits = s.replace("-", "").replace("/", "")
    if len(digits) == 8 and digits.isdigit():
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
    return s


def sleep_between():
    time.sleep(REQUEST_INTERVAL)


def df_to_records(df, numeric_cols=None):
    """DataFrame → 记录数组；数值列统一 parse_number，日期列转 ISO，NaN 转 None"""
    if df is None or df.empty:
        return []
    records = []
    for _, row in df.iterrows():
        rec = {}
        for col in df.columns:
            val = row[col]
            if pd_isna(val):
                rec[str(col)] = None
            elif numeric_cols and col in numeric_cols:
                rec[str(col)] = parse_number(val)
            elif "日" in str(col) and ("报告" in str(col) or col in ("date",)):
                rec[str(col)] = to_iso(val)
            elif isinstance(val, (int, float)):
                rec[str(col)] = float(val)
            else:
                rec[str(col)] = str(val).strip()
        records.append(rec)
    return records


def pd_isna(val):
    try:
        import pandas as pd
        return pd.isna(val)
    except Exception:
        return val is None


def fetch_indicators(code: str):
    """同花顺财务摘要：关键指标，按报告期倒序取最近 MAX_PERIODS 期"""
    df = ak.stock_financial_abstract_ths(symbol=code, indicator="按报告期")
    if df is None or df.empty:
        return []
    df = df.copy()
    df["_dt"] = pd_to_datetime(df["报告期"])
    df = df.sort_values("_dt", ascending=False).head(MAX_PERIODS)
    df = df.drop(columns=["_dt"])
    # 除报告期外均为数值列（带亿/% 等单位的原始字符串，需统一解析）
    numeric_cols = [c for c in df.columns if c != "报告期"]
    records = df_to_records(df, numeric_cols=numeric_cols)
    for rec in records:
        if rec.get("报告期"):
            rec["报告期"] = to_iso(rec["报告期"])
    return records


def pd_to_datetime(series):
    import pandas as pd
    return pd.to_datetime(series, errors="coerce")


def fetch_report(code: str, kind: str):
    """新浪三大报表：kind ∈ {'利润表', '资产负债表', '现金流量表'}"""
    df = ak.stock_financial_report_sina(stock=sina_symbol(code), symbol=kind)
    if df is None or df.empty:
        return []
    df = df.copy()
    # 新浪返回全部历史报告期，按报告日倒序取最近 MAX_PERIODS 期
    df["_dt"] = pd_to_datetime(df["报告日"])
    df = df.sort_values("_dt", ascending=False).head(MAX_PERIODS)
    df = df.drop(columns=["_dt"])
    # 除元数据列外的都是数值列
    meta_cols = {"报告日", "数据源", "是否审计", "公告日期", "币种", "类型", "更新日期"}
    numeric_cols = [c for c in df.columns if c not in meta_cols]
    records = df_to_records(df, numeric_cols=numeric_cols)
    for rec in records:
        rec["报告日"] = to_iso(rec.get("报告日"))
        if rec.get("公告日期"):
            rec["公告日期"] = to_iso(rec["公告日期"])
    return records


def fetch_info(code: str):
    """东财个股基本信息；失败时返回空 dict（不影响整体流程）"""
    try:
        df = ak.stock_individual_info_em(symbol=code)
        if df is None or df.empty:
            return {}
        return {str(r["item"]): r["value"] for _, r in df.iterrows()}
    except Exception:
        return {}


def iso_or_none(v):
    """NaN/NaT → None，否则转 ISO 日期"""
    try:
        import pandas as pd
        if pd.isna(v):
            return None
    except Exception:
        if v is None:
            return None
    return to_iso(v)


def format_quote_time(raw):
    """腾讯行情时间 '20260807161442' → ISO 格式"""
    s = str(raw).strip()
    if len(s) == 14 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}T{s[8:10]}:{s[10:12]}:{s[12:14]}+08:00"
    return None


def fetch_snapshot(code: str):
    """最新估值快照：腾讯行情接口（最新价/涨跌幅/PE/PB/市值/换手率）"""
    url = f"http://qt.gtimg.cn/q={sina_symbol(code)}"
    r = requests.get(url, timeout=10)
    r.encoding = "gbk"
    parts = r.text.strip().split(";")[0].split("~")
    if len(parts) < 50:
        return {}

    def num(i):
        try:
            v = float(parts[i])
            return v
        except (ValueError, IndexError):
            return None

    price = num(3)
    snapshot = {
        "name": parts[1].strip() or None,
        "price": price,
        "change_pct": None if num(32) is None else round(num(32) / 100.0, 6),
        "pe_ttm": num(39),
        "pb": num(46),
        "market_cap": None if num(45) is None else round(num(45) * 1e8, 2),
        "float_market_cap": None if num(44) is None else round(num(44) * 1e8, 2),
        "turnover_rate": None if num(38) is None else round(num(38) / 100.0, 6),
        "time": format_quote_time(parts[30]),
    }
    return snapshot


def fetch_dividends(code: str):
    """巨潮分红历史（送股/转增/派息比例 + 关键日期），按公告日期倒序"""
    df = ak.stock_dividend_cninfo(symbol=code)
    if df is None or df.empty:
        return []
    records = []
    for _, row in df.iterrows():
        records.append(
            {
                "year": str(row["报告时间"]).strip(),
                "type": str(row["分红类型"]).strip(),
                "announce_date": iso_or_none(row["实施方案公告日期"]),
                "record_date": iso_or_none(row["股权登记日"]),
                "ex_date": iso_or_none(row["除权日"]),
                "pay_date": iso_or_none(row["派息日"]),
                "bonus_per_10": parse_number(row["派息比例"]),
                "transfer_per_10": parse_number(row["转增比例"]),
                "description": str(row["实施方案分红说明"]).strip(),
            }
        )
    records.sort(key=lambda r: r["announce_date"] or "", reverse=True)
    return records


def fetch_reports(code: str):
    """巨潮资讯定期报告列表（官方披露 PDF 直链），按日期倒序"""
    reports = []
    today = datetime.now()
    start = (today - timedelta(days=365 * 3)).strftime("%Y%m%d")
    end = today.strftime("%Y%m%d")
    for cat in REPORT_CATEGORIES:
        try:
            df = ak.stock_zh_a_disclosure_report_cninfo(
                symbol=code,
                category=cat,
                start_date=start,
                end_date=end,
            )
        except Exception:
            continue
        if df is None or df.empty:
            continue
        for _, row in df.head(MAX_PERIODS).iterrows():
            title = str(row["公告标题"]).strip()
            if "摘要" in title:
                continue
            date = str(row["公告时间"])[:10]
            detail = str(row["公告链接"])
            try:
                aid = detail.split("announcementId=")[1].split("&")[0]
            except IndexError:
                continue
            reports.append(
                {
                    "title": title,
                    "category": cat,
                    "date": date,
                    "pdf_url": f"http://static.cninfo.com.cn/finalpage/{date}/{aid}.PDF",
                    "detail_url": detail,
                }
            )
    reports.sort(key=lambda r: r["date"], reverse=True)
    return reports[: MAX_PERIODS * 2]


def fetch_company(code: str, name: str):
    """抓取单家公司全部数据，失败项单独降级，不中断"""
    result = {"code": code, "name": name}
    result["updated_at"] = datetime.now(CN_TZ).strftime("%Y-%m-%dT%H:%M:%S+08:00")
    errors = []

    try:
        result["info"] = fetch_info(code)
    except Exception as e:
        result["info"] = {}
        errors.append(f"info: {e}")
    sleep_between()

    try:
        result["indicators"] = fetch_indicators(code)
    except Exception as e:
        result["indicators"] = []
        errors.append(f"indicators: {e}")
    sleep_between()

    for key, kind in (
        ("income", "利润表"),
        ("balance", "资产负债表"),
        ("cashflow", "现金流量表"),
    ):
        try:
            result[key] = fetch_report(code, kind)
        except Exception as e:
            result[key] = []
            errors.append(f"{key}: {e}")
        sleep_between()

    try:
        result["snapshot"] = fetch_snapshot(code)
    except Exception as e:
        result["snapshot"] = {}
        errors.append(f"snapshot: {e}")
    sleep_between()

    try:
        result["dividends"] = fetch_dividends(code)
    except Exception as e:
        result["dividends"] = []
        errors.append(f"dividends: {e}")
    sleep_between()

    try:
        result["reports"] = fetch_reports(code)
    except Exception as e:
        result["reports"] = []
        errors.append(f"reports: {e}")

    result["errors"] = errors if errors else None
    return result


def save_json(path: Path, data):
    """原子写入：先写临时文件再替换，避免半截文件被 Pages 读取"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    os.replace(tmp, path)


def main():
    parser = argparse.ArgumentParser(description="抓取 A 股财务数据 → 静态 JSON")
    parser.add_argument("--limit", type=int, default=0, help="最多抓取的公司数（测试用）")
    args = parser.parse_args()

    companies = DEFAULT_COMPANIES[: args.limit] if args.limit > 0 else DEFAULT_COMPANIES
    print(f"[{datetime.now(CN_TZ).strftime('%F %T')}] 开始抓取 {len(companies)} 家公司 ...")

    index_items = []
    failed = []
    for i, (code, name) in enumerate(companies, 1):
        print(f"[{i}/{len(companies)}] {code} {name} ...", flush=True)
        try:
            data = fetch_company(code, name)
            save_json(COMPANIES_DIR / f"{code}.json", data)
            index_items.append(
                {
                    "code": code,
                    "name": name,
                    "industry": (data.get("info") or {}).get("行业"),
                    "updated_at": data["updated_at"],
                }
            )
            if data.get("errors"):
                print(f"      部分失败: {data['errors']}")
            else:
                print("      完成")
        except Exception:
            failed.append(code)
            print(f"      抓取失败: {traceback.format_exc()}", flush=True)
        sleep_between()

    now = datetime.now(CN_TZ).strftime("%Y-%m-%dT%H:%M:%S+08:00")
    save_json(
        OUTPUT_DIR / "index.json",
        {
            "updated_at": now,
            "count": len(index_items),
            "companies": index_items,
        },
    )

    print(f"完成：成功 {len(index_items)} 家，失败 {len(failed)} 家")
    if failed:
        print(f"失败列表: {failed}")
        sys.exit(1)


if __name__ == "__main__":
    main()
