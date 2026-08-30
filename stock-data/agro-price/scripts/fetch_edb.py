# -*- coding: utf-8 -*-
"""行业 EDB 量价抓取器（汽车 / 电解铝 / 航运 / 轮胎橡胶 / 地产链 / 煤炭 / 钢铁）。

数据源：本地 Wind 金融能力 .agents/skills/wind-mcp-skill/scripts/cli.mjs
        economic_data.query_economic_indicator_data（question 直接传 EDB 代码，逗号分隔）。

策略（对齐"周/月聚合、省积分"）：
  - 一次调用按分类批量传该类的多个 EDB 代码（共享同一日期区间），减少调用数。
  - 日频序列自动聚合到"每周最后交易日的值"（周中密度 > 1/周 才折叠）；
    周频、月频原生序列保持不变（月频无法由更少数据补出，原样保留）。
  - 只保留最近一年（--begin/--end，默认今天往前 365 天）；新分类单独 --only
    --begin 2025-01-01 抓取后合并写回，分类级 range 记录各自区间。

产物：../data/edb.json  结构：
  { "updated_at", "range":{begin,end}, "categories":[
      { "id","name","indicators":[{"code","name","unit","freq","source",
                                   "points":[["YYYY-MM-DD", value], ...]}] } ] }

用法：python fetch_edb.py            # 抓取全部分类
      python fetch_edb.py --only alu # 只抓某一类（id）
"""
import argparse
import datetime as dt
import io
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# 仓库根 = stock-data/agro-price/scripts -> 上溯三级
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SKILL_DIR = os.path.join(REPO, ".agents", "skills", "wind-mcp-skill")
CLI = os.path.join("scripts", "cli.mjs")
OUT = os.path.join(HERE, "..", "data", "edb.json")

# 分类 -> 指标清单（code, 展示名, 分组标签）。展示名以本地探测为准，
# 单位/频率最终以 Wind 返回 meta 为准。
CATEGORIES = [
    {
        "id": "auto", "name": "汽车",
        # 口径统一用中汽协（月度完整，无统计局 1-2 月合并发布导致的缺口）；单位「辆」。
        "indicators": [
            ("S0105523", "汽车产量", "产量"),
            ("S0105710", "汽车销量", "产量"),
            ("S0105526", "乘用车产量", "产量"),
            ("S6139215", "新能源汽车产量", "新能源"),
            ("S6139212", "新能源汽车销量", "新能源"),
            ("X2694913", "新能源渗透率", "新能源"),
            ("S0105689", "比亚迪产量", "厂商"),
        ],
    },
    {
        "id": "alu", "name": "电解铝",
        "indicators": [
            ("S0179655", "铝锭A00现货", "价格"),
            ("Z9174481", "氧化铝", "成本"),
            ("S0029755", "LME铝", "价格"),
            ("S0031718", "铝锭月均价", "价格"),
        ],
    },
    {
        "id": "shipping", "name": "航运",
        "indicators": [
            ("S0000066", "CCFI综合", "集运指数"),
            ("S0114089", "SCFI综合", "集运指数"),
            ("S0000073", "CCFI美西", "航线"),
            ("S0000075", "CCFI欧洲", "航线"),
            ("S0000072", "CCFI美东", "航线"),
            ("S0000069", "CCFI东南亚", "航线"),
            ("D9483906", "沿海散货", "散货油运"),
            ("S0031553", "BDTI原油运输", "散货油运"),
            ("S0031550", "BDI干散货", "散货油运"),
        ],
    },
    {
        "id": "tire", "name": "轮胎橡胶",
        # 产业链：产量/出口（需求）+ 开工率（景气）+ 天然/合成橡胶（原料成本）。
        # 价格类为日频，脚本自动折周；产量用橡胶信息贸易网口径（月度连续，无统计局 1-2 月缺口）。
        "indicators": [
            ("F0040955", "轮胎产量", "产销"),
            ("S0270241", "橡胶轮胎出口额", "产销"),
            ("S9987482", "全钢胎开工率", "开工率"),
            ("S6124651", "半钢胎开工率", "开工率"),
            ("S5470428", "天然橡胶", "原料价格"),
            ("S5470420", "丁苯橡胶", "原料价格"),
        ],
    },
    {
        "id": "realestate", "name": "地产链",
        # 统计局月度累计值为主曲线（每年 1 月重置形成锯齿属累计口径正常形态）；
        # 70 城同比与 30 城成交为市场高频侧确认。码源：search_economic_indicator 检索。
        "indicators": [
            ("S0029658", "商品房销售面积累计", "销售"),
            ("S0029659", "商品房销售额累计", "销售"),
            ("S0029656", "开发投资完成额累计", "投资"),
            ("S0029669", "房屋新开工面积累计", "施工"),
            ("S0029670", "房屋竣工面积累计", "施工"),
            ("S2707411", "70城新房价格同比", "价格"),
            ("S2707380", "30城日均成交(月均)", "销售"),
        ],
    },
    {
        "id": "coal", "name": "煤炭",
        # 产/需（统计局原煤、海关进口、统计局焦炭）+ 价格（秦皇岛动力煤周频、焦链日频折周）。
        "indicators": [
            ("S0026989", "原煤产量", "产销"),
            ("S0027001", "煤炭进口量", "产销"),
            ("S0026997", "焦炭产量", "产销"),
            ("S5104572", "秦皇岛动力煤Q5500", "价格"),
            ("S5132102", "炼焦煤均价", "价格"),
            ("S5132320", "冶金焦平仓价", "价格"),
        ],
    },
    {
        "id": "steel", "name": "钢铁",
        # 统计局当月产量 + 螺纹钢现货（日频折周）+ 进口矿月度均价 + 钢材社会库存（周频）。
        "indicators": [
            ("S0027374", "粗钢产量", "产量"),
            ("S0027370", "生铁产量", "产量"),
            ("S0027378", "钢材产量", "产量"),
            ("S5707798", "螺纹钢价格", "价格"),
            ("S5704501", "铁矿石进口均价", "价格"),
            ("L3818799", "钢材社会库存", "库存"),
        ],
    },
]


def call_wind(codes, begin, end):
    """一次 economic_data 调用，逗号批量传代码；返回 code->metric dict。"""
    params = {"question": ",".join(codes), "beginDate": begin, "endDate": end}
    suffix = "edb-%d" % int(dt.datetime.now().timestamp())
    pf = os.path.join("scripts", "request-%s.json" % suffix)
    pfull = os.path.join(SKILL_DIR, pf.replace("/", os.sep))
    with io.open(pfull, "w", encoding="utf-8") as f:
        f.write(json.dumps(params, ensure_ascii=False))
    try:
        r = subprocess.run(
            ["node", CLI, "call", "economic_data",
             "query_economic_indicator_data", "@" + pf],
            cwd=SKILL_DIR, capture_output=True, text=True,
            encoding="utf-8", timeout=180,
        )
    finally:
        try:
            os.remove(pfull)
        except OSError:
            pass
    out = (r.stdout or "").strip()
    if not out:
        raise RuntimeError("wind empty stdout; stderr=%s" % (r.stderr or "")[:300])
    env = json.loads(out)
    if not env.get("content"):
        raise RuntimeError("wind envelope: %s" % json.dumps(env, ensure_ascii=False)[:300])
    payload = json.loads(env["content"][0]["text"])
    result = {}
    for mt in payload.get("metrics", []):
        meta = mt.get("meta", {})
        code = meta.get("code") or mt.get("code")
        result[code] = {
            "meta": meta,
            "date": mt.get("date", []),
            "value": mt.get("value", []),
        }
    return result


def parse_date(s):
    s = str(s).strip()
    for fmt in ("%Y%m%d", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def to_num(v):
    try:
        f = float(v)
        return round(f, 4)
    except (TypeError, ValueError):
        return None


def collapse_weekly(dates, values):
    """日频->每周最后一点；周/月频（每周<=1点）原样返回。"""
    pts = []
    for ds, vs in zip(dates, values):
        d = parse_date(ds)
        n = to_num(vs)
        if d is None or n is None:
            continue
        pts.append((d, n))
    if len(pts) < 2:
        return [[d.strftime("%Y-%m-%d"), v] for d, v in pts]
    # 判断原生密度：跨度天数 / 点数 < 5 视为日频，需折叠
    span = (pts[-1][0] - pts[0][0]).days + 1
    if span / max(len(pts), 1) >= 5:
        return [[d.strftime("%Y-%m-%d"), v] for d, v in pts]
    weekly = {}
    for d, v in pts:
        iso = d.isocalendar()
        weekly[(iso[0], iso[1])] = (d, v)  # 同周后者覆盖前者（周内最后交易日）
    return [[d.strftime("%Y-%m-%d"), v] for (_y, _w), (d, v) in sorted(weekly.items())]


def month_mean(dates, values):
    """日频波动大的成交类序列 -> 每月均值（抹平周内噪声，对齐月度展示）。"""
    buckets = {}
    for ds, vs in zip(dates, values):
        d = parse_date(ds)
        n = to_num(vs)
        if d is None or n is None:
            continue
        buckets.setdefault((d.year, d.month), []).append((d, n))
    out = []
    for (_y, _m), items in sorted(buckets.items()):
        last_d = items[-1][0]
        avg = sum(v for _d, v in items) / len(items)
        out.append([last_d.strftime("%Y-%m-%d"), round(avg, 2)])
    return out


# 成交面积等日频量能指标单日值周内噪声大，不走折周取末点，改按月均聚合
MONTH_MEAN_CODES = {"S2707380"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="仅抓取指定分类 id（auto/alu/shipping）")
    ap.add_argument("--begin", default=None)
    ap.add_argument("--end", default=None)
    args = ap.parse_args()

    end = args.end or dt.date.today().strftime("%Y-%m-%d")
    begin = args.begin or (dt.date.today() - dt.timedelta(days=365)).strftime("%Y-%m-%d")

    cats_out = []
    total_pts = 0
    for cat in CATEGORIES:
        if args.only and cat["id"] != args.only:
            continue
        codes = [c for c, _n, _g in cat["indicators"]]
        print("[fetch] %s: %d codes %s" % (cat["id"], len(codes), codes))
        data = call_wind(codes, begin, end)
        inds = []
        for code, disp, group in cat["indicators"]:
            mt = data.get(code)
            if not mt or not mt["date"]:
                print("  [warn] %s(%s) 无数据返回，跳过" % (disp, code))
                continue
            if code in MONTH_MEAN_CODES:
                pts = month_mean(mt["date"], mt["value"])
            else:
                pts = collapse_weekly(mt["date"], mt["value"])
            if not pts:
                continue
            meta = mt["meta"]
            inds.append({
                "code": code,
                "name": meta.get("name") or disp,
                "label": disp,
                "unit": meta.get("unit", ""),
                "freq": meta.get("freq", ""),
                "source": meta.get("source", ""),
                "group": group,
                "points": pts,
            })
            total_pts += len(pts)
            print("  [ok] %-8s %-22s freq=%s n=%d" % (
                code, disp, meta.get("freq", "?"), len(pts)))
        if inds:
            cats_out.append({"id": cat["id"], "name": cat["name"],
                             "range": {"begin": begin, "end": end},
                             "indicators": inds})

    out = {
        "updated_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "range": {"begin": begin, "end": end},
        "categories": cats_out,
    }

    # --only 时合并写回：只替换本次抓取的分类，保留 edb.json 里其它分类（省积分，不重抓）
    if args.only and os.path.exists(os.path.abspath(OUT)):
        try:
            with io.open(os.path.abspath(OUT), encoding="utf-8") as f:
                existing = json.load(f)
            merged = {c["id"]: c for c in cats_out}
            for c in existing.get("categories", []):
                merged.setdefault(c["id"], c)
            order = [cat["id"] for cat in CATEGORIES]
            cats_final = [merged[i] for i in order if i in merged]
            for cid in merged:
                if cid not in order:
                    cats_final.append(merged[cid])
            out["categories"] = cats_final
            print("[merge] --only %s：保留其它分类，仅替换该类" % args.only)
        except Exception as e:
            print("[merge] 合并失败，退回整份覆盖：%s" % e)

    ofull = os.path.abspath(OUT)
    os.makedirs(os.path.dirname(ofull), exist_ok=True)
    with io.open(ofull, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("[done] 写入 %s  分类=%d 序列=%d 总点数=%d" % (
        ofull, len(cats_out),
        sum(len(c["indicators"]) for c in cats_out), total_pts))


if __name__ == "__main__":
    sys.exit(main())
