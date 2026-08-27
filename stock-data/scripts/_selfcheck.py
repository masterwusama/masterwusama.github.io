# -*- coding: utf-8 -*-
"""价值分析功能自检：数据完整性 / index 交叉一致性 / 价格参考内部关系 / 重算同步 / TTM 抽查"""
import io
import json
import math
import re
import sys
from datetime import datetime
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path(__file__).parent))
from config import DEFAULT_COMPANIES  # noqa: E402
from scoring import compute_scores, _ttm_net_profit, _eps_ttm_field  # noqa: E402

BASE = Path(__file__).parent.parent
DATA = BASE / 'data'
fails = []
warns = []


def check(cond, msg):
    if not cond:
        fails.append(msg)


# ---------- 1) 数据完整性 ----------
companies = {}
for f in sorted((DATA / 'companies').glob('*.json')):
    d = json.loads(f.read_text(encoding='utf-8'))
    code = d.get('code') or f.stem
    companies[code] = d
    if d.get('errors'):
        fails.append(f'{code} errors={d["errors"]}')
    mkt = next((c[2] for c in DEFAULT_COMPANIES if c[0] == code), 'A')
    # 期数下限：A股三大报表及指标均≥10；港股东财源指标仅≈9期；美股无公告列表
    for k, mn in (('indicators', 6 if mkt != 'A' else 10),
                  ('income', 8 if mkt != 'A' else 10),
                  ('balance', 8 if mkt != 'A' else 10),
                  ('cashflow', 8 if mkt != 'A' else 10)):
        n = len(d.get(k) or [])
        check(n >= mn, f'{code} {k} 仅 {n} 期 (<{mn})')
    if mkt == 'A':
        check(len(d.get('reports') or []) >= 5, f'{code} reports 仅 {len(d.get("reports") or [])} 条')
    snap = d.get('snapshot') or {}
    check(float(snap.get('price') or 0) > 0, f'{code} snapshot.price 异常: {snap.get("price")}')

idx = json.loads(io.open(DATA / 'index.json', encoding='utf-8').read())
cfg = {c[0]: c for c in DEFAULT_COMPANIES}
check(idx.get('count') == len(idx.get('companies') or []) == len(cfg),
      f'count 不一致: idx.count={idx.get("count")} len={len(idx.get("companies") or [])} config={len(cfg)}')
codes_idx = {c['code'] for c in idx['companies']}
check(codes_idx == set(cfg), f'名单不匹配: 仅index={sorted(codes_idx - set(cfg))} 仅config={sorted(set(cfg) - codes_idx)}')
for c in idx['companies']:
    d = companies[c['code']]
    # 名字/市场与 config 一致
    cc = cfg[c['code']]
    check(c.get('name') == d.get('name') == cc[1], f'{c["code"]} 名称不一致: idx={c.get("name")} file={d.get("name")} cfg={cc[1]}')
    # 分数范围
    s = c.get('scores') or {}
    for k in ('grahamAgg', 'grahamDef', 'schloss', 'buffett'):
        v = s.get(k)
        check(v is None or 0 <= v <= 100 + 1e-9, f'{c["code"]} {k} 超范围: {v}')

# ---------- 2) priceRefs 内部一致性 ----------
n_fairliq = 0
n_netcash = 0
for c in idx['companies']:
    pr = (c.get('scores') or {}).get('priceRefs') or {}
    fa = pr.get('fairLiq')

    def close(a, b, tol=1e-6):
        return a is not None and b is not None and abs(a - b) <= max(tol, abs(b) * tol)

    if fa is not None:
        n_fairliq += 1
        ga = pr.get('grahamAgg') or {}
        check(close(fa, ga.get('sellCons')), f'{c["code"]} fairLiq({fa}) != grahamAgg.sellCons({ga.get("sellCons")})')
        check(close(ga.get('sellFair'), 1.5 * fa), f'{c["code"]} grahamAgg.sellFair != 1.5×fairLiq')
    # 净现金/市值：字段存在且是有限数（重负债基建可为深度负值，不设量级硬边界）
    ncr = pr.get('netCashRatio')
    check(ncr is None or (isinstance(ncr, (int, float)) and math.isfinite(ncr)),
          f'{c["code"]} netCashRatio 异常: {ncr}')
    if ncr is not None:
        n_netcash += 1
        calc = pr.get('netCashCalc')
        check(isinstance(calc, dict), f'{c["code"]} netCashRatio 有值但缺 netCashCalc 明细')
        if isinstance(calc, dict):
            m0, tl0, ca0 = calc.get('mcap'), calc.get('tl'), calc.get('cash')
            check(isinstance(m0, (int, float)) and m0 > 0, f'{c["code"]} netCashCalc.mcap 异常: {m0}')
            check(tl0 is not None and ca0 is not None, f'{c["code"]} netCashCalc 缺 货币资金/负债合计')
            for kk in ('fin', 'notes', 'otherCA'):
                vv = calc.get(kk)
                check(vv is None or (isinstance(vv, (int, float)) and math.isfinite(vv)),
                      f'{c["code"]} netCashCalc.{kk} 非法: {vv}')
            rep = calc.get('report')
            check(rep is None or re.match(r'^\d{4}-\d{2}-\d{2}$', rep), f'{c["code"]} netCashCalc.report 格式异常: {rep}')
            # 明细反算与存储比率一致（加权系数与 scoring.py 保持同步）
            wsum = sum((calc.get(kk) or 0) * w for kk, w in (('cash', 1.0), ('fin', 0.7), ('notes', 0.4), ('otherCA', 0.3)))
            recalc = (wsum - tl0) / m0
            check(abs(recalc - ncr) <= max(1e-9, abs(ncr) * 1e-9),
                  f'{c["code"]} netCashCalc 反算({recalc}) != netCashRatio({ncr})')
    sc, bu, gd = pr.get('schloss') or {}, pr.get('buffett') or {}, pr.get('grahamDef') or {}
    for tag, r in (('schloss', sc),):
        buy, cons, fair = r.get('buy'), r.get('sellCons'), r.get('sellFair')
        if cons is not None:
            check(close(fair, 1.5 * cons), f'{c["code"]} {tag}.sellFair({fair}) != 1.5×sellCons({cons})')
            if buy is not None:
                check(buy <= cons + max(1e-6, cons * 1e-6),
                      f'{c["code"]} {tag}.buy({buy}) > sellCons({cons})（clamp失效）')
    # buffett：buy=2/3·公平PE·eps，sellCons=公平PE·eps，sellFair=1.3倍
    bb_c, bb_f, bb_b = bu.get('sellCons'), bu.get('sellFair'), bu.get('buy')
    if bb_c is not None:
        check(close(bb_f, 1.3 * bb_c), f'{c["code"]} buffett.sellFair({bb_f}) != 1.3×sellCons({bb_c})')
        check(close(bb_b, 2.0 / 3.0 * bb_c), f'{c["code"]} buffett.buy({bb_b}) != 2/3×sellCons({bb_c})')
    gdc, gdf = gd.get('sellCons'), gd.get('sellFair')
    check(close(gdf, 4.0 / 3.0 * gdc) if gdc is not None else True,
          f'{c["code"]} grahamDef.sellFair({gdf}) != 4/3×sellCons({gdc})')

# ---------- 3) 重算一致性（index 与最新算法同步） ----------
mismatch = []
for c in idx['companies']:
    py = compute_scores(companies[c['code']])
    stored = c.get('scores') or {}

    def cmp_val(path, a, b):
        if a is None and b is None:
            return
        # 数值用相对容差；其余类型（如 netCashCalc.report 日期串）严格相等
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            ok = abs(a - b) <= max(1e-9, abs(b) * 1e-9)
        else:
            ok = a == b
        if not ok:
            mismatch.append(f'{c["code"]}.{path}: stored={b} recompute={a}')

    for k in ('grahamAgg', 'grahamDef', 'schloss', 'buffett'):
        cmp_val(k, py.get(k), stored.get(k))
    pstored = stored.get('priceRefs') or {}
    for k, sub in (py.get('priceRefs') or {}).items():
        if isinstance(sub, dict):
            for fld, v in sub.items():
                cmp_val(f'priceRefs.{k}.{fld}', v, (pstored.get(k) or {}).get(fld))
        else:
            cmp_val(f'priceRefs.{k}', sub, pstored.get(k))
fails.extend(mismatch)

# ---------- 4) 数据链抽查（华域/海螺/三角/鲁泰/中创）：报告期最新性、epsTTM、年报净利序列 ----------
print('== 数据链抽查 ==')
for code in ('600741', '600585', '601163', '000726', '601717'):
    d = companies.get(code)
    if not d:
        continue
    ind = d.get('indicators') or []
    inc = sorted(d.get('income') or [], key=lambda r: str(r.get('报告日') or ''))
    bal = sorted(d.get('balance') or [], key=lambda r: str(r.get('报告日') or ''))
    ind_latest = max((str(r.get('报告期') or '')[:10] for r in ind if r.get('报告期')), default='-')
    inc_latest = str(bal and (inc[-1].get('报告日') or '-'))[:10] if inc else '-'
    bal_latest = str(bal[-1].get('报告日') or '-')[:10] if bal else '-'
    eps_ttm = _eps_ttm_field(ind)
    profits = [round((r.get('净利润') or 0) / 1e8, 2) for r in inc
               if '12-31' in str(r.get('报告日') or '')][-4:]
    snap = d.get('snapshot') or {}
    print(f'  {code} {d.get("name")}')
    print(f'      indicators 最新 {ind_latest} | income 最新 {inc_latest} | balance 最新 {bal_latest}')
    print(f'      近4年报净利(亿): {profits} | epsTTM: {eps_ttm} | 快照: 价 {snap.get("price")} / PE {snap.get("pe_ttm", snap.get("pe"))} / 市值(亿) {snap.get("market_cap")}')
    # 一致性：indicators 与报表同期推进（间隔不超过 2 个季度）
    try:
        di = datetime.strptime(ind_latest, '%Y-%m-%d')
        dn = datetime.strptime(inc_latest, '%Y-%m-%d')
        check(abs((di - dn).days) <= 100, f'{code} indicators({ind_latest}) 与 income({inc_latest}) 报告期严重脱节')
    except ValueError:
        fails.append(f'{code} 报告期格式异常: {ind_latest}/{inc_latest}')

print()
print(f'== 汇总 == 公司数 {len(companies)} | fairLiq 有值 {n_fairliq} 家 | 净现金/市值有值 {n_netcash} 家 | 失败 {len(fails)} 项')
for x in fails[:30]:
    print('  FAIL:', x)
sys.exit(1 if fails else 0)
