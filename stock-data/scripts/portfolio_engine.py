# -*- coding: utf-8 -*-
"""模拟持仓引擎：三种价值投资策略的每日调仓与净值记录。

策略（初始资金各 20 万，均不满仓，分批建仓）：
全局硬门槛（所有策略）：造假分 < 30 且管理分 > 55。
- 施洛斯烟蒂：最多 10 只，单票上限 8%，分 4 批（每批 2%）
- 格雷厄姆防御：质量门槛 管理≥70+流派分≥75，最多 10 只，单票上限 6%，分 3 批（每批 2%）
- 巴菲特芒格：质量门槛 管理≥80+流派分≥70，最多 4 只，单票上限 15%，分 3 批（每批 5%）
建仓节奏：首日仅买第 1 批；此后每个交易日，持仓标的只要仍命中买点且未达
单票上限就按折价深度优先加 1 批，新命中买点的候选买入第 1 批补位。

运行方式（本地或 Actions，需在 fetch_data.py 之后）：
    python portfolio_engine.py
自动判断：无持仓数据则初始化建仓（以最新收盘价买入），否则按当日收盘价调仓。
交易日判定：以 A 股行情快照的最新日期为准；该日期已入账则跳过（周末/节假日幂等）。

产出（供前端页面渲染）：
    stock-data/portfolio/data/portfolio.json  当前持仓与汇总
    stock-data/portfolio/data/trades.json     全部调仓记录
    stock-data/portfolio/data/nav.json        每日净值历史（用于每日盈亏）
"""
import json
import math
from datetime import datetime, timezone, timedelta
from pathlib import Path

BASE = Path(__file__).parent.parent
CN_TZ = timezone(timedelta(hours=8))
INIT_CAP = 200000.0

STRATEGIES = {
    'schloss': {'label': '施洛斯烟蒂', 'school': 'schloss',
                'max_pos': 10, 'target_w': 0.08, 'n_tranches': 4,
                'min_mgmt': 55, 'max_fraud': 30, 'min_score': 0},
    'grahamDef': {'label': '格雷厄姆防御', 'school': 'grahamDef',
                  'max_pos': 10, 'target_w': 0.06, 'n_tranches': 3,
                  'min_mgmt': 70, 'max_fraud': 30, 'min_score': 75},
    'buffett': {'label': '巴菲特芒格', 'school': 'buffett',
                'max_pos': 4, 'target_w': 0.15, 'n_tranches': 3,
                'min_mgmt': 80, 'max_fraud': 30, 'min_score': 70},
}


def now_iso():
    return datetime.now(CN_TZ).strftime('%Y-%m-%dT%H:%M:%S+08:00')


def load_json(path, default):
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    return default


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')),
                   encoding='utf-8')
    tmp.replace(path)


def load_market():
    """读取 fetch_data 产出的数据，返回 A 股 {code: {...}} 与最新交易日期。
    交易日期取行情快照时间（companies/*.json 的 snapshot.time）而非抓取时刻，
    保证周末/节假日兜底运行时仍归入最近的交易日。"""
    idx = load_json(BASE / 'data' / 'index.json', {})
    stocks, trade_date = {}, None
    for c in idx.get('companies') or []:
        if c.get('market') != 'A' or not c.get('price'):
            continue
        stocks[c['code']] = c
        det = load_json(BASE / 'data' / 'companies' / ('%s.json' % c['code']), {})
        t = ((det.get('snapshot') or {}).get('time') or '')[:10]
        if t and (trade_date is None or t > trade_date):
            trade_date = t
    return stocks, trade_date


def refs_of(c):
    return ((c.get('scores') or {}).get('priceRefs') or {})


def quality_ok(c, cfg):
    """全局硬门槛：造假分必须低于 30、管理分必须大于 55；策略可叠加更高要求"""
    sc = c.get('scores') or {}
    if (sc.get('fraud') or 0) >= cfg['max_fraud']:
        return False
    if (sc.get('mgmt') or 0) <= cfg['min_mgmt']:
        return False
    if cfg['min_score'] and (sc.get(cfg['school']) or 0) < cfg['min_score']:
        return False
    return True


def candidates(stocks, cfg, exclude=()):
    """命中买点且通过质量门槛的候选，按折价深度升序（越深越靠前）"""
    rows = []
    for code, c in stocks.items():
        if code in exclude or not quality_ok(c, cfg):
            continue
        r = refs_of(c).get(cfg['school']) or {}
        buy = r.get('buy')
        price = c.get('price')
        if not buy or not price or price > buy:
            continue
        rows.append((price / buy, code))
    rows.sort()
    return [code for _, code in rows]


def tranche_amount(cfg):
    """每批买入金额 = 初始资金 × 单票上限 ÷ 批数"""
    return INIT_CAP * cfg['target_w'] / cfg['n_tranches']


def buy_lots(cash, price, amount):
    """A 股整手（100 股）买入股数"""
    if price is None or price <= 0:
        return 0
    amt = min(amount, cash)
    return int(math.floor(amt / price / 100.0)) * 100


def apply_buy(strat, pos, c, trade_date, shares, reason, trades):
    """按当日收盘价执行一笔买入（含均价摊薄），记入交易流水"""
    amount = round(shares * c['price'], 2)
    new_shares = pos['shares'] + shares
    pos['cost'] = round((pos['cost'] * pos['shares'] + amount) / new_shares, 4)
    pos['shares'] = new_shares
    strat['cash'] = round(strat['cash'] - amount, 2)
    trades.append({'date': trade_date, 'code': pos['code'], 'name': pos['name'],
                   'side': 'buy', 'price': c['price'], 'shares': shares,
                   'amount': amount, 'reason': reason})


def init_strategy(key, cfg, stocks, trade_date):
    strat = {'label': cfg['label'], 'init_cap': INIT_CAP, 'cash': INIT_CAP,
             'positions': [], 'as_of': trade_date}
    trades = []
    for code in candidates(stocks, cfg)[:cfg['max_pos']]:
        c = stocks[code]
        shares = buy_lots(strat['cash'], c['price'], tranche_amount(cfg))
        if shares <= 0:
            continue
        pos = {'code': code, 'name': c['name'], 'shares': 0, 'cost': 0,
               'bought_at': trade_date, 'tranches': 0}
        apply_buy(strat, pos, c, trade_date, shares, '初始建仓第1批（命中买点）', trades)
        pos['tranches'] = 1
        strat['positions'].append(pos)
    return strat, trades


def daily_strategy(strat, cfg, stocks, trade_date):
    trades = []
    # 1. 卖出：现价触及该流派卖出参考价（sellFair）
    kept = []
    for pos in strat['positions']:
        c = stocks.get(pos['code'])
        price = c.get('price') if c else None
        sf = (refs_of(c).get(cfg['school']) or {}).get('sellFair') if c else None
        if price and sf and price >= sf:
            amount = round(pos['shares'] * price, 2)
            strat['cash'] = round(strat['cash'] + amount, 2)
            trades.append({'date': trade_date, 'code': pos['code'], 'name': pos['name'],
                           'side': 'sell', 'price': price, 'shares': pos['shares'],
                           'amount': amount, 'reason': '达到卖出参考价'})
        else:
            kept.append(pos)
    strat['positions'] = kept
    # 2. 加仓：已持仓且仍命中买点、未达单票上限的，按折价深度优先各加 1 批
    pend = []
    for pos in strat['positions']:
        if pos.get('tranches', 1) >= cfg['n_tranches']:
            continue
        c = stocks.get(pos['code'])
        if not c:
            continue
        r = refs_of(c).get(cfg['school']) or {}
        if c.get('price') and r.get('buy') and c['price'] <= r['buy'] and quality_ok(c, cfg):
            pend.append((c['price'] / r['buy'], pos))
    pend.sort(key=lambda t: t[0])
    for _, pos in pend:
        c = stocks[pos['code']]
        shares = buy_lots(strat['cash'], c['price'], tranche_amount(cfg))
        if shares <= 0:
            continue
        apply_buy(strat, pos, c, trade_date, shares,
                  '加仓第%d批（仍命中买点）' % (pos['tranches'] + 1), trades)
        pos['tranches'] = pos.get('tranches', 1) + 1
    # 3. 买入：新命中买点的候选买第 1 批补位（不追加已持仓）
    held = {p['code'] for p in strat['positions']}
    for code in candidates(stocks, cfg, exclude=held):
        if len(strat['positions']) >= cfg['max_pos']:
            break
        c = stocks[code]
        shares = buy_lots(strat['cash'], c['price'], tranche_amount(cfg))
        if shares <= 0:
            continue
        pos = {'code': code, 'name': c['name'], 'shares': 0, 'cost': 0,
               'bought_at': trade_date, 'tranches': 0}
        apply_buy(strat, pos, c, trade_date, shares, '新建仓第1批（命中买点）', trades)
        pos['tranches'] = 1
        strat['positions'].append(pos)
    strat['as_of'] = trade_date
    return trades


def summarize(strat, stocks, trade_date):
    """按最新价计算市值/盈亏/权重（写回 portfolio.json 的展示字段）"""
    total = 0.0
    out = []
    for pos in strat['positions']:
        c = stocks.get(pos['code']) or {}
        price = c.get('price') or pos['cost']
        value = round(pos['shares'] * price, 2)
        costv = pos['shares'] * pos['cost']
        days = (datetime.strptime(trade_date, '%Y-%m-%d')
                - datetime.strptime(pos['bought_at'], '%Y-%m-%d')).days
        out.append({**pos, 'price': price, 'value': value,
                    'pnl': round(value - costv, 2),
                    'pnl_pct': round((value / costv - 1) * 100, 2) if costv else 0,
                    'days': days})
        total += value
    nav = round(strat['cash'] + total, 2)
    prev = strat.get('_prev_nav', strat['init_cap'])
    return {
        'label': strat['label'], 'init_cap': strat['init_cap'],
        'cash': strat['cash'], 'nav': nav, 'prev_nav': prev,
        'day_pnl': round(nav - prev, 2),
        'day_pnl_pct': round((nav / prev - 1) * 100, 2) if prev else 0,
        'total_pnl': round(nav - strat['init_cap'], 2),
        'total_pnl_pct': round((nav / strat['init_cap'] - 1) * 100, 2),
        'position_pct': round(total / nav * 100, 2) if nav else 0,
        'positions': out, 'as_of': trade_date,
    }


def main():
    stocks, trade_date = load_market()
    if not stocks or not trade_date:
        print('无 A 股行情，退出')
        return
    pf_path = BASE / 'portfolio' / 'data' / 'portfolio.json'
    tr_path = BASE / 'portfolio' / 'data' / 'trades.json'
    nav_path = BASE / 'portfolio' / 'data' / 'nav.json'
    pf = load_json(pf_path, None)
    trades_all = load_json(tr_path, {k: [] for k in STRATEGIES})
    nav_all = load_json(nav_path, {k: [] for k in STRATEGIES})

    if pf and all(trade_date in (e['date'] for e in nav_all.get(k, ()))
                  for k in STRATEGIES):
        print('交易日 %s 已入账，跳过' % trade_date)
        return

    first_run = pf is None
    if first_run:
        pf = {'strategies': {}}
        print('初始化建仓，交易日 %s' % trade_date)
    else:
        # 恢复内部状态（现金/持仓/上一净值）
        inner = load_json(pf_path.with_name('_state.json'), {})
        if not inner:
            print('缺少 _state.json，无法继续每日调仓')
            return
        pf = {'strategies': inner}

    out = {'updated_at': now_iso(), 'as_of': trade_date, 'strategies': {}}
    state = {}
    for key, cfg in STRATEGIES.items():
        if first_run:
            strat, tr = init_strategy(key, cfg, stocks, trade_date)
        else:
            strat = pf['strategies'][key]
            strat['_prev_nav'] = (nav_all.get(key) or [{'nav': INIT_CAP}])[-1]['nav']
            tr = daily_strategy(strat, cfg, stocks, trade_date)
        trades_all.setdefault(key, []).extend(tr)
        view = summarize(strat, stocks, trade_date)
        out['strategies'][key] = view
        state[key] = {'label': cfg['label'], 'init_cap': INIT_CAP,
                      'cash': strat['cash'], 'positions': strat['positions'],
                      'as_of': trade_date}
        posn = ', '.join('%s %d股(%d/%d批)' % (p['name'], p['shares'],
                                               p.get('tranches', 1), cfg['n_tranches'])
                         for p in strat['positions'])
        print('%s: nav=%.2f 现金=%.2f 仓位=%.1f%% 持仓[%s] 新交易=%d' % (
            cfg['label'], view['nav'], view['cash'], view['position_pct'],
            posn or '空仓', len(tr)))

    save_json(pf_path, out)
    save_json(tr_path, trades_all)
    for key in STRATEGIES:
        nav_all.setdefault(key, []).append({
            'date': trade_date, 'nav': out['strategies'][key]['nav'],
            'cash': out['strategies'][key]['cash'],
            'position_pct': out['strategies'][key]['position_pct']})
    save_json(nav_path, nav_all)
    save_json(pf_path.with_name('_state.json'), state)
    print('完成，写入 %s' % pf_path.parent)


if __name__ == '__main__':
    main()
