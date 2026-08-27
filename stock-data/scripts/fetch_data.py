#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""抓取 A 股财务数据，生成供 GitHub Pages 托管的静态 JSON。

数据源（全部为公开免费接口，无需 token）：
- 财务指标（ROE/毛利率/净利率等）：同花顺摘要接口
- 三大报表（利润表/资产负债表/现金流量表）：新浪财经
- 最新估值快照（最新价/PE/PB/市值）：腾讯行情接口
- 分红历史：巨潮资讯
- 定期报告 PDF 链接：巨潮资讯
- 审计信息（事务所/意见类型）：定期报告 PDF 文本解析（巨潮直链）

用法：
    python fetch_data.py                 # 抓取全部配置的公司
    python fetch_data.py --limit 2       # 只抓前 2 家（快速测试）
"""

import argparse
import json
import os
import re
import sys
import time
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

import akshare as ak
import pymupdf
import requests

from config import DEFAULT_COMPANIES, REQUEST_INTERVAL
from scoring import compute_scores  # 预计算评分（与 assets/stock.js 一致性由 _score_check.py 验证）

# 输出目录：<仓库>/stock-data/data
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data"
COMPANIES_DIR = OUTPUT_DIR / "companies"

# 输出报告期数基准（实际输出 MAX_PERIODS+1 期 ≈ 5 年；
# 多 1 期用于最早一期单季值的还原，相应多抓 1 期被丢弃）
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
    """'20251231' / '2025-12-31' → '2025-12-31'；无法识别原样返回；NaN/NaT → None"""
    s = str(date_value).strip()
    if not s or s.lower() in ("nan", "nat", "none"):
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
    """同花顺财务摘要：关键指标，按报告期倒序取最近 MAX_PERIODS 期。

    财务数据为累计口径（一季报=Q1，半年报=Q1+Q2，三季报=前三季，年报=全年），
    额外计算单季口径（营业总收入/净利润）：本期累计 - 上期累计；
    一季报(03-31)本身就是单季。新增字段 `*_单季`，保留原始累计值。
    多抓 2 期：1 期供最早一期的单季还原，另 1 期因无上期而被丢弃。
    """
    df = ak.stock_financial_abstract_ths(symbol=code, indicator="按报告期")
    if df is None or df.empty:
        return []
    df = df.copy()
    df["_dt"] = pd_to_datetime(df["报告期"])
    df = df.sort_values("_dt", ascending=False).head(MAX_PERIODS + 2)
    df = df.sort_values("_dt", ascending=True).reset_index(drop=True)
    # 单季化（升序遍历，累计差）
    for col in ("营业总收入", "净利润"):
        single = []
        for i, row in df.iterrows():
            cum = parse_number(row[col])
            if i == 0:
                single.append(None)  # 最早一期无上期，无法还原
            elif str(row["报告期"]).endswith("03-31"):
                single.append(cum)
            else:
                prev = parse_number(df.loc[i - 1, col])
                single.append(None if (cum is None or prev is None) else round(cum - prev, 4))
        df[f"{col}_单季"] = single
    df = df.iloc[1:]  # 丢弃最早一期（该期之前已用其一季报还原相邻期单季值）
    df = df.sort_values("_dt", ascending=False)
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
    """个股基本信息：优先东财，失败时用巨潮 profile 兜底（提供行业）；
    两者都失败时抛异常，由调用方记录到 errors（不静默吞掉）。"""
    try:
        df = ak.stock_individual_info_em(symbol=code)
        if df is not None and not df.empty:
            return {str(r["item"]): r["value"] for _, r in df.iterrows()}
    except Exception:
        pass
    try:
        df = ak.stock_profile_cninfo(symbol=code)
        if df is not None and not df.empty:
            row = df.iloc[0]
            info = {}
            if row.get("所属行业") is not None:
                info["行业"] = str(row["所属行业"]).strip()
            if row.get("A股简称") is not None:
                info["股票简称"] = str(row["A股简称"]).strip()
            if row.get("上市日期") is not None:
                info["上市日期"] = to_iso(str(row["上市日期"])[:10])
            return info
    except Exception:
        pass
    raise RuntimeError("东财/巨潮基本信息接口均不可用")


# 东财/巨潮的“行业”字段值（如“汽车制造业”）为证监会行业分类，原样保留即可


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
    """行情时间 → ISO：A 股 '20260807161442' / 港股 '2026/08/21 16:08:14' / 美股 '2026-08-25 16:00:01'"""
    s = str(raw).strip()
    if len(s) == 14 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}T{s[8:10]}:{s[10:12]}:{s[12:14]}+08:00"
    m = re.match(r"(\d{4})/(\d{2})/(\d{2}) (\d{2}):(\d{2}):(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}T{m.group(4)}:{m.group(5)}:{m.group(6)}+08:00"
    m = re.match(r"(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}T{m.group(4)}:{m.group(5)}:{m.group(6)}+08:00"
    return None


def fetch_snapshot(code: str):
    """最新估值快照：腾讯行情接口（最新价/涨跌幅/PE/PB/市值/换手率），A 股专用"""
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


# ==================== 港股数据源（东财港股 + 腾讯行情） ====================
# 东财港股三大报表为长表（每行一个科目），科目名按 IFRS 口径，映射回前端 A 股字段名。
# 注意：东财已把各公司财年末统一映射为 12-31 报告期，与 A 股 schema 完全对齐。

# 资产负债表科目映射：东财科目名 → 前端字段（未列出的科目保留原名）
HK_BALANCE_MAP = {
    "流动资产合计": "流动资产合计",
    "流动负债合计": "流动负债合计",
    "总负债": "负债合计",
    "总资产": "资产总计",
    "现金及等价物": "货币资金",
    # 类现金科目归并到“交易性金融资产”，供净现金/市值加权计算
    "短期投资": "交易性金融资产",
    "指定以公允价值记账之金融资产(流动)": "交易性金融资产",
    "无形资产": "无形资产",
    "商誉": "商誉",
    "短期贷款": "短期借款",
    "长期贷款": "长期借款",
    "融资租赁负债(非流动)": "租赁负债",
    "股东权益": "所有者权益(或股东权益)合计",
}

# 利润表科目映射
HK_INCOME_MAP = {
    "营业额": "营业总收入",
    "营运收入": "营业收入",
    "股东应占溢利": "净利润",
    "毛利": "营业利润",
    "税项": "所得税费用",
}

# 现金流量表科目映射（港股无“销售商品提供劳务收到的现金”，收现比留空）
HK_CASHFLOW_MAP = {
    "经营业务现金净额": "经营活动产生的现金流量净额",
    "购建固定资产": "购建固定资产、无形资产和其他长期资产所支付的现金",
    "购建无形资产及其他资产": "购建无形资产及其他资产支付的现金",
    "期末现金": "期末现金及现金等价物余额",
}

# 东财港股分析指标（英文列）→ 前端 indicators 字段；比率类为百分数数值需 /100
HK_IND_MAP = {
    "OPERATE_INCOME": "营业总收入",
    "HOLDER_PROFIT": "净利润",
    "BASIC_EPS": "基本每股收益",
    "BPS": "每股净资产",
}
HK_IND_PCT = {
    "GROSS_PROFIT_RATIO": "销售毛利率",
    "NET_PROFIT_RATIO": "销售净利率",
    "ROE_AVG": "净资产收益率",
    "ROA": "总资产净利率",
    "DEBT_ASSET_RATIO": "资产负债率",
}


def _pct(v):
    """百分数数值（50.87）→ 小数（0.5087）"""
    n = parse_number(v)
    return None if n is None else round(n / 100.0, 4)


def fetch_hk_report(code: str, kind: str, item_map: dict):
    """东财港股三大报表：长表（科目×金额）→ 宽表（报告日 × 字段），按报告日倒序"""
    df = ak.stock_financial_hk_report_em(stock=code, symbol=kind)
    if df is None or df.empty:
        return []
    by_date = {}
    for _, r in df.iterrows():
        dt = to_iso(str(r["REPORT_DATE"])[:10])
        if not dt:
            continue
        item = item_map.get(str(r["STD_ITEM_NAME"]).strip(), str(r["STD_ITEM_NAME"]).strip())
        val = parse_number(r["AMOUNT"])
        by_date.setdefault(dt, {})[item] = val
    records = [{"报告日": dt, **fields} for dt, fields in by_date.items()]
    records.sort(key=lambda r: r["报告日"], reverse=True)
    return records[:MAX_PERIODS]


def fetch_hk_indicators(code: str):
    """东财港股财务分析指标：映射为前端 indicators 字段，含单季还原（累计差），按报告期倒序"""
    df = ak.stock_financial_hk_analysis_indicator_em(symbol=code)
    if df is None or df.empty:
        return []
    df = df.copy()
    df = df.sort_values("REPORT_DATE", ascending=True).reset_index(drop=True)
    rows = []
    for _, r in df.iterrows():
        rec = {"报告期": to_iso(str(r["REPORT_DATE"])[:10])}
        for en, zh in HK_IND_MAP.items():
            rec[zh] = parse_number(r[en])
        for en, zh in HK_IND_PCT.items():
            rec[zh] = _pct(r[en])
        rec["流动比率"] = parse_number(r["CURRENT_RATIO"])
        rows.append(rec)
    # 单季还原：本期累计 - 上期累计（港股无 A 股式一季报特例，统一按累计差）
    for col in ("营业总收入", "净利润"):
        for i, rec in enumerate(rows):
            cum = rec[col]
            if i == 0:
                rec[col + "_单季"] = None
            else:
                prev = rows[i - 1][col]
                rec[col + "_单季"] = None if (cum is None or prev is None) else round(cum - prev, 4)
    rows = rows[-MAX_PERIODS:]
    return rows[::-1]


def fetch_hk_snapshot(code: str):
    """港股快照：腾讯行情（价格/涨跌幅/时间）+ 东财指标（PE/PB/市值）

    腾讯港股字段与 A 股不同：3=最新价、30=时间、31=涨跌额、32=涨跌幅、44=流通市值(亿港元)、45=总市值(亿港元)
    """
    url = f"http://qt.gtimg.cn/q=hk{code}"
    r = requests.get(url, timeout=10)
    r.encoding = "gbk"
    parts = r.text.strip().split(";")[0].split("~")
    if len(parts) < 40:
        return {}

    def num(i):
        try:
            return float(parts[i])
        except (ValueError, IndexError):
            return None

    snapshot = {
        "name": parts[1].strip() or None,
        "price": num(3),
        "change_pct": None if num(32) is None else round(num(32) / 100.0, 6),
        "time": format_quote_time(parts[30]),
    }
    try:
        df = ak.stock_hk_financial_indicator_em(symbol=code)
        if df is not None and not df.empty:
            row = df.iloc[0]
            snapshot["pe_ttm"] = parse_number(row["市盈率"])
            snapshot["pb"] = parse_number(row["市净率"])
            snapshot["market_cap"] = parse_number(row["总市值(港元)"])
            snapshot["float_market_cap"] = None if num(44) is None else round(num(44) * 1e8, 2)
            snapshot["turnover_rate"] = None
    except Exception:
        snapshot["pe_ttm"] = None
        snapshot["pb"] = None
        snapshot["market_cap"] = None
        snapshot["float_market_cap"] = None
        snapshot["turnover_rate"] = None
    return snapshot


def fetch_hk_dividends(code: str):
    """东财港股分红：方案文本解析每股派息 → 每10股口径，日期统一 ISO"""
    df = ak.stock_hk_dividend_payout_em(symbol=code)
    if df is None or df.empty:
        return []
    records = []
    for _, row in df.iterrows():
        plan = str(row["分红方案"]).strip()
        bonus = None
        m = re.search(r"每股派(?:人民币|港币)?([\d.]+)元", plan)
        if m:
            bonus = round(float(m.group(1)) * 10, 4)  # 每股 → 每10股
        else:
            m = re.search(r"每10股派(?:人民币|港币)?([\d.]+)元", plan)
            if m:
                bonus = round(float(m.group(1)), 4)
        kind = str(row["分配类型"]).strip()
        annual = ("年度" in kind) or ("末期" in kind)
        rec_date = str(row["截至过户日"]).strip() if row["截至过户日"] else ""
        rec_date = to_iso(rec_date.split("-")[0].split("至")[0]) if rec_date else None
        records.append(
            {
                "year": str(row["财政年度"]).strip() + ("年报" if annual else "中报"),
                "type": "年度分红" if annual else "中期分红",
                "announce_date": iso_or_none(str(row["最新公告日期"])[:10]),
                "record_date": rec_date,
                "ex_date": iso_or_none(str(row["除净日"])[:10]),
                "pay_date": iso_or_none(str(row["发放日"])[:10]),
                "bonus_per_10": bonus,
                "transfer_per_10": None,
                "description": plan,
            }
        )
    records.sort(key=lambda r: r["announce_date"] or "", reverse=True)
    return records


def fetch_company_hk(code: str, name: str):
    """抓取港股公司：指标/三大报表/快照/分红（东财 + 腾讯）；无定期报告 PDF 与审计信息"""
    result = {"code": code, "name": name, "market": "HK"}
    result["updated_at"] = datetime.now(CN_TZ).strftime("%Y-%m-%dT%H:%M:%S+08:00")
    errors = []
    result["info"] = {}  # 东财港股无行业信息，留空

    try:
        result["indicators"] = fetch_hk_indicators(code)
    except Exception as e:
        result["indicators"] = []
        errors.append(f"indicators: {e}")
    sleep_between()

    for key, kind, item_map in (
        ("income", "利润表", HK_INCOME_MAP),
        ("balance", "资产负债表", HK_BALANCE_MAP),
        ("cashflow", "现金流量表", HK_CASHFLOW_MAP),
    ):
        try:
            result[key] = fetch_hk_report(code, kind, item_map)
        except Exception as e:
            result[key] = []
            errors.append(f"{key}: {e}")
        sleep_between()

    # 归母权益 = 股东权益 - 少数股东权益（杜邦拆解口径）
    for rec in result["balance"]:
        eq = rec.get("所有者权益(或股东权益)合计")
        mi = rec.get("少数股东权益")
        if eq is not None and mi is not None:
            rec["归属于母公司股东权益合计"] = round(eq - mi, 4)

    try:
        result["snapshot"] = fetch_hk_snapshot(code)
    except Exception as e:
        result["snapshot"] = {}
        errors.append(f"snapshot: {e}")
    sleep_between()

    try:
        result["dividends"] = fetch_hk_dividends(code)
    except Exception as e:
        result["dividends"] = []
        errors.append(f"dividends: {e}")
    sleep_between()

    result["reports"] = []  # 港股无巨潮定期报告，前端已容错
    result["errors"] = errors if errors else None
    return result


# ==================== 美股数据源（东财美股 + 腾讯行情） ====================
# 东财美股三大报表为长表（科目×报告期），科目中文命名；财务指标仅年报口径
# （美股财年统一映射 12-31，与 A 股 schema 对齐）。金额单位为美元；
# 无分红/定期报告接口（前端已容错空列表）。

# 财务指标映射：东财英文列 → 前端字段；比率类为百分数数值需 /100
US_IND_MAP = {
    "OPERATE_INCOME": "营业总收入",
    "PARENT_HOLDER_NETPROFIT": "净利润",
    "BASIC_EPS": "基本每股收益",
}
US_IND_PCT = {
    "GROSS_PROFIT_RATIO": "销售毛利率",
    "NET_PROFIT_RATIO": "销售净利率",
    "ROE_AVG": "净资产收益率",
    "ROA": "总资产净利率",
    "DEBT_ASSET_RATIO": "资产负债率",
}

# 资产负债表科目映射：东财美股科目名 → 前端字段（未列出的科目保留原名）
US_BALANCE_MAP = {
    "现金及现金等价物": "货币资金",
    # 类现金科目归并到“交易性金融资产”，供净现金/市值加权计算
    "有价证券投资(流动)": "交易性金融资产",
    "短期投资": "交易性金融资产",
    "应收账款": "应收账款",
    "存货": "存货",
    "流动资产合计": "流动资产合计",
    "物业、厂房及设备": "固定资产",
    "无形资产": "无形资产",
    "商誉": "商誉",
    "总资产": "资产总计",
    "短期债务": "短期借款",
    "流动负债合计": "流动负债合计",
    "长期负债": "长期借款",
    "总负债": "负债合计",
    "股东权益合计": "所有者权益(或股东权益)合计",
    "归属于母公司股东权益": "归属于母公司股东权益合计",
}

# 利润表科目映射
US_INCOME_MAP = {
    "主营收入": "营业总收入",
    "营业收入": "营业收入",
    "营业成本": "营业成本",
    "营业利润": "营业利润",
    "归属于母公司股东净利润": "净利润",
    "所得税": "所得税费用",
}

# 现金流量表科目映射（美股无“销售商品提供劳务收到的现金”，收现比留空）
US_CASHFLOW_MAP = {
    "经营活动产生的现金流量净额": "经营活动产生的现金流量净额",
    "购买固定资产": "购建固定资产、无形资产和其他长期资产所支付的现金",
    "购建无形资产及其他资产": "购建无形资产及其他资产支付的现金",
    "现金及现金等价物期末余额": "期末现金及现金等价物余额",
}


def fiscal_year_end(date_str):
    """美股财年统一映射 12-31：财年末在 1-6 月 → 上年 12-31，7-12 月 → 当年 12-31
    （如 NVDA 2026-01-25 → 2025-12-31，保证前端年报序列按 12-31 对齐）"""
    try:
        y, m, _ = str(date_str).split("-")
        y, m = int(y), int(m)
        return f"{y - (1 if m <= 6 else 0)}-12-31"
    except (ValueError, TypeError):
        return date_str


def fetch_us_report(code: str, kind: str, item_map: dict):
    """东财美股三大报表：长表（科目×金额）→ 宽表（报告日 × 字段），按报告日倒序"""
    df = ak.stock_financial_us_report_em(stock=code, symbol=kind, indicator="年报")
    if df is None or df.empty:
        return []
    by_date = {}
    for _, r in df.iterrows():
        dt = fiscal_year_end(to_iso(str(r["REPORT_DATE"])[:10]))
        if not dt:
            continue
        item = item_map.get(str(r["ITEM_NAME"]).strip(), str(r["ITEM_NAME"]).strip())
        val = parse_number(r["AMOUNT"])
        by_date.setdefault(dt, {})[item] = val
    records = [{"报告日": dt, **fields} for dt, fields in by_date.items()]
    records.sort(key=lambda r: r["报告日"], reverse=True)
    return records[:MAX_PERIODS]


def fetch_us_indicators(code: str):
    """东财美股财务指标：仅年报口径（无季报），映射前端字段，按报告期倒序"""
    df = ak.stock_financial_us_analysis_indicator_em(symbol=code)
    if df is None or df.empty:
        return []
    df = df.sort_values("REPORT_DATE", ascending=True).reset_index(drop=True)
    rows = []
    for _, r in df.iterrows():
        rec = {"报告期": fiscal_year_end(to_iso(str(r["REPORT_DATE"])[:10]))}
        for en, zh in US_IND_MAP.items():
            rec[zh] = parse_number(r[en])
        for en, zh in US_IND_PCT.items():
            rec[zh] = _pct(r[en])
        rec["流动比率"] = parse_number(r["CURRENT_RATIO"])
        # 美股仅年报（无单季口径），单季字段留空，前端季视图退化为报告期序列
        rec["营业总收入_单季"] = None
        rec["净利润_单季"] = None
        rows.append(rec)
    rows = rows[-MAX_PERIODS:]
    return rows[::-1]


def fetch_us_snapshot(code: str):
    """美股快照：腾讯行情（价格/涨跌幅/时间/PE/市值，单位美元）。

    腾讯美股字段：3=最新价、30=时间、32=涨跌幅%、39=PE(TTM)、44=流通市值(亿美元)、45=总市值(亿美元)；
    无 PB 与换手率，留空。
    """
    url = f"http://qt.gtimg.cn/q=us{code}"
    r = requests.get(url, timeout=10)
    r.encoding = "gbk"
    parts = r.text.strip().split(";")[0].split("~")
    if len(parts) < 40:
        return {}

    def num(i):
        try:
            return float(parts[i])
        except (ValueError, IndexError):
            return None

    return {
        "name": parts[1].strip() or None,
        "price": num(3),
        "change_pct": None if num(32) is None else round(num(32) / 100.0, 6),
        "pe_ttm": num(39),
        "pb": None,
        "market_cap": None if num(45) is None else round(num(45) * 1e8, 2),
        "float_market_cap": None if num(44) is None else round(num(44) * 1e8, 2),
        "turnover_rate": None,
        "time": format_quote_time(parts[30]),
    }


def fetch_company_us(code: str, name: str):
    """抓取美股公司：指标/三大报表/快照（东财 + 腾讯）；无分红与定期报告"""
    result = {"code": code, "name": name, "market": "US"}
    result["updated_at"] = datetime.now(CN_TZ).strftime("%Y-%m-%dT%H:%M:%S+08:00")
    errors = []
    result["info"] = {}  # 东财美股无行业信息，留空

    try:
        result["indicators"] = fetch_us_indicators(code)
    except Exception as e:
        result["indicators"] = []
        errors.append(f"indicators: {e}")
    sleep_between()

    for key, kind, item_map in (
        ("income", "综合损益表", US_INCOME_MAP),
        ("balance", "资产负债表", US_BALANCE_MAP),
        ("cashflow", "现金流量表", US_CASHFLOW_MAP),
    ):
        try:
            result[key] = fetch_us_report(code, kind, item_map)
        except Exception as e:
            result[key] = []
            errors.append(f"{key}: {e}")
        sleep_between()

    try:
        result["snapshot"] = fetch_us_snapshot(code)
    except Exception as e:
        result["snapshot"] = {}
        errors.append(f"snapshot: {e}")
    sleep_between()

    result["dividends"] = []  # 美股无分红接口
    result["reports"] = []  # 美股无定期报告接口
    result["errors"] = errors if errors else None
    return result


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


# 事务所名称前的常见修饰语（聘任表格文本：本次变更业经/续聘/已由等）
FIRM_NOISE = (
    "本次变更业经", "变更业经", "业经", "已由", "本次", "变更",
    "续聘", "改聘", "聘请", "聘任", "拟聘", "公司", "经", "由",
)

# 会计师事务所全称（名称 2-15 字 + 可选（特殊普通合伙）/（普通合伙）后缀，内部允许空白）
FIRM_RE = r"([\u4e00-\u9fa5]{2,15}?会计师事务所(?:[（(]\s*(?:特殊普通|普通)?\s*合伙\s*[）)])?)"


def clean_firm(raw: str):
    """去掉事务所名称前的修饰语，如「本次变更业经立信会计师事务所」→「立信会计师事务所」"""
    raw = raw.strip()
    m = re.search(FIRM_RE, raw)
    if m:
        raw = m.group(1)
    idx = 0
    for w in FIRM_NOISE:
        p = raw.find(w)
        if p >= 0:
            idx = max(idx, p + len(w))
    return raw[idx:].strip() if idx else raw


def first_firm(text: str):
    """提取会计师事务所名称：优先沪市「境内会计师事务所名称」/深市「审计机构名称」表格，
    兜底全文首个带（特殊普通合伙）后缀的全称。"""
    for anchor in ("境内会计师事务所名称", "审计机构名称"):
        m = re.search(anchor + r"\s*\n?\s*" + FIRM_RE, text)
        if m:
            return clean_firm(m.group(1))
    m = re.search(FIRM_RE, text)
    return clean_firm(m.group(1)) if m else None


def has_real_retention(text: str) -> bool:
    """判断是否真的为保留意见（排除「标准(的)无保留意见」中的子串误命中）。"""
    t = text
    for kw in ("标准的无保留意见", "标准无保留意见", "带强调事项段的无保留意见", "无保留意见"):
        t = t.replace(kw, "")
    return "保留意见" in t


def classify_opinion(text: str):
    """全文关键词精判审计意见类型。

    注意：「无保留意见」包含子串「保留意见」，必须先排除「无」前缀。
    """
    if "无法表示意见" in text:
        return "无法表示意见"
    if "否定意见" in text:
        return "否定意见"
    if "带强调事项段" in text or "带持续经营重大不确定性事项段" in text:
        return "带强调事项段的无保留意见"
    if has_real_retention(text):
        return "保留意见"
    if "标准的无保留意见" in text or "标准无保留意见" in text:
        return "标准无保留意见"
    if "无保留意见" in text:
        return "无保留意见"
    return None


def extract_audit(text: str, is_annual: bool = False):
    """从年报/半年报 PDF 文本提取审计信息（会计师事务所 + 审计意见）。

    深市披露表：「审计机构名称」「审计意见类型」；
    沪市表格：「境内会计师事务所名称」+ 董事会「非标准意见审计报告」说明
    （√/☑不适用 = 标准无保留意见，√/☑适用 = 非标准意见 → 转关键词精判）。
    以审计报告正文标志「我们审计了」判定是否真的审计：
    半年报未审计时（仅“聘任会计师事务所”表格），一律返回空，避免误导。
    """
    if re.search(r"我们\s*审\s*计\s*了", text) is None:
        # 年报理论必有审计报告；扫描版/解析失败时保守返回空
        return None, None

    # 1) 会计师事务所名称
    firm = first_firm(text)

    # 2) 审计意见类型
    opinion = None
    m = re.search(r"非标准意见审计报告.{0,200}?说明.{0,80}?[√☑✓]\s*不适用", text, re.S)
    if m:
        opinion = "标准无保留意见"
    else:
        m = re.search(r"非标准意见审计报告.{0,200}?说明.{0,80}?[√☑✓]\s*适用", text, re.S)
        if m:
            opinion = classify_opinion(text)
        else:
            m = re.search(r"审计意见类型\s*\n?\s*([^\n]{0,18})", text)
            if m:
                v = m.group(1).strip()
                if "无法表示意见" in v:
                    opinion = "无法表示意见"
                elif "否定意见" in v:
                    opinion = "否定意见"
                elif has_real_retention(v):
                    opinion = "保留意见"
                elif "标准的无保留意见" in v or "标准无保留意见" in v:
                    opinion = "标准无保留意见"
                elif "无保留意见" in v:
                    opinion = "无保留意见"
            else:
                opinion = classify_opinion(text)
    # 有审计报告且未检出非标准信号 → 标准无保留意见
    if opinion is None:
        opinion = "标准无保留意见"
    return firm, opinion


def fetch_audit(code: str, reports: list):
    """解析定期报告 PDF 的审计信息（事务所 + 意见类型），写回 reports 条目。

    仅年报/半年报可能附审计报告（季报不审计，保持为空）；
    已解析且 PDF 链接未变化的条目直接复用旧 JSON 缓存，避免重复下载。
    返回失败下载数（网络抖动时由调用方记录到 errors）。
    """
    old = {}
    try:
        prev = json.loads((COMPANIES_DIR / f"{code}.json").read_text(encoding="utf-8"))
        for r in prev.get("reports") or []:
            if r.get("audit_firm") or r.get("audit_opinion"):
                old[r.get("pdf_url")] = {
                    "audit_firm": r.get("audit_firm"),
                    "audit_opinion": r.get("audit_opinion"),
                }
    except (OSError, ValueError):
        pass
    headers = {"User-Agent": "Mozilla/5.0"}
    failed = 0
    for r in reports:
        if r["category"] not in ("年报", "半年报"):
            continue
        cached = old.get(r.get("pdf_url"))
        if cached:
            r.update(cached)
            continue
        ok = False
        for attempt in range(2):  # 瞬时网络失败自动重试一次
            try:
                resp = requests.get(r["pdf_url"], headers=headers, timeout=90)
                if resp.status_code == 404:
                    # 巨潮归档已移除/更换该 PDF，跳过且不计失败（不影响财务数据）
                    ok = True
                    break
                resp.raise_for_status()
                doc = pymupdf.open(stream=resp.content, filetype="pdf")
                text = "".join(page.get_text() for page in doc)
                doc.close()
                firm, opinion = extract_audit(text, r["category"] == "年报")
                r["audit_firm"] = firm
                r["audit_opinion"] = opinion
                ok = True
                break
            except Exception:
                time.sleep(2)
        if not ok:
            failed += 1
            r["audit_firm"] = None
            r["audit_opinion"] = None
    return failed


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


def fetch_company(code: str, name: str, market: str = "A"):
    """按市场分流：A 股走同花顺/新浪/巨潮，港股走东财港股接口，美股走东财美股接口"""
    if market == "HK":
        return fetch_company_hk(code, name)
    if market == "US":
        return fetch_company_us(code, name)
    return fetch_company_a(code, name)


def fetch_company_a(code: str, name: str):
    """抓取 A 股单家公司全部数据，失败项单独降级，不中断"""
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

    # 审计信息：解析年报/半年报 PDF（事务所 + 意见类型），失败不中断
    try:
        failed = fetch_audit(code, result["reports"])
        if failed:
            errors.append(f"audit: {failed} 份报告 PDF 解析失败（下次抓取自动重试）")
    except Exception as e:
        errors.append(f"audit: {e}")

    result["errors"] = errors if errors else None
    return result


def save_json(path: Path, data):
    """原子写入：先写临时文件再替换，避免半截文件被 Pages 读取。紧凑格式压缩体积（约减半）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
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
    for i, item in enumerate(companies, 1):
        if len(item) >= 3:
            code, name, market = item[0], item[1], item[2]
        else:  # 兼容旧的两元组配置
            code, name, market = item[0], item[1], "A"
        print(f"[{i}/{len(companies)}] {code} {name} [{market}] ...", flush=True)
        try:
            data = fetch_company(code, name, market)
            save_json(COMPANIES_DIR / f"{code}.json", data)
            # 预计算四大流派总分（Python 版评分，与前端 JS 评分一致性由 scripts/_score_check.py 验证）
            try:
                scores = compute_scores(data)
            except Exception:
                scores = None
            index_items.append(
                {
                    "code": code,
                    "name": name,
                    "market": market,
                    "industry": (data.get("info") or {}).get("行业"),
                    "price": (data.get("snapshot") or {}).get("price"),
                    "updated_at": data["updated_at"],
                    "scores": scores,
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
