# -*- coding: utf-8 -*-
"""临时选股脚本：全市场粗筛 -> 精算施洛斯买入参考 -> 输出现价 <= 买入参考的公司。

用法: python _find_schloss.py [精算上限] [--max N]
- 粗筛:东财全市场快照(PE/PB/市值/排除 ST 与金融)
- 精算:复用 fetch_data 抓取函数(仅评分必需项),scoring.compute_scores 算 schloss.buy
"""
import os
import sys
import json
import time

os.environ['no_proxy'] = '*'
os.environ['NO_PROXY'] = '*'

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import DEFAULT_COMPANIES  # noqa: E402
from fetch_data import fetch_indicators, fetch_report, fetch_snapshot, fetch_dividends, sleep_between  # noqa: E402
from scoring import compute_scores  # noqa: E402

TRACKED = {c[0] for c in DEFAULT_COMPANIES}

FIN_KEYWORDS = ('银行', '证券', '保险', '信托', '期货', '农商', '村镇', '担保', '租赁', '金控')


def is_fin(name):
    """金融类公司判定：名称含金融关键词，或简称以“行”结尾（张家港行/青农商行等）"""
    if name.endswith('行'):
        return True
    return any(k in name for k in FIN_KEYWORDS)

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'}


def sina_clist():
    """新浪沪深A股行情列表分页拉取（含北交所，symbol 带 sh/sz/bj 前缀）"""
    sess = requests.Session()
    sess.trust_env = False
    rows = []
    page = 1
    while True:
        r = sess.get('https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData',
                     params={'page': page, 'num': 100, 'sort': 'symbol', 'asc': 1,
                             'node': 'hs_a', 'symbol': '', '_s_r_a': 'page'},
                     headers=UA, timeout=20)
        batch = r.json() if r.text.strip().startswith('[') else []
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < 100:
            break
        page += 1
        time.sleep(0.4)
    return rows


def rough_candidates(pe_max=13.0, pb_max=1.1, cap_min=3e9, cap_max=40e9):
    """新浪全市场快照粗筛，返回 [(code, name, pe, pb, mcap, price)]"""
    rows = sina_clist()
    out = []
    for r in rows:
        code = str(r.get('code') or '')
        name = str(r.get('name') or '')
        if not (code.isdigit() and len(code) == 6):
            continue
        if code[0] in '489':  # 排除北交所/退市板
            continue
        if 'ST' in name.upper() or '退' in name:
            continue
        if is_fin(name):
            continue
        pe = r.get('per')
        pb = r.get('pb')
        mcap = r.get('mktcap')  # 万元
        price = r.get('trade')
        if not (pe and pb and mcap and price):
            continue
        mcap = mcap * 1e4
        if not (0 < pe < pe_max and 0 < pb < pb_max):
            continue
        if not (cap_min <= mcap <= cap_max):
            continue
        out.append((code, name, float(pe), float(pb), float(mcap), float(price)))
    out.sort(key=lambda x: x[2])  # PE 升序
    return out


def fetch_minimal(code):
    """抓评分必需数据(跳过 info/reports/audit 慢项)"""
    result = {'code': code, 'name': '', 'indicators': [], 'income': [],
              'balance': [], 'cashflow': [], 'snapshot': {}, 'dividends': []}
    result['indicators'] = fetch_indicators(code)
    sleep_between()
    for key, kind in (('income', '利润表'), ('balance', '资产负债表'), ('cashflow', '现金流量表')):
        result[key] = fetch_report(code, kind)
        sleep_between()
    result['snapshot'] = fetch_snapshot(code)
    sleep_between()
    result['dividends'] = fetch_dividends(code)
    return result


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0  # 0 = 全部
    t0 = time.time()
    print('[粗筛] 拉取全市场快照 ...')
    cands = [c for c in rough_candidates() if c[0] not in TRACKED]
    print('[粗筛] 候选 %d 家 (PE<13, PB<1.1, 市值30~400亿, 排除ST/北交所/金融/已跟踪)' % len(cands))
    if not cands:
        return
    for c in cands[:15]:
        print('   ', c[0], c[1], 'PE=%.1f PB=%.2f 市值=%.0f亿 现价=%.2f' % (c[2], c[3], c[4] / 1e8, c[5]))
    todo = cands if limit <= 0 else cands[:limit]
    print('... 共 %d 家, 全部精算 ...' % len(todo))

    hits = []
    scored = []
    for i, (code, name, pe, pb, mcap, price) in enumerate(todo):
        try:
            d = fetch_minimal(code)
            d['name'] = name
            s = compute_scores(d)
            buy = (s.get('priceRefs') or {}).get('schloss', {}).get('buy')
            score = s.get('schloss')
            profits = []
            if buy is not None:
                yrs = sorted((str(r.get('报告日') or ''), r.get('净利润')) for r in d['income'] if r.get('净利润') is not None and '12-31' in str(r.get('报告日') or ''))
                profits = [round(p / 1e8, 1) for _, p in yrs[-3:]]
            tag = '  <-- 现价<=买入参考!' if (buy and price and price <= buy) else ''
            print('[%d/%d] %s %s | PE=%.1f PB=%.2f 现价=%.2f 买入参考=%s 施洛斯分=%s 近3年报净利(亿)%s%s' %
                  (i + 1, len(todo), code, name, pe, pb, price,
                   '%.2f' % buy if buy else '-',
                   '%.1f' % score if score is not None else '-', profits or '-', tag))
            if score is not None:
                scored.append(code)
            if buy and price and price <= buy:
                hits.append((code, name, price, buy, score, pe, pb, mcap, profits))
        except Exception as e:
            print('[%d/%d] %s %s 失败: %s' % (i + 1, len(todo), code, name, str(e)[:120]))
            time.sleep(1)

    print('\n===== 命中结果: 现价 <= 施洛斯买入参考（按折扣排序） =====')
    hits.sort(key=lambda x: -(1 - x[2] / x[3]) * 100)
    for code, name, price, buy, score, pe, pb, mcap, profits in hits:
        print('  %s %s | 现价 %.2f <= 买入参考 %.2f (折扣 %.0f%%) | 施洛斯分 %.1f | PE=%.1f PB=%.2f 市值=%.0f亿 | 净利(亿)%s'
              % (code, name, price, buy, (1 - price / buy) * 100, score or 0, pe, pb, mcap / 1e8, profits))
    print('\n已评分数: %d / %d 家; 命中 %d 家; 总耗时 %.1f 分钟' % (len(scored), len(todo), len(hits), (time.time() - t0) / 60))
    json.dump([{'code': c, 'name': n, 'price': p, 'buy': b, 'score': sc,
                'discount': round((1 - p / b) * 100, 1)}
               for c, n, p, b, sc, *_ in hits],
              open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '_find_hits.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
