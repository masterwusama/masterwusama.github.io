# -*- coding: utf-8 -*-
"""本地自动化抓取筛选器：把网页列表的筛选条件做成命令行参数。

筛选语义与网页筛选面板（assets/stock.js passFilter）逐一对齐：
- 造假风险 ≤ N          --fraud-max
- 管理能力 ≥ N          --mgmt-min
- 买点（多选需同时满足）  --buy 格进取,格防御,施洛斯,巴菲特（逗号分隔，可中英文）
- 打折促销 %            --discount（仅配合 --buy，现价 ≤ 买价×N%，默认 100）
- 卖点（多选需同时满足）  --sell（现价须同时 ≥ 保守卖价与公允卖价，任一缺失即排除）
- 搜索框                --keyword（名称/代码模糊）
- 市场 Tab             --market A,HK,US
额外增强（网页没有）：--cycle-max 周期位置上限、market 源的 PB/市值预筛。

两种数据源：
    --source tracked  只筛已跟踪列表（读 data/index.json，与网页所见完全一致），
                      加 --refresh 先跑 fetch_data.py 全量更新再筛
    --source market   全市场扫描（沪深两市 PB/市值预筛 + 逐只精算），结果沉淀到
                      选股缓存（与 screen_stocks.py 共用 _screen_cache.json，可断点续跑）；
                      加 --cache-only 不联网扫新股票、仅用缓存出报告

示例：
    # 与网页同款：造假≤30 管理≥55 施洛斯买点
    python scripts/auto_screen.py --fraud-max 30 --mgmt-min 55 --buy schloss

    # 买点再打 8 折（现价 ≤ 买价×80%）才算命中
    python scripts/auto_screen.py --buy 施洛斯 --discount 80

    # 全市场扫巴菲特买点，输出前 20 名并存 JSON
    python scripts/auto_screen.py --source market --buy buffett --top 20
"""
import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

BASE = Path(__file__).parent.parent
sys.path.insert(0, str(Path(__file__).parent))

SCHOOLS = ('grahamAgg', 'grahamDef', 'schloss', 'buffett')
SCHOOL_CN = {'grahamAgg': '格进取', 'grahamDef': '格防御', 'schloss': '施洛斯', 'buffett': '巴菲特'}
# 参数别名：英文名 / 缩写 / 中文名均可
SCHOOL_ALIAS = {}
for _k, _cn in SCHOOL_CN.items():
    SCHOOL_ALIAS[_k.lower()] = _k
    SCHOOL_ALIAS[_cn] = _k
SCHOOL_ALIAS.update({'gagg': 'grahamAgg', 'gdef': 'grahamDef', 'agg': 'grahamAgg',
                     'def': 'grahamDef', 'schl': 'schloss', 'buf': 'buffett'})

MARKETS = ('A', 'HK', 'US')
MARKET_ALIAS = {'a': 'A', 'ash': 'A', 'a股': 'A', 'hk': 'HK', 'h': 'HK', '港股': 'HK',
                'us': 'US', '美股': 'US'}


def now_iso():
    return datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%dT%H:%M:%S+08:00')


def parse_schools(text, what):
    out = []
    for tok in str(text).replace('，', ',').split(','):
        tok = tok.strip()
        if not tok:
            continue
        k = SCHOOL_ALIAS.get(tok.lower())
        if not k:
            sys.exit('%s 无法识别流派 %r（可用：%s）' % (what, tok, ', '.join(SCHOOLS)))
        if k not in out:
            out.append(k)
    return out


def clamp_int(v, maxv, what):
    if v is None:
        return None
    n = int(v)
    if n < 0 or n > maxv:
        print('%s=%d 越界，钳制到 0~%d' % (what, n, maxv), file=sys.stderr)
    return max(0, min(maxv, n))


# ---------------- 数据源 1：已跟踪列表（与网页同源） ----------------

def load_tracked(refresh):
    if refresh:
        print('== 先全量更新跟踪数据（fetch_data.py，耗时较长）==', flush=True)
        subprocess.run([sys.executable, str(Path(__file__).parent / 'fetch_data.py')], check=True)
    idx = json.loads((BASE / 'data' / 'index.json').read_text(encoding='utf-8'))
    rows = []
    for c in idx.get('companies') or []:
        sc = c.get('scores') or {}
        refs = sc.get('priceRefs') or {}
        rows.append({
            'code': c.get('code'), 'name': c.get('name'), 'market': c.get('market') or 'A',
            'industry': c.get('industry'), 'price': c.get('price'),
            'pb': None, 'mcap': None,
            'fraud': sc.get('fraud'), 'mgmt': sc.get('mgmt'), 'cycle': sc.get('cycle'),
            'scores': {k: sc.get(k) for k in SCHOOLS},
            'refs': {k: {'buy': (refs.get(k) or {}).get('buy'),
                         'cons': (refs.get(k) or {}).get('sellCons'),
                         'fair': (refs.get(k) or {}).get('sellFair')} for k in SCHOOLS},
            'src': 'tracked',
        })
    return rows, idx.get('updated_at')


# ---------------- 数据源 2：全市场扫描（复用 screen_stocks 取数与缓存） ----------------

def refine_entry(code, name):
    """精算一只并转成缓存条目（在 screen_stocks 基础上补 sells/cycle 字段）"""
    import screen_stocks as ss
    from scoring import compute_scores
    data = ss.screen_one(code, name)
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
        'sells': {k: {'cons': (refs.get(k) or {}).get('sellCons'),
                      'fair': (refs.get(k) or {}).get('sellFair')} for k in SCHOOLS},
        'scores': {k: sc.get(k) for k in SCHOOLS},
        'mgmt': sc.get('mgmt'), 'fraud': sc.get('fraud'), 'cycle': sc.get('cycle'),
        'updated_at': now_iso(),
    }
    return entry if entry['price'] else None


def load_market(args):
    """全市场预筛+精算（可断点续跑），返回与 tracked 同构的 rows"""
    import screen_stocks as ss
    cache_path = Path(args.cache)
    cache = ss.load_json(cache_path, {'version': 1, 'stocks': {}})
    stocks = cache.setdefault('stocks', {})
    scanned = 0

    def save_cache():
        cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding='utf-8')

    # 本次筛选依赖但旧缓存缺少的字段 → 触发重扫（旧条目只有 buys）
    def stale(ent):
        if ent.get('thin'):
            return False
        if args.sell and 'sells' not in ent:
            return True
        if args.cycle_max is not None and 'cycle' not in ent:
            return True
        return False

    if not args.cache_only:
        tracked = ss.tracked_codes()
        spot = ss.fetch_spot_all()
        cand = [x for x in spot if x['name'] and 'ST' not in x['name'] and '退' not in x['name']
                and x['code'] not in tracked and not x['name'].startswith('N')
                and x['pb'] and args.pb_min < x['pb'] <= args.pb_max
                and x['price'] and x['price'] > 0
                and x['pe'] and x['pe'] > 0
                and x['mcap'] and x['mcap'] >= args.mcap_min]
        cand.sort(key=lambda x: x['pb'])
        todo = [x for x in cand if x['code'] not in stocks or stale(stocks[x['code']])]
        if todo:
            print('池子 %d 只，其中待精算 %d 只（本次最多扫 %d，其余下次续跑）' % (
                len(cand), len(todo), args.max_attempts), flush=True)
        for row in todo:
            if scanned >= args.max_attempts:
                break
            scanned += 1
            code, name = str(row['code']), str(row['name'])
            try:
                ent = refine_entry(code, name)
            except Exception as e:
                print('%d SKIP %s %s %r' % (scanned, code, name, e), flush=True)
                continue
            if ent is None:
                stocks[code] = {'name': name, 'pb': row['pb'], 'pe': row['pe'],
                                'mcap': row['mcap'], 'price': None, 'buys': {},
                                'scores': {}, 'thin': True, 'updated_at': now_iso()}
                save_cache()
                print('%d thin %s %s (history<25 期)' % (scanned, code, name), flush=True)
                continue
            ent['pb'] = ent['pb'] or row['pb']
            stocks[code] = ent
            save_cache()
            b = (ent['buys'] or {}).get((args.buy or ['schloss'])[0])
            print('%d scan %s %s PB=%.2f price=%s mgmt=%s fraud=%s buy=%s' % (
                scanned, code, name, ent['pb'], ent['price'],
                ent['mgmt'], ent['fraud'], None if b is None else round(b, 2)), flush=True)
        if scanned:
            print('本轮精算 %d 只，缓存累计 %d 只' % (scanned, len(stocks)), flush=True)

    rows = []
    for code, ent in stocks.items():
        if not ent.get('price'):
            continue
        buys = ent.get('buys') or {}
        sells = ent.get('sells') or {}
        rows.append({
            'code': code, 'name': ent.get('name'), 'market': 'A', 'industry': None,
            'price': ent.get('price'), 'pb': ent.get('pb'), 'mcap': ent.get('mcap'),
            'fraud': ent.get('fraud'), 'mgmt': ent.get('mgmt'), 'cycle': ent.get('cycle'),
            'scores': ent.get('scores') or {},
            'refs': {k: {'buy': buys.get(k),
                         'cons': (sells.get(k) or {}).get('cons'),
                         'fair': (sells.get(k) or {}).get('fair')} for k in SCHOOLS},
            'src': 'market',
        })
    return rows, ('缓存 %d 只（--cache-only，沿用缓存价格）' % len(rows)) if args.cache_only \
        else '全市场扫描（%s）' % now_iso()


# ---------------- 筛选（语义对齐网页 passFilter） ----------------

def pass_row(r, a):
    """返回 None=淘汰；否则返回 {'discount': 最深买点折扣(负数), 'hits': [...]}"""
    if a.markets and r['market'] not in a.markets:
        return None
    if a.keyword:
        kw = a.keyword.lower()
        if kw not in (r['name'] or '').lower() and kw not in (r['code'] or ''):
            return None
    if a.fraud_max is not None:
        if r['fraud'] is None or r['fraud'] > a.fraud_max:
            return None
    if a.mgmt_min is not None:
        if r['mgmt'] is None or r['mgmt'] < a.mgmt_min:
            return None
    if a.cycle_max is not None:
        if r['cycle'] is None or r['cycle'] > a.cycle_max:
            return None
    price = r['price']
    if price is None or price <= 0:
        return None
    res = {'discount': None, 'buy_hits': [], 'sell_hits': []}
    disc = a.discount / 100.0 if (a.buy and a.discount is not None) else 1.0
    for s in a.buy:
        buy = r['refs'][s]['buy']
        if buy is None or price > buy * disc:
            return None
        res['buy_hits'].append(s)
        d = price / buy - 1.0
        if res['discount'] is None or d < res['discount']:
            res['discount'] = d
    for s in a.sell:
        cons, fair = r['refs'][s]['cons'], r['refs'][s]['fair']
        if cons is None or fair is None or price < cons or price < fair:
            return None
        res['sell_hits'].append(s)
    return res


# ---------------- 输出 ----------------

def fmt(v, nd=2):
    return '-' if v is None else ('%.*f' % (nd, v))


def brief(r, res):
    sc = r['scores']
    line1 = '%s %s [%s]%s 现价 %s 造假 %s 管理 %s 周期 %s' % (
        r['code'], r['name'], r['market'],
        ' ' + r['industry'] if r.get('industry') else '',
        fmt(r['price']), fmt(r['fraud'], 1), fmt(r['mgmt'], 1), fmt(r['cycle'], 1))
    line2 = '评分 ' + '/'.join(fmt(sc.get(k), 0) for k in SCHOOLS) + \
        '（进取/防御/施洛斯/巴菲特）'
    if res['buy_hits']:
        parts = ['%s %.2f(%+.1f%%)' % (SCHOOL_CN[s], r['refs'][s]['buy'],
                                        (r['price'] / r['refs'][s]['buy'] - 1) * 100)
                 for s in res['buy_hits']]
        line2 += '  买点: ' + ' ; '.join(parts)
    if res['sell_hits']:
        line2 += '  卖点: ' + ' ; '.join(SCHOOL_CN[s] for s in res['sell_hits'])
    return line1 + '\n    ' + line2


def sort_key(r, res, key):
    if key == 'disc':
        return res['discount'] if res['discount'] is not None else 9e9
    if key == 'mgmt':
        return -(r['mgmt'] if r['mgmt'] is not None else -9e9)
    if key == 'fraud':
        return r['fraud'] if r['fraud'] is not None else 9e9
    if key == 'price':
        return -(r['price'] or 0)
    if key.startswith('score-'):
        v = (r['scores'] or {}).get(key[6:])
        return -(v if v is not None else -9e9)
    return 0


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    ap = argparse.ArgumentParser(description='网页筛选条件的本地自动化抓取筛选器',
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--source', choices=('tracked', 'market'), default='tracked',
                    help='数据源：tracked=已跟踪列表（默认，与网页一致）；market=全市场扫描')
    ap.add_argument('--refresh', action='store_true',
                    help='tracked 源：先跑 fetch_data.py 全量更新再筛（耗时）')
    ap.add_argument('--cache-only', action='store_true',
                    help='market 源：不联网扫新股票，仅用已有缓存出报告（秒级）')
    ap.add_argument('--fraud-max', type=int, help='造假风险 ≤ N（0~100）')
    ap.add_argument('--mgmt-min', type=int, help='管理能力 ≥ N（0~100）')
    ap.add_argument('--buy', help='买点流派逗号分隔（多选需同时满足）：%s / 中文名'
                    % ','.join(SCHOOLS))
    ap.add_argument('--discount', type=int, default=100,
                    help='打折促销%%：现价 ≤ 买价×N%% 才命中（仅配合 --buy，0~500，默认 100）')
    ap.add_argument('--sell', help='卖点流派逗号分隔（现价须同时≥保守与公允）')
    ap.add_argument('--keyword', help='名称/代码模糊匹配')
    ap.add_argument('--market', default='A,HK,US', help='市场（逗号分隔 A,HK,US；默认全部）')
    ap.add_argument('--cycle-max', type=int, help='周期位置 ≤ N（越低越接近底部；非周期公司排除）')
    ap.add_argument('--pb-min', type=float, default=0.01, help='market 源预筛 PB 下限')
    ap.add_argument('--pb-max', type=float, default=1.40, help='market 源预筛 PB 上限')
    ap.add_argument('--mcap-min', type=float, default=3e9, help='market 源预筛市值下限（元）')
    ap.add_argument('--max-attempts', type=int, default=150,
                    help='market 源单次最多精算只数（约 10 秒/只，剩余下次续跑）')
    ap.add_argument('--cache', default=str(BASE / 'scripts' / '_screen_cache.json'),
                    help='market 源精算缓存路径（与 screen_stocks.py 共用）')
    ap.add_argument('--sort', default=None,
                    help='disc=买点折扣最深（默认，需 --buy）| mgmt | fraud | price | score:<流派>')
    ap.add_argument('--top', type=int, default=50, help='显示前 N 名（0=全部，默认 50）')
    ap.add_argument('--out', default=str(BASE / 'scripts' / '_auto_screen_result.json'),
                    help='JSON 结果输出路径')
    a = ap.parse_args()

    a.buy = parse_schools(a.buy, '--buy') if a.buy else []
    a.sell = parse_schools(a.sell, '--sell') if a.sell else []
    a.markets = []
    for tok in str(a.market or '').replace('，', ',').split(','):
        tok = tok.strip()
        if tok:
            m = MARKET_ALIAS.get(tok.lower())
            if not m:
                sys.exit('--market 无法识别 %r（可用 A,HK,US）' % tok)
            if m not in a.markets:
                a.markets.append(m)
    a.fraud_max = clamp_int(a.fraud_max, 100, '--fraud-max')
    a.mgmt_min = clamp_int(a.mgmt_min, 100, '--mgmt-min')
    a.cycle_max = clamp_int(a.cycle_max, 100, '--cycle-max')
    a.discount = clamp_int(a.discount, 500, '--discount')
    if a.discount is None:
        a.discount = 100
    sort = a.sort or ('disc' if a.buy else 'mgmt')

    t0 = time.time()
    if a.source == 'tracked':
        rows, meta = load_tracked(a.refresh)
    else:
        rows, meta = load_market(a)
        if set(a.markets) != set(MARKETS):
            a.markets = ['A'] if 'A' in a.markets else a.markets  # market 源仅覆盖沪深

    hits = []
    for r in rows:
        res = pass_row(r, a)
        if res:
            hits.append((r, res))
    hits.sort(key=lambda t: sort_key(t[0], t[1], sort))
    top = hits if a.top == 0 else hits[:a.top]

    conds = []
    if a.fraud_max is not None:
        conds.append('造假≤%d' % a.fraud_max)
    if a.mgmt_min is not None:
        conds.append('管理≥%d' % a.mgmt_min)
    if a.buy:
        conds.append('买点[' + ','.join(SCHOOL_CN[s] for s in a.buy) + ']'
                     + ('×%d%%' % a.discount if a.discount != 100 else ''))
    if a.sell:
        conds.append('卖点[' + ','.join(SCHOOL_CN[s] for s in a.sell) + ']')
    if a.cycle_max is not None:
        conds.append('周期≤%d' % a.cycle_max)
    if a.keyword:
        conds.append('关键词 %r' % a.keyword)
    print('\n==== 源=%s(%s) 条件: %s | 命中 %d/%d，显示前 %d | 用时 %.0fs ====' % (
        a.source, meta, ' & '.join(conds) or '（无条件，列全部）',
        len(hits), len(rows), len(top), time.time() - t0))
    for i, (r, res) in enumerate(top, 1):
        print('%3d. %s' % (i, brief(r, res)))

    payload = {'generated_at': now_iso(), 'source': a.source, 'meta': meta,
               'conditions': {'fraud_max': a.fraud_max, 'mgmt_min': a.mgmt_min,
                              'buy': a.buy, 'discount': a.discount, 'sell': a.sell,
                              'keyword': a.keyword, 'market': a.markets,
                              'cycle_max': a.cycle_max, 'sort': sort},
               'matches': len(hits),
               'rows': [dict(r, discount=res['discount'], buy_hits=res['buy_hits'],
                             sell_hits=res['sell_hits']) for r, res in top]}
    Path(a.out).write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding='utf-8')
    print('JSON -> %s' % a.out)


if __name__ == '__main__':
    main()
