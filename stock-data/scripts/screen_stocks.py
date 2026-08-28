# -*- coding: utf-8 -*-
"""选股筛选器：全市场扫描满足「管理能力 / 造假风险 / 流派买点」条件的未跟踪股票。

复用 fetch_data 的取数路径与 scoring 的评分算法（跳过 reports/audit——两者不参与
compute_scores，精算结果与全量抓取一致），结果缓存到本地，重跑同一股票不重新抓取。

用法示例：
    # 施洛斯买点，管理≥70 / 造假≤30，输出前 10 只
    python scripts/screen_stocks.py --school schloss --mgmt-min 70 --fraud-max 30 --top 10

    # 三个流派任一买点命中即可
    python scripts/screen_stocks.py --school schloss,grahamDef,buffett --top 10

    # 只用缓存出报告（不联网扫新股票，行情价格沿用缓存时刻）
    python scripts/screen_stocks.py --no-spot --top 20

    # 从旧版临时脚本日志回灌缓存（一次性迁移用）
    python scripts/screen_stocks.py --ingest scripts/_tmp_screen_out.txt

说明：
- 预筛条件：非 ST/退/次新，PB ∈ [--pb-min, --pb-max]，动态 PE>0，市值≥--mcap-min，
  排除已跟踪（data/index.json）；施洛斯买点上限为每股净资产（clamp_buy 截断），
  故现价触及施洛斯买点必然 PB≤1，--pb-max 超过 1.3 意义不大。
- 精算受 --max-attempts 限制，单次运行时长约 attempts×9 秒；扫不完的池子下次继续
  （已精算的股票走缓存，不重复抓取）。
- 本脚本只做筛选与报告（打印 + JSON 输出），不修改 data/ 与 config.py；
  确认名单后手动加入 scripts/config.py 再全量抓取。
"""
import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

BASE = Path(__file__).parent.parent
sys.path.insert(0, str(Path(__file__).parent))
import akshare as ak  # noqa: E402
import fetch_data as fd  # noqa: E402
from scoring import compute_scores  # noqa: E402

CN_TZ = timezone(timedelta(hours=8))
SCHOOLS = ('schloss', 'grahamDef', 'grahamAgg', 'buffett')


def now_iso():
    return datetime.now(CN_TZ).strftime('%Y-%m-%dT%H:%M:%S+08:00')


def load_json(path, default):
    if Path(path).exists():
        return json.loads(Path(path).read_text(encoding='utf-8'))
    return default


def tracked_codes():
    idx = load_json(BASE / 'data' / 'index.json', {})
    return {c['code'] for c in idx.get('companies') or []}


# ---------------- 行情预筛（交易所名单 + 腾讯批量行情） ----------------

def fetch_spot_all():
    """全市场快照：交易所官网名单（上交所主板/科创板 + 深交所 A 股，北交所跳过）
    拿代码+名称，腾讯行情分批拿 现价/PE/PB/总市值。"""
    parts_src = []
    for label, fn in (
        ('sh-main', lambda: ak.stock_info_sh_name_code(symbol='主板A股')),
        ('sh-star', lambda: ak.stock_info_sh_name_code(symbol='科创板')),
        ('sz-a', lambda: ak.stock_info_sz_name_code(symbol='A股列表')),
    ):
        try:
            df = fn()
            code_col = next(c for c in df.columns if '代码' in str(c))
            name_col = next(c for c in df.columns if '简称' in str(c) or '名称' in str(c))
            pairs = list(zip(df[code_col].astype(str), df[name_col].astype(str)))
            parts_src.append(pairs)
            print('  %s rows=%d' % (label, len(pairs)), flush=True)
        except Exception as e:
            print('  %s ERR %r (continue)' % (label, e), flush=True)
    codes = [p for sub in parts_src for p in sub]
    print('code list rows=%d' % len(codes), flush=True)

    rows = []
    batches = [codes[i:i + 60] for i in range(0, len(codes), 60)]
    for bi, batch in enumerate(batches, 1):
        q = ','.join(fd.sina_symbol(c) for c, _ in batch)
        for attempt in range(3):
            try:
                r = requests.get('http://qt.gtimg.cn/q=' + q, timeout=15)
                r.encoding = 'gbk'
                items = r.text.strip().split(';')
                if len(items) >= len(batch) // 2:
                    break
            except Exception:
                time.sleep(2)
        else:
            raise RuntimeError('tencent batch %d failed' % bi)
        for item in items:
            parts = item.strip().split('~')
            if len(parts) < 50:
                continue

            def num(i):
                try:
                    return float(parts[i])
                except (ValueError, IndexError):
                    return None

            rows.append({'code': parts[2], 'name': parts[1],
                         'price': num(3), 'pe': num(39), 'pb': num(46),
                         'mcap': None if num(45) is None else num(45) * 1e8})
        if bi % 20 == 0:
            print('  tencent batch %d/%d' % (bi, len(batches)), flush=True)
        time.sleep(0.3)
    print('spot rows=%d' % len(rows), flush=True)
    return rows


# ---------------- 单只精算（与 fetch_company_a 同路径，跳过 reports/audit） ----------------

def screen_one(code, name):
    r = {'code': code, 'name': name, 'updated_at': now_iso()}
    try:
        r['info'] = fd.fetch_info(code)
    except Exception:
        r['info'] = {}
    fd.sleep_between()
    for key, fn in (
        ('indicators', lambda: fd.fetch_indicators(code)),
        ('income', lambda: fd.fetch_report(code, '利润表')),
        ('balance', lambda: fd.fetch_report(code, '资产负债表')),
        ('cashflow', lambda: fd.fetch_report(code, '现金流量表')),
        ('snapshot', lambda: fd.fetch_snapshot(code)),
        ('dividends', lambda: fd.fetch_dividends(code)),
    ):
        try:
            r[key] = fn()
        except Exception:
            r[key] = []
        fd.sleep_between()
    return r


def refine_to_cache(code, name):
    """精算一只并转成缓存条目；数据不足（次新等）返回 None"""
    data = screen_one(code, name)
    ind = data.get('indicators') or []
    if len(ind) < 25:
        return None
    sc = compute_scores(data)
    refs = sc.get('priceRefs') or {}
    snap = data.get('snapshot') or {}
    entry = {
        'name': name,
        'pb': snap.get('pb'), 'pe': snap.get('pe_ttm'),
        'mcap': snap.get('market_cap'), 'price': snap.get('price'),
        'buys': {k: (refs.get(k) or {}).get('buy') for k in SCHOOLS},
        'scores': {k: sc.get(k) for k in SCHOOLS},
        'mgmt': sc.get('mgmt'), 'fraud': sc.get('fraud'),
        'updated_at': now_iso(),
    }
    return entry if entry['price'] else None


# ---------------- 旧临时日志回灌（一次性迁移） ----------------

def ingest_log(logfile, cache):
    """解析旧版 _tmp_screen.py 输出：'N miss CODE NAME PB=x mgmt=a [fraud=b] price=p buy=q'
    未打印 mgmt 视为 ≥80（旧阈值为 80），未打印 fraud 视为 ≤30；字段存上/下界标记。"""
    pat = re.compile(r'^\d+ (?:miss|HIT) (\d{6}) (\S+) PB=([\d.]+)'
                     r'(?: mgmt=([\d.]+))?(?: fraud=([\d.]+))?'
                     r'(?: price=([\d.]+) buy=([\d.]+))?')
    stocks = cache.setdefault('stocks', {})
    n = 0
    for line in Path(logfile).read_text(encoding='utf-8', errors='replace').splitlines():
        m = pat.match(line.strip())
        if not m:
            continue
        code, name, pb = m.group(1), m.group(2), float(m.group(3))
        mgmt, fraud = m.group(4), m.group(5)
        price, buy = m.group(6), m.group(7)
        ent = stocks.setdefault(code, {'name': name, 'pb': pb, 'pe': None, 'mcap': None,
                                       'price': float(price) if price else None,
                                       'buys': {'schloss': float(buy) if buy else None},
                                       'scores': {}, 'updated_at': 'ingested'})
        if mgmt:
            ent['mgmt'] = float(mgmt)
        else:
            ent['mgmt_ge'] = 80.0  # 旧阈值 80 下未打印 = 达标，仅存下界
        if fraud:
            ent['fraud'] = float(fraud)
        else:
            ent['fraud_le'] = 30.0  # 未打印 = 当时达标，仅存上界
        if buy:
            ent.setdefault('buys', {})['schloss'] = float(buy)
        n += 1
    print('ingested %d entries' % n)
    return cache


# ---------------- 报告 ----------------

def eff(v, bound, default=None):
    """缓存兼容：mgmt_ge=80 取下界，fraud_le=30 取上界"""
    if v is None:
        return bound
    return v


def passes(ent, args):
    mgmt = eff(ent.get('mgmt'), ent.get('mgmt_ge'))
    fraud = eff(ent.get('fraud'), ent.get('fraud_le'))
    price = ent.get('price')
    if mgmt is None or mgmt < args.mgmt_min:
        return None
    if fraud is None or fraud > args.fraud_max:
        return None
    if price is None or price <= 0:
        return None
    hits = []
    for s in args.school:
        b = (ent.get('buys') or {}).get(s)
        if b is None or price > b:
            continue
        hits.append((s, b))
    if not hits:
        return None
    best = max(hits, key=lambda t: t[1] / price)
    return {'mgmt': mgmt, 'fraud': fraud, 'hits': hits,
            'discount': best[1] / price - 1.0}


def main():
    ap = argparse.ArgumentParser(description='全市场选股：管理/造假/流派买点筛选')
    ap.add_argument('--school', default='schloss',
                    help='买点流派，逗号分隔：%s' % ','.join(SCHOOLS))
    ap.add_argument('--mgmt-min', type=float, default=70.0)
    ap.add_argument('--fraud-max', type=float, default=30.0)
    ap.add_argument('--top', type=int, default=10)
    ap.add_argument('--pb-min', type=float, default=0.01)
    ap.add_argument('--pb-max', type=float, default=1.05)
    ap.add_argument('--mcap-min', type=float, default=3e9)
    ap.add_argument('--max-attempts', type=int, default=150)
    ap.add_argument('--cache', default=str(BASE / 'scripts' / '_screen_cache.json'))
    ap.add_argument('--out', default=str(BASE / 'scripts' / '_screen_result.json'))
    ap.add_argument('--no-spot', action='store_true', help='不扫新股票，仅用缓存出报告')
    ap.add_argument('--ingest', help='从旧临时脚本日志回灌缓存后退出')
    args = ap.parse_args()
    args.school = [s.strip() for s in args.school.split(',') if s.strip() in SCHOOLS]
    if not args.school:
        sys.exit('school 为空')

    cache = load_json(args.cache, {'version': 1, 'stocks': {}})
    if args.ingest:
        ingest_log(args.ingest, cache)
        Path(args.cache).write_text(
            json.dumps(cache, ensure_ascii=False, indent=1), encoding='utf-8')
        print('cache saved -> %s' % args.cache)
        return

    stocks = cache.setdefault('stocks', {})
    if not args.no_spot:
        tracked = tracked_codes()
        rows = fetch_spot_all()
        cand = [x for x in rows if x['name'] and 'ST' not in x['name'] and '退' not in x['name']
                and x['code'] not in tracked and not x['name'].startswith('N')
                and x['pb'] and args.pb_min < x['pb'] <= args.pb_max
                and x['price'] and x['price'] > 0
                and x['pe'] and x['pe'] > 0
                and x['mcap'] and x['mcap'] >= args.mcap_min]
        cand.sort(key=lambda x: x['pb'])
        todo = [x for x in cand if x['code'] not in stocks]
        pbs = [x['pb'] for x in cand]
        print('universe PB %.2f~%.2f: %d (cached %d, to scan %d)' % (
            min(pbs), max(pbs), len(cand),
            len(cand) - len(todo), min(len(todo), args.max_attempts)), flush=True)
        done = 0
        for row in todo:
            if done >= args.max_attempts:
                break
            done += 1
            code, name = str(row['code']), str(row['name'])
            try:
                ent = refine_to_cache(code, name)
            except Exception as e:
                print('%d SKIP %s %s %r' % (done, code, name, e), flush=True)
                continue
            if ent is None:
                # 次新/数据不足：写入占位条目避免下次重扫（passes 会因 price 缺失自然淘汰）
                stocks[code] = {'name': name, 'pb': row['pb'], 'pe': row['pe'],
                                'mcap': row['mcap'], 'price': None, 'buys': {},
                                'scores': {}, 'thin': True, 'updated_at': now_iso()}
                Path(args.cache).write_text(
                    json.dumps(cache, ensure_ascii=False, indent=1), encoding='utf-8')
                print('%d thin %s %s (history<25 期)' % (done, code, name), flush=True)
                continue
            ent['pb'] = ent['pb'] or row['pb']
            stocks[code] = ent
            Path(args.cache).write_text(
                json.dumps(cache, ensure_ascii=False, indent=1), encoding='utf-8')
            b = (ent['buys'] or {}).get(args.school[0])
            print('%d scan %s %s PB=%.2f price=%s mgmt=%s fraud=%s buy=%s' % (
                done, code, name, ent['pb'], ent['price'],
                ent['mgmt'], ent['fraud'], None if b is None else round(b, 2)), flush=True)

    rows = []
    for code, ent in stocks.items():
        r = passes(ent, args)
        if r:
            rows.append(dict(code=code, name=ent.get('name'), pb=ent.get('pb'),
                             price=ent.get('price'), mgmt=r['mgmt'], fraud=r['fraud'],
                             discount=r['discount'], hits=r['hits'],
                             scores=ent.get('scores'), updated_at=ent.get('updated_at')))
    rows.sort(key=lambda x: -x['discount'])
    top = rows[:args.top]
    print('\n==== matches=%d, top %d ====' % (len(rows), len(top)))
    for i, r in enumerate(top, 1):
        hs = ' ; '.join('%s buy=%.2f(%.0f%%)' % (s, b, r['discount'] * 100 + 100)
                        for s, b in r['hits'])
        print('%2d. %s %s PB=%.2f price=%.2f mgmt=%s fraud=%s | %s' % (
            i, r['code'], r['name'], r['pb'] or 0, r['price'],
            r['mgmt'], r['fraud'], hs))
    Path(args.out).write_text(
        json.dumps({'generated_at': now_iso(), 'args': vars(args), 'matches': top},
                   ensure_ascii=False, indent=1), encoding='utf-8')
    print('result -> %s' % args.out)


if __name__ == '__main__':
    main()
