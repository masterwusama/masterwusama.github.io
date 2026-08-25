"""评分计算 —— stock.js valueAnalysis/valueScores 的 Python 移植

用途：抓取脚本在生成 index.json 时预计算四大流派总分，前端列表页直接读取，
无需再下载全部公司 JSON。详情页完整明细仍由前端 JS 计算渲染。

⚠ 修改评分规则必须同步修改 assets/stock.js 与本文件，并以 JS 为基准，
用 scripts/_score_check.py（Node 抽取 stock.js 原函数对比）做一致性校验。
"""

from datetime import datetime, timedelta, timezone

# 10年期国债收益率参考值（与 stock.js BOND_10Y 一致，仅用于股债利差展示，不影响评分）
BOND_10Y = 0.017


def ssum(vals):
    """对应 JS sum()：忽略 null，全部为 null 时返回 None"""
    s, hit = 0.0, False
    for v in vals:
        if v is not None:
            s += v
            hit = True
    return s if hit else None


def annual_rows(indicators):
    """对应 JS annualRows：年报序列（报告期升序）"""
    rows = [r for r in (indicators or [])
            if '12-31' in str(r.get('报告期') or '')]
    return sorted(rows, key=lambda r: str(r.get('报告期') or ''))


def sheet_row_by_date(rows, date):
    """对应 JS sheetRowByDate：按报告日（YYYY-MM-DD）取行"""
    for r in (rows or []):
        if str(r.get('报告日') or '')[:10] == date:
            return r
    return None


def annual_balance_rows(rows):
    """对应 JS annualBalanceRows：三大报表年报序列（报告日 12-31，升序）"""
    rows = [r for r in (rows or [])
            if '12-31' in str(r.get('报告日') or '')]
    return sorted(rows, key=lambda r: str(r.get('报告日') or ''))


def cagr(cur, prev, years):
    if cur is None or prev is None or prev <= 0 or not years:
        return None
    return (cur / prev) ** (1.0 / years) - 1.0


def per_share_div(dividends, year):
    """对应 JS perShareDiv：某年每股派息合计（元/股，含中期分红）"""
    total, hit = 0.0, False
    for r in (dividends or []):
        m = str(r.get('year') or '')
        y = m[:4]
        if y.isdigit() and int(y) == year and r.get('bonus_per_10') is not None:
            total += r['bonus_per_10']
            hit = True
    return total / 10.0 if hit else None


def consecutive_div_years(dividends):
    """对应 JS consecutiveDivYears：从最新年份倒推的连续分红年数"""
    years = set()
    for r in (dividends or []):
        m = str(r.get('year') or '')
        y = m[:4]
        if y.isdigit():
            years.add(int(y))
    ys = sorted(years, reverse=True)
    if not ys:
        return 0
    n = 1
    for i in range(1, len(ys)):
        if ys[i] == ys[i - 1] - 1:
            n += 1
        else:
            break
    return n


def _recent_cutoff(now):
    """对应 JS recentDividends 的 cutoff（now-1 年，UTC；闰日退化为 3/1 同 JS）"""
    if now is None:
        now = datetime.now(timezone.utc)
    try:
        cutoff = now.replace(year=now.year - 1)
    except ValueError:
        cutoff = now.replace(year=now.year - 1, day=28) + timedelta(days=1)
    return cutoff.strftime('%Y-%m-%d')


def recent_dividends(d, now=None):
    """对应 JS recentDividends：近一年分红记录（数据按日期倒序）"""
    cutoff_str = _recent_cutoff(now)
    return [r for r in (d.get('dividends') or [])
            if (str(r.get('pay_date') or r.get('announce_date') or '')[:10]) >= cutoff_str]


def lerp_score(v, a, b, ma, mb):
    """对应 JS lerpScore：v ≤ a 取 ma；v ≥ b 取 mb；中间线性"""
    if v is None:
        return None
    if v <= a:
        return ma
    if v >= b:
        return mb
    return ma + (v - a) / (b - a) * (mb - ma)


def value_analysis(d, now=None):
    """对应 JS valueAnalysis —— 仅计算评分依赖字段（股息/净现比/CAGR/杜邦 ROE）"""
    ind = d.get('indicators') or []
    annual = annual_rows(ind)
    cf_list = sorted(d.get('cashflow') or [], key=lambda r: str(r.get('报告日') or ''))
    divs = d.get('dividends') or []
    s = d.get('snapshot') or {}
    price = s.get('price')
    last = annual[-1] if annual else None
    last_date = str(last.get('报告期') or '')[:10] if last else None
    last_year = int(last_date[:4]) if last_date else None

    # ---- 股东回报 ----
    per_share_12m = None
    hit12 = False
    for r in recent_dividends(d, now):
        if r.get('bonus_per_10') is not None:
            per_share_12m = (per_share_12m or 0.0) + r['bonus_per_10']
            hit12 = True
    per_share_12m = per_share_12m / 10.0 if hit12 else None
    div_yield = per_share_12m / price if (price is not None and per_share_12m is not None) else None
    per_share_y = per_share_div(divs, last_year) if last_year is not None else None
    eps_y = last.get('基本每股收益') if last else None
    payout = per_share_y / eps_y if (per_share_y is not None and eps_y is not None and eps_y > 0) else None
    div_consecutive = consecutive_div_years(divs)

    # ---- 现金流质量（近 5 年年报）----
    cf_rows = []
    for i in range(max(0, len(annual) - 5), len(annual)):
        date = str(annual[i].get('报告期') or '')[:10]
        c = sheet_row_by_date(cf_list, date)
        net = annual[i].get('净利润')
        revenue = annual[i].get('营业总收入')
        ocf = c.get('经营活动产生的现金流量净额') if c else None
        capex = c.get('购建固定资产、无形资产和其他长期资产所支付的现金') if c else None
        if capex is not None and (capex < 0 or (revenue is not None and capex > revenue * 1.5)):
            capex = None
        cf_rows.append({
            'net': net, 'ocf': ocf,
            'ratio': ocf / net if (net is not None and ocf is not None and net > 0) else None,
            'fcf': ocf - capex if (ocf is not None and capex is not None) else None,
        })
    sum_net = ssum([r['net'] for r in cf_rows])
    sum_ocf = ssum([r['ocf'] for r in cf_rows])
    ratio5 = sum_ocf / sum_net if (sum_net is not None and sum_ocf is not None and sum_net > 0) else None

    # ---- 杜邦分析（近 5 年年报，仅取评分用 ROE 披露值）----
    dupont_roe = []
    for j in range(max(0, len(annual) - 5), len(annual)):
        dupont_roe.append(annual[j].get('净资产收益率'))

    # ---- 成长性 ----
    rev_cagr5 = net_cagr5 = None
    if len(annual) >= 2:
        first = annual[0]
        span = last_year - int(str(first.get('报告期') or '')[:4])
        if span > 0:
            rev_cagr5 = cagr(last.get('营业总收入'), first.get('营业总收入'), span)
            net_cagr5 = cagr(last.get('净利润'), first.get('净利润'), span)

    return {
        'divYield': div_yield, 'payout': payout, 'divConsecutive': div_consecutive,
        'ratio5': ratio5, 'netCagr5': net_cagr5, 'dupontRoe': dupont_roe,
    }


def value_scores(d, va, k=1.0):
    """对应 JS valueScores —— 返回四大流派总分（满分 100）。

    k 为市值/估值缩放因子（默认 1=当前市值）：mcap/pe/pb 同乘 k、股息率除以 k，
    使总分随 k 单调变化，供价格参考二分反推使用（price_references）。
    """
    annual = annual_rows(d.get('indicators') or [])
    last = annual[-1] if annual else None
    last_date = str(last.get('报告期') or '')[:10] if last else None
    last_year = int(last_date[:4]) if last_date else None
    ba_list = sorted(d.get('balance') or [], key=lambda r: str(r.get('报告日') or ''))
    last_ba = sheet_row_by_date(ba_list, last_date) if last_date else None
    s = d.get('snapshot') or {}
    mcap, pe, pb = s.get('market_cap'), s.get('pe_ttm'), s.get('pb')
    if k != 1.0:
        mcap = mcap * k if mcap is not None else None
        pe = pe * k if pe is not None else None
        pb = pb * k if pb is not None else None
    div_consecutive = va['divConsecutive'] or 0
    # 股息率随假设价格反向缩放（仅施洛斯股息率项使用）
    div_yield = va['divYield']
    if k != 1.0 and div_yield is not None:
        div_yield = div_yield / k

    # ---- 基础量（最新年报）----
    def g(ba, key):
        return ba.get(key) if ba else None

    ca = g(last_ba, '流动资产合计')
    cl = g(last_ba, '流动负债合计')
    tl = g(last_ba, '负债合计')
    assets = g(last_ba, '资产总计')
    cash = g(last_ba, '货币资金')
    st_debt = g(last_ba, '短期借款')
    lt_debt = g(last_ba, '长期借款')
    bond = g(last_ba, '应付债券')
    due1y = g(last_ba, '一年内到期的非流动负债')
    lease = g(last_ba, '租赁负债')
    intang = g(last_ba, '无形资产')
    goodwill = g(last_ba, '商誉')
    net_profit = last.get('净利润') if last else None
    debtr = last.get('资产负债率') if last else None
    g_margin = last.get('销售毛利率') if last else None
    n_margin = last.get('销售净利率') if last else None

    int_debt = ssum([st_debt, due1y, lt_debt, bond, lease])
    if int_debt is None:
        int_debt = 0.0
    net_cash = cash - int_debt if cash is not None else None
    ncav = ca - tl if (ca is not None and tl is not None) else None
    wc = ca - cl if (ca is not None and cl is not None) else None
    ltd = ssum([due1y, lt_debt, bond, lease])
    if ltd is None:
        ltd = 0.0
    cur_ratio = ca / cl if (ca is not None and cl is not None and cl > 0) else None
    liq_ratio = ca / tl if (ca is not None and tl is not None and tl > 0) else None
    pncav = mcap / ncav if (mcap is not None and ncav is not None and ncav > 0) else None
    pnetcash = mcap / net_cash if (mcap is not None and net_cash is not None and net_cash > 0) else None
    pepb = pe * pb if (pe is not None and pb is not None) else None
    intang_share = intang / assets if (intang is not None and assets is not None and assets > 0) else None
    goodwill_share = goodwill / assets if (goodwill is not None and assets is not None and assets > 0) else None

    # 近5年年报净利润（盈利稳定性）与近5年净利累计增长
    net5 = [r.get('净利润') for r in annual[-5:]]
    pos_n = len([v for v in net5 if v is not None and v > 0])
    grow5 = None
    if len(net5) >= 2 and net5[0] is not None and net5[-1] is not None and net5[0] > 0:
        grow5 = net5[-1] / net5[0] - 1.0

    # ROE 近5年均值（披露口径）
    roe_vals = [v for v in va['dupontRoe'] if v is not None]
    roe5 = ssum(roe_vals) / len(roe_vals) if roe_vals else None

    scores = []

    # ---- 格雷厄姆 · 进取型烟蒂 ----
    scores.append((
        # 价格/净流动资产（市值/NCAV）≤ 0.67×，30 分
        None if ncav is None else (lerp_score(pncav, 0.67, 1.5, 30, 0) if ncav > 0 else 0.0),
        # 价格/净现金 ≤ 1×，20 分
        None if net_cash is None else (lerp_score(pnetcash, 1, 2, 20, 0) if net_cash > 0 else 0.0),
        # 流动资产/总负债 ≥ 2，20 分
        lerp_score(liq_ratio, 1, 2, 0, 20),
        # 最新年报净利润 > 0，15 分
        15.0 if (net_profit is not None and net_profit > 0) else 0.0,
        # 资产负债率 ≤ 60%，10 分
        lerp_score(debtr, 0.6, 0.8, 10, 0),
        # 连续分红 ≥ 3 年，5 分
        (5.0 if div_consecutive >= 3 else (2.5 if div_consecutive >= 1 else 0.0)),
    ))
    g_a_total = ssum(scores[-1])

    # ---- 格雷厄姆 · 防御型烟蒂（规模硬门槛 + 负分惩罚）----
    def size_score(v):
        if v is None:
            return None
        if v >= 1e10:
            return 10.0
        if v >= 5e9:
            return 6.0
        if v >= 3e9:
            return 3.0
        return 0.0

    def div_score10(years):
        if years >= 10:
            return 15.0
        if years >= 7:
            return 10.0
        if years >= 5:
            return 5.0
        if years >= 3:
            return 2.0
        return 0.0

    if wc is None:
        ltd_score = None
    elif wc <= 0:
        ltd_score = -10.0
    elif ltd <= wc:
        ltd_score = 20.0
    elif ltd <= wc * 1.5:
        ltd_score = lerp_score(ltd / wc, 1, 1.5, 20, 5)
    else:
        ltd_score = 0.0

    cur_score = None if cur_ratio is None else (
        20.0 if cur_ratio >= 2 else
        (lerp_score(cur_ratio, 1.5, 2, 0, 20) if cur_ratio >= 1.5 else
         (5.0 if cur_ratio >= 1 else -10.0)))

    pos_score = 15.0 if pos_n >= 5 else (9.0 if pos_n == 4 else (4.0 if pos_n == 3 else -5.0))

    grow_score = None if grow5 is None else (
        10.0 if grow5 >= 0.33 else (lerp_score(grow5, 0, 0.33, 0, 10) if grow5 >= 0 else -5.0))

    pepb_score = None
    if pepb is not None:
        pepb_score = 5.0 if pepb <= 22.5 else (lerp_score(pepb, 22.5, 45, 5, 0) if pepb <= 45 else 0.0)

    scores.append((
        size_score(assets), cur_score, ltd_score, pos_score,
        div_score10(div_consecutive), grow_score, lerp_score(pe, 15, 25, 5, 0), pepb_score,
    ))
    g_d_total = ssum(scores[-1])

    # ---- 施洛斯烟蒂 ----
    s_items = (
        lerp_score(pb, 0.75, 1.5, 25, 0),          # 市净率 ≤ 0.75
        lerp_score(pe, 10, 20, 20, 0),             # 市盈率 ≤ 10
        lerp_score(liq_ratio, 1, 2, 0, 20),        # 流动资产/总负债 ≥ 2
        lerp_score(div_yield, 0, 0.03, 0, 15),  # 股息率 ≥ 3%
        10.0 if (net_profit is not None and net_profit > 0) else 0.0,  # 最新年报净利 > 0
        # 市值 ≤ 流动资产
        ((10.0 if mcap <= ca else lerp_score(mcap / ca, 1, 2, 10, 0))
         if (mcap is not None and ca is not None and ca > 0) else None),
    )
    # ---- 施洛斯风险扣分（与 JS valueScores 中 riskItems 一一对应）----
    def eq_of(row):
        """归母权益（优先归母，缺则全部权益）"""
        if not row:
            return None
        v = row.get('归属于母公司股东权益合计')
        return v if v is not None else row.get('所有者权益(或股东权益)合计')

    def int_debt_of(row):
        """有息负债全口径（与上方 int_debt 一致：短借+一年内+长借+债券+租赁，缺键当 0）"""
        if not row:
            return None
        v = ssum([row.get('短期借款'), row.get('一年内到期的非流动负债'),
                  row.get('长期借款'), row.get('应付债券'), row.get('租赁负债')])
        return 0.0 if v is None else v

    ba_annual = annual_balance_rows(d.get('balance') or [])
    in_annual = annual_balance_rows(d.get('income') or [])
    cf_annual = annual_balance_rows(d.get('cashflow') or [])
    last_eq = eq_of(last_ba)
    earliest_eq = eq_of(ba_annual[0]) if len(ba_annual) >= 5 else None
    int_debt_now = int_debt_of(last_ba) if last_ba else None
    int_debt_earliest = int_debt_of(ba_annual[0]) if len(ba_annual) >= 5 else None
    # 近5年扣非亏损年数（annual 最后 5 行）
    adj_net = [r.get('扣非净利润') for r in annual[-5:]]
    adj_loss_n = len([v for v in adj_net if v is not None and v < 0])
    adj_valid = len([v for v in adj_net if v is not None])
    # 应收账款/营收 3 年年报均值（位置对齐，缺失年忽略）
    ar3 = [r.get('应收账款') for r in ba_annual[-3:]]
    rev3 = [r.get('营业总收入') for r in in_annual[-3:]]
    ar_rev3 = None
    if len(ar3) == 3 and len(rev3) == 3:
        s_ar, s_rev = ssum(ar3), ssum(rev3)
        if s_ar is not None and s_rev is not None:
            ar_rev3 = s_ar / s_rev
    # 近3年累计经营现金流 vs 累计利息费用
    ocf3 = [r.get('经营活动产生的现金流量净额') for r in cf_annual[-3:]]
    int_exp3 = [r.get('利息费用') for r in in_annual[-3:]]
    ocf3_sum, int_exp3_sum = ssum(ocf3), ssum(int_exp3)
    ocf_covers = (ocf3_sum >= int_exp3_sum) if (ocf3_sum is not None and int_exp3_sum is not None) else None
    # 近5年累计经营现金流（区分扩张举债 vs 补亏举债）
    ocf5_sum = ssum([r.get('经营活动产生的现金流量净额') for r in cf_annual[-5:]])
    # 5 年趋势（最新 vs 最早年报，要求 ≥5 个年报）
    span_ok = len(annual) >= 5
    rev_now = last.get('营业总收入') if last else None
    rev_earliest = annual[0].get('营业总收入') if span_ok else None
    g_margin_now = last.get('销售毛利率') if last else None
    g_margin_earliest = annual[0].get('销售毛利率') if span_ok else None
    eq_grow = (last_eq / earliest_eq - 1.0) if (last_eq is not None and earliest_eq is not None and earliest_eq > 0) else None
    int_debt_grow = (int_debt_now / int_debt_earliest - 1.0) if (int_debt_now is not None and int_debt_earliest is not None and int_debt_earliest > 0) else None
    rev_grow = (rev_now / rev_earliest - 1.0) if (rev_now is not None and rev_earliest is not None and rev_earliest > 0) else None
    g_margin_delta = (g_margin_now - g_margin_earliest) if (g_margin_now is not None and g_margin_earliest is not None) else None
    gw_int_sum = (goodwill or 0.0) + (intang or 0.0)
    inv = last_ba.get('存货') if last_ba else None
    # 9 个量化扣分项（与 JS riskItems 阈值/分值完全一致），数据不足给 0 不误伤
    risk_items = (
        # 净资产5年变动（归母权益）
        0.0 if eq_grow is None else (-5.0 if eq_grow <= -0.4 else (-3.0 if eq_grow <= -0.2 else 0.0)),
        # 近5年扣非亏损年数
        0.0 if adj_valid < 3 else (-5.0 if adj_loss_n >= 3 else (-3.0 if adj_loss_n == 2 else 0.0)),
        # (商誉+无形资产)/归母权益
        0.0 if (last_eq is None or last_eq <= 0) else (-4.0 if gw_int_sum / last_eq > 0.6 else (-2.0 if gw_int_sum / last_eq > 0.3 else 0.0)),
        # 应收账款/营收（3年年报均值）
        0.0 if ar_rev3 is None else (-3.0 if ar_rev3 > 0.6 else (-1.5 if ar_rev3 > 0.4 else 0.0)),
        # 存货/总资产（最新年报）
        0.0 if (inv is None or assets is None or assets <= 0) else (-2.0 if inv / assets > 0.5 else (-1.0 if inv / assets > 0.35 else 0.0)),
        # 有息负债5年变动（翻倍且 5 年经营现金流为负 → 补亏举债重扣）
        0.0 if int_debt_grow is None else (-6.0 if (int_debt_grow > 1 and ocf5_sum is not None and ocf5_sum < 0) else (-3.0 if int_debt_grow > 1 else (-2.0 if int_debt_grow > 0.5 else 0.0))),
        # 近3年经营现金流 vs 利息费用
        -4.0 if ocf_covers is False else 0.0,
        # 营收5年变动
        0.0 if rev_grow is None else (-4.0 if rev_grow <= -0.5 else (-2.0 if rev_grow <= -0.2 else 0.0)),
        # 毛利率5年变动
        0.0 if g_margin_delta is None else (-4.0 if g_margin_delta <= -0.2 else (-2.0 if g_margin_delta <= -0.1 else 0.0)),
    )
    s_total = ssum(s_items + risk_items)

    # ---- 巴菲特芒格 ----
    share = None
    if intang_share is not None or goodwill_share is not None:
        share = (intang_share or 0.0) + (goodwill_share or 0.0)
    moat_items = (
        lerp_score(g_margin, 0.2, 0.4, 0, 5),          # 销售毛利率 ≥ 40%
        lerp_score(roe5, 0.08, 0.15, 0, 4),            # ROE ≥ 15%
        lerp_score(share, 0, 0.1, 0, 3),               # 无形+商誉占比 ≥ 10%
        # 连续分红 ≥ 5 年且分红率 ≤ 70%
        (3.0 if (va['payout'] is not None and va['payout'] <= 0.7) else 1.5)
        if div_consecutive >= 5 else 0.0,
    )
    b_items = (
        lerp_score(roe5, 0.10, 0.15, 0, 25),           # ROE ≥ 15%
        lerp_score(n_margin, 0.05, 0.10, 0, 15),       # 净利率 ≥ 10%
        lerp_score(debtr, 0.5, 0.75, 15, 0),           # 负债率 ≤ 50%
        lerp_score(va['ratio5'], 0.5, 1, 0, 15),       # 5年净现比 ≥ 1
        lerp_score(va['netCagr5'], 0, 0.1, 0, 15),     # 净利 5 年 CAGR ≥ 10%
    )
    b_total = ssum(moat_items + b_items)

    return {
        'grahamAgg': g_a_total,
        'grahamDef': g_d_total,
        'schloss': s_total,
        'buffett': b_total,
    }


# ---- 价格参考（买入/保守卖出/公允卖出）----
# 买入价：二分反推使该流派总分 ≥ BUY_SCORE_TARGET 的最高市值对应股价；
#         若质量项托底已达标或总分不随价格变化则返回 None。
# 卖出价：锚定各流派核心估值指标的评分阈值倍数（不随质量分托底失真）。
BUY_SCORE_TARGET = 90.0   # 买入参考价对应的评分目标
PRICE_K_HI = 1000.0       # 二分市值缩放上限（足够大使价格项归零）
PRICE_K_ITERS = 80        # 二分固定迭代次数（双端一致）


def _fair_pe(net_cagr5):
    """巴菲特合理市盈率 = 净利5年CAGR×100，夹在 [8, 25]；无数据取 15"""
    if net_cagr5 is None:
        return 15.0
    return max(8.0, min(25.0, net_cagr5 * 100.0))


def _bisect_buy(score_fn, price0):
    """二分找总分 ≥ 目标的最大缩放因子 k，返回买入价 = price0×k；无解返回 None"""
    t_max = score_fn(1e-9)          # k→0：价格项全满分的上限
    t_inf = score_fn(PRICE_K_HI)    # k→很大：价格项归零后的质量分托底
    if t_max is None or t_inf is None:
        return None
    if t_max - t_inf < 1e-9:
        return None                 # 总分不随价格变（无价格项），无法反推
    if t_inf >= BUY_SCORE_TARGET:
        return None                 # 质量分已达标，买入价无上界
    tgt = min(BUY_SCORE_TARGET, t_max)
    lo, hi = 0.0, PRICE_K_HI
    for _ in range(PRICE_K_ITERS):
        mid = (lo + hi) / 2.0
        if score_fn(mid) >= tgt:
            lo = mid
        else:
            hi = mid
    return price0 * lo


def price_references(d, va):
    """对应 JS priceReferences：四大流派买入/保守卖出/公允卖出价格参考"""
    s = d.get('snapshot') or {}
    price0, mcap0 = s.get('price'), s.get('market_cap')
    pe0, pb0 = s.get('pe_ttm'), s.get('pb')
    if price0 is None or price0 <= 0:
        return {'grahamAgg': {'buy': None, 'sellCons': None, 'sellFair': None},
                'grahamDef': {'buy': None, 'sellCons': None, 'sellFair': None},
                'schloss': {'buy': None, 'sellCons': None, 'sellFair': None},
                'buffett': {'buy': None, 'sellCons': None, 'sellFair': None}}

    # ---- 基础量（最新年报资产负债表）----
    annual = annual_rows(d.get('indicators') or [])
    last = annual[-1] if annual else None
    last_date = str(last.get('报告期') or '')[:10] if last else None
    ba_list = sorted(d.get('balance') or [], key=lambda r: str(r.get('报告日') or ''))
    last_ba = sheet_row_by_date(ba_list, last_date) if last_date else None

    def g(key):
        return last_ba.get(key) if last_ba else None

    ca, tl = g('流动资产合计'), g('负债合计')
    ncav = (ca - tl) if (ca is not None and tl is not None) else None
    shares = mcap0 / price0 if mcap0 is not None else None
    ncav_ps = ncav / shares if (ncav is not None and shares) else None
    bps = price0 / pb0 if (pb0 is not None and pb0 > 0) else None
    eps_ttm = price0 / pe0 if (pe0 is not None and pe0 > 0) else None
    fair_pe = _fair_pe(va.get('netCagr5'))

    def buy_of(key):
        return _bisect_buy(lambda kk: value_scores(d, va, kk)[key], price0)

    def clamp_buy(buy, anchor):
        """买入价不超过本流派估值锚（保守卖出价）：质量分托底时反推价可能高于锚位，
        截断后仍满足“该价时评分≥90”且避免买入参考高于卖出参考的矛盾"""
        if buy is not None and anchor is not None and buy > anchor:
            return anchor
        return buy

    gA_cons = ncav_ps if (ncav_ps is not None and ncav_ps > 0) else None
    gD_cons = (15.0 * eps_ttm) if (eps_ttm is not None and eps_ttm > 0) else None
    s_cons = bps if (bps is not None and bps > 0) else None
    b_cons = (fair_pe * eps_ttm) if eps_ttm is not None else None

    return {
        'grahamAgg': {
            'buy': clamp_buy(buy_of('grahamAgg'), gA_cons),
            'sellCons': gA_cons,
            'sellFair': (1.5 * ncav_ps) if (ncav_ps is not None and ncav_ps > 0) else None,
        },
        'grahamDef': {
            'buy': clamp_buy(buy_of('grahamDef'), gD_cons),
            'sellCons': gD_cons,
            'sellFair': (20.0 * eps_ttm) if (eps_ttm is not None and eps_ttm > 0) else None,
        },
        'schloss': {
            'buy': clamp_buy(buy_of('schloss'), s_cons),
            'sellCons': s_cons,
            'sellFair': (1.5 * bps) if (bps is not None and bps > 0) else None,
        },
        'buffett': {
            'buy': clamp_buy((fair_pe * eps_ttm * 2.0 / 3.0) if eps_ttm is not None else None, b_cons),
            'sellCons': b_cons,
            'sellFair': (fair_pe * eps_ttm * 1.3) if eps_ttm is not None else None,
        },
    }


def compute_scores(company, now=None):
    """抓取后调用：返回四大流派总分 + 价格参考 dict（供 index.json 直接使用）"""
    va = value_analysis(company, now)
    scores = value_scores(company, va)
    scores['priceRefs'] = price_references(company, va)
    return scores
