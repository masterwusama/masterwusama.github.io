# -*- coding: utf-8 -*-
"""模拟持仓引擎：三种价值投资策略的每日调仓与净值记录。

策略（初始资金各 20 万，均不满仓；全局硬门槛：造假分 < 30 且管理分 > 55）：

分批建仓/减仓 = 价格档位驱动（不到相应档位不执行）：
- 买入三档（按现价低于买点的折价深度，各策略档位不同）：
    折价 ≥ 档位1 → 建至单票上限的 1/3；≥ 档位2 → 2/3；≥ 档位3 → 满上限。
    初始化时若折价已很深，直接按对应档位一次性买入。
- 卖出三档（各策略独立价位表 sell_bands，依次触及依次减仓）：
    施洛斯：保守卖出价→减至2/3、公允价→1/3、公允价×105%→清仓（修复即卖、快进快出）
    格雷厄姆防御：保守卖出价→减至2/3、公允价→1/3、公允价×110%→清仓（纪律止盈）
    巴菲特芒格：保守价不卖、公允价→减至2/3、公允价×125%→1/3、×150%→清仓（让利润奔跑）
- 每个交易日按档位算"应持批次"：低于应持则补买、高于上限则减仓（先卖后买）。
- 分红除权：每日调仓前先处理持仓标的的除权除息日（ex_date）记录——现金分红
  计入现金（税前）、转增/送股增加持股数并摊薄成本价；若建仓日晚于除权日则无权。
  同一笔分红只处理一次（pos.div_last 记录已处理的最近除权日），漏跑数日后补处理。
- 不设持股数量上限：候选命中档位即可买入，由现金与单票上限自然约束分散度。

各策略参数（2026-08-29 定版）：
- 施洛斯烟蒂：单票上限 8%；买入档位 折价 3%/8%/15%
- 格雷厄姆防御：管理≥70+流派分≥75；单票上限 6%；买入档位 折价 5%/10%/15%
- 巴菲特芒格：管理≥80+流派分≥70；单票上限 15%；买入档位 折价 2%/5%/10%

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
N_TR = 3  # 买入/卖出均为三档（每档 = 单票上限的 1/3）

STRATEGIES = {
    'schloss': {'label': '施洛斯烟蒂', 'school': 'schloss',
                'target_w': 0.08, 'buy_bands': (0.03, 0.08, 0.15),
                'sell_bands': (('sellCons', 1.0), ('sellFair', 1.0), ('sellFair', 1.05)),
                'min_mgmt': 55, 'max_fraud': 30, 'min_score': 0},
    'grahamDef': {'label': '格雷厄姆防御', 'school': 'grahamDef',
                  'target_w': 0.06, 'buy_bands': (0.05, 0.10, 0.15),
                  'sell_bands': (('sellCons', 1.0), ('sellFair', 1.0), ('sellFair', 1.10)),
                  'min_mgmt': 70, 'max_fraud': 30, 'min_score': 75},
    'buffett': {'label': '巴菲特芒格', 'school': 'buffett',
                'target_w': 0.15, 'buy_bands': (0.02, 0.05, 0.10),
                'sell_bands': (('sellFair', 1.0), ('sellFair', 1.25), ('sellFair', 1.50)),
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
    """读取 fetch_data 产出的数据，返回 (A 股 {code: {...}}, 分红 {code: [记录]}, 最新交易日期)。
    交易日期取行情快照时间（companies/*.json 的 snapshot.time）而非抓取时刻，
    保证周末/节假日兜底运行时仍归入最近的交易日；分红取同文件的 dividends 数组。"""
    idx = load_json(BASE / 'data' / 'index.json', {})
    stocks, div_map, trade_date = {}, {}, None
    for c in idx.get('companies') or []:
        if c.get('market') != 'A' or not c.get('price'):
            continue
        stocks[c['code']] = c
        det = load_json(BASE / 'data' / 'companies' / ('%s.json' % c['code']), {})
        t = ((det.get('snapshot') or {}).get('time') or '')[:10]
        if t and (trade_date is None or t > trade_date):
            trade_date = t
        divs = [d for d in (det.get('dividends') or []) if d.get('ex_date')]
        if divs:
            div_map[c['code']] = divs
    return stocks, div_map, trade_date


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


def discount_of(c, cfg):
    """现价相对该流派买点的折价深度；无买点/无价/未到买点返回 None"""
    r = refs_of(c).get(cfg['school']) or {}
    buy, price = r.get('buy'), c.get('price')
    if not buy or not price or price > buy:
        return None
    return 1 - price / buy


def demand_tranches(c, cfg):
    """买入侧应持批次（0~3）：折价深度达到第几档就建到几档"""
    disc = discount_of(c, cfg)
    if disc is None:
        return 0
    return sum(1 for b in cfg['buy_bands'] if disc >= b)


def cap_tranches(c, cfg):
    """卖出侧持仓上限批次（0~3）：现价依次触及 sell_bands 各档则相应减档"""
    price = c.get('price')
    if not price:
        return N_TR  # 无行情不触发卖出
    r = refs_of(c).get(cfg['school']) or {}
    hit = 0
    for i, (ref_key, mult) in enumerate(cfg['sell_bands']):
        v = r.get(ref_key)
        if v and price >= v * mult:
            hit = max(hit, i + 1)  # 按最高触发档位减档（低档参考价缺失不影响高档）
    return N_TR - hit


def sell_band_name(cfg, i):
    """第 i 档（0 起）卖出触发说明"""
    ref_key, mult = cfg['sell_bands'][i]
    base = '保守卖出价' if ref_key == 'sellCons' else '公允价值价'
    if abs(mult - 1.0) < 1e-9:
        return '达到%s' % base
    return '达到%s×%.0f%%' % (base, mult * 100)


def candidates(stocks, cfg, exclude=()):
    """命中买点（折价>0）且通过质量门槛的候选，按折价深度降序（越深越靠前）"""
    rows = []
    for code, c in stocks.items():
        if code in exclude or not quality_ok(c, cfg):
            continue
        disc = discount_of(c, cfg)
        if disc is None or disc <= 0:
            continue
        rows.append((-disc, code))
    rows.sort()
    return [code for _, code in rows]


def tranche_amount(cfg):
    """每档买入金额 = 初始资金 × 单票上限 ÷ 档数"""
    return INIT_CAP * cfg['target_w'] / N_TR


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


def fill_buy(strat, pos, c, cfg, trade_date, target_tr, trades, note):
    """把持仓从当前批次补买到 target_tr（每档一笔流水）；返回实际买到的批次"""
    disc = discount_of(c, cfg)
    while pos['tranches'] < target_tr:
        shares = buy_lots(strat['cash'], c['price'], tranche_amount(cfg))
        if shares == 0 and strat['cash'] >= c['price'] * 100:
            shares = 100  # 档位金额不足一手：高价股以一手为一档，保证能建仓
        if shares <= 0:
            break
        band = cfg['buy_bands'][pos['tranches']]
        apply_buy(strat, pos, c, trade_date, shares,
                  '%s第%d档（折价%.1f%%≥%.0f%%）' % (note, pos['tranches'] + 1,
                                                    disc * 100, band * 100), trades)
        pos['tranches'] += 1
    return pos['tranches']


def trim_sell(strat, pos, c, cfg, trade_date, target_tr, trades, note):
    """把持仓从当前批次减到 target_tr（每档一笔流水，按比例减仓，末档清仓）"""
    while pos['tranches'] > target_tr:
        band_i = N_TR - pos['tranches']  # 本笔对应第几档卖出（0 起）
        if target_tr == 0:
            sell_cnt = pos['shares']
        else:
            keep = int(pos['shares'] * target_tr / pos['tranches'])
            sell_cnt = pos['shares'] - keep
        if sell_cnt <= 0:
            break
        amount = round(sell_cnt * c['price'], 2)
        strat['cash'] = round(strat['cash'] + amount, 2)
        trades.append({'date': trade_date, 'code': pos['code'], 'name': pos['name'],
                       'side': 'sell', 'price': c['price'], 'shares': sell_cnt,
                       'amount': amount,
                       'reason': '%s第%d档（%s）' % (note, band_i + 1,
                                                     sell_band_name(cfg, band_i))})
        pos['shares'] -= sell_cnt
        pos['tranches'] -= 1


def apply_dividends(strat, div_map, trade_date, trades):
    """除权除息处理：持仓中 bought_at < ex_date <= trade_date 且未处理的分红记录
    依次入账（现金分红入现金、转增送股增股数摊薄成本）。漏跑数日后会补处理。"""
    for pos in strat['positions']:
        if pos['shares'] <= 0:
            continue
        divs = sorted(div_map.get(pos['code']) or [], key=lambda d: d['ex_date'])
        for d in divs:
            ex = d['ex_date']
            if ex <= (pos.get('div_last') or '') or ex <= pos['bought_at'] or ex > trade_date:
                continue  # 已处理过 / 除权日前未持仓（无分红权）/ 尚未除权
            bonus = d.get('bonus_per_10') or 0
            transfer = d.get('transfer_per_10') or 0
            if bonus:  # 现金分红（税前）：登记日收盘持股为基数
                cash = round(pos['shares'] * bonus / 10.0, 2)
                strat['cash'] = round(strat['cash'] + cash, 2)
                trades.append({'date': trade_date, 'code': pos['code'], 'name': pos['name'],
                               'side': 'dividend', 'price': None, 'shares': pos['shares'],
                               'amount': cash, 'reason': '现金分红 10派%s元（除权日%s，税前）'
                                                          % (bonus, ex)})
            if transfer:  # 转增/送股：总成本不变，按新增整股数摊薄成本
                add = int(math.floor(pos['shares'] / 10.0 * transfer))
                if add > 0:
                    pos['cost'] = round(pos['cost'] * pos['shares'] / (pos['shares'] + add), 4)
                    pos['shares'] += add
                    trades.append({'date': trade_date, 'code': pos['code'], 'name': pos['name'],
                                   'side': 'dividend', 'price': None, 'shares': add,
                                   'amount': 0, 'reason': '10转增%s股（除权日%s），成本摊薄'
                                                          % (transfer, ex)})
            pos['div_last'] = ex


def init_strategy(key, cfg, stocks, trade_date):
    strat = {'label': cfg['label'], 'init_cap': INIT_CAP, 'cash': INIT_CAP,
             'positions': [], 'as_of': trade_date}
    trades = []
    for code in candidates(stocks, cfg):  # 不设持股数量上限，现金与单票上限自然约束
        c = stocks[code]
        demand = demand_tranches(c, cfg)
        if demand <= 0:
            continue
        pos = {'code': code, 'name': c['name'], 'shares': 0, 'cost': 0,
               'bought_at': trade_date, 'tranches': 0}
        reached = fill_buy(strat, pos, c, cfg, trade_date, demand, trades, '初始建仓')
        if reached > 0:
            strat['positions'].append(pos)
        if strat['cash'] < tranche_amount(cfg) * 0.5:
            break  # 现金已明显不足，停止扫描
    return strat, trades


def daily_strategy(strat, cfg, stocks, div_map, trade_date):
    trades = []
    # 0. 分红除权：先于买卖执行，保证档位判定基于除权后的持股数与成本
    apply_dividends(strat, div_map, trade_date, trades)
    # 1. 卖出：现价触及卖出档位则减仓（清仓即移出持仓）
    kept = []
    for pos in strat['positions']:
        c = stocks.get(pos['code'])
        if c:
            cap = cap_tranches(c, cfg)
            if cap < pos['tranches']:
                trim_sell(strat, pos, c, cfg, trade_date, cap, trades, '分批卖出')
        if pos['shares'] > 0:
            kept.append(pos)
    strat['positions'] = kept
    # 2. 加仓：持仓折价加深到更高档位则补买（按折价深度优先）
    pend = []
    for pos in strat['positions']:
        c = stocks.get(pos['code'])
        if not c or pos['tranches'] >= N_TR:
            continue
        disc = discount_of(c, cfg)
        if disc is not None and quality_ok(c, cfg):
            pend.append((-disc, pos))
    pend.sort(key=lambda t: t[0])
    for _, pos in pend:
        c = stocks[pos['code']]
        fill_buy(strat, pos, c, cfg, trade_date, demand_tranches(c, cfg),
                 trades, '分批加仓')
    # 3. 买入：新命中档位（折价>0）的候选按档位建仓（不设持股数量上限）
    held = {p['code'] for p in strat['positions']}
    for code in candidates(stocks, cfg, exclude=held):
        if strat['cash'] < tranche_amount(cfg) * 0.5:
            break
        c = stocks[code]
        demand = demand_tranches(c, cfg)
        if demand <= 0:
            continue
        pos = {'code': code, 'name': c['name'], 'shares': 0, 'cost': 0,
               'bought_at': trade_date, 'tranches': 0}
        reached = fill_buy(strat, pos, c, cfg, trade_date, demand, trades, '新建仓')
        if reached > 0:
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
    stocks, div_map, trade_date = load_market()
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
            tr = daily_strategy(strat, cfg, stocks, div_map, trade_date)
        trades_all.setdefault(key, []).extend(tr)
        view = summarize(strat, stocks, trade_date)
        out['strategies'][key] = view
        state[key] = {'label': cfg['label'], 'init_cap': INIT_CAP,
                      'cash': strat['cash'], 'positions': strat['positions'],
                      'as_of': trade_date}
        posn = ', '.join('%s %d股(%d/3档)' % (p['name'], p['shares'], p['tranches'])
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
