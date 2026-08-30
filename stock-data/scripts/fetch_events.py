# -*- coding: utf-8 -*-
"""公司结构化事件与股东数据抓取器（一次性，走本地 Wind，不进每日 Actions）。

数据源：.agents/skills/wind-mcp-skill/scripts/cli.mjs
  - stock_data.get_stock_events        —— 增减持 / 并购重组 / 违规处罚 / 司法诉讼 / ST 变动
  - stock_data.get_stock_equity_holders —— 前十大/流通股东、机构持股、实控人、限售解禁

返回信封：content[0].text → JSON，业务数据在 payload["data"]["data"] = [ {columns:[{name,type,unit}], rows:[[...]]} ]（列式表数组）。

产物（独立于 fetch_data.py，Actions 永不写此目录）：
  data/events/<code>.json  单家原始明细：{code,name,windcode,fetched_at, events:{...}, holders:{...}}
  data/events/index.json   列表覆盖层：{updated_at, byCode:{code:{fraudDelta,mgmtDelta,flags,instHold,unlockRatio,...}}}

用法：
  python fetch_events.py --codes 002027,600019   # 抓指定 A 股（探针/调试）
  python fetch_events.py                          # 抓全部 A 股（默认跳过已抓，除非 --force）
  python fetch_events.py --recompute              # 不联网，仅从已存明细重算 delta 覆盖层
  python fetch_events.py --limit 3                # 只抓前 N 家（调试）
"""
import argparse
import datetime as dt
import io
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STOCK_ROOT = os.path.abspath(os.path.join(HERE, ".."))
REPO = os.path.abspath(os.path.join(STOCK_ROOT, ".."))
SKILL_DIR = os.path.join(REPO, ".agents", "skills", "wind-mcp-skill")
CLI = os.path.join("scripts", "cli.mjs")
EVENTS_DIR = os.path.join(STOCK_ROOT, "data", "events")
COMPANIES_DIR = os.path.join(STOCK_ROOT, "data", "companies")

sys.path.insert(0, HERE)
from config import DEFAULT_COMPANIES  # noqa: E402

MAX_ROWS = 20  # 每表最多保留行数（按日期倒序）
SLEEP = 1.8    # 调用间隔（秒）——Wind 连续调用易瞬时空返回，间隔需足够

# 事件类型 → (工具, 定向问句模板)
EVENT_QUERIES = [
    ("increase_hold", "get_stock_events", "查询{name}（{code}）的股东增减持记录，包括大股东和董事监事高管的增持、减持"),
    ("ma", "get_stock_events", "查询{name}（{code}）的并购重组事件"),
    ("penalty", "get_stock_events", "查询{name}（{code}）的违规处罚、监管处罚、被立案调查记录"),
    ("lawsuit", "get_stock_events", "查询{name}（{code}）的司法诉讼与仲裁案件"),
    ("st_change", "get_stock_events", "查询{name}（{code}）的风险警示、ST、*ST 戴帽与摘帽变动记录"),
]
HOLDER_QUERIES = [
    ("holders_a", "查询{name}（{code}）最新报告期的前十大股东、前十大流通股东、机构股东持股及持股变动"),
    ("holders_b", "查询{name}（{code}）的实际控制人和限售解禁时间表、未来解禁数量"),
]


def wind_code(code):
    """A 股代码 → Wind 代码：6/9→.SH，0/2/3→.SZ，4/8→.BJ。"""
    if code.startswith(("6", "9")):
        return code + ".SH"
    if code.startswith(("0", "2", "3")):
        return code + ".SZ"
    return code + ".BJ"


def _extract_json(s):
    """从可能混入告警/横幅的 stdout 中截取首个 '{' 到末个 '}' 的 JSON 子串。"""
    if not s:
        return None
    a = s.find("{")
    b = s.rfind("}")
    if a < 0 or b <= a:
        return None
    return s[a:b + 1]


def call_wind(tool, question, uniq, retry=2):
    """调 cli.mjs；容错 stdout 污染（update 横幅/告警）与瞬时后端错误（重试 retry 次）。"""
    last_err = None
    for attempt in range(retry + 1):
        try:
            return _call_wind_once(tool, question, uniq if attempt == 0 else uniq + "-r%d" % attempt)
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < retry:
                _sleep()
    raise last_err


def _call_wind_once(tool, question, uniq):
    pf = os.path.join("scripts", "request-%s.json" % uniq)
    pfull = os.path.join(SKILL_DIR, pf.replace("/", os.sep))
    with io.open(pfull, "w", encoding="utf-8") as f:
        f.write(json.dumps({"question": question}, ensure_ascii=False))
    try:
        r = subprocess.run(
            ["node", CLI, "call", "stock_data", tool, "@" + pf],
            cwd=SKILL_DIR, capture_output=True, text=True,
            encoding="utf-8", timeout=180,
        )
    finally:
        try:
            os.remove(pfull)
        except OSError:
            pass
    env = json.loads(_extract_json(r.stdout) or "null")
    if env is None:
        raise RuntimeError("no JSON in stdout; head=%r" % ((r.stdout or "")[:120]))
    if env.get("ok") is False:
        raise RuntimeError("wind envelope error: %s" % json.dumps(env, ensure_ascii=False)[:200])
    content = env.get("content")
    txt = (content or [{}])[0].get("text") if content else None
    if not txt:
        # 空 text / 缺 content 多为连续调用瞬时限流或后端吐空 → 抛错触发重试
        raise RuntimeError("empty content (likely throttled); envelope=%s" % json.dumps(env, ensure_ascii=False)[:160])
    try:
        payload = json.loads(txt) if isinstance(txt, str) else txt
    except ValueError:
        # text 非 JSON（多为“未检索到/纯提示文本”）→ 视为空结果，不中断整家抓取
        return {}
    return payload if isinstance(payload, dict) else {}


def _date_key(rec):
    for k, v in rec.items():
        if any(t in k for t in ("日期", "截止日", "变动日", "公告日")) and isinstance(v, str):
            m = re.search(r"\d{4}[-/]?\d{2}[-/]?\d{2}", v)
            if m:
                return m.group(0).replace("/", "-")
    return ""


def tables_records(payload):
    """payload → list[dict 记录]，取所有表合并；丢弃全 null 单元格；按日期倒序截断。"""
    data = payload.get("data") if isinstance(payload, dict) else None
    tables = (data or {}).get("data") if isinstance(data, dict) else None
    recs = []
    for t in tables or []:
        cols = [c.get("name") for c in (t.get("columns") or [])]
        for row in t.get("rows") or []:
            rec = {}
            for i, name in enumerate(cols):
                if name is None:
                    continue
                v = row[i] if i < len(row) else None
                if v is not None and v != "":
                    rec[name] = v
            if rec:
                recs.append(rec)
    # 有日期字段的按日期倒序（保留最近），无则保留原序尾部
    dated = [r for r in recs if _date_key(r)]
    if dated:
        recs.sort(key=_date_key, reverse=True)
    return recs[:MAX_ROWS]


def split_holder_tables(payload):
    """股东工具一次返回多表 → 按列名关键字归类到 top10/top10_float/institutions/holder_change/actual_controller/unlock。"""
    out = {"top10": [], "top10_float": [], "institutions": [],
           "holder_change": [], "actual_controller": [], "unlock": []}
    data = payload.get("data") if isinstance(payload, dict) else None
    tables = (data or {}).get("data") if isinstance(data, dict) else None
    # 归类顺序敏感：十大股东表常自带“持股数量变动”列，若先匹配“变动”会被误分到 holder_change，
    # 故“解禁/实控人/机构/流通/十大股东”等具名判据必须排在通用“变动/增减”之前。
    for t in tables or []:
        cols = [c.get("name") or "" for c in (t.get("columns") or [])]
        head = " ".join(cols)
        recs = tables_records({"data": {"data": [t]}})
        if not recs:
            continue
        if "解禁" in head:
            out["unlock"].extend(recs)
        elif "实际控制人" in head or "控股路径" in head:
            out["actual_controller"].extend(recs)
        elif "机构" in head:
            out["institutions"].extend(recs)
        elif "流通" in head:
            out["top10_float"].extend(recs)
        elif "十大股东" in head or "股东名称" in head:
            out["top10"].extend(recs)
        elif "变动" in head or "增减" in head:
            out["holder_change"].extend(recs)
        else:
            out["top10"].extend(recs)
    for k in out:
        out[k] = out[k][:MAX_ROWS]
    return out


def _holders_key_nonempty(tables):
    return any(tables.get(k) for k in ("top10", "institutions", "top10_float", "holder_change"))


def _fetch_holders_a(name, wc, uniq):
    """股东核心表（十大/流通/机构/变动）公司必有数据，空即视为限流/吐空 → 多次重试直到非空。"""
    q = HOLDER_QUERIES[0][1].format(name=name, code=wc)
    tables = {}
    for i in range(5):
        payload = call_wind("get_stock_equity_holders", q, "%s-holders_a-a%d" % (uniq, i))
        tables = split_holder_tables(payload)
        if _holders_key_nonempty(tables):
            return tables
        _sleep()
    return tables


def _merge_holders(dst, src):
    """合并股东分表：split_holder_tables 总返回全部键，只让非空桶覆盖，避免 holders_b 的空 top10 冲掉 holders_a 的数据。"""
    for k, v in src.items():
        if v:
            dst[k] = v
    return dst


def _pick_col(keys, *musts, **kw):
    """在列名中选首个含全部 musts 子串的列；exclude=元组则需全部不含。"""
    ex = kw.get("exclude") or ()
    for k in keys:
        if all(m in k for m in musts) and not any(e in k for e in ex):
            return k
    return None


def reconstruct_holder_rows(recs):
    """Wind 股东类表（institutions/top10/top10_float）偶发返回“最新期名次 i × 上期名次 j”
    交叉展开行：同一名次重复、“较上期变动”列是 i-j 错配差值（如 -3 亿股）。
    检测到名次重复时重建：每家最新期股东一行，上期值按同名称回接，
    变动重算为最新−上期；单名列在前、“合计”常量列在后（配合前端 pickVal
    精确优先）；幂等（重建后名次唯一，重跑直接返回）。"""
    if not recs:
        return recs
    # 聚合行形态：单行多机构名分号串接（Wind 汇总返回，无名次）→ 拆每家一行；
    # 比例/数量是全体合计不随拆分行下发，只保留“合计”列，避免被误读为单家持股
    if len(recs) == 1:
        r0 = recs[0]
        nk = _pick_col(r0.keys(), "股东名称", exclude=("合计", "名次", "实际"))
        nm = str(r0.get(nk) or "") if nk else ""
        if (";" in nm or "；" in nm):
            out = []
            for p in nm.replace("；", ";").split(";"):
                p = p.strip()
                if not p:
                    continue
                rec = {k: v for k, v in r0.items() if "合计" in k or "持股机构数" in k}
                rec[nk] = p
                out.append(rec)
            if out:
                return out
    ranks = [r.get("名次") for r in recs if "名次" in r]
    if not ranks or len(set(ranks)) == len(ranks):
        return recs
    cols = set()
    for r in recs[:5]:
        cols.update(r.keys())
    c_now_name = _pick_col(cols, "最新", "股东名称", exclude=("合计", "名次", "实际"))
    c_prev_name = _pick_col(cols, "股东名称", exclude=("最新", "合计", "名次", "实际"))
    if not (c_now_name and c_prev_name):
        return recs
    c_now_ratio = _pick_col(cols, "最新", "持股比例", exclude=("合计", "名次", "变动"))
    c_prev_ratio = _pick_col(cols, "持股比例", exclude=("最新", "合计", "名次", "变动"))
    c_now_qty = _pick_col(cols, "最新", "持股数量", exclude=("合计", "名次", "变动"))
    c_prev_qty = _pick_col(cols, "持股数量", exclude=("最新", "合计", "名次", "变动"))
    c_now_share = _pick_col(cols, "最新", "股本性质")
    # 变动列名沿用原表（机构持股数量变动/股东持股数量变动/流通股东持股数量变动），前端配置兼容
    c_chg_qty = _pick_col(cols, "数量变动")
    c_chg_ratio = _pick_col(cols, "比例变动")
    consts = {k: next((r.get(k) for r in recs if r.get(k) is not None), None)
              for k in cols if "合计" in k or "持股机构数" in k}
    # 最新期列表：按名次取首次出现（交叉行内最新列恒定，重复行等价）；上期映射按名称
    now_by_rank = {}
    prev_map = {}
    for r in recs:
        rk = r.get("名次")
        nm = r.get(c_now_name)
        if rk is not None and nm and rk not in now_by_rank:
            now_by_rank[rk] = r
        pn = r.get(c_prev_name)
        if pn and pn not in prev_map:
            prev_map[pn] = r
    out = []
    for rk in sorted(now_by_rank):
        r = now_by_rank[rk]
        nm = str(r.get(c_now_name))
        rec = {"名次": rk, c_now_name: r.get(c_now_name)}
        if c_now_ratio:
            rec[c_now_ratio] = r.get(c_now_ratio)
        if c_now_qty:
            rec[c_now_qty] = r.get(c_now_qty)
        if c_now_share:
            rec[c_now_share] = r.get(c_now_share)
        p = prev_map.get(nm)
        if p is not None:
            if c_chg_ratio and c_now_ratio and c_prev_ratio and p.get(c_prev_ratio) is not None:
                rec[c_chg_ratio] = round(_num(r.get(c_now_ratio)) - _num(p.get(c_prev_ratio)), 4)
            if c_chg_qty and c_now_qty and c_prev_qty and p.get(c_prev_qty) is not None:
                rec[c_chg_qty] = int(_num(r.get(c_now_qty)) - _num(p.get(c_prev_qty)))
        rec.update({k: v for k, v in consts.items() if v is not None})
        out.append(rec)
    return out


def fetch_one(code, name, wc, uniq_prefix):
    ev, hd = {}, {}
    n = 0
    # 先抓股东核心表（公司必有十大股东，放最前避开连续调用限流窗口），空结果多重试
    _merge_holders(hd, _fetch_holders_a(name, wc, uniq_prefix))
    # 实控人 + 解禁
    n += 1
    payload = call_wind("get_stock_equity_holders", HOLDER_QUERIES[1][1].format(name=name, code=wc),
                        "%s-holders_b-%d" % (uniq_prefix, n))
    _merge_holders(hd, split_holder_tables(payload))
    for key, tool, q in EVENT_QUERIES:
        n += 1
        payload = call_wind(tool, q.format(name=name, code=wc), "%s-%s-%d" % (uniq_prefix, key, n))
        recs = tables_records(payload)
        if key == "ma":
            recs = clean_ma_rows(recs, name, wc)
        ev[key] = recs
    for bk in ("institutions", "top10", "top10_float"):
        hd[bk] = reconstruct_holder_rows(hd.get(bk) or [])
    return {
        "code": code, "name": name, "windcode": wc,
        "fetched_at": dt.datetime.now().isoformat(timespec="seconds"),
        "events": ev, "holders": hd,
    }


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with io.open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def load_json(path):
    if not os.path.exists(path):
        return None
    with io.open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--codes", help="逗号分隔的 A 股代码，仅抓这些")
    ap.add_argument("--limit", type=int, default=0, help="只抓前 N 家（调试）")
    ap.add_argument("--force", action="store_true", help="覆盖已抓明细")
    ap.add_argument("--recompute", action="store_true", help="不联网，仅从明细重算覆盖层")
    args = ap.parse_args()

    a_list = [(c, n) for (c, n, m) in DEFAULT_COMPANIES if m == "A"]
    if args.codes:
        want = set(x.strip() for x in args.codes.split(","))
        a_list = [(c, n) for (c, n) in a_list if c in want]
    if args.limit:
        a_list = a_list[: args.limit]

    if args.recompute:
        recompute_index(a_list)
        return

    uniq = str(int(dt.datetime.now().timestamp()))
    ok, failed = 0, []
    for i, (code, name) in enumerate(a_list, 1):
        out = os.path.join(EVENTS_DIR, "%s.json" % code)
        if os.path.exists(out) and not args.force:
            print("[%d/%d] %s %s 已存在，跳过（--force 覆盖）" % (i, len(a_list), code, name))
            ok += 1
            continue
        wc = wind_code(code)
        print("[%d/%d] %s %s (%s) 抓取 ..." % (i, len(a_list), code, name, wc), flush=True)
        try:
            data = fetch_one(code, name, wc, uniq)
            write_json(out, data)
            evn = {k: len(v) for k, v in data["events"].items()}
            hdn = {k: len(v) for k, v in data["holders"].items() if v}
            print("      完成 events=%s holders=%s" % (evn, hdn), flush=True)
            ok += 1
        except Exception as e:
            failed.append(code)
            print("      失败: %s" % str(e)[:200], flush=True)
        _sleep()

    recompute_index(a_list)
    print("[done] 成功 %d 家，失败 %d 家 %s" % (ok, len(failed), failed or ""))


def _sleep():
    import time
    time.sleep(SLEEP)


def recompute_index(a_list):
    """从已存明细计算 fraudDelta/mgmtDelta 覆盖层（不联网）。"""
    by_code = {}
    for code, _name in a_list:
        data = load_json(os.path.join(EVENTS_DIR, "%s.json" % code))
        if not data:
            continue
        by_code[code] = compute_deltas(data)
    out = {
        "updated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "byCode": by_code,
    }
    write_json(os.path.join(EVENTS_DIR, "index.json"), out)
    print("[index] 覆盖层 %d 家 -> events/index.json" % len(by_code))


# ---- 评分增量（基础分不变，事件信号算成静态 delta，前端只做 clamp(基础分+delta)）----
_NUM_RE = re.compile(r"-?\d+(?:,\d{3})*(?:\.\d+)?")


def _num(v):
    """从任意值抽取 float（兼容千分位/单位/None），失败返回 0.0。"""
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    m = _NUM_RE.search(str(v))
    return float(m.group(0).replace(",", "")) if m else 0.0


def _txt(row):
    return " ".join(str(x) for x in row.values())


def _has(row, *kws):
    t = _txt(row)
    return any(k in t for k in kws)


def _clamp(x, lo, hi):
    return max(lo, min(hi, x))


def _is_party(row, short, field):
    """判断公司（简称 short）是否为该行某一方：用简称作子串在字段全名中匹配。"""
    val = str(row.get(field, ""))
    return bool(short) and (short in val or short[:3] in val)


def _ma_relevant(rec, short, wc):
    """并购行与本公司是否相关：任一“股票代码”列命中自身代码，
    或简称核心（去“股份”后缀）出现在标题/并购各方名称。
    Wind 对定向问句偶发路由塌缩，会把全市场无关并购事件整表灌入（如 603599）。"""
    code = (wc or "").split(".")[0]
    if code:
        for k, v in rec.items():
            if "股票代码" in k and code in str(v):
                return True
    core = (short or "").replace("股份", "")
    if not core:
        return False
    text = " ".join(str(v) for k, v in rec.items() if any(
        t in k for t in ("标题", "竞买方", "出让方", "标的方")))
    return core in text or core[:2] in text


def clean_ma_rows(recs, short, wc):
    """并购桶清洗：剔除无关行 + 同一事件按(事件ID,标的)合并出让/竞买方展开行。
    幂等：已清洗行重跑不会重复拼接。"""
    merged, order = {}, []
    for r in recs or []:
        if not _ma_relevant(r, short, wc):
            continue
        key = (r.get("并购事件ID") or r.get("并购事件标题") or "",
               r.get("并购事件标的方名称") or "")
        if key not in merged:
            merged[key] = dict(r)
            order.append(key)
            continue
        base = merged[key]
        for k, v in r.items():
            if not v:
                continue
            if "股票代码" in k:
                base.setdefault(k, v)           # 同事件其他方的代码列补位
            elif k.endswith("名称") and str(v) not in str(base.get(k, "")):
                base[k] = base.get(k, "") + "、" + str(v)  # 多出让/竞买方串接
    return [merged[k] for k in order]


def compute_deltas(data):
    """依据事件/股东明细算造假与管理的静态增量（列名/单位容错，缺表则该项计 0）。"""
    ev = data.get("events") or {}
    hd = data.get("holders") or {}
    short = data.get("name") or ""
    top10 = reconstruct_holder_rows(hd.get("top10") or [])
    flags = []

    # --- 违规处罚：条数 + 立案/重大处罚（仅扫值列，不扫列名），小计封顶 +15 ---
    pen = ev.get("penalty") or []
    penalty_count = len(pen)
    fraud = 0.0
    if penalty_count:
        pen_add = min(15.0, penalty_count * 6.0)
        pen_serious = False
        for r in pen:
            vals = " ".join(str(x) for x in r.values())
            if any(k in vals for k in ("立案", "行政处罚决定", "重大违法", "冻结", "留置", "移送", "遣送")):
                pen_serious = True
        if pen_serious:
            pen_add = min(15.0, pen_add + 6.0)
        fraud += pen_add
        flags.append("违规处罚 %d 条" % penalty_count)

    # --- 司法诉讼：区分公司作为被告(可疑) vs 原告(正常经营,计 0)；涉案金额单位万元 ---
    laws = ev.get("lawsuit") or []
    def_amt = 0.0
    def_cnt = 0
    for r in laws:
        amt = _num(r.get("诉讼仲裁涉案金额"))
        if _is_party(r, short, "诉讼仲裁被告方"):
            def_amt += amt
            def_cnt += 1
    if def_cnt:
        if def_amt >= 20000:      # >=2亿 重大被告诉讼
            fraud += 10
            flags.append("被告诉讼涉案 %.0f 万" % def_amt)
        elif def_amt >= 5000:
            fraud += 7
            flags.append("被告诉讼涉案 %.0f 万" % def_amt)
        elif def_amt >= 1000:
            fraud += 5
            flags.append("被告诉讼涉案 %.0f 万" % def_amt)

    # --- ST / 风险警示（当前或近期曾戴帽，未摘帽）---
    st_rows = ev.get("st_change") or []
    st = False
    for r in st_rows:
        t = _txt(r)
        if ("ST" in t or "风险警示" in t or "戴帽" in t) and not any(
                k in t for k in ("摘帽", "撤销", "取消", "已解除", "恢复")):
            st = True
    if st:
        fraud += 15
        flags.append("ST/风险警示")

    # --- 大股东/董监高 减持 vs 增持：只读“方向”列的值（无方向列的表为十大专员变动误路由，不计）---
    inc = ev.get("increase_hold") or []
    reduce_flag = False
    increase_flag = False
    for r in inc:
        dirv = None
        for k, v in r.items():
            if "方向" in k:
                dirv = str(v)
                break
        if not dirv:
            continue
        if "减持" in dirv or "卖出" in dirv:
            reduce_flag = True
        elif "增持" in dirv or "买入" in dirv:
            increase_flag = True
    if reduce_flag:
        fraud += 5
        flags.append("大股东/董监高减持")

    # --- 高商誉/跨界并购重组（被标注重组）；先过相关性/去重，防 Wind 路由塌缩混入全市场事件 ---
    ma = clean_ma_rows(ev.get("ma"), short, data.get("windcode") or "")
    if any(_has(r, "重组") for r in ma):
        fraud += 5
        flags.append("并购重组 %d 起" % len(ma))

    fraud = _clamp(fraud, 0.0, 30.0)

    # ================= 管理增量 mgmt（越高越好）=================
    mgmt = 0.0
    inst = reconstruct_holder_rows(hd.get("institutions") or [])  # 存量未透视的行幂等重建
    has_shebao = any("社保" in _txt(r) or "养老" in _txt(r) for r in inst)
    # 机构持股比例合计环比上升：用行内常量“合计”列（最新 vs 上期/上一季），
    # 不用“机构持股比例变动”列——交叉展开行里那是名次错配差值，任一正数即误判
    inst_ratio_up = False
    inst_hold = None
    for r in inst:
        now_t = prev_t = None
        for k, v in r.items():
            if "机构持股比例合计" not in k:
                continue
            if k.startswith("最新"):
                now_t = _num(v)
            elif "上一期" in k or "上一季" in k:
                prev_t = _num(v)
        if now_t:
            inst_hold = now_t
        if now_t and prev_t and now_t > prev_t:
            inst_ratio_up = True
    if increase_flag:
        mgmt += 8
        flags.append("重要股东增持")
    if has_shebao:
        mgmt += 8
        flags.append("社保/养老持股")
    elif inst_ratio_up:
        mgmt += 5
        flags.append("机构增持")
    if reduce_flag:
        mgmt -= 10
    if penalty_count:
        mgmt -= 10
    if st:
        mgmt -= 15
    if def_amt >= 20000:
        mgmt -= 8

    # --- 未来解禁占流通股 >20%：潜在抛压 ---
    unlock = hd.get("unlock") or []
    unlock_ratio = None
    for r in unlock:
        for k, v in r.items():
            if "比例" in k and "解禁" in _txt(r):
                p = _num(v)
                if p and (unlock_ratio is None or p > unlock_ratio):
                    unlock_ratio = p
    if unlock_ratio is not None and unlock_ratio >= 20:
        mgmt -= 5
        flags.append("未来解禁占比 %.1f%%" % unlock_ratio)
    mgmt = _clamp(mgmt, -30.0, 15.0)

    # --- 前十大股东摘要（供前端展示；行已透视，按名次取最新期字段，列名容错）---
    names = []
    for r in sorted(top10, key=lambda x: _num(x.get("名次")))[:10]:
        nm = rt = None
        for k, v in r.items():
            if "股东名称" in k and "最新" in k and "名次" not in k and nm is None:
                nm = v
            elif "持股比例" in k and "最新" in k and "合计" not in k and rt is None:
                rt = v
        if not nm:
            continue
        names.append("%s %s%%" % (nm, rt) if rt else str(nm))
    top_summary = "；".join(names)

    return {
        "fraudDelta": round(fraud, 1), "mgmtDelta": round(mgmt, 1),
        "flags": flags, "st": st, "penaltyCount": penalty_count,
        "defendantLawsuit": round(def_amt, 1), "reduceFlag": reduce_flag,
        "unlockRatio": unlock_ratio, "instHold": inst_hold,
        "topHoldersSummary": top_summary,
    }


if __name__ == "__main__":
    sys.exit(main())
