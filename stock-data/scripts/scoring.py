"""评分计算 —— stock.js valueAnalysis/valueScores 的 Python 移植

用途：抓取脚本在生成 index.json 时预计算四大流派总分，前端列表页直接读取，
无需再下载全部公司 JSON。详情页完整明细仍由前端 JS 计算渲染。

⚠ 修改评分规则必须同步修改 assets/stock.js 与本文件，并以 JS 为基准，
用 scripts/_score_check.py（Node 抽取 stock.js 原函数对比）做一致性校验。
"""

from datetime import datetime, timedelta, timezone
import math

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


def ar_of(row):
    """对应 JS arOf：应收账款读取（港股报表科目为“应收帐款”，双科目兼容，优先 A 股口径）"""
    if not row:
        return None
    v = row.get('应收账款')
    return v if v is not None else row.get('应收帐款')


def cagr(cur, prev, years):
    # cur ≤ 0 时负基数开小数次方为复数，无实数解，返回 None（与 JS 一致）
    if cur is None or prev is None or prev <= 0 or cur <= 0 or not years:
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


def value_scores(d, va, k=1.0, use_fundamental=False):
    """对应 JS valueScores —— 返回四大流派总分（满分 100）。

    k 为市值/估值缩放因子（默认 1=当前市值）：mcap/pe/pb 同乘 k、股息率除以 k，
    使总分随 k 单调变化，供价格参考二分反推使用（price_references）。
    use_fundamental=True（仅二分反推）时 pb/pe 改用财报驱动每股量反推
    （归母权益/股本、TTM净利/股本），使“现价×临界倍数”的现价因子精确抵消，
    参考价只随财报变动；快照 pb/pe 仅 2 位小数，直接缩放会引入舍入漂移。
    """
    annual = annual_rows(d.get('indicators') or [])
    last = annual[-1] if annual else None
    last_date = str(last.get('报告期') or '')[:10] if last else None
    last_year = int(last_date[:4]) if last_date else None
    ba_list = sorted(d.get('balance') or [], key=lambda r: str(r.get('报告日') or ''))
    last_ba = sheet_row_by_date(ba_list, last_date) if last_date else None
    s = d.get('snapshot') or {}
    mcap, pe, pb = s.get('market_cap'), s.get('pe_ttm'), s.get('pb')
    # 快照缺 PB（腾讯行情不返回美股 PB）时用财报每股净资产补算：股价÷每股净资产，缺则归母权益/股本反推；
    # 仅 k=1（当期评分）时补算，k≠1 的缩放分支已由财报驱动精确计算，两者口径一致（与 JS valueScores 镜像）
    if pb is None and k == 1.0:
        bps_fb = _latest_field(d.get('indicators') or [], '每股净资产')
        if bps_fb is None and last_ba is not None:
            eq_fb = last_ba.get('归属于母公司股东权益合计')
            if eq_fb is None:
                eq_fb = last_ba.get('所有者权益(或股东权益)合计')
            sh_fb = _share_count(d.get('balance') or [],
                                 (mcap / s.get('price')) if (mcap is not None and s.get('price')) else None, None)
            if eq_fb is not None and sh_fb:
                bps_fb = eq_fb / sh_fb
        if bps_fb is not None and bps_fb > 0 and s.get('price') is not None and s.get('price') > 0:
            pb = s.get('price') / bps_fb
    if k != 1.0 or use_fundamental:
        p0 = s.get('price')
        # 每股净资产优先用指标字段（数据源按财报算好、随财报更新），缺则财报权益/股本
        bps_f = _latest_field(d.get('indicators') or [], '每股净资产')
        shares_f = _share_count(d.get('balance') or [], (mcap / p0) if (mcap is not None and p0) else None, bps_f)
        last_eq_v = None
        if last_ba is not None:
            last_eq_v = last_ba.get('归属于母公司股东权益合计')
            if last_eq_v is None:
                last_eq_v = last_ba.get('所有者权益(或股东权益)合计')
        if shares_f:
            # 快照 mcap 含舍入/滞后，改用财报股本×实时价（市值类价格项同样精确抵消）
            mcap = shares_f * p0 * k
            if bps_f is None and last_eq_v is not None:
                bps_f = last_eq_v / shares_f
            pb = (p0 * k / bps_f) if bps_f else (pb * k if pb is not None else None)
            # 每股收益优先用基本每股收益字段做 TTM，缺则 TTM 净利/股本
            eps_f = _eps_ttm_field(d.get('indicators') or [])
            if eps_f is None:
                ttm_f = _ttm_net_profit(d.get('indicators') or [])
                eps_f = (ttm_f / shares_f) if ttm_f is not None else None
            pe = (p0 * k / eps_f) if eps_f else (pe * k if pe is not None else None)
        else:
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
    # 应收账款/营收 3 年年报均值（位置对齐，缺失年忽略；港股“应收帐款”科目兼容）
    ar3 = [ar_of(r) for r in ba_annual[-3:]]
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


def _ttm_net_profit(rows):
    """滚动 TTM 净利润（利润表为累计口径）：最新报告期累计 + 上年年报 - 上年同期累计；
    最新报告期为年报时直接取年报数；任一要素缺失返回 None"""
    by_date = {}
    for r in (rows or []):
        p = str(r.get('报告期') or '')
        if len(p) >= 10:
            by_date[p[:10]] = r.get('净利润')
    if not by_date:
        return None
    latest_p = max(by_date)  # YYYY-MM-DD 字符串排序即时间序
    cur = by_date[latest_p]
    y, m, d = latest_p[:4], latest_p[5:7], latest_p[8:10]
    if m == '12':
        return cur
    prev_ann = by_date.get(str(int(y) - 1) + '-12-31')
    prev_same = by_date.get(str(int(y) - 1) + '-' + m + '-' + d)
    if cur is None or prev_ann is None or prev_same is None:
        return None
    return cur + prev_ann - prev_same


def _share_count(balance_rows, shares_fallback, bps_field=None):
    """财报股本优先（最新年报实收资本，港股退而取股本），与快照股本偏差 >5% 视为面值异常/口径不同时回退。
    仍不行时用归母权益/每股净资产反推（数据源口径、随财报更新）；
    港股“股本”常为面值总额（面值 0.1/0.01/0.001 等），再按常见面值反推股数。
    快照股本 mcap/price 随实时价抖动（含快照舍入/滞后），财报股本使每股量完全财报驱动"""
    rows = [r for r in (balance_rows or []) if str(r.get('报告日') or '').endswith('12-31')]
    row = None
    if rows:
        row = sorted(rows, key=lambda r: str(r.get('报告日')))[-1]
    cap_cn = None
    cap_hk = None
    eq = None
    if row:
        cap_cn = row.get('实收资本(或股本)')
        cap_hk = row.get('股本')
        eq = row.get('归属于母公司股东权益合计')
        if eq is None:
            eq = row.get('所有者权益(或股东权益)合计')
    for c in (cap_cn, cap_hk):
        if c and shares_fallback and 0.95 <= c / shares_fallback <= 1.05:
            return c
    # 权益/每股净资产反推（每股净资产=权益/股数，数据源算好的财报口径）；偏差 25% 内视为同口径
    if bps_field and eq and shares_fallback:
        c2 = eq / bps_field
        if 0.75 <= c2 / shares_fallback <= 1.25:
            return c2
    # 港股“股本”常为面值总额，按常见面值（0.1/0.01/0.001）反推股数；偏差 12% 内视为同口径
    if cap_hk and shares_fallback:
        for mul in (10, 100, 1000):
            c3 = cap_hk * mul
            if 0.88 <= c3 / shares_fallback <= 1.12:
                return c3
    return shares_fallback


def _latest_field(rows, field):
    """indicators 最新报告期字段值（该期缺失时回退到上一期有值的）"""
    best = None
    for r in (rows or []):
        p = str(r.get('报告期') or '')
        if len(p) >= 10 and (best is None or p > best[0]):
            v = r.get(field)
            if v is not None:
                best = (p, v)
    return best[1] if best else None


def _eps_ttm_field(rows):
    """基本每股收益字段（累计口径）滚动 TTM：最新累计 + 上年年报 - 上年同期累计；最新为年报时直接用年报值"""
    by_date = {}
    for r in (rows or []):
        p = str(r.get('报告期') or '')
        if len(p) >= 10:
            by_date[p[:10]] = r.get('基本每股收益')
    if not by_date:
        return None
    latest_p = max(by_date)
    cur = by_date[latest_p]
    if cur is None:
        return None
    y, m = latest_p[:4], latest_p[5:7]
    if m == '12':
        return cur
    prev_ann = by_date.get(str(int(y) - 1) + '-12-31')
    prev_same = by_date.get(str(int(y) - 1) + latest_p[4:10])
    if prev_ann is None or prev_same is None:
        return None
    return cur + prev_ann - prev_same


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
    """对应 JS priceReferences：公允清算价值 + 四大流派买入/保守卖出/公允卖出价格参考
    fairLiq = 每股公允清算价值（流动资产合计-负债合计）/财报股本，格雷厄姆清算口径"""
    s = d.get('snapshot') or {}
    price0, mcap0 = s.get('price'), s.get('market_cap')
    pe0, pb0 = s.get('pe_ttm'), s.get('pb')
    if price0 is None or price0 <= 0:
        return {'fairLiq': None,
                'netCashRatio': None,
                'netCashCalc': None,
                'grahamAgg': {'buy': None, 'sellCons': None, 'sellFair': None},
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
    last_eq = None
    if last_ba is not None:
        last_eq = last_ba.get('归属于母公司股东权益合计')
        if last_eq is None:
            last_eq = last_ba.get('所有者权益(或股东权益)合计')
    # 每股净资产优先用指标字段（数据源按财报算好、随财报更新，与实时价无关），
    # 避免快照 pb/pe 舍入与 mcap 滞后导致参考价随行情漂移（财务无变化时参考价应不变）
    bps = _latest_field(d.get('indicators') or [], '每股净资产')
    # 股本优先用财报实收资本（最新年报），快照 mcap/price 会随实时价抖动（快照舍入/滞后）
    shares = _share_count(d.get('balance') or [], mcap0 / price0 if mcap0 is not None else None, bps)
    ncav_ps = ncav / shares if (ncav is not None and shares) else None
    if bps is None and last_eq is not None and shares:
        bps = last_eq / shares
    if bps is None:
        bps = price0 / pb0 if (pb0 is not None and pb0 > 0) else None
    eps_ttm = _eps_ttm_field(d.get('indicators') or [])
    if eps_ttm is None:
        ttm_net = _ttm_net_profit(d.get('indicators') or [])
        eps_ttm = (ttm_net / shares) if (ttm_net is not None and shares) else None
    if eps_ttm is None:
        eps_ttm = price0 / pe0 if (pe0 is not None and pe0 > 0) else None
    # 净现金/市值：最近一期财报（加权类现金 − 负债合计）÷ 快照总市值；
    # 类现金保守折算：货币资金×1.0 ＋ 交易性金融资产×0.7 ＋ 应收票据×0.4 ＋ 其他流动资产×0.3；
    # 分子随财报更新（含季报），分母随行情快照，缺失科目按 0 折入
    latest_ba = ba_list[-1] if ba_list else None

    def gb(key):
        v = latest_ba.get(key) if latest_ba else None
        return v if isinstance(v, (int, float)) else None

    cash_v = gb('货币资金')
    fin_v = gb('交易性金融资产')
    notes_v = gb('应收票据')
    other_v = gb('其他流动资产')
    tl_latest = gb('负债合计')

    def gw(v, k):
        return (v * k) if v is not None else 0.0

    weighted_cash = gw(cash_v, 1.0) + gw(fin_v, 0.7) + gw(notes_v, 0.4) + gw(other_v, 0.3)
    has_core = (cash_v is not None and tl_latest is not None and mcap0)
    net_cash_ratio = ((weighted_cash - tl_latest) / mcap0) if has_core else None
    net_cash_calc = ({'cash': cash_v,
                      'fin': fin_v,
                      'notes': notes_v,
                      'otherCA': other_v,
                      'tl': tl_latest,
                      'mcap': mcap0,
                      'report': str(latest_ba.get('报告日') or '')[:10] or None}
                     if has_core else None)
    fair_pe = _fair_pe(va.get('netCagr5'))

    def buy_of(key):
        return _bisect_buy(lambda kk: value_scores(d, va, kk, use_fundamental=True)[key], price0)

    def clamp_buy(buy, anchor):
        """买入价不超过本流派估值锚（保守卖出价）：质量分托底时反推价可能高于锚位，
        截断后仍满足“该价时评分≥90”且避免买入参考高于卖出参考的矛盾"""
        if buy is not None and anchor is not None and buy > anchor:
            return anchor
        return buy

    gA_cons = ncav_ps if (ncav_ps is not None and ncav_ps > 0) else None
    # TTM 每股亏损（≤0）时基于 EPS 的估值锚无意义，锚位与买入价一并置空（避免负价/误导价）
    eps_ok = eps_ttm is not None and eps_ttm > 0
    gD_cons = (15.0 * eps_ttm) if eps_ok else None
    s_cons = bps if (bps is not None and bps > 0) else None
    b_cons = (fair_pe * eps_ttm) if eps_ok else None

    return {
        'fairLiq': ncav_ps if (ncav_ps is not None and ncav_ps > 0) else None,
        'netCashRatio': net_cash_ratio,
        'netCashCalc': net_cash_calc,
        'grahamAgg': {
            'buy': clamp_buy(buy_of('grahamAgg'), gA_cons),
            'sellCons': gA_cons,
            'sellFair': (1.5 * ncav_ps) if (ncav_ps is not None and ncav_ps > 0) else None,
        },
        'grahamDef': {
            'buy': clamp_buy(buy_of('grahamDef'), gD_cons) if eps_ok else None,
            'sellCons': gD_cons,
            'sellFair': (20.0 * eps_ttm) if eps_ok else None,
        },
        'schloss': {
            'buy': clamp_buy(buy_of('schloss'), s_cons),
            'sellCons': s_cons,
            'sellFair': (1.5 * bps) if (bps is not None and bps > 0) else None,
        },
        'buffett': {
            'buy': clamp_buy(fair_pe * eps_ttm * 2.0 / 3.0, b_cons) if eps_ok else None,
            'sellCons': b_cons,
            'sellFair': (fair_pe * eps_ttm * 1.3) if eps_ok else None,
        },
    }


def fraud_analysis(d):
    """对应 JS fraudAnalysis —— 财报造假可能性量化红旗筛查总分（0~100，越高越可疑）。
    借鉴 Beneish M-Score 思路：8 项红旗按严重度加权，数据不足项计 0 分不误伤。"""
    annual = annual_rows(d.get('indicators') or [])
    last = annual[-1] if annual else None
    prev = annual[-2] if len(annual) >= 2 else None
    last_date = str(last.get('报告期') or '')[:10] if last else None
    prev_date = str(prev.get('报告期') or '')[:10] if prev else None
    ba_list = sorted(d.get('balance') or [], key=lambda r: str(r.get('报告日') or ''))
    cf_list = sorted(d.get('cashflow') or [], key=lambda r: str(r.get('报告日') or ''))
    last_ba = sheet_row_by_date(ba_list, last_date) if last_date else None
    prev_ba = sheet_row_by_date(ba_list, prev_date) if prev_date else None
    last_cf = sheet_row_by_date(cf_list, last_date) if last_date else None

    rev = last.get('营业总收入') if last else None
    rev_prev = prev.get('营业总收入') if prev else None
    net = last.get('净利润') if last else None
    ocf = last_cf.get('经营活动产生的现金流量净额') if last_cf else None
    sold_cash = last_cf.get('销售商品、提供劳务收到的现金') if last_cf else None
    assets = last_ba.get('资产总计') if last_ba else None
    ar = ar_of(last_ba)
    ar_prev = ar_of(prev_ba)
    inv = last_ba.get('存货') if last_ba else None
    inv_prev = prev_ba.get('存货') if prev_ba else None
    other_ar = None
    if last_ba:
        other_ar = last_ba.get('其他应收款')
        if other_ar is None:
            other_ar = last_ba.get('其他应收款(合计)')
    soft = ((last_ba.get('商誉') or 0) + (last_ba.get('无形资产') or 0)) if last_ba else None
    gm = last.get('销售毛利率') if last else None
    gm_prev = prev.get('销售毛利率') if prev else None

    # 近5年累计净现比（比单年稳健：累计经营现金流 ÷ 累计净利润）
    sum_net, sum_ocf, hit = 0.0, 0.0, False
    for r in annual[-5:]:
        cf = sheet_row_by_date(cf_list, str(r.get('报告期') or '')[:10])
        n = r.get('净利润')
        o = cf.get('经营活动产生的现金流量净额') if cf else None
        if n is not None and o is not None:
            sum_net += n
            sum_ocf += o
            hit = True
    ratio5 = sum_ocf / sum_net if (hit and sum_net > 0) else None

    def grow(cur, pre):
        return (cur / pre - 1.0) if (cur is not None and pre is not None and pre > 0) else None

    rev_grow = grow(rev, rev_prev)
    ar_grow = grow(ar, ar_prev)
    inv_grow = grow(inv, inv_prev)
    ar_gap = (ar_grow - rev_grow) if (ar_grow is not None and rev_grow is not None) else None
    inv_gap = (inv_grow - rev_grow) if (inv_grow is not None and rev_grow is not None) else None
    gm_delta = (gm - gm_prev) if (gm is not None and gm_prev is not None) else None
    tata = ((net - ocf) / assets) if (net is not None and ocf is not None and assets is not None and assets > 0) else None
    other_share = other_ar / assets if (other_ar is not None and assets is not None and assets > 0) else None
    soft_share = soft / assets if (soft is not None and assets is not None and assets > 0) else None
    collect = sold_cash / rev if (sold_cash is not None and rev is not None and rev > 0) else None

    # 严重度分段：v≤a→0；a~b→0~0.5；b~c→0.5~1；≥c→1（越高越可疑）
    def sev(v, a, b, c):
        if v is None:
            return None
        if v <= a:
            return 0.0
        if v >= c:
            return 1.0
        if v <= b:
            return (v - a) / (b - a) * 0.5
        return 0.5 + (v - b) / (c - b) * 0.5

    def w(score, max_v):
        return None if score is None else score * max_v

    # 净现比：≥1 无红旗；0~1 线性升；≤0 满严重（利润无现金支撑）
    s1 = None if ratio5 is None else lerp_score(ratio5, 0, 1, 1, 0)
    # 收现比：≥100% 无红旗；60%~100% 线性升；≤60% 满严重
    s8 = None if collect is None else lerp_score(collect, 0.6, 1, 1, 0)
    # 毛利率上升才可疑（下降属经营问题）
    s5 = None if gm_delta is None else (0.0 if gm_delta <= 0 else sev(gm_delta, 0, 0.05, 0.10))

    scores = [
        w(s1, 25),                              # 5年累计净现比，25 分
        w(sev(tata, 0.02, 0.06, 0.10), 20),     # 总应计比率，20 分
        w(sev(ar_gap, 0.05, 0.20, 0.40), 15),   # 应收增速−营收增速，15 分
        w(sev(inv_gap, 0.05, 0.25, 0.50), 10),  # 存货增速−营收增速，10 分
        w(s5, 10),                              # 毛利率同比变动，10 分
        w(sev(other_share, 0.02, 0.05, 0.10), 10),  # 其他应收款占用，10 分
        w(sev(soft_share, 0.10, 0.20, 0.35), 5),    # 资产偏软，5 分
        w(s8, 5),                               # 销售收现比，5 分
    ]
    avail = [s for s in scores if s is not None]
    if not avail:
        return None
    total = min(100.0, sum(avail))
    # 与 JS Math.round(total*10)/10 一致（Python round 为银行家舍入，不能直接用）
    return math.floor(total * 10 + 0.5) / 10.0


def management_analysis(d):
    """对应 JS managementAnalysis —— 管理层管理水平评分（0~100，越高越好）。
    融合 DEA 投入产出效率思想的 8 维透明加权：费用纪律/资产周转/资本回报/成长质量/
    营运资金/现金流质量/股东回报/治理诚信；数据不足项不计分不误伤。"""
    annual = annual_rows(d.get('indicators') or [])
    last = annual[-1] if annual else None
    last_date = str(last.get('报告期') or '')[:10] if last else None
    last_year = int(last_date[:4]) if last_date else None
    inc_list = sorted(d.get('income') or [], key=lambda r: str(r.get('报告日') or ''))
    ba_list = sorted(d.get('balance') or [], key=lambda r: str(r.get('报告日') or ''))
    cf_list = sorted(d.get('cashflow') or [], key=lambda r: str(r.get('报告日') or ''))
    last_inc = sheet_row_by_date(inc_list, last_date) if last_date else None
    last_ba = sheet_row_by_date(ba_list, last_date) if last_date else None

    if last:
        rev = last.get('营业总收入')
        roe = last.get('净资产收益率')
        if roe is None:
            roe = last.get('净资产收益率-摊薄')
        eps = last.get('基本每股收益')
    else:
        rev = last_inc.get('营业总收入') if last_inc else None
        roe = None
        eps = None
    sell_exp = last_inc.get('销售费用') if last_inc else None
    adm_exp = last_inc.get('管理费用') if last_inc else None
    fin_exp = last_inc.get('财务费用') if last_inc else None
    assets = last_ba.get('资产总计') if last_ba else None
    ar = ar_of(last_ba)
    inv = last_ba.get('存货') if last_ba else None

    # 1. 三费率：任一费用存在则缺失项按 0 计（与 JS (x||0) 一致）；
    # 三费科目全缺（港股/美股报表口径）时回退替代科目近似计算：美股“营业费用”、港股“销售及分销费用”
    fees = [sell_exp, adm_exp, fin_exp]
    fee_sum = sum(f for f in fees if f is not None) if any(f is not None for f in fees) else None
    if fee_sum is None and last_inc is not None:
        fee_sum = last_inc.get('营业费用') if last_inc.get('营业费用') is not None else last_inc.get('销售及分销费用')
    fee_ratio = fee_sum / rev if (fee_sum is not None and rev is not None and rev > 0) else None
    # 2. 总资产周转率 = 营收 ÷ 总资产
    turnover = rev / assets if (rev is not None and assets is not None and assets > 0) else None
    # 4. 营收约 5 年 CAGR：取不晚于 last_year-5 的最近年报作基期，缺则用最早年报（跳过末期本身）
    rev_cagr = None
    if len(annual) >= 2 and last_year is not None:
        base = None
        for r in reversed(annual[:-1]):
            yy = int(str(r.get('报告期') or '')[:4])
            if yy <= last_year - 5:
                base = r
                break
        if base is None:
            base = annual[0]
        span = last_year - int(str(base.get('报告期') or '')[:4])
        if span > 0:
            rev_cagr = cagr(rev, base.get('营业总收入'), span)
    # 5. 营运资金占用（应收＋存货）÷ 营收
    wc = (ar + inv) / rev if (ar is not None and inv is not None and rev is not None and rev > 0) else None
    # 6. 近 5 年累计净现比（累计经营现金流 ÷ 累计净利润）
    sum_net, sum_ocf, hit = 0.0, 0.0, False
    for r in annual[-5:]:
        cf = sheet_row_by_date(cf_list, str(r.get('报告期') or '')[:10])
        n = r.get('净利润')
        o = cf.get('经营活动产生的现金流量净额') if cf else None
        if n is not None and o is not None:
            sum_net += n
            sum_ocf += o
            hit = True
    cash_ratio = sum_ocf / sum_net if (hit and sum_net > 0) else None
    # 7. 现金分红率 = 最近一次每股分红 ÷ 最近年报每股收益；>150% 视为口径不可比置空（数据按日期倒序）
    payout = None
    divs = [r for r in (d.get('dividends') or [])
            if r.get('bonus_per_10') is not None and r.get('bonus_per_10') > 0]
    if divs and eps is not None and eps > 0:
        payout = (divs[0]['bonus_per_10'] / 10.0) / eps
        if payout > 1.5:
            payout = None
    # 8. 治理诚信：造假风险分反向（越低越诚信）
    fraud = fraud_analysis(d)

    scores = [
        lerp_score(fee_ratio, 0.10, 0.30, 15, 0),   # 费用纪律，15 分（越低越好）
        lerp_score(turnover, 0.2, 1.0, 0, 10),      # 资产周转，10 分（越高越好）
        lerp_score(roe, 0, 0.15, 0, 20),            # 资本回报，20 分（越高越好）
        lerp_score(rev_cagr, 0, 0.10, 0, 10),       # 成长质量，10 分（越高越好）
        lerp_score(wc, 0.15, 0.45, 10, 0),          # 营运资金占用，10 分（越低越好）
        lerp_score(cash_ratio, 0, 1.0, 0, 15),      # 现金流质量，15 分（越高越好）
        lerp_score(payout, 0, 0.50, 0, 10),         # 股东回报，10 分（越高越好）
        None if fraud is None else lerp_score(fraud, 0, 100, 10, 0),  # 治理诚信，10 分（造假分越低越好）
    ]
    avail = [s for s in scores if s is not None]
    if not avail:
        return None
    total = min(100.0, sum(avail))
    # 与 JS Math.round(total*10)/10 一致（Python round 为银行家舍入，不能直接用）
    return math.floor(total * 10 + 0.5) / 10.0


def cycle_analysis(d):
    """对应 JS cycleAnalysis —— 周期性行业判定 + 周期位置评分（0~100，越低越接近底部）。
    阶段一：周期强度（净利变异系数 40 + 深度下滑频率 35 + 毛利率波动 25），≥ 40 判为周期性；
    阶段二：仅周期性公司打周期位置分；非周期性返回 {'cyclical': False, 'total': None}。"""
    annual = annual_rows(d.get('indicators') or [])
    cf_list = sorted(d.get('cashflow') or [], key=lambda r: str(r.get('报告日') or ''))
    ba_list = sorted(d.get('balance') or [], key=lambda r: str(r.get('报告日') or ''))
    last = annual[-1] if annual else None
    last_date = str(last.get('报告期') or '')[:10] if last else None

    # ---- 阶段一：周期强度判定（样本标准差，窗口取近 8 年年报）----
    w8 = annual[-8:]
    nets = [r.get('净利润') for r in w8 if r.get('净利润') is not None]
    gms = [r.get('销售毛利率') for r in w8 if r.get('销售毛利率') is not None]

    def sd(arr):
        if len(arr) < 2:
            return None
        m = sum(arr) / len(arr)
        v = sum((x - m) ** 2 for x in arr) / (len(arr) - 1)
        return math.sqrt(v)

    # 1a 净利变异系数 = 标准差 ÷ |均值|（均值取绝对值防近零放大；全亏取各年绝对值均值）
    cv_net = None
    if len(nets) >= 3:
        denom = abs(sum(nets) / len(nets))
        if denom == 0:
            denom = sum(abs(x) for x in nets) / len(nets)
        if denom > 0:
            cv_net = sd(nets) / denom
    # 1b 利润深度下滑频率：年度净利同比 ≤ -30% 的年数（同比自算，与报表口径一致）
    drops, yoy_hist, hit_drop = 0, [], False
    for ci in range(1, len(annual)):
        n_cur, n_pre = annual[ci].get('净利润'), annual[ci - 1].get('净利润')
        yoy = (n_cur / n_pre - 1.0) if (n_cur is not None and n_pre is not None and n_pre > 0) else None
        if yoy is not None:
            yoy_hist.append(yoy)
            hit_drop = True
            if yoy <= -0.3:
                drops += 1
    # 1c 毛利率波动 = 年度毛利率标准差（价格驱动型周期行业毛利率大起大落）
    gm_sd = sd(gms) if len(gms) >= 3 else None

    c_scores = [
        lerp_score(cv_net, 0.3, 1.2, 0, 40),                        # 净利变异系数，40 分
        lerp_score(drops, 0, 2, 0, 35) if hit_drop else None,       # 深度下滑年数，35 分
        lerp_score(gm_sd, 0.03, 0.10, 0, 25),                       # 毛利率波动，25 分
    ]
    c_avail = [s for s in c_scores if s is not None]
    cyc = min(100.0, sum(c_avail)) if c_avail else None
    cyc = None if cyc is None else math.floor(cyc * 10 + 0.5) / 10.0
    cyclical = cyc is not None and cyc >= 40
    if not cyclical:
        return {'cyclical': False, 'cyclicalScore': cyc, 'total': None}

    # ---- 阶段二：周期位置评分（分数越低越接近周期底部）----
    def pct_of(v, arr):
        vs = [x for x in arr if x is not None]
        if v is None or len(vs) < 2:
            return None
        mn, mx = min(vs), max(vs)
        return 0.5 if mx == mn else (v - mn) / (mx - mn)

    net_last = last.get('净利润') if last else None
    rev_last = last.get('营业总收入') if last else None
    gm_last = last.get('销售毛利率') if last else None
    net_pct = pct_of(net_last, nets)
    gm_pct = pct_of(gm_last, gms)
    rev_pct = pct_of(rev_last, [r.get('营业总收入') for r in w8])
    net_yoy = yoy_hist[-1] if yoy_hist else None
    # 最新年报净现比（底部常伴随现金流恶化）
    last_cf = sheet_row_by_date(cf_list, last_date) if last_date else None
    ocf_last = last_cf.get('经营活动产生的现金流量净额') if last_cf else None
    ncr = ocf_last / net_last if (net_last is not None and ocf_last is not None and net_last > 0) else None
    # 存货同比（去库存 → 接近底部）
    last_ba = sheet_row_by_date(ba_list, last_date) if last_date else None
    prev_date = str(annual[-2].get('报告期') or '')[:10] if len(annual) >= 2 else None
    prev_ba = sheet_row_by_date(ba_list, prev_date) if prev_date else None
    inv_now = last_ba.get('存货') if last_ba else None
    inv_prev = prev_ba.get('存货') if prev_ba else None
    inv_grow = (inv_now / inv_prev - 1.0) if (inv_now is not None and inv_prev is not None and inv_prev > 0) else None
    # 资本开支强度 = 当年购建支出 ÷ 近 3 年均值（收缩 → 供给出清接近底部）
    CAPEX_K = '购建固定资产、无形资产和其他长期资产所支付的现金'
    annual_cf = [r for r in cf_list if str(r.get('报告日') or '')[5:] == '12-31']
    capex_now = last_cf.get(CAPEX_K) if last_cf else None
    capex_prev = [r.get(CAPEX_K) for r in annual_cf[-4:-1] if r.get(CAPEX_K) is not None]
    capex_ratio = None
    if capex_now is not None and len(capex_prev) >= 2:
        capex_avg = sum(capex_prev) / len(capex_prev)
        if capex_avg > 0:
            capex_ratio = capex_now / capex_avg
    # 最新单季营收环比（仍在回落 → 未到底；环比回升 → 开始离开底部）
    q_rows = sorted([r for r in (d.get('indicators') or [])
                     if str(r.get('报告期') or '')[5:] != '12-31'],
                    key=lambda r: str(r.get('报告期') or ''))
    qrev = [r.get('营业总收入_单季') for r in q_rows]
    qoq = None
    if len(qrev) >= 2 and qrev[-2] is not None and qrev[-2] > 0 and qrev[-1] is not None:
        qoq = qrev[-1] / qrev[-2] - 1.0

    scores = [
        None if net_pct is None else net_pct * 25,                 # 利润位置，25 分（越低越近底部）
        lerp_score(net_yoy, -0.50, 0.30, 0, 15),                   # 利润动能，15 分（深负=底部）
        None if gm_pct is None else gm_pct * 15,                   # 毛利率位置，15 分（越低越近底部）
        None if rev_pct is None else rev_pct * 10,                 # 营收位置，10 分（越低越近底部）
        lerp_score(ncr, 0, 1.2, 0, 10),                            # 现金流压力，10 分（≤ 0 底部）
        lerp_score(inv_grow, -0.10, 0.20, 0, 10),                  # 库存周期，10 分（去库存→底部）
        lerp_score(capex_ratio, 0.7, 1.3, 0, 10),                  # 资本开支周期，10 分（收缩→出清）
        lerp_score(qoq, -0.10, 0.05, 0, 10),                       # 单季环比，10 分（仍在探底→低分）
    ]
    avail = [s for s in scores if s is not None]
    if not avail:
        return {'cyclical': True, 'cyclicalScore': cyc, 'total': None}
    total = min(100.0, sum(avail))
    # 与 JS Math.round(total*10)/10 一致（Python round 为银行家舍入，不能直接用）
    return {'cyclical': True, 'cyclicalScore': cyc,
            'total': math.floor(total * 10 + 0.5) / 10.0}


def cycle_history(d):
    """对应 JS cycleHistory —— 逐年回溯周期位置分（趋势图/趋势状态共用）。
    每个年报年以该年为窗口末尾取最近 8 年年报，用与 cycle_analysis 阶段二相同的 8 维逻辑；
    单季环比逐年参与：历史年用该年自身单季营收环比，末年用全局最新单季环比（与当期总分口径对齐），
    故各年均为满 8 维、同口径可比。"""
    annual = annual_rows(d.get('indicators') or [])
    cf_list = sorted(d.get('cashflow') or [], key=lambda r: str(r.get('报告日') or ''))
    ba_list = sorted(d.get('balance') or [], key=lambda r: str(r.get('报告日') or ''))
    CAPEX_K = '购建固定资产、无形资产和其他长期资产所支付的现金'
    annual_cf = [r for r in cf_list if str(r.get('报告日') or '')[5:] == '12-31']
    q_rows = sorted([r for r in (d.get('indicators') or [])
                     if str(r.get('报告期') or '')[5:] != '12-31'],
                    key=lambda r: str(r.get('报告期') or ''))
    qrev = [r.get('营业总收入_单季') for r in q_rows]
    qoq = None
    if len(qrev) >= 2 and qrev[-2] is not None and qrev[-2] > 0 and qrev[-1] is not None:
        qoq = qrev[-1] / qrev[-2] - 1.0
    # 按年归档单季营收（升序，保留 None），供逐年环比：各年取该年最后两个单季（Q3/Q2）
    interim_by_year = {}
    for r in q_rows:
        yr = str(r.get('报告期') or '')[:4]
        interim_by_year.setdefault(yr, []).append(r.get('营业总收入_单季'))

    def year_qoq(yr):
        vals = interim_by_year.get(str(yr), [])
        if len(vals) >= 2 and vals[-2] is not None and vals[-2] > 0 and vals[-1] is not None:
            return vals[-1] / vals[-2] - 1.0
        return None

    def pct_of(v, arr):
        vs = [x for x in arr if x is not None]
        if v is None or len(vs) < 2:
            return None
        mn, mx = min(vs), max(vs)
        return 0.5 if mx == mn else (v - mn) / (mx - mn)

    out = []
    for i in range(2, len(annual)):  # 需至少 3 年窗口且同比可算（i≥2）
        row = annual[i]
        year = int(str(row.get('报告期') or '')[:4])
        win = annual[max(0, i - 7):i + 1]
        net = row.get('净利润')
        prev = annual[i - 1].get('净利润')
        yoy = (net / prev - 1.0) if (net is not None and prev is not None and prev > 0) else None
        date = str(row.get('报告期') or '')[:10]
        cf = sheet_row_by_date(cf_list, date)
        ba = sheet_row_by_date(ba_list, date)
        ba_prev = sheet_row_by_date(ba_list, str(annual[i - 1].get('报告期') or '')[:10])
        ocf = cf.get('经营活动产生的现金流量净额') if cf else None
        ncr = ocf / net if (net is not None and ocf is not None and net > 0) else None
        inv_now = ba.get('存货') if ba else None
        inv_prev = ba_prev.get('存货') if ba_prev else None
        inv_grow = (inv_now / inv_prev - 1.0) if (inv_now is not None and inv_prev is not None and inv_prev > 0) else None
        capex_now = cf.get(CAPEX_K) if cf else None
        ci = annual_cf.index(cf) if cf in annual_cf else -1
        capex_prev = [r.get(CAPEX_K) for r in annual_cf[max(0, ci - 3):ci]
                      if r.get(CAPEX_K) is not None]
        capex_ratio = None
        if capex_now is not None and len(capex_prev) >= 2:
            capex_avg = sum(capex_prev) / len(capex_prev)
            if capex_avg > 0:
                capex_ratio = capex_now / capex_avg
        # 单季环比：末年用全局最新单季环比（与当期总分一致），历史年用该年自身单季环比（满 8 维）
        qoq_i = qoq if i == len(annual) - 1 else year_qoq(year)
        scores = [
            None if pct_of(net, [r.get('净利润') for r in win]) is None
            else pct_of(net, [r.get('净利润') for r in win]) * 25,
            lerp_score(yoy, -0.50, 0.30, 0, 15),
            None if pct_of(row.get('销售毛利率'), [r.get('销售毛利率') for r in win]) is None
            else pct_of(row.get('销售毛利率'), [r.get('销售毛利率') for r in win]) * 15,
            None if pct_of(row.get('营业总收入'), [r.get('营业总收入') for r in win]) is None
            else pct_of(row.get('营业总收入'), [r.get('营业总收入') for r in win]) * 10,
            lerp_score(ncr, 0, 1.2, 0, 10),
            lerp_score(inv_grow, -0.10, 0.20, 0, 10),
            lerp_score(capex_ratio, 0.7, 1.3, 0, 10),
            lerp_score(qoq_i, -0.10, 0.05, 0, 10),
        ]
        avail = [s for s in scores if s is not None]
        sc = math.floor(min(100.0, sum(avail)) * 10 + 0.5) / 10.0 if avail else None
        out.append({'year': year, 'score': sc})
    return out


def cycle_trend(hist):
    """对应 JS cycleTrendOf —— 趋势状态（最新年相对上一年）：
    rev=反转（上一年还在底部区≤30 且明显回升）/ up=上行 / flat=筑底（低位≤40横盘）/ down=下行"""
    h = [x for x in (hist or []) if x.get('score') is not None]
    if len(h) < 2:
        return None
    d1 = h[-1]['score'] - h[-2]['score']
    if d1 > 5:
        return 'rev' if h[-2]['score'] <= 30 else 'up'
    if d1 < -5:
        return 'down'
    if h[-1]['score'] <= 40:
        return 'flat'
    return 'up' if d1 >= 0 else 'down'


def compute_scores(company, now=None):
    """抓取后调用：返回四大流派总分 + 价格参考 + 造假风险分 + 管理分 + 周期分/趋势 dict（供 index.json 直接使用）"""
    va = value_analysis(company, now)
    scores = value_scores(company, va)
    scores['priceRefs'] = price_references(company, va)
    scores['fraud'] = fraud_analysis(company)
    scores['mgmt'] = management_analysis(company)
    ca = cycle_analysis(company)
    scores['cycle'] = ca['total']
    scores['cyclical'] = ca['cyclical']
    # 趋势状态仅周期性公司（非周期不打分不显示趋势）
    scores['cycleTrend'] = cycle_trend(cycle_history(company)) if ca['total'] is not None else None
    return scores
