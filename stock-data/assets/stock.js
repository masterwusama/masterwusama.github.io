/* 价值分析模块 —— 加载 stock-data/data/*.json 并渲染
 * 路由：#/600519 → 公司详情；无 hash → 公司列表
 */
(function () {
  'use strict';

  var DATA_BASE = './data/';

  var $ = function (id) { return document.getElementById(id); };
  var state = { companies: [], current: null, charts: [], view: 'year',
    indexUpdatedAt: null, listScroll: 0, keyword: '', tab: 'A',
    scores: {}, details: {}, scoresLoaded: false, sortKey: null, sortDir: 'desc', sortOpen: false,
    // 筛选条件：造假风险≤ / 管理能力≥ / 买点（多选同满，可乘打折促销%）/ 卖点（多选同满，须同时达保守与公允）
    flt: { fraudMax: null, mgmtMin: null, buys: [], discount: null, sells: [] }, fltOpen: false };

  // 移动端断点（与 CSS @media max-width:600px 保持一致）：宽表切换卡片流、详情长列表折叠
  var mqMobile = window.matchMedia('(max-width: 600px)');

  // 10年期国债收益率参考值（用于股债利差对比，需手动定期更新）
  var BOND_10Y = 0.017;

  /* ---------------- 工具函数 ---------------- */

  // 金额（元）→ "xx.x亿" / "xx万" / 原值
  function fmtMoney(v) {
    if (v == null || isNaN(v)) return '-';
    var abs = Math.abs(v);
    if (abs >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (abs >= 1e4) return (v / 1e4).toFixed(2) + '万';
    return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  // 小数 → "12.34"
  function fmtNum(v) {
    if (v == null || isNaN(v)) return '-';
    return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  function fmtDate(s) {
    return s ? String(s).slice(0, 10) : '-';
  }

  // "2026-08-09T01:37:56+08:00" → "2026-08-09 01:37"
  function fmtFullDate(s) {
    return s ? String(s).replace('T', ' ').slice(0, 16) : '-';
  }

  function cls(v) {
    if (v == null || isNaN(v) || v === 0) return 'flat';
    return v > 0 ? 'up' : 'down';
  }

  // 最近一年分红记录（按派息日/公告日 ≥ 一年前，数据已按日期倒序）
  function recentDividends(d) {
    var cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    var cutoffStr = cutoff.toISOString().slice(0, 10);
    return (d.dividends || []).filter(function (r) {
      return (r.pay_date || r.announce_date || '') >= cutoffStr;
    });
  }

  /* ---------------- 价值分析：数据准备与工具函数 ---------------- */

  // indicators 中的年报序列（按报告期升序）
  function annualRows(indicators) {
    return (indicators || [])
      .filter(function (r) { return String(r['报告期'] || '').indexOf('12-31') >= 0; })
      .sort(function (a, b) { return a['报告期'] < b['报告期'] ? -1 : 1; });
  }

  // 滚动 TTM 净利润（利润表为累计口径）：最新累计 + 上年年报 - 上年同期累计；最新为年报时直接用年报数
  function ttmNetProfit(indicators) {
    var byDate = {}, latest = null, cur = null;
    (indicators || []).forEach(function (r) {
      var p = String(r['报告期'] || '').slice(0, 10);
      if (p.length === 10) {
        byDate[p] = r['净利润'];
        if (latest == null || p > latest) { latest = p; cur = r['净利润']; }
      }
    });
    if (!latest) return null;
    var y = Number(latest.slice(0, 4)), m = latest.slice(5, 7);
    if (m === '12') return cur;  // 最新报告期为年报
    var prevAnn = byDate[String(y - 1) + '-12-31'];
    var prevSame = byDate[String(y - 1) + latest.slice(4, 10)];
    if (cur == null || prevAnn == null || prevSame == null) return null;
    return cur + prevAnn - prevSame;
  }

  // 财报股本优先（最新年报实收资本，港股退而取股本），与快照股本偏差 >5% 视为面值异常/口径不同时回退。
  // 仍不行时用归母权益/每股净资产反推（数据源口径、随财报更新）；
  // 港股“股本”常为面值总额（面值 0.1/0.01/0.001 等），再按常见面值反推股数。
  // 快照股本 mcap/price 随实时价抖动（含快照舍入/滞后），财报股本使每股量完全财报驱动
  function shareCount(balance, sharesFallback, bpsField) {
    var rows = (balance || []).filter(function (r) { return String(r['报告日'] || '').indexOf('12-31') >= 0; });
    var row = null, eq = null, capCn = null, capHk = null;
    if (rows.length) {
      rows.sort(function (a, b) { return a['报告日'] < b['报告日'] ? -1 : 1; });
      row = rows[rows.length - 1];
      capCn = row['实收资本(或股本)'];
      capHk = row['股本'];
      eq = row['归属于母公司股东权益合计'] != null ? row['归属于母公司股东权益合计'] : row['所有者权益(或股东权益)合计'];
    }
    if (capCn && sharesFallback && capCn / sharesFallback >= 0.95 && capCn / sharesFallback <= 1.05) return capCn;
    if (capHk && sharesFallback && capHk / sharesFallback >= 0.95 && capHk / sharesFallback <= 1.05) return capHk;
    // 权益/每股净资产反推（每股净资产=权益/股数，数据源算好的财报口径）；偏差 25% 内视为同口径
    if (bpsField && eq && sharesFallback) {
      var c2 = eq / bpsField;
      if (c2 / sharesFallback >= 0.75 && c2 / sharesFallback <= 1.25) return c2;
    }
    // 港股“股本”常为面值总额，按常见面值（0.1/0.01/0.001）反推股数；偏差 12% 内视为同口径
    if (capHk && sharesFallback) {
      var muls = [10, 100, 1000];
      for (var i = 0; i < muls.length; i++) {
        var c3 = capHk * muls[i];
        if (c3 / sharesFallback >= 0.88 && c3 / sharesFallback <= 1.12) return c3;
      }
    }
    return sharesFallback;
  }

  // indicators 最新报告期字段值（该期缺失时回退到上一期有值的）
  function latestField(indicators, field) {
    var best = null;
    (indicators || []).forEach(function (r) {
      var p = String(r['报告期'] || '').slice(0, 10);
      if (p.length === 10 && (best == null || p > best[0])) {
        var v = r[field];
        if (v != null) best = [p, v];
      }
    });
    return best ? best[1] : null;
  }

  // 基本每股收益字段（累计口径）滚动 TTM：最新累计 + 上年年报 - 上年同期累计；最新为年报时直接用年报值
  function epsTtmField(indicators) {
    var byDate = {}, latest = null;
    (indicators || []).forEach(function (r) {
      var p = String(r['报告期'] || '').slice(0, 10);
      if (p.length === 10) byDate[p] = r['基本每股收益'];
    });
    var dates = Object.keys(byDate);
    if (!dates.length) return null;
    dates.sort();
    latest = dates[dates.length - 1];
    var cur = byDate[latest];
    if (cur == null) return null;
    var y = Number(latest.slice(0, 4)), m = latest.slice(5, 7);
    if (m === '12') return cur;
    var prevAnn = byDate[String(y - 1) + '-12-31'];
    var prevSame = byDate[String(y - 1) + latest.slice(4, 10)];
    if (prevAnn == null || prevSame == null) return null;
    return cur + prevAnn - prevSame;
  }

  // 从三大报表列表中取指定报告日（YYYY-MM-DD）的行
  function sheetRowByDate(list, date) {
    list = list || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i]['报告日']).slice(0, 10) === date) return list[i];
    }
    return null;
  }

  // 三大报表年报序列（报告日 12-31，升序）——用于历史趋势对比
  function annualBalanceRows(rows) {
    return (rows || [])
      .filter(function (r) { return String(r['报告日'] || '').indexOf('12-31') >= 0; })
      .sort(function (a, b) { return a['报告日'] < b['报告日'] ? -1 : 1; });
  }

  // 应收账款读取（港股报表科目为“应收帐款”，双科目兼容，优先 A 股口径）
  function arOf(row) {
    if (!row) return null;
    var v = row['应收账款'];
    return v != null ? v : row['应收帐款'];
  }

  // 复合增长率：cur 较 prev 跨越 years 年；任一端 ≤ 0 时比率开小数次方无实数解，返回 null
  function cagr(cur, prev, years) {
    if (cur == null || prev == null || prev <= 0 || cur <= 0 || !years) return null;
    return Math.pow(cur / prev, 1 / years) - 1;
  }

  // 某报告期年份的每股派息合计（元/股，含中期分红）
  function perShareDiv(dividends, year) {
    var total = 0, hit = false;
    (dividends || []).forEach(function (r) {
      var m = String(r.year || '').match(/^(\d{4})/);
      if (m && Number(m[1]) === year && r.bonus_per_10 != null) {
        total += r.bonus_per_10;
        hit = true;
      }
    });
    return hit ? total / 10 : null;
  }

  // 连续分红年数（从最新年份倒推）
  function consecutiveDivYears(dividends) {
    var years = {};
    (dividends || []).forEach(function (r) {
      var m = String(r.year || '').match(/^(\d{4})/);
      if (m) years[Number(m[1])] = true;
    });
    var ys = Object.keys(years).map(Number).sort(function (a, b) { return b - a; });
    if (!ys.length) return 0;
    var n = 1;
    for (var i = 1; i < ys.length; i++) {
      if (ys[i] === ys[i - 1] - 1) n++; else break;
    }
    return n;
  }

  function sum(list) {
    var s = 0, hit = false;
    list.forEach(function (v) { if (v != null) { s += v; hit = true; } });
    return hit ? s : null;
  }

  /* ---------------- 视图切换 ---------------- */

  function show(id) {
    ['stock-loading', 'stock-error', 'stock-list', 'stock-detail'].forEach(function (n) {
      $(n).style.display = n === id ? '' : 'none';
    });
  }

  function fail(msg) {
    $('stock-error').textContent = msg;
    show('stock-error');
  }

  function route() {
    // 代码：A 股 6 位数字（600873）/ 港股 5 位数字（00696）/ 美股 1~5 位字母数字（GOOGL、NVDA）
    var m = location.hash.match(/^#\/([A-Za-z0-9]{1,6})$/);
    if (m) {
      // 进入详情前记录列表滚动位置，返回时恢复
      state.listScroll = window.scrollY;
      showDetail(m[1]);
    } else { showList(); }
  }

  window.addEventListener('hashchange', route);
  $('stock-back').addEventListener('click', function () {
    location.hash = '';
  });

  /* ---------------- 公司列表 ---------------- */

  function showList() {
    if (!state.companies.length) { fetchIndex(); return; }
    show('stock-list');
    renderList();
    // 预载全部公司数据并计算三大流派评分（异步填充，缓存复用进详情页）
    if (!state.scoresLoaded) fetchScores();
  }

  // 渲染列表（市场 Tab 过滤 + 搜索/条件筛选 + 评分排序 + 宽表展示），重建 DOM 后重新绑定交互
  function renderList() {
    var box = $('stock-list');
    var list = sortCompanies().filter(function (c) { return c.market === state.tab; });
    // 市场 Tab：A股/港股/美股 分流展示（带各市场数量），切换仅过滤不重拉数据
    var tabLabels = { A: 'A股', HK: '港股', US: '美股' };
    var isMobile = mqMobile.matches;
    // 工具栏（Tab/搜索/排序）：移动端整组吸顶，切市场/搜索/排序无需滚回顶部
    var html = '<div class="s-toolbar">' +
      '<div class="s-tabs" role="tablist">' +
      ['A', 'HK', 'US'].map(function (m) {
        var n = state.companies.filter(function (c) { return c.market === m; }).length;
        return '<button class="s-tab' + (state.tab === m ? ' active' : '') + '" data-tab="' + m +
          '" role="tab" aria-selected="' + (state.tab === m ? 'true' : 'false') + '">' +
          tabLabels[m] + '<span class="s-tab-count">' + n + '</span></button>';
      }).join('') + '</div>' +
      '<div class="stock-search-wrap">' +
      '<input id="stock-search" type="search" placeholder="搜索公司名称 / 代码" ' +
      'value="' + (state.keyword || '') + '" aria-label="搜索公司"></div>' +
      '<div class="s-filter' + (isMobile && !state.fltOpen ? ' s-filter-folded' : '') + '">' +
      // 移动端折叠面板：默认收起为一行摘要（含已启用条件概览），与排序面板同样式风格
      (isMobile ? '<button type="button" class="s-filter-toggle" id="stock-flt-toggle" ' +
        'aria-expanded="' + (state.fltOpen ? 'true' : 'false') + '">' + fltToggleLabel() + '</button>' : '') +
      '<div class="s-filter-body">' +
      '<div class="s-flt-row">' +
      '<label class="s-flt-num" title="财报造假可能性（0-100，越高越可疑），只保留 ≤ 该分的公司">造假风险 ≤ ' +
      '<input id="flt-fraud" type="number" min="0" max="100" step="1" inputmode="numeric" placeholder="不限" value="' + fltVal(state.flt.fraudMax) + '"></label>' +
      '<label class="s-flt-num" title="管理层管理水平（0-100，越高越好），只保留 ≥ 该分的公司">管理能力 ≥ ' +
      '<input id="flt-mgmt" type="number" min="0" max="100" step="1" inputmode="numeric" placeholder="不限" value="' + fltVal(state.flt.mgmtMin) + '"></label>' +
      '</div>' +
      '<div class="s-flt-row"><span class="s-flt-t">买点（多选需同时满足）</span>' +
      fltCb('buy', 'grahamAgg', '格进取') + fltCb('buy', 'grahamDef', '格防御') +
      fltCb('buy', 'schloss', '施洛斯') + fltCb('buy', 'buffett', '巴菲特') +
      '<label class="s-flt-num s-flt-disc" title="买点门槛 × 折扣%，如填 80 则要求现价 ≤ 买价×80%，填 120 则放宽到买价×120%（即现价距买点 20% 以内）；仅勾选买点后可用，留空等同 100%">打折促销 ' +
      '<input id="flt-disc" type="number" min="0" max="500" step="1" inputmode="numeric" placeholder="100" value="' + fltVal(state.flt.discount) + '"' +
      (state.flt.buys.length ? '' : ' disabled') + '> %</label>' +
      '</div>' +
      '<div class="s-flt-row"><span class="s-flt-t">卖点（多选需同时满足，须同时达到保守与公允）</span>' +
      fltCb('sell', 'grahamAgg', '格进取') + fltCb('sell', 'grahamDef', '格防御') +
      fltCb('sell', 'schloss', '施洛斯') + fltCb('sell', 'buffett', '巴菲特') +
      '</div>' +
      '<div class="s-flt-row"><button type="button" id="flt-reset">重置筛选</button>' +
      '<span class="s-flt-hint">买：现价 ≤ 买价×折扣；卖：现价 ≥ 保守卖价且 ≥ 公允卖价；缺数据的公司自动排除</span></div>' +
      '</div></div>' +
      '<div class="s-sort' + (isMobile && !state.sortOpen ? ' s-sort-folded' : '') + '">' +
      // 移动端折叠面板：默认收起（仅一行摘要），点开才显示全部排序按钮，避免占用屏高
      (isMobile ? '<button type="button" class="s-sort-toggle" id="stock-sort-toggle" ' +
        'aria-expanded="' + (state.sortOpen ? 'true' : 'false') + '">' +
        sortToggleLabel() + '</button>' : '') +
      '<div class="s-sort-body">' +
      sortBtn('score-grahamAgg', '格·进取') +
      sortBtn('score-grahamDef', '格·防御') +
      sortBtn('score-schloss', '施洛斯') +
      sortBtn('score-buffett', '巴菲特') +
      // 移动端卡片流补充入口：按各策略买入性价比排序（参考价÷现价，倍数大在前）
      (isMobile ? '<span class="s-sort-divider">买入性价比</span>' +
        sortBtn('buy-grahamAgg', '进取买') +
        sortBtn('buy-grahamDef', '防御买') +
        sortBtn('buy-schloss', '施洛斯买') +
        sortBtn('buy-buffett', '巴菲特买') +
        '<span class="s-sort-divider">清算价值</span>' +
        sortBtn('liq', '清算价') +
        sortBtn('netcash', '净现金率') +
        '<span class="s-sort-divider">造假风险</span>' +
        sortBtn('fraud', '造假分') +
        '<span class="s-sort-divider">管理水平</span>' +
        sortBtn('mgmt', '管理分') +
        '<span class="s-sort-divider">周期位置</span>' +
        sortBtn('cycle', '周期分') : '') +
      '<span class="s-sort-hint">评分列按分数排，买入/卖出参考列按性价比排（参考价 ÷ 现价，倍数大在前），再点同列切换升/降序</span></div></div></div>';
    if (isMobile) {
      // 移动端卡片流：名称/代码/行业/现价 + 四流派评分四宫格 + 买入参考，零横向拖动
      html += '<div class="stock-cards">' + list.map(cardHtml).join('') + '</div>';
    } else {
      // 宽表：列数从简——买入/卖出参考按流派合并为单列（单元格内竖排 买→保→公 三档，18列降为14列）；
      // 列头按买入性价比排序，点卖出小字按保守价排序（data-sort 键：score-/buy-/sellC- + 流派）
      var SCHOOLS = ['grahamAgg', 'grahamDef', 'schloss', 'buffett'];
      html += '<div class="stock-table-wrap"><table class="stock-list-table"><thead>' +
      '<tr class="th-g1">' +
      thSort('name', '股票名称', 'stick', ' rowspan="2"') +
      thSort('code', '代码', 'c-code', ' rowspan="2"') +
      thSort('industry', '所属行业', 'c-industry', ' rowspan="2"') +
      thSort('price', '现价', null, ' rowspan="2"') +
      thSort('liq', '清算价值', null, ' rowspan="2"', '按每股公允清算价值排') +
      thSort('netcash', '净现金/市值', null, ' rowspan="2"', '(货币资金×100%＋交易性金融资产×70%＋应收票据×40%＋其他流动资产×30%−负债合计)÷总市值，最近一期财报；鼠标悬停单元格可看代入值') +
      thSort('fraud', '造假风险', null, ' rowspan="2"', '财报造假可能性评分（0-100，越高越可疑）；点击按分数排序') +
      thSort('mgmt', '管理水平', null, ' rowspan="2"', '管理层管理水平评分（0-100，越高越好）；点击按分数排序') +
            thSort('cycle', '周期位置', null, ' rowspan="2"', '周期位置评分（0-100，越低越接近周期底部）；非周期性行业不打分显示“非周期”；点击按分数排序（升序=更近底部）') +
      '<th colspan="4">四大流派评分</th>' +
      '<th colspan="4" title="每列自上而下：买入参考 / 保守卖出参考 / 公允卖出参考（小字）；现价进入买区绿底、卖区红字">价格参考（买 / 保卖 / 公卖）</th>' +
      '</tr><tr class="th-g2">' +
      SCHOOLS.map(function (k, i) {
        return thSort('score-' + k, ['格进取', '格防御', '施洛斯', '巴菲特'][i]);
      }).join('') +
      SCHOOLS.map(function (k, i) {
        return thSort('buy-' + k, ['格进取', '格防御', '施洛斯', '巴菲特'][i], 'c-ref-h', '', '按买入性价比排；点格内卖出小字按卖出价排');
      }).join('') +
      '</tr></thead><tbody>';
    list.forEach(function (c) {
      var k = (c.name + ' ' + c.code).toLowerCase();
      html += '<tr class="stock-row" data-k="' + k + '" data-code="' + c.code + '" ' +
        'data-price="' + (c.price == null ? '' : c.price) + '" tabindex="0" role="link">' +
        listCells(c) + '</tr>';
    });
    html += '</tbody></table></div>';
    }
    html += '<div class="stock-hint" id="stock-search-empty" style="display:none">未找到匹配的公司</div>';
    html += '<div class="stock-list-foot">数据更新于 ' + fmtFullDate(state.indexUpdatedAt) + '</div>';
    box.innerHTML = html;

    // 搜索框输入即时过滤（名称/代码模糊匹配，与筛选条件叠加）
    var input = $('stock-search');
    input.addEventListener('input', function () {
      state.keyword = input.value;
      applyFilters();
    });

    // 筛选面板：数值输入即时生效（0~上限钳制，越界/非法值失焦时回写钳制后的值；打折促销上限 500）
    var fFraud = $('flt-fraud'), fMgmt = $('flt-mgmt'), fDisc = $('flt-disc');
    function bindNumInput(el, key, max) {
      if (!el) return;
      el.addEventListener('input', function () {
        state.flt[key] = clampInt(el.value, max);
        applyFilters();
      });
      el.addEventListener('change', function () {
        el.value = state.flt[key] == null ? '' : state.flt[key];
      });
    }
    bindNumInput(fFraud, 'fraudMax');
    bindNumInput(fMgmt, 'mgmtMin');
    bindNumInput(fDisc, 'discount', 500);
    // 买点/卖点复选：多选代表同时满足；勾选买点才解锁打折促销输入
    box.querySelectorAll('[data-flt-buy]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        fltToggleArr(state.flt.buys, cb.getAttribute('data-flt-buy'), cb.checked);
        if (fDisc) fDisc.disabled = !state.flt.buys.length;
        applyFilters();
      });
    });
    box.querySelectorAll('[data-flt-sell]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        fltToggleArr(state.flt.sells, cb.getAttribute('data-flt-sell'), cb.checked);
        applyFilters();
      });
    });
    var fReset = $('flt-reset');
    if (fReset) {
      fReset.addEventListener('click', function () {
        state.flt = { fraudMax: null, mgmtMin: null, buys: [], discount: null, sells: [] };
        renderList();
      });
    }
    // 移动端筛选面板展开/收起（与排序面板互斥：同时只展开一个，避免叠加占满屏高）
    var fltToggle = $('stock-flt-toggle');
    if (fltToggle) {
      fltToggle.addEventListener('click', function () {
        state.fltOpen = !state.fltOpen;
        if (state.fltOpen) state.sortOpen = false;
        renderList();
      });
    }

    // 市场 Tab 切换：仅重渲染当前列表，保留搜索词与排序状态
    box.querySelectorAll('.s-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.tab = btn.getAttribute('data-tab');
        renderList();
      });
    });

    // 移动端排序面板展开/收起（与筛选面板互斥）
    var sortToggle = $('stock-sort-toggle');
    if (sortToggle) {
      sortToggle.addEventListener('click', function () {
        state.sortOpen = !state.sortOpen;
        if (state.sortOpen) state.fltOpen = false;
        renderList();
      });
    }

    // 排序：表头列与下方按钮共用同一逻辑（applySort），首次点击数值列降序、文本列升序；
    // 仅绑定 .s-sort-body 内按钮，避免命中折叠面板触发按钮（无 data-sort）
    box.querySelectorAll('thead th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () { applySort(th.getAttribute('data-sort')); });
    });
    box.querySelectorAll('.s-sort-body button').forEach(function (btn) {
      btn.addEventListener('click', function () { applySort(btn.getAttribute('data-sort')); });
    });

    // 行点击与键盘可达：进入详情（路由由 hashchange 统一处理）
    box.querySelectorAll('.stock-row').forEach(function (row) {
      row.addEventListener('click', function () {
        location.hash = '#/' + row.getAttribute('data-code');
      });
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          location.hash = '#/' + row.getAttribute('data-code');
        }
      });
    });

    // 净现金/市值单元格（宽表 td 与移动卡片 div）：点击弹出代入计算式，不触发行进详情
    box.querySelectorAll('[data-s="netcash"]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        showNetFormulaPop(el);
      });
    });

    // 合并参考格内卖出小字：分别按保守/公允价排序（列头本身按买入价排），不触发行进详情
    box.querySelectorAll('td .sl-c[data-sort], td .sl-f[data-sort]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        applySort(el.getAttribute('data-sort'));
      });
    });

    // 关键词 + 筛选条件统一应用到所有行（宽表与卡片流共用）
    applyFilters();

    // 从详情返回时恢复滚动位置
    if (state.listScroll) window.scrollTo(0, state.listScroll);

    // 断点跨越（手机↔桌面）时切换列表形态；详情页不打扰
    if (!state.mqBound) {
      state.mqBound = true;
      mqMobile.addEventListener('change', function () {
        if (!state.current && state.companies.length) renderList();
      });
    }
  }

  // 单行 10 个单元格：名称/代码/行业/现价/清算/净现金 ＋ 评分4 ＋ 价格参考4（每流派买/保/公合并单列）
  // data-s 标记供降级路径 fillRowScores 渐进重填；价格与现价对照着色（买区绿/卖区红）
  function listCells(c) {
    var sc = state.scores[c.code] || null;
    var refs = sc ? sc.priceRefs : null;
    var cur = c.price;
    var h = '<td class="c-name stick" title="' + c.name + '">' + c.name + '</td>' +
      '<td class="c-code">' + c.code + '</td>' +
      '<td class="c-industry" title="' + (c.industry || '') + '">' + (c.industry || '-') + '</td>' +
      '<td class="c-num c-now">' + (cur == null ? '-' : fmtNum(cur)) + '</td>';
    // 公允清算价值（每股）：现价 ≤ 清算价（跌破清算价值）标绿
    var liq = refs ? refs.fairLiq : null;
    var liqHit = liq != null && cur != null && cur <= liq ? ' r-hit' : '';
    h += '<td class="c-num' + liqHit + '" data-s="liq" title="公允清算价值估算：(流动资产合计-负债合计)/股本">' +
      (liq == null ? '-' : fmtNum(liq)) + '</td>';
    // 净现金/市值：分子随最近一期财报更新，分母随行情快照；悬停看公式，点击弹代入计算式
    var ncr = refs ? refs.netCashRatio : null;
    var ncrTitle = netCashFormula(refs) ||
      '净现金/市值：(货币资金×100%＋交易性金融资产×70%＋应收票据×40%＋其他流动资产×30%−负债合计)÷总市值（最近一期财报），≥100% 表示扣除全部负债后的类现金仍高于市值';
    h += '<td class="c-num' + (ncr != null && ncr >= 1 ? ' r-hit' : '') + '" data-s="netcash" ' +
      'title="' + ncrTitle + '">' +
      (ncr == null ? '-' : (ncr * 100).toFixed(1) + '%') + '</td>';
    // 造假风险（百分制，越高风险越大）：等级色与详情页造假分圆徽一致
    var fraud = sc ? sc.fraud : null;
    h += '<td class="c-num sc-' + fraudGradeOf(fraud) + '" data-s="fraud" ' +
      'title="财报造假可能性 ' + (fraud == null ? '-' : fmtNum(fraud)) + ' 分（0-100，越高越可疑）：净现背离/高应计/应收存货增速背离/毛利率逆势上升/其他应收占用等量化红旗加权">' +
      (fraud == null ? '-' : fmtNum(fraud)) + '</td>';
    // 管理水平（百分制，越高越好）：等级色与价值评分同向，与详情页管理分圆徽一致
    var mgmt = sc ? sc.mgmt : null;
    h += '<td class="c-num sc-' + gradeOf(mgmt) + '" data-s="mgmt" ' +
      'title="管理层管理水平 ' + (mgmt == null ? '-' : fmtNum(mgmt)) + ' 分（0-100，越高越好）：费用纪律/资产周转/资本回报/成长质量/营运资金/现金流质量/股东回报/治理诚信加权">' +
      (mgmt == null ? '-' : fmtNum(mgmt)) + '</td>';
    // 周期位置（百分制，越低越接近底部）：非周期性行业显示“非周期”灰色；周期性低分=机会=绿（同造假分方向）；
    // 趋势图标：反转/上行 ▲绿、筑底 ◆琥珀、下行 ▼红（后端预计算，降级路径由客户端回填）
    var cyc = sc ? sc.cycle : null;
    var cycT = sc ? sc.cycleTrend : null;
    var cycTip = (cycT ? cycleTrendText(cycT) + '（最新年分数相对上一年）；' : '') +
      '周期位置 ' + (cyc == null ? '-' : fmtNum(cyc)) + ' 分（0-100，越低越接近周期底部）：利润/毛利率/营收位置 + 同比动能 + 现金流 + 库存/资本开支周期 + 单季环比加权';
    if (sc && sc.cyclical === false) {
      h += '<td class="c-num sc-na" data-s="cycle" title="非周期性/弱周期行业（周期强度 < 40），不适用周期位置评分">非周期</td>';
    } else {
      h += '<td class="c-num sc-' + fraudGradeOf(cyc) + '" data-s="cycle" title="' + cycTip + '">' +
        (cyc == null ? '-' : fmtNum(cyc)) + cycleTrendIcon(cycT) + '</td>';
    }
    ['grahamAgg', 'grahamDef', 'schloss', 'buffett'].forEach(function (k) {
      var v = sc ? sc[k] : null;
      var g = gradeOf(v);
      h += '<td class="c-num sc-' + g + '" data-s="score-' + k + '" title="' + gradeText(g) + '">' +
        (v == null ? '-' : fmtNum(v)) + '</td>';
    });
    // 价格参考合并列：每流派一列，竖排 买→保守→公允；现价 ≤ 买价只标绿买入价，
    // 现价 ≥ 卖出价对应行标红，其余中性不染色（避免整格绿底染到卖价小字）
    var schoolNames = { grahamAgg: '格·进取', grahamDef: '格·防御', schloss: '施洛斯', buffett: '巴菲特' };
    ['grahamAgg', 'grahamDef', 'schloss', 'buffett'].forEach(function (k) {
      var p = refs && refs[k] ? refs[k] : null;
      var buy = p ? p.buy : null;
      var pC = p ? p.sellCons : null;
      var pF = p ? p.sellFair : null;
      var hitB = buy != null && cur != null && cur <= buy ? ' r-hit' : '';
      var hitC = pC != null && cur != null && cur >= pC;
      var hitF = pF != null && cur != null && cur >= pF;
      h += '<td class="c-num c-ref" data-s="buy-' + k + '" ' +
        'title="' + schoolNames[k] + '：买 ' + (buy == null ? '-' : fmtNum(buy)) + ' / 保卖 ' + (pC == null ? '-' : fmtNum(pC)) + ' / 公卖 ' + (pF == null ? '-' : fmtNum(pF)) + '">' +
        '<span class="rf-buy' + hitB + '">' + (buy == null ? '-' : fmtNum(buy)) + '</span>' +
        '<span class="rf-sell">' +
          '<span class="sl-c' + (hitC ? ' r-hit-s' : '') + '" data-s="sellC-' + k + '" data-sort="sellC-' + k + '" title="保守卖出参考，点击按保守价排序">' + (pC == null ? '-' : fmtNum(pC)) + '</span>' +
          '<span class="sl-f' + (hitF ? ' r-hit-s' : '') + '" data-s="sellF-' + k + '" data-sort="sellF-' + k + '" title="公允卖出参考，点击按公允价排序">' + (pF == null ? '' : fmtNum(pF)) + '</span>' +
        '</span>' +
        '</td>';
    });
    return h;
  }

  // 移动端卡片：头部（名称/代码/行业/现价）+ 四流派评分四宫格 + 买入参考一行四格；
  // 带 stock-row 类以复用搜索过滤/点击进详情/键盘可达的绑定逻辑
  function cardHtml(c) {
    var sc = state.scores[c.code] || null;
    var refs = sc ? sc.priceRefs : null;
    var cur = c.price;
    var names = ['格进取', '格防御', '施洛斯', '巴菲特'];
    var h = '<div class="stock-card stock-row" data-k="' + (c.name + ' ' + c.code).toLowerCase() +
      '" data-code="' + c.code + '" data-price="' + (cur == null ? '' : cur) + '" tabindex="0" role="link">';
    h += '<div class="sc-head">' +
      '<span class="sc-name">' + c.name + '</span>' +
      '<span class="sc-code">' + c.code + '</span>' +
      '<span class="sc-industry">' + (c.industry || '-') + '</span>' +
      '<span class="sc-price">' + (cur == null ? '-' : fmtNum(cur)) + '</span>' +
      '<span class="sc-fraud sc-' + fraudGradeOf(sc ? sc.fraud : null) + '" data-s="fraud" title="财报造假可能性（0-100，越高越可疑）"><em>造假</em><b>' + (sc && sc.fraud != null ? fmtNum(sc.fraud) : '-') + '</b></span>' +
      '<span class="sc-mgmt sc-' + gradeOf(sc ? sc.mgmt : null) + '" data-s="mgmt" title="管理层管理水平评分（0-100，越高越好）"><em>管理</em><b>' + (sc && sc.mgmt != null ? fmtNum(sc.mgmt) : '-') + '</b></span>' +
      (sc && sc.cyclical === false
        ? '<span class="sc-cycle sc-na" data-s="cycle" title="非周期性/弱周期行业，不适用周期位置评分"><em>周期</em><b>非周期</b></span>'
        : '<span class="sc-cycle sc-' + fraudGradeOf(sc ? sc.cycle : null) + '" data-s="cycle" title="周期位置评分（0-100，越低越接近周期底部）；趋势：' + (sc && sc.cycleTrend ? cycleTrendText(sc.cycleTrend) : '-') + '"><em>周期</em><b>' + (sc && sc.cycle != null ? fmtNum(sc.cycle) : '-') + '</b>' + cycleTrendIcon(sc ? sc.cycleTrend : null) + '</span>') +
      '</div>';
    // 公允清算价值 + 净现金/市值 并排（移动端半行各一块，样式复用 sc-liq）
    var liq = refs ? refs.fairLiq : null;
    var liqHit = liq != null && cur != null && cur <= liq;
    var ncrC = refs ? refs.netCashRatio : null;
    // 移动端无 hover：净现金块点按弹代入计算式浮层；初始提示写公式模板
    h += '<div class="sc-duo">' +
      '<div class="sc-liq' + (liqHit ? ' sc-liq-hit' : '') + '" title="公允清算价值估算：(流动资产合计-负债合计)/股本">' +
        '<em>清算价值</em>' +
        '<span class="sc-liq-v" data-s="liq">' + (liq == null ? '-' : fmtNum(liq)) + '</span>' +
        (liqHit ? '<b>跌破</b>' : '') +
      '</div>' +
      '<div class="sc-liq sc-net-tap" data-s="netcash" title="(货币资金×100%＋交易性金融资产×70%＋应收票据×40%＋其他流动资产×30%−负债合计)÷总市值，点击看代入值">' +
        '<em>净现金/市值</em>' +
        '<span>' + (ncrC == null ? '-' : (ncrC * 100).toFixed(1) + '%') + '</span>' +
      '</div>' +
    '</div>';
    // 评分四宫格（等级色与宽表一致：sc-good/mid/low/bad/na）
    h += '<div class="sc-scores">' + ['grahamAgg', 'grahamDef', 'schloss', 'buffett'].map(function (k, i) {
      var v = sc ? sc[k] : null;
      var g = gradeOf(v);
      return '<div class="sc-score sc-' + g + '"><span class="sc-k">' + names[i] + '</span>' +
        '<span class="sc-v" data-s="score-' + k + '">' + (v == null ? '-' : fmtNum(v)) + '</span></div>';
    }).join('') + '</div>';
    // 买/卖参考四列：每列含买入价 + 保守卖出 + 公允卖出（现价 ≤ 买入价只标绿买入价，
    // 现价 ≥ 卖出价对应值标红，其余中性不染色，与宽表语义一致）
    h += '<div class="sc-refs">' + ['grahamAgg', 'grahamDef', 'schloss', 'buffett'].map(function (k, i) {
      var p = refs && refs[k] ? refs[k] : null;
      var buy = p ? p.buy : null;
      var sellC = p ? p.sellCons : null;
      var sellF = p ? p.sellFair : null;
      var hitB = buy != null && cur != null && cur <= buy;
      var hitC = sellC != null && cur != null && cur >= sellC;
      var hitF = sellF != null && cur != null && cur >= sellF;
      return '<div class="sc-ref" data-s="buy-' + k + '">' +
        '<em>' + names[i] + '</em>' +
        '<span class="r-buy' + (hitB ? ' r-hit' : '') + '">买 ' + (buy == null ? '-' : fmtNum(buy)) + '</span>' +
        '<span class="r-sell' + (hitC ? ' r-hit-s' : '') + '">保卖 ' + (sellC == null ? '-' : fmtNum(sellC)) + '</span>' +
        '<span class="r-sell' + (hitF ? ' r-hit-s' : '') + '">公卖 ' + (sellF == null ? '-' : fmtNum(sellF)) + '</span>' +
        '</div>';
    }).join('') + '</div>';
    return h + '</div>';
  }

  /* ---------------- 列表条件筛选 ---------------- */

  // 筛选数值输入渲染值（空值显示占位符）
  function fltVal(v) { return v == null ? '' : v; }

  // 买点/卖点复选框 HTML（勾选状态从 state.flt 回显）
  function fltCb(kind, k, label) {
    var arr = kind === 'buy' ? state.flt.buys : state.flt.sells;
    return '<label class="s-flt-cb"><input type="checkbox" data-flt-' + kind + '="' + k + '"' +
      (arr.indexOf(k) >= 0 ? ' checked' : '') + '>' + label + '</label>';
  }

  // 0~上限正整数钳制（默认上限 100）：空/非法值返回 null（不过滤），越界钳到边界（输入框 min/max 双重保险）
  function clampInt(v, max) {
    if (v == null || String(v).trim() === '') return null;
    var n = parseInt(v, 10);
    if (isNaN(n)) return null;
    return Math.max(0, Math.min(max == null ? 100 : max, n));
  }

  // 数组勾选切换（防重复）
  function fltToggleArr(arr, k, checked) {
    var i = arr.indexOf(k);
    if (checked && i < 0) arr.push(k);
    if (!checked && i >= 0) arr.splice(i, 1);
  }

  function fltActive() {
    var f = state.flt;
    return f.fraudMax != null || f.mgmtMin != null || f.buys.length > 0 || f.sells.length > 0;
  }

  // 移动端筛选面板触发按钮文案：展开态“收起”，收起态显示已启用条件摘要（未启用则提示）
  function fltToggleLabel() {
    if (state.fltOpen) return '收起筛选 ▲';
    var f = state.flt, parts = [];
    if (f.fraudMax != null) parts.push('造假≤' + f.fraudMax);
    if (f.mgmtMin != null) parts.push('管理≥' + f.mgmtMin);
    if (f.buys.length) parts.push(f.buys.length + '个买点' + (f.discount != null ? '×' + f.discount + '%' : ''));
    if (f.sells.length) parts.push(f.sells.length + '个卖点');
    return parts.length ? '筛选：' + parts.join(' · ') + ' ▾' : '筛选条件 ▾';
  }

  // 单家公司是否通过筛选（各条件取交集）；依赖的评分/参考价/现价缺失时视为不满足自动排除。
  // 买点：现价 ≤ 买价×折扣%；卖点：现价须同时 ≥ 保守卖价与公允卖价（任一缺失即不满足）
  function passFilter(c) {
    if (!fltActive()) return true;
    var f = state.flt;
    var sc = state.scores[c.code] || null;
    if (f.fraudMax != null) {
      if (!sc || sc.fraud == null || sc.fraud > f.fraudMax) return false;
    }
    if (f.mgmtMin != null) {
      if (!sc || sc.mgmt == null || sc.mgmt < f.mgmtMin) return false;
    }
    var refs = sc ? sc.priceRefs : null;
    var cur = c.price;
    var disc = (f.discount != null && f.buys.length) ? f.discount / 100 : 1;
    var i, r;
    for (i = 0; i < f.buys.length; i++) {
      r = refs && refs[f.buys[i]] ? refs[f.buys[i]] : null;
      if (!r || r.buy == null || cur == null || cur > r.buy * disc) return false;
    }
    for (i = 0; i < f.sells.length; i++) {
      r = refs && refs[f.sells[i]] ? refs[f.sells[i]] : null;
      if (!r || cur == null || r.sellCons == null || r.sellFair == null ||
        cur < r.sellCons || cur < r.sellFair) return false;
    }
    return true;
  }

  // 关键词 + 筛选条件统一应用到当前列表所有行（宽表 tr 与移动端卡片共用 .stock-row），
  // 同步刷新“未找到匹配的公司”提示；评分渐进加载完成后也会重调本函数逐步放行满足的行
  function applyFilters() {
    var box = $('stock-list');
    if (!box) return;
    var q = (state.keyword || '').trim().toLowerCase();
    var byCode = {};
    state.companies.forEach(function (c) { byCode[c.code] = c; });
    var shown = 0;
    box.querySelectorAll('.stock-row').forEach(function (row) {
      var code = row.getAttribute('data-code');
      var kwHit = !q || (row.getAttribute('data-k') || '').indexOf(q) >= 0;
      var hit = kwHit && (!byCode[code] || passFilter(byCode[code]));
      row.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    var empty = $('stock-search-empty');
    if (empty) empty.style.display = shown ? 'none' : '';
  }

  /* ---------------- 列表评分预载与排序 ---------------- */

  // 排序按钮 HTML（当前选中标准高亮并显示升降箭头）
  function sortBtn(key, label) {
    var active = state.sortKey === key;
    return '<button data-sort="' + key + '"' + (active ? ' class="active"' : '') + '>' +
      label + (active ? (state.sortDir === 'desc' ? ' ↓' : ' ↑') : '') + '</button>';
  }

  // 排序项 → 展示名（折叠面板摘要用；含宽表表头入口的键）
  var SORT_LABELS = {
    'score-grahamAgg': '格·进取', 'score-grahamDef': '格·防御',
    'score-schloss': '施洛斯', 'score-buffett': '巴菲特',
    'buy-grahamAgg': '进取买', 'buy-grahamDef': '防御买',
    'buy-schloss': '施洛斯买', 'buy-buffett': '巴菲特买',
    'sellC-grahamAgg': '进取保卖', 'sellC-grahamDef': '防御保卖',
    'sellC-schloss': '施洛斯保卖', 'sellC-buffett': '巴菲特保卖',
    'sellF-grahamAgg': '进取公卖', 'sellF-grahamDef': '防御公卖',
    'sellF-schloss': '施洛斯公卖', 'sellF-buffett': '巴菲特公卖',
    'name': '名称', 'code': '代码', 'industry': '行业', 'price': '现价', 'liq': '清算价值',
    'netcash': '净现金/市值', 'fraud': '造假风险', 'mgmt': '管理水平', 'cycle': '周期位置'
  };

  // 移动端排序面板触发按钮文案：展开态“收起”，收起态显示当前排序摘要（无则提示选择）
  function sortToggleLabel() {
    if (state.sortOpen) return '收起排序 ▲';
    var label = SORT_LABELS[state.sortKey];
    return label ? '排序：' + label + (state.sortDir === 'desc' ? ' ↓' : ' ↑') + ' ▾' : '选择排序方式 ▾';
  }

  // 表头排序单元格 HTML（可点击；激活列高亮并显示箭头；cls 追加样式如 stick，attrs 追加属性如 rowspan；
  // hint 用于替换排序语义说明，如买入/卖出列按性价比排）
  function thSort(key, label, cls, attrs, hint) {
    // 合并参考格内点卖出小字按 sellC-/sellF- 排序时，归一到 buy- 键，高亮仍落在该流派列头
    var normKey = (state.sortKey || '').replace(/^sell[CcFf]-/, 'buy-');
    var active = key === normKey;
    var title = hint
      ? '点击按' + label + '排序（' + hint + '），再点切换升/降序'
      : '点击按' + label + '排序，再点切换升/降序';
    return '<th' + (attrs || '') + ' data-sort="' + key + '" class="th-sort' +
      (active ? ' active' : '') + (cls ? ' ' + cls : '') + '" title="' + title + '">' + label +
      (active ? (state.sortDir === 'desc' ? ' ↓' : ' ↑') : '') + '</th>';
  }

  // 统一排序入口：首次点击数值列降序（高分/高价在前）、文本列升序；再点同列切换升/降
  function applySort(key) {
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortKey = key;
      state.sortDir = (key === 'name' || key === 'code' || key === 'industry') ? 'asc' : 'desc';
    }
    renderList();
  }

  // 取公司排序值：基础列直接读字段；评分/价格参考从预计算 scores（缺则 null 排最后）
  function sortVal(c, key) {
    if (key === 'name' || key === 'code' || key === 'industry') return c[key] || '';
    if (key === 'price') return c.price;
    if (key === 'liq') {
      var sc0 = state.scores[c.code];
      return sc0 && sc0.priceRefs ? sc0.priceRefs.fairLiq : null;
    }
    if (key === 'netcash') {
      var scN = state.scores[c.code];
      return scN && scN.priceRefs ? scN.priceRefs.netCashRatio : null;
    }
    if (key === 'fraud') {
      var scF = state.scores[c.code];
      return scF && scF.fraud != null ? scF.fraud : null;
    }
    if (key === 'mgmt') {
      var scM = state.scores[c.code];
      return scM && scM.mgmt != null ? scM.mgmt : null;
    }
    if (key === 'cycle') {
      var scC = state.scores[c.code];
      return scC && scC.cycle != null ? scC.cycle : null;  // 非周期性公司为 null 排最后
    }
    var sc = state.scores[c.code];
    if (!sc) return null;
    if (key.indexOf('score-') === 0) return sc[key.slice(6)];
    var refs = sc.priceRefs;
    if (!refs) return null;
    var k = key.slice(key.indexOf('-') + 1);
    var r = refs[k];
    if (!r) return null;
    if (key.indexOf('buy-') === 0) return ratio(r.buy, c.price);
    if (key.indexOf('sellC-') === 0) return ratio(r.sellCons, c.price);
    if (key.indexOf('sellF-') === 0) return ratio(r.sellFair, c.price);
    return null;
  }

  // 性价比 = 参考价 ÷ 现价（倍数）：越大说明相对现价的空间/折价越足；任一缺失返回 null
  function ratio(a, b) {
    return (a == null || b == null || b === 0) ? null : a / b;
  }

  // 按当前排序标准返回公司列表（无排序时保持原顺序；缺值排最后）
  function sortCompanies() {
    var key = state.sortKey;
    if (!key) return state.companies.slice();
    return state.companies.slice().sort(function (a, b) {
      var sa = sortVal(a, key);
      var sb = sortVal(b, key);
      if (sa == null && sb == null) return 0;
      if (sa == null) return 1;
      if (sb == null) return -1;
      var r;
      if (typeof sa === 'number' && typeof sb === 'number') r = sa - sb;
      else r = String(sa).localeCompare(String(sb), 'zh-Hans-CN');
      return state.sortDir === 'asc' ? r : -r;
    });
  }

  // 并行预载全部公司详细数据并计算四大评分（渐进填充；数据缓存供详情页复用）
  function fetchScores() {
    state.scoresLoaded = true;
    state.companies.forEach(function (c) {
      fetch(DATA_BASE + 'companies/' + c.code + '.json')
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) {
          state.details[c.code] = d;
          try {
            var va = valueAnalysis(d);
            var v = valueScores(d, va);
            var fa = null;
            try { fa = fraudAnalysis(d); } catch (e) { /* 造假分缺失不影响评分 */ }
            var ma = null;
            try { ma = managementAnalysis(d); } catch (e) { /* 管理分缺失不影响评分 */ }
            var ca = null;
            try { ca = cycleAnalysis(d); } catch (e) { /* 周期分缺失不影响评分 */ }
            var cycTrend = null;
            if (ca && ca.total != null) {
              try { cycTrend = cycleTrendOf(cycleHistory(d)); } catch (e) { /* 趋势缺失不影响评分 */ }
            }
            state.scores[c.code] = {
              grahamAgg: v.grahamAgg.total, grahamDef: v.grahamDef.total,
              schloss: v.schloss.total, buffett: v.buffett.total,
              priceRefs: priceReferences(d, va),
              fraud: fa ? fa.total : null,
              mgmt: ma ? ma.total : null,
              cycle: ca ? ca.total : null,
              cyclical: ca ? ca.cyclical : null,
              cycleTrend: cycTrend
            };
          } catch (e) { /* 单家计算失败不影响其他公司 */ }
          fillRowScores(c.code);
        })
        .catch(function () { /* 单家加载失败跳过 */ });
    });
  }

  // 单行渐进补填评分与价格参考（不重建整个表格）
  function fillRowScores(code) {
    var row = document.querySelector('.stock-row[data-code="' + code + '"]');
    if (!row) return;
    var sc = state.scores[code] || null;
    var refs = sc ? sc.priceRefs : null;
    var cur = row.getAttribute('data-price');
    cur = cur === '' || cur == null ? null : Number(cur);
    row.querySelectorAll('[data-s]').forEach(function (td) {
      var m = td.getAttribute('data-s').split('-');
      var kind = m[0], k = m[1], p = null;
      if (kind === 'score') {
        p = sc ? sc[k] : null;
        td.className = 'c-num sc-' + gradeOf(p);
        td.title = gradeText(gradeOf(p));
      } else if (kind === 'liq') {
        // 公允清算价值：现价 ≤ 清算价（跌破清算价值）标绿；宽表 td 与移动端卡片 span 共用
        p = refs ? refs.fairLiq : null;
        var liqHit2 = p != null && cur != null && cur <= p;
        if (td.tagName === 'TD') {
          td.className = 'c-num' + (liqHit2 ? ' r-hit' : '');
        } else {
          var liqBox = td.closest('.sc-liq');
          if (liqBox) {
            liqBox.classList.toggle('sc-liq-hit', liqHit2);
            var liqTag = liqBox.querySelector('b');
            if (liqTag) liqTag.textContent = liqHit2 ? '跌破' : '';
          }
        }
      } else if (kind === 'netcash') {
        // 净现金/市值：分支内完成格式化不走通用 fmtNum；宽表 td 同步刷新代入公式提示，
        // 移动端 data-s 在卡片 div 上，只更新内部 span 文本避免覆盖结构
        p = refs ? refs.netCashRatio : null;
        var ncrTxt = p == null ? '-' : (p * 100).toFixed(1) + '%';
        if (td.tagName === 'TD') {
          var ncrF = netCashFormula(refs);
          td.innerHTML = ncrTxt;
          td.setAttribute('title', ncrF || '净现金/市值：(类现金加权−负债合计)/总市值');
        } else {
          var ncrSp = td.querySelector('span');
          if (ncrSp) ncrSp.textContent = ncrTxt;
        }
        return;
      } else if (kind === 'fraud') {
        // 造假风险：PC 宽表 td 重设等级色；移动端 .sc-fraud 徽标保留结构类只换等级色与数值
        p = sc ? sc.fraud : null;
        var fg = fraudGradeOf(p);
        if (td.tagName === 'TD') {
          td.className = 'c-num sc-' + fg;
          td.innerHTML = p == null ? '-' : fmtNum(p);
        } else {
          td.classList.remove('sc-good', 'sc-mid', 'sc-low', 'sc-bad', 'sc-na');
          td.classList.add('sc-' + fg);
          var fb = td.querySelector('b');
          if (fb) fb.textContent = p == null ? '-' : fmtNum(p);
        }
        return;
      } else if (kind === 'mgmt') {
        // 管理水平：方向与价值评分同向（越高越好），复用等级色；移动端徽标同造假分处理
        p = sc ? sc.mgmt : null;
        var mg = gradeOf(p);
        if (td.tagName === 'TD') {
          td.className = 'c-num sc-' + mg;
          td.innerHTML = p == null ? '-' : fmtNum(p);
        } else {
          td.classList.remove('sc-good', 'sc-mid', 'sc-low', 'sc-bad', 'sc-na');
          td.classList.add('sc-' + mg);
          var mb = td.querySelector('b');
          if (mb) mb.textContent = p == null ? '-' : fmtNum(p);
        }
        return;
      } else if (kind === 'cycle') {
        // 周期位置：低分=接近底部=机会=绿（同造假分方向）；非周期性显示“非周期”灰；
        // 宽表 td 重建“分数+趋势图标”结构；移动端徽标保持结构只换等级色/数值/图标（避免破坏卡片布局）
        p = sc ? sc.cycle : null;
        var ct = sc ? sc.cycleTrend : null;
        var nonCyc = sc && sc.cyclical === false;
        var cg = nonCyc ? 'na' : fraudGradeOf(p);
        if (td.tagName === 'TD') {
          td.className = 'c-num sc-' + cg;
          if (nonCyc) {
            td.innerHTML = '非周期';
            td.setAttribute('title', '非周期性/弱周期行业（周期强度 < 40），不适用周期位置评分');
          } else {
            td.innerHTML = (p == null ? '-' : fmtNum(p)) + cycleTrendIcon(ct);
            td.setAttribute('title', (ct ? cycleTrendText(ct) + '（最新年分数相对上一年）；' : '') +
              '周期位置 ' + (p == null ? '-' : fmtNum(p)) + ' 分（0-100，越低越接近周期底部）');
          }
        } else {
          td.classList.remove('sc-good', 'sc-mid', 'sc-low', 'sc-bad', 'sc-na');
          td.classList.add('sc-' + cg);
          var cb = td.querySelector('b');
          if (cb) cb.textContent = nonCyc ? '非周期' : (p == null ? '-' : fmtNum(p));
          var oldI = td.querySelector('i.cy-t');
          if (oldI) oldI.parentNode.removeChild(oldI);
          if (!nonCyc && ct) td.insertAdjacentHTML('beforeend', cycleTrendIcon(ct));
        }
        return;
      } else {
        if (refs && refs[k]) p = refs[k][kind === 'buy' ? 'buy' : kind === 'sellC' ? 'sellCons' : 'sellFair'];
        var hit = '';
        if (p != null && cur != null) {
          if (kind === 'buy' && cur <= p) hit = ' r-hit';
          if (kind !== 'buy' && cur >= p) hit = ' r-hit-s';
        }
        if (kind === 'buy') {
          // 合并参考格：绿标只落在买入价上，不污染卖价小字；宽表 td 重建三档结构，
          // 移动端 sc-ref 块保留原结构仅刷三个价位的类与文本（避免降级路径破坏卡片布局）
          var r = refs && refs[k] ? refs[k] : null;
          var b = r ? r.buy : null;
          var pc = r ? r.sellCons : null;
          var pf = r ? r.sellFair : null;
          var hb = b != null && cur != null && cur <= b ? ' r-hit' : '';
          var hc = pc != null && cur != null && cur >= pc;
          var hf = pf != null && cur != null && cur >= pf;
          if (td.tagName === 'TD') {
            td.className = 'c-num c-ref';
            td.innerHTML = '<span class="rf-buy' + hb + '">' + (b == null ? '-' : fmtNum(b)) + '</span>' +
              '<span class="rf-sell">' +
              '<span class="sl-c' + (hc ? ' r-hit-s' : '') + '" data-s="sellC-' + k + '" data-sort="sellC-' + k + '" title="保守卖出参考，点击按保守价排序">' + (pc == null ? '-' : fmtNum(pc)) + '</span>' +
              '<span class="sl-f' + (hf ? ' r-hit-s' : '') + '" data-s="sellF-' + k + '" data-sort="sellF-' + k + '" title="公允卖出参考，点击按公允价排序">' + (pf == null ? '' : fmtNum(pf)) + '</span>' +
              '</span>';
          } else {
            var ms = td.querySelectorAll('span');
            if (ms.length >= 3) {
              ms[0].className = 'r-buy' + hb;
              ms[0].textContent = '买 ' + (b == null ? '-' : fmtNum(b));
              ms[1].className = 'r-sell' + (hc ? ' r-hit-s' : '');
              ms[1].textContent = '保卖 ' + (pc == null ? '-' : fmtNum(pc));
              ms[2].className = 'r-sell' + (hf ? ' r-hit-s' : '');
              ms[2].textContent = '公卖 ' + (pf == null ? '-' : fmtNum(pf));
            }
          }
          return;
        }
        // 降级路径单次命中 sellC/sellF span（buy 分支已重建整格，此处仅兜底刷色）：
        // 只切换命中类，保留 sl-c/sl-f 结构类
        td.classList.remove('r-hit', 'r-hit-s');
        if (hit) td.classList.add(hit.trim());
        td.innerHTML = p == null ? (td.classList.contains('sl-f') ? '' : '-') : fmtNum(p);
      }
    });
    // 评分补填完成后重新应用筛选：满足条件的行逐步放行，依赖缺失的行保持隐藏（仅在筛选已启用时才有实际开销）
    if (fltActive()) applyFilters();
  }

  function fetchIndex() {
    show('stock-loading');
    // 加时间戳避免浏览器缓存旧列表（数据由 Actions 定期更新）
    fetch(DATA_BASE + 'index.json?t=' + Date.now())
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        state.companies = data.companies || [];
        state.indexUpdatedAt = data.updated_at;
        // 后端已预计算评分（scoring.py），直接使用免去逐家下载全量数据（卡顿优化）；
        // 旧 index.json 缺 scores 时视为未加载，走 fetchScores() 降级路径
        var have = 0, total = state.companies.length;
        state.companies.forEach(function (c) {
          if (c.scores) { state.scores[c.code] = c.scores; have++; }
        });
        state.scoresLoaded = total > 0 && have === total;
        showList();
      })
      .catch(function () { fail('公司列表加载失败，请稍后刷新重试'); });
  }

  /* ---------------- 公司详情 ---------------- */

  function showDetail(code) {
    // 列表页已预载过该公司数据（评分预载），直接复用免重复下载
    if (state.details[code]) { renderDetail(state.details[code]); return; }
    show('stock-loading');
    fetch(DATA_BASE + 'companies/' + code + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) {
        state.details[code] = d;
        renderDetail(d);
      })
      .catch(function () { fail('公司数据加载失败：' + code); });
  }

  function renderDetail(d) {
    state.current = d;
    // 详情页 DOM 重建前释放旧图表实例
    state.charts.forEach(function (c) { try { c.dispose(); } catch (e) {} });
    state.charts = [];
    show('stock-detail');
    var s = d.snapshot || {};
    var chg = s.change_pct;

    var html = '';

    // 头部（市场徽标 + 货币单位：US→USD / HK→HKD / A→CNY）
    var marketName = d.market === 'US' ? '美股' : d.market === 'HK' ? '港股' : 'A股';
    var ccy = d.market === 'US' ? 'USD' : d.market === 'HK' ? 'HKD' : 'CNY';
    html += '<div class="stock-header">' +
      '<h2>' + d.name + '</h2>' +
      '<span class="s-badge s-badge-' + (d.market || 'A') + '">' + marketName + '</span>' +
      '<span class="s-code">' + d.code + '</span>' +
      '<span class="s-price ' + cls(chg) + '">' + fmtNum(s.price) + '</span>' +
      '<span class="s-ccy">' + ccy + '</span>' +
      '<span class="s-meta ' + cls(chg) + '">' +
      (chg == null ? '-' : (chg > 0 ? '+' : '') + (chg * 100).toFixed(2) + '%') + '</span>' +
      '<span class="s-meta">更新于 ' + fmtDate(s.time || d.updated_at) + '</span>' +
      '</div>';

    // 五大模块锚点导航（点击平滑滚动，避免与 #/code 路由冲突）
    html += '<nav class="va-nav" aria-label="详情模块导航">' +
      '<a href="#sec-basic" data-scroll="sec-basic">① 基础财务信息</a>' +
      '<a href="#sec-value" data-scroll="sec-value">② 通用价值标准</a>' +
      '<a href="#sec-graham" data-scroll="sec-graham">③ 格雷厄姆烟蒂</a>' +
      '<a href="#sec-schloss" data-scroll="sec-schloss">④ 施洛斯烟蒂</a>' +
      '<a href="#sec-buffett" data-scroll="sec-buffett">⑤ 巴菲特芒格</a>' +
      '<a href="#sec-fraud" data-scroll="sec-fraud">⑥ 造假风险</a>' +
      '<a href="#sec-mgmt" data-scroll="sec-mgmt">⑦ 管理水平</a>' +
      '<a href="#sec-cycle" data-scroll="sec-cycle">⑧ 周期位置</a>' +
      '</nav>';

    // ---- 模块一：基础财务信息（估值快照/趋势图/财务对比/报表/分红/定期报告）----
    html += '<section id="sec-basic" class="stock-section va-module"><h2 class="va-module-title"><span>①</span>基础财务信息</h2>';

    // 估值快照
    var recDivs = recentDividends(d);
    var va = valueAnalysis(d); // 价值分析计算（股息/现金流/杜邦/成长/体检）
    var sc = valueScores(d, va); // 三大流派评分（格雷厄姆/施洛斯/巴菲特）
    sc.d = d;
    // 价格参考单独挂载（二分循环调用 valueScores，绝不可放进 valueScores 内部防递归）
    sc.priceRefs = priceReferences(d, va);
    var divBox = '<div class="kv kv-div"><div class="k">近一年分红</div><div class="v">' + recDivs.length + ' 条</div>' +
      '<div class="div-list">' + (recDivs.length
        ? recDivs.map(function (r) {
          return '<span class="div-item">' + (r.year ? r.year + ' ' : '') + (r.description || '') + '</span>';
        }).join('')
        : '<span class="div-item">暂无</span>') +
      '</div></div>';
    html += '<div class="stock-section"><div class="stock-snapshot">' +
      kv('市盈率(TTM)', fmtNum(s.pe_ttm)) +
      kv('市净率', fmtNum(s.pb)) +
      kv('总市值', fmtMoney(s.market_cap)) +
      kv('流通市值', fmtMoney(s.float_market_cap)) +
      kv('公允清算价值', '<span title="(流动资产合计-负债合计)/财报股本，格雷厄姆清算口径，随财报更新">' +
        (sc.priceRefs && sc.priceRefs.fairLiq != null ? fmtNum(sc.priceRefs.fairLiq) : '-') + '</span>') +
      kv('当前股息率', fmtPct(va.divYield)) +
      divBox +
      '</div></div>';

    // （价值分析五大区块：价值体检/股东回报/现金流质量/杜邦分析/成长性已移至模块二）

    // 指标趋势图（按指标分 3 个独立图表；支持季/年视图切换）
    var indCount = (d.indicators || []).length;
    html += '<div class="stock-section"><div class="stock-section-head">' +
      '<h3 id="stock-chart-title">关键指标趋势（近 ' + indCount + ' 期）</h3>' +
      '<div class="stock-view-toggle">' +
      '<button data-view="quarter">季</button>' +
      '<button data-view="year" class="active">年</button>' +
      '</div></div>' +
      '<div class="stock-chart-block"><h4 id="stock-chart-revenue-title">营业总收入 & 净利润（单季，亿元）</h4><div class="stock-chart" id="stock-chart-revenue"></div></div>' +
      '<div class="stock-chart-block"><h4 id="stock-chart-margin-title">销售毛利率 & 销售净利率（报告期口径）</h4><div class="stock-chart" id="stock-chart-margin"></div></div>' +
      '<div class="stock-chart-block"><h4 id="stock-chart-roe-title">净资产收益率（各期累计）</h4><div class="stock-chart" id="stock-chart-roe"></div></div>' +
      '<p class="stock-chart-note" id="stock-chart-note">季度口径：单季值 = 本期累计 - 上期累计（一季报为当季值）；ROE 为报告期累计值</p></div>';

    // 财务对比（年报/季报，任意两个报告期可对比）
    html += '<div class="stock-section"><div class="stock-section-head">' +
      '<h3>财务对比</h3>' +
      '<div class="stock-compare-pick">' +
      '<select id="stock-compare-a"></select>' +
      '<span>对比</span>' +
      '<select id="stock-compare-b"></select>' +
      '</div></div>' +
      '<div class="stock-compare-wrap"><table class="stock-compare" id="stock-compare-body"></table></div></div>';

    // 三大报表（金额单位随市场：A/港股人民币元，美股美元）
    html += '<div class="stock-section"><h3>财务报表' +
      '<span class="s-ccy-note">（金额单位：' + (d.market === 'US' ? '美元' : '人民币元') + '）</span></h3>' +
      '<div class="stock-tabs">' +
      sheetTab('income', '利润表') + sheetTab('balance', '资产负债表') + sheetTab('cashflow', '现金流量表') +
      '<select id="stock-period"></select></div>' +
      '<table class="stock-table" id="stock-sheet-body"></table></div>';

    // 分红历史（全量；移动端默认前 5 条，其余折叠）
    var divs = d.dividends || [];
    var foldDivs = mqMobile.matches && !state.detailExpanded;
    html += '<div class="stock-section"><h3>分红历史（' + divs.length + ' 条）</h3>';
    divs.forEach(function (r, i) {
      var desc = r.description || '';
      var extra = '';
      if (r.pay_date) extra += '派息日 ' + fmtDate(r.pay_date);
      html += '<div class="stock-list-item' + (foldDivs && i >= 5 ? ' d-more' : '') + '">' +
        '<span class="d-year">' + (r.year || '-') + '</span>' +
        '<span class="stock-badge">' + (r.type || '') + '</span>' +
        '<span class="d-desc">' + desc + '</span>' +
        (extra ? '<span class="d-date">' + extra + '</span>' : '') +
        '</div>';
    });
    if (foldDivs && divs.length > 5) {
      html += '<button type="button" class="d-more-btn" id="stock-divs-more">展开全部 ' + divs.length + ' 条</button>';
    }
    html += '</div>';

    // 定期报告（移动端默认前 5 份，其余折叠）
    var reports = d.reports || [];
    var foldReps = mqMobile.matches && !state.detailExpanded;
    html += '<div class="stock-section"><h3>定期报告（' + reports.length + ' 份）</h3>';
    reports.forEach(function (r, i) {
      var audit = '';
      // 审计信息：年报/半年报附事务所与意见类型（季报不审计，无该字段）
      if (r.audit_firm || r.audit_opinion) {
        audit = '<span class="d-audit">审计：' + (r.audit_firm || '—') +
          (r.audit_opinion ? ' · ' + r.audit_opinion : '') + '</span>';
      }
      html += '<div class="stock-list-item' + (foldReps && i >= 5 ? ' d-more' : '') + '">' +
        '<span class="stock-badge">' + r.category + '</span>' +
        '<span class="d-year">' + r.title + '</span>' +
        '<span class="d-date">' + fmtDate(r.date) + '</span>' +
        audit +
        '<a href="' + r.pdf_url + '" target="_blank" rel="noopener">PDF 原文</a>' +
        '<a href="' + r.detail_url + '" target="_blank" rel="noopener">详情</a>' +
        '</div>';
    });
    if (foldReps && reports.length > 5) {
      html += '<button type="button" class="d-more-btn" id="stock-reports-more">展开全部 ' + reports.length + ' 份</button>';
    }
    html += '</div>';
    html += '</section>'; // 模块一结束

    // ---- 模块二：通用价值标准（体检/股东回报/现金流/杜邦/成长）----
    html += '<section id="sec-value" class="stock-section va-module"><h2 class="va-module-title"><span>②</span>通用价值标准</h2>';

    // 价值体检清单（Pass/Fail 一眼定位风险点）
    html += '<div class="stock-section"><h3>价值体检</h3>' +
      '<div class="stock-compare-wrap"><table class="stock-compare va-health"><tbody id="stock-health-body"></tbody></table>' +
      '<p class="stock-chart-note">' + va.checkSummary + '</p></div></div>';

    // 股东回报：股息率/分红率/连续分红/累计派息 + 每股分红趋势
    html += '<div class="stock-section"><div class="stock-section-head">' +
      '<h3>股东回报</h3></div>' +
      '<div class="stock-snapshot va-snapshot">' +
      kv('股息率(近12月)', fmtPct(va.divYield)) +
      kv('10年国债收益率', fmtPct(BOND_10Y)) +
      kv('股债利差', fmtPct(va.spread)) +
      kv('分红率(最新年报)', fmtPct(va.payout)) +
      kv('连续分红年数', va.divConsecutive ? va.divConsecutive + ' 年' : '-') +
      kv('累计每股派息', va.cumPerShare == null ? '-' : fmtNum(va.cumPerShare) + ' 元') +
      '</div>' +
      '<div class="stock-chart-block"><h4>近 ' + va.divChart.length + ' 年每股派息（元/股）</h4><div class="stock-chart" id="stock-chart-dividend"></div></div></div>';

    // 现金流质量：净现比/自由现金流/收现比
    html += '<div class="stock-section"><div class="stock-section-head"><h3>现金流质量</h3></div>' +
      '<div class="stock-snapshot va-snapshot">' +
      kv('5年累计净现比', va.ratio5 == null ? '-' : fmtNum(va.ratio5)) +
      kv('5年累计自由现金流', fmtMoney(va.fcf5)) +
      kv('近5年收现比均值', va.collectAvg == null ? '-' : fmtNum(va.collectAvg)) +
      '</div>' +
      '<div class="stock-compare-wrap"><table class="stock-compare"><thead><tr>' +
      '<th>年度</th><th>净利润(亿)</th><th>经营现金流(亿)</th><th>净现比</th><th>资本开支(亿)</th><th>自由现金流(亿)</th><th>收现比</th></tr></thead>' +
      '<tbody id="stock-cf-body"></tbody></table></div>' +
      '<div class="stock-chart-block"><h4>净现比（年报，>1 说明利润有真金白银支撑）</h4><div class="stock-chart" id="stock-chart-netcash"></div></div></div>';

    // 杜邦分析：ROE = 净利率 × 总资产周转率 × 权益乘数
    html += '<div class="stock-section"><h3>杜邦分析</h3>' +
      '<div class="stock-compare-wrap"><table class="stock-compare"><thead><tr>' +
      '<th>年度</th><th>净利率</th><th>总资产周转率</th><th>权益乘数</th><th>ROE(拆解)</th><th>ROE(披露)</th></tr></thead>' +
      '<tbody id="stock-dupont-body"></tbody></table></div>' +
      '<p class="stock-chart-note">ROE 拆解 = 净利率 × 总资产周转率 × 权益乘数（期末口径）；披露 ROE 为同花顺报告期口径，两者略有差异属正常。</p></div>';

    // 成长性 & 估值匹配
    html += '<div class="stock-section"><div class="stock-section-head"><h3>成长性与估值匹配</h3></div>' +
      '<div class="stock-snapshot va-snapshot">' +
      kv('营收 CAGR(5年)', fmtPct(va.revCagr5)) +
      kv('净利 CAGR(5年)', fmtPct(va.netCagr5)) +
      kv('营收 CAGR(3年)', fmtPct(va.revCagr3)) +
      kv('净利 CAGR(3年)', fmtPct(va.netCagr3)) +
      kv('PEG', va.pegText) +
      '</div>' +
      '<p class="stock-chart-note">CAGR 基于 ' + va.growthNote + '；PEG = PE(TTM) / 净利5年CAGR，&lt;1 低估、1~2 合理、&gt;2 偏贵。</p></div>';
    html += '</section>'; // 模块二结束

    // ---- 模块三：格雷厄姆烟蒂标准评判（进取型 + 防御型两张评分卡）----
    html += '<section id="sec-graham" class="stock-section va-module"><h2 class="va-module-title"><span>③</span>格雷厄姆烟蒂标准评判</h2>' +
      '<div class="score-grid">' +
      '<div class="score-card" id="stock-score-graham-agg"></div>' +
      '<div class="score-card" id="stock-score-graham-def"></div>' +
      '</div></section>';

    // ---- 模块四：施洛斯烟蒂标准评判 ----
    html += '<section id="sec-schloss" class="stock-section va-module"><h2 class="va-module-title"><span>④</span>施洛斯烟蒂标准评判</h2>' +
      '<div class="score-card" id="stock-score-schloss"></div></section>';

    // ---- 模块五：巴菲特芒格价值标准评判 ----
    html += '<section id="sec-buffett" class="stock-section va-module"><h2 class="va-module-title"><span>⑤</span>巴菲特芒格价值标准评判</h2>' +
      '<div class="score-card" id="stock-score-buffett"></div></section>';

    // ---- 模块六：财务报表造假可能性分析（量化红旗筛查，百分制越高风险越大）----
    html += '<section id="sec-fraud" class="stock-section va-module"><h2 class="va-module-title"><span>⑥</span>财务报表造假可能性分析</h2>' +
      '<div class="score-card" id="stock-score-fraud"></div></section>';

    // ---- 模块七：管理层管理水平评分（8 维百分制加权，越高越好）----
    html += '<section id="sec-mgmt" class="stock-section va-module"><h2 class="va-module-title"><span>⑦</span>管理层管理水平评分</h2>' +
      '<div class="score-card" id="stock-score-mgmt"></div></section>';

    // ---- 模块八：周期位置（周期性判定 + 底部概率，分数越低越接近底部，非周期不打分）----
    html += '<section id="sec-cycle" class="stock-section va-module"><h2 class="va-module-title"><span>⑧</span>周期位置 · 周期性行业判定</h2>' +
      '<div class="score-card" id="stock-score-cycle"></div>' +
      '<div class="stock-chart-block" id="stock-cycle-chart-block" style="display:none"><h4>历年财报周期位置评分趋势（分数越低越接近周期底部）</h4>' +
      '<div class="stock-chart" id="stock-chart-cycle"></div>' +
      '<p class="stock-chart-note">逐年回溯：以各年报年为窗口末尾取最近 8 年年报，按与当期相同的 8 维逻辑打分；单季环比逐年参与（历史年用该年自身单季营收环比，末年用最新单季环比），各年均为满 8 维、同口径可比。</p></div></section>';

    $('stock-detail-body').innerHTML = html;
    bindViewToggle();
    bindComparePicks();
    bindVaNav();
    renderCharts(d.indicators || []);
    renderCompare(d);
    initSheet(d);
    renderValueAnalysis(va);
    renderScores(sc);
    var fa = fraudAnalysis(d);
    var fraudEl = $('stock-score-fraud');
    if (fraudEl) fraudEl.innerHTML = fraudCard(fa);
    var ma = managementAnalysis(d);
    var mgmtEl = $('stock-score-mgmt');
    if (mgmtEl) mgmtEl.innerHTML = managementCard(ma);
    var ca = cycleAnalysis(d);
    var cycleEl = $('stock-score-cycle');
    if (cycleEl) cycleEl.innerHTML = cycleCard(ca);
    renderCycleChart(d, ca);
    bindMoreButtons();
  }

  // 移动端“展开全部”按钮：分红/定期报告各在其所属 section 内展开折叠项
  function bindMoreButtons() {
    var bind = function (id) {
      var btn = $(id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        state.detailExpanded = true;
        btn.parentNode.querySelectorAll('.d-more').forEach(function (el) { el.classList.remove('d-more'); });
        btn.parentNode.removeChild(btn);
      });
    };
    bind('stock-divs-more');
    bind('stock-reports-more');
  }

  /* ---------------- 价值分析：核心计算与渲染 ---------------- */

  // 汇总全部价值分析计算（股息/现金流/杜邦/成长/体检），renderDetail 与各 render 共用
  function valueAnalysis(d) {
    var ind = d.indicators || [];
    var annual = annualRows(ind); // 年报，升序
    var cfList = (d.cashflow || []).slice().sort(function (a, b) {
      return a['报告日'] < b['报告日'] ? -1 : 1;
    });
    var baList = (d.balance || []).slice().sort(function (a, b) {
      return a['报告日'] < b['报告日'] ? -1 : 1;
    });
    var divs = d.dividends || [];
    var s = d.snapshot || {};
    var price = s.price;
    var last = annual[annual.length - 1];
    var lastDate = last ? String(last['报告期']).slice(0, 10) : null;
    var lastYear = lastDate ? Number(lastDate.slice(0, 4)) : null;

    // ---- 股东回报 ----
    var perShare12m = null, hit12 = false;
    recentDividends(d).forEach(function (r) {
      if (r.bonus_per_10 != null) { perShare12m = (perShare12m || 0) + r.bonus_per_10; hit12 = true; }
    });
    perShare12m = hit12 ? perShare12m / 10 : null;
    var divYield = (price && perShare12m != null) ? perShare12m / price : null;
    var perShareY = lastYear != null ? perShareDiv(divs, lastYear) : null;
    var epsY = last ? last['基本每股收益'] : null;
    var payout = (perShareY != null && epsY != null && epsY > 0) ? perShareY / epsY : null;
    var divConsecutive = consecutiveDivYears(divs);
    var cumPerShare = null, hitCum = false;
    divs.forEach(function (r) {
      if (r.bonus_per_10 != null) { cumPerShare = (cumPerShare || 0) + r.bonus_per_10; hitCum = true; }
    });
    cumPerShare = hitCum ? cumPerShare / 10 : null;

    // ---- 现金流质量（近 5 年年报）----
    var cfRows = [];
    for (var i = Math.max(0, annual.length - 5); i < annual.length; i++) {
      var date = String(annual[i]['报告期']).slice(0, 10);
      var c = sheetRowByDate(cfList, date);
      var net = annual[i]['净利润'];
      var revenue = annual[i]['营业总收入'];
      var ocf = c ? c['经营活动产生的现金流量净额'] : null;
      var capex = c ? c['购建固定资产、无形资产和其他长期资产所支付的现金'] : null;
      // 数据源偶发脏值（如个别年份数值异常大）：资本开支不可能超过营收 1.5 倍，超限置空
      if (capex != null && (capex < 0 || (revenue != null && capex > revenue * 1.5))) capex = null;
      var receive = c ? c['销售商品、提供劳务收到的现金'] : null;
      cfRows.push({
        year: date.slice(0, 4),
        net: net,
        ocf: ocf,
        ratio: (net != null && ocf != null && net > 0) ? ocf / net : null,
        capex: capex,
        fcf: (ocf != null && capex != null) ? ocf - capex : null,
        receive: receive,
        revenue: revenue,
        collect: (receive != null && revenue != null && revenue > 0) ? receive / revenue : null
      });
    }
    var sumNet = sum(cfRows.map(function (r) { return r.net; }));
    var sumOcf = sum(cfRows.map(function (r) { return r.ocf; }));
    var ratio5 = (sumNet != null && sumOcf != null && sumNet > 0) ? sumOcf / sumNet : null;
    var fcf5 = sum(cfRows.map(function (r) { return r.fcf; }));
    var collects = cfRows.map(function (r) { return r.collect; }).filter(function (v) { return v != null; });
    var collectAvg = collects.length ? sum(collects) / collects.length : null;

    // ---- 杜邦分析（近 5 年年报）----
    var dupont = [];
    for (var j = Math.max(0, annual.length - 5); j < annual.length; j++) {
      var dDate = String(annual[j]['报告期']).slice(0, 10);
      var b = sheetRowByDate(baList, dDate);
      var bPrev = j > 0 ? sheetRowByDate(baList, String(annual[j - 1]['报告期']).slice(0, 10)) : null;
      var rev = annual[j]['营业总收入'];
      var net2 = annual[j]['净利润'];
      var assets = b ? b['资产总计'] : null;
      var assetsPrev = bPrev ? bPrev['资产总计'] : null;
      var assetsAvg = (assets != null && assetsPrev != null) ? (assets + assetsPrev) / 2 : assets;
      var equity = b ? (b['归属于母公司股东权益合计'] != null ? b['归属于母公司股东权益合计'] : b['所有者权益(或股东权益)合计']) : null;
      var margin = (rev != null && net2 != null && rev > 0) ? net2 / rev : null;
      var turnover = (rev != null && assetsAvg != null && assetsAvg > 0) ? rev / assetsAvg : null;
      var leverage = (assets != null && equity != null && equity > 0) ? assets / equity : null;
      dupont.push({
        year: dDate.slice(0, 4),
        margin: margin,
        turnover: turnover,
        leverage: leverage,
        roe: (margin != null && turnover != null && leverage != null) ? margin * turnover * leverage : null,
        roeReported: annual[j]['净资产收益率']
      });
    }

    // ---- 成长性 & PEG ----
    var revCagr5 = null, netCagr5 = null, revCagr3 = null, netCagr3 = null, growthNote = '年报数据';
    if (annual.length >= 2) {
      var first = annual[0];
      var span = lastYear - Number(String(first['报告期']).slice(0, 4));
      if (span > 0) {
        revCagr5 = cagr(last['营业总收入'], first['营业总收入'], span);
        netCagr5 = cagr(last['净利润'], first['净利润'], span);
        growthNote = '最新年报(' + lastYear + ') vs ' + String(first['报告期']).slice(0, 4) + '，跨度 ' + span + ' 年';
        var a3 = null;
        if (lastYear != null) {
          for (var k = 0; k < annual.length; k++) {
            if (Number(String(annual[k]['报告期']).slice(0, 4)) === lastYear - 3) { a3 = annual[k]; break; }
          }
        }
        if (a3) {
          revCagr3 = cagr(last['营业总收入'], a3['营业总收入'], 3);
          netCagr3 = cagr(last['净利润'], a3['净利润'], 3);
        }
      }
    }
    var peg = (s.pe_ttm != null && netCagr5 != null && netCagr5 > 0) ? s.pe_ttm / (netCagr5 * 100) : null;
    var pegText = peg == null
      ? (netCagr5 != null && netCagr5 <= 0 ? 'N/A(净利负增长)' : '-')
      : (peg < 1 ? fmtNum(peg) + ' 低估' : peg <= 2 ? fmtNum(peg) + ' 合理' : fmtNum(peg) + ' 偏贵');

    // ---- 价值体检清单 ----
    var roe3 = null;
    var roeVals = dupont.map(function (r) { return r.roeReported; }).filter(function (v) { return v != null; });
    if (roeVals.length) roe3 = sum(roeVals.slice(-3)) / Math.min(3, roeVals.length);
    var lastBa = lastDate ? sheetRowByDate(baList, lastDate) : null;
    var cash = lastBa ? lastBa['货币资金'] : null;
    var debt = lastBa ? [lastBa['短期借款'], lastBa['一年内到期的非流动负债'], lastBa['长期借款'], lastBa['应付债券'], lastBa['租赁负债']] : [];
    var netCash = (cash != null && sum(debt) != null) ? cash - sum(debt) : null;
    var lastLb = last ? last['资产负债率'] : null;
    var lastCr = last ? last['流动比率'] : null;
    var lastMargin = last ? last['销售净利率'] : null;

    function check(label, std, valText, pass) {
      var st = pass === null ? 'na' : (pass ? 'pass' : 'fail');
      return { label: label, std: std, val: valText, pass: st };
    }
    var checks = [
      check('净资产收益率(近3年平均)', '≥ 15%', fmtPct(roe3), roe3 == null ? null : roe3 >= 0.15),
      check('销售净利率(最新年报)', '≥ 10%', fmtPct(lastMargin), lastMargin == null ? null : lastMargin >= 0.10),
      check('资产负债率(最新年报)', '< 60%', fmtPct(lastLb), lastLb == null ? null : lastLb < 0.60),
      check('流动比率(最新年报)', '≥ 1.5', fmtNum(lastCr), lastCr == null ? null : lastCr >= 1.5),
      check('5年累计净现比', '≥ 0.8', fmtNum(ratio5), ratio5 == null ? null : ratio5 >= 0.8),
      check('连续分红年数', '≥ 5 年', (divConsecutive || 0) + ' 年', divConsecutive >= 5),
      check('股息率(近12月)', '≥ 2%', fmtPct(divYield), divYield == null ? null : divYield >= 0.02),
      check('净利5年正增长', 'CAGR > 0', fmtPct(netCagr5), netCagr5 == null ? null : netCagr5 > 0),
      check('净现金(货币资金-有息负债)', '> 0', fmtMoney(netCash), netCash == null ? null : netCash > 0),
      check('5年累计自由现金流', '> 0', fmtMoney(fcf5), fcf5 == null ? null : fcf5 > 0)
    ];
    var passN = checks.filter(function (c) { return c.pass === 'pass'; }).length;
    var failN = checks.filter(function (c) { return c.pass === 'fail'; }).length;
    var checkSummary = '体检结果：通过 ' + passN + ' 项，未通过 ' + failN + ' 项，其余数据缺失。仅作量化参考，不构成投资建议。';

    // 每股派息图数据（近 6 年，含最新年报）
    var divChart = [];
    if (lastYear != null) {
      for (var y = lastYear; y > lastYear - 6 && y > 2000; y--) {
        var v = perShareDiv(divs, y);
        if (v != null) divChart.unshift({ year: y, value: v });
      }
    }

    return {
      divYield: divYield, spread: (divYield != null) ? divYield - BOND_10Y : null,
      payout: payout, divConsecutive: divConsecutive, cumPerShare: cumPerShare,
      cfRows: cfRows, ratio5: ratio5, fcf5: fcf5, collectAvg: collectAvg,
      dupont: dupont, revCagr5: revCagr5, netCagr5: netCagr5,
      revCagr3: revCagr3, netCagr3: netCagr3, pegText: pegText, growthNote: growthNote,
      checks: checks, checkSummary: checkSummary, divChart: divChart
    };
  }

  // 渲染价值分析各区块（体检表 + 现金流表 + 杜邦表 + 2 张图）
  function renderValueAnalysis(va) {
    renderHealth(va);
    renderCfTable(va);
    renderDuPont(va);
    renderVaCharts(va);
  }

  function renderHealth(va) {
    var body = $('stock-health-body');
    if (!body) return;
    var html = va.checks.map(function (c) {
      var badge = c.pass === 'pass' ? '<span class="va-badge va-pass">通过</span>'
        : c.pass === 'fail' ? '<span class="va-badge va-fail">未通过</span>'
        : '<span class="va-badge va-na">数据不足</span>';
      return '<tr><td class="k">' + c.label + '</td><td class="v">' + c.val + '</td>' +
        '<td class="v">' + c.std + '</td><td class="v">' + badge + '</td></tr>';
    }).join('');
    body.innerHTML = html;
  }

  function renderCfTable(va) {
    var body = $('stock-cf-body');
    if (!body) return;
    body.innerHTML = va.cfRows.map(function (r) {
      return '<tr><td>' + r.year + '</td>' +
        '<td>' + fmtMoney(r.net) + '</td>' +
        '<td>' + fmtMoney(r.ocf) + '</td>' +
        '<td>' + fmtNum(r.ratio) + '</td>' +
        '<td>' + fmtMoney(r.capex) + '</td>' +
        '<td>' + fmtMoney(r.fcf) + '</td>' +
        '<td>' + fmtNum(r.collect) + '</td></tr>';
    }).join('');
  }

  function renderDuPont(va) {
    var body = $('stock-dupont-body');
    if (!body) return;
    body.innerHTML = va.dupont.map(function (r) {
      return '<tr><td>' + r.year + '</td>' +
        '<td>' + fmtPct(r.margin) + '</td>' +
        '<td>' + fmtNum(r.turnover) + '</td>' +
        '<td>' + fmtNum(r.leverage) + '</td>' +
        '<td>' + fmtPct(r.roe) + '</td>' +
        '<td>' + fmtPct(r.roeReported) + '</td></tr>';
    }).join('');
  }

  /* ---------------- 三大流派价值评分（满分 100，基准=最新年报 + 最新市值） ---------------- */

  // 线性得分：v ≤ a 取 ma；v ≥ b 取 mb；中间线性
  function lerpScore(v, a, b, ma, mb) {
    if (v == null || isNaN(v)) return null;
    if (v <= a) return ma;
    if (v >= b) return mb;
    return ma + (v - a) / (b - a) * (mb - ma);
  }

  // 总分 → 等级（优秀/良好/一般/较差/数据不足）
  function gradeOf(total) {
    if (total == null) return 'na';
    if (total >= 80) return 'good';
    if (total >= 60) return 'mid';
    if (total >= 40) return 'low';
    return 'bad';
  }

  function gradeText(g) {
    return { good: '优秀', mid: '良好', low: '一般', bad: '较差', na: '数据不足' }[g];
  }

  // 造假风险等级（分数越高越可疑，与价值评分方向相反）：<20 低 / <40 中 / <60 较高 / ≥60 高
  function fraudGradeOf(total) {
    if (total == null) return 'na';
    if (total < 20) return 'good';
    if (total < 40) return 'mid';
    if (total < 60) return 'low';
    return 'bad';
  }

  function fraudGradeText(g) {
    return { good: '低', mid: '中', low: '较高', bad: '高', na: '数据不足' }[g];
  }

  // 评分项构造：match = 符合度（score/max，用于百分比与颜色；负分按 0% 显示）
  function it(std, val, thr, max, score) {
    return { std: std, val: val, thr: thr, max: max, score: score, match: score == null ? null : Math.max(0, score) / max };
  }

  // 价格标签：买入价≤现价（进入买入区）标绿；卖出价≥现价（进入卖出区）标红
  function _priceTag(label, p, curPrice, kind, tip) {
    var cls = '';
    if (p != null && curPrice != null) {
      if (kind === 'buy' && curPrice <= p) cls = ' sp-hit';
      if (kind === 'sell' && curPrice >= p) cls = ' sp-hit';
    }
    return '<span class="sp' + cls + '" title="' + tip + '"><i>' + label + '</i><b>' +
      (p == null ? '-' : fmtNum(p)) + '</b></span>';
  }

  // 评分卡 HTML：标题 + 总分圆徽 + 价格参考行 + 标准明细表（标准/当前值/参考阈值/符合度/得分）+ 备注
  function scoreCard(title, basis, total, items, note, priceRefs, curPrice) {
    var g = gradeOf(total);
    var rows = items.map(function (x) {
      var mCls = x.match == null ? 'sc-na' : x.match >= 0.99 ? 'sc-good' : x.match >= 0.5 ? 'sc-mid' : 'sc-low';
      var mTxt = x.match == null ? '-' : (x.match * 100).toFixed(0) + '%';
      return '<tr><td>' + x.std + '</td><td class="v">' + x.val + '</td><td class="v">' + x.thr + '</td>' +
        '<td class="v ' + mCls + '">' + mTxt + '</td>' +
        '<td class="v"><b>' + (x.score == null ? '-' : fmtNum(x.score)) + '</b> / ' + x.max + '</td></tr>';
    }).join('');
    var refs = priceRefs || {};
    var pricesHtml = '<div class="score-prices">' +
      _priceTag('买入参考', refs.buy, curPrice, 'buy', '该流派评分达到 90 分（或评分上限）对应的价格；现价不高于此价时进入买入参考区') +
      _priceTag('保守卖出', refs.sellCons, curPrice, 'sell', '核心估值锚位；现价不低于此价时进入保守卖出参考区') +
      _priceTag('公允卖出', refs.sellFair, curPrice, 'sell', '估值锚位上浮后的价格；现价不低于此价时进入公允卖出参考区') +
      '</div>';
    return '<div class="score-card-head"><h4>' + title + '</h4>' +
      '<div class="score-circle va-grade-' + g + '"><span>总分</span><b>' + (total == null ? '-' : fmtNum(total)) + '</b><i>' + gradeText(g) + '</i></div></div>' +
      '<p class="score-basis">' + basis + '</p>' +
      pricesHtml +
      '<div class="stock-compare-wrap"><table class="stock-compare">' +
      '<thead><tr><th>评判标准</th><th>当前值</th><th>参考阈值</th><th>符合度</th><th>得分</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      (note ? '<p class="score-note">' + note + '</p>' : '');
  }

  // 三大流派评分汇总（格雷厄姆进取/防御、施洛斯、巴菲特芒格），以最新年报为基础
  // k 为市值/估值缩放因子（默认 1=当前市值）：mcap/pe/pb 同乘 k、股息率除以 k，
  // 使总分随 k 单调变化，供价格参考二分反推使用（priceReferences）
  // useFundamental（仅二分反推）时 pb/pe 改用财报驱动每股量反推（归母权益/股本、TTM净利/股本），
  // 使“现价×临界倍数”的现价因子精确抵消，参考价只随财报变动；快照 pb/pe 仅 2 位小数，直接缩放会引入舍入漂移
  function valueScores(d, va, k, useFundamental) {
    if (k == null) k = 1;
    var annual = annualRows(d.indicators || []);
    var last = annual[annual.length - 1];
    var lastDate = last ? String(last['报告期']).slice(0, 10) : null;
    var lastYear = lastDate ? Number(lastDate.slice(0, 4)) : null;
    var baList = (d.balance || []).slice().sort(function (a, b) { return a['报告日'] < b['报告日'] ? -1 : 1; });
    var lastBa = lastDate ? sheetRowByDate(baList, lastDate) : null;
    var s = d.snapshot || {};
    var mcap = s.market_cap, pe = s.pe_ttm, pb = s.pb;
    // 快照缺 PB（腾讯行情不返回美股 PB）时用财报每股净资产补算：股价÷每股净资产，缺则归母权益/股本反推；
    // 仅 k=1（当期评分）时补算，k≠1 的缩放分支已由财报驱动精确计算，两者口径一致（均随财报变动、不随行情舍入漂移）
    if (pb == null && k === 1) {
      var bpsFb = latestField(d.indicators, '每股净资产');
      if (bpsFb == null && lastBa != null) {
        var eqFb = lastBa['归属于母公司股东权益合计'] != null ? lastBa['归属于母公司股东权益合计'] : lastBa['所有者权益(或股东权益)合计'];
        var shFb = shareCount(d.balance, (mcap != null && s.price != null && s.price > 0) ? mcap / s.price : null, null);
        if (eqFb != null && shFb) bpsFb = eqFb / shFb;
      }
      if (bpsFb != null && bpsFb > 0 && s.price != null && s.price > 0) pb = s.price / bpsFb;
    }
    if (k !== 1 || useFundamental) {
      var p0 = s.price;
      // 每股净资产优先用指标字段（数据源按财报算好、随财报更新），缺则财报权益/股本
      var bpsF = latestField(d.indicators, '每股净资产');
      var sharesF = shareCount(d.balance, (mcap != null && p0 != null && p0 > 0) ? mcap / p0 : null, bpsF);
      var lastEqV = null;
      if (lastBa != null) {
        lastEqV = lastBa['归属于母公司股东权益合计'] != null ? lastBa['归属于母公司股东权益合计'] : lastBa['所有者权益(或股东权益)合计'];
      }
      if (sharesF) {
        // 快照 mcap 含舍入/滞后，改用财报股本×实时价（市值类价格项同样精确抵消）
        mcap = sharesF * p0 * k;
        if (bpsF == null && lastEqV != null) bpsF = lastEqV / sharesF;
        pb = bpsF ? p0 * k / bpsF : (pb != null ? pb * k : null);
        // 每股收益优先用基本每股收益字段做 TTM，缺则 TTM 净利/股本
        var epsF = epsTtmField(d.indicators);
        if (epsF == null) {
          var ttmF = ttmNetProfit(d.indicators);
          if (ttmF != null) epsF = ttmF / sharesF;
        }
        pe = epsF ? p0 * k / epsF : (pe != null ? pe * k : null);
      } else {
        mcap = mcap != null ? mcap * k : null;
        pe = pe != null ? pe * k : null;
        pb = pb != null ? pb * k : null;
      }
    }
    var divConsecutive = va.divConsecutive || 0;
    // 股息率随假设价格反向缩放（仅施洛斯股息率项使用）
    var divYield = va.divYield;
    if (k !== 1 && divYield != null) divYield = divYield / k;

    // ---- 基础量（最新年报）----
    var ca = lastBa ? lastBa['流动资产合计'] : null;      // 流动资产合计
    var cl = lastBa ? lastBa['流动负债合计'] : null;      // 流动负债合计
    var tl = lastBa ? lastBa['负债合计'] : null;          // 负债合计
    var assets = lastBa ? lastBa['资产总计'] : null;      // 资产总计
    var cash = lastBa ? lastBa['货币资金'] : null;        // 货币资金
    var stDebt = lastBa ? lastBa['短期借款'] : null;      // 短期借款
    var ltDebt = lastBa ? lastBa['长期借款'] : null;      // 长期借款
    var bond = lastBa ? lastBa['应付债券'] : null;        // 应付债券
    var due1y = lastBa ? lastBa['一年内到期的非流动负债'] : null; // 一年内到期的长贷/债券/租赁重分类
    var lease = lastBa ? lastBa['租赁负债'] : null;       // 租赁负债（新租赁准则表内化的分期付款）
    var intang = lastBa ? lastBa['无形资产'] : null;      // 无形资产
    var goodwill = lastBa ? lastBa['商誉'] : null;        // 商誉
    var netProfit = last ? last['净利润'] : null;
    var debtr = last ? last['资产负债率'] : null;
    var gMargin = last ? last['销售毛利率'] : null;
    var nMargin = last ? last['销售净利率'] : null;
    // 有息负债全口径：短借 + 一年内到期 + 长借 + 应付债券 + 租赁负债（字段缺失视为 0）
    var intDebt = sum([stDebt, due1y, ltDebt, bond, lease]);
    if (intDebt == null) intDebt = 0;
    var netCash = (cash != null && intDebt != null) ? cash - intDebt : null; // 净现金
    var ncav = (ca != null && tl != null) ? ca - tl : null;   // 净流动资产 NCAV
    var wc = (ca != null && cl != null) ? ca - cl : null;     // 营运资本
    // 长期有息负债全口径：一年内到期部分为重分类的长贷/债券，租赁负债计入（字段缺失视为 0）
    var ltd = sum([due1y, ltDebt, bond, lease]);
    if (ltd == null) ltd = 0;
    var curRatio = (ca != null && cl != null && cl > 0) ? ca / cl : null;
    var liqRatio = (ca != null && tl != null && tl > 0) ? ca / tl : null;
    var pncav = (mcap != null && ncav != null && ncav > 0) ? mcap / ncav : null;
    var pnetcash = (mcap != null && netCash != null && netCash > 0) ? mcap / netCash : null;
    // 净现金/NCAV 为负时属于“不达标”而非“数据缺失”：当前值文本说明 + 得 0 分
    var pncavVal = ncav == null ? '-' : (ncav > 0 ? (pncav == null ? '-' : fmtNum(pncav) + '×') : 'NCAV 为负');
    var pnetcashVal = netCash == null ? '-' : (netCash > 0 ? (pnetcash == null ? '-' : fmtNum(pnetcash) + '×') : '净现金为负');
    var pepb = (pe != null && pb != null) ? pe * pb : null;
    var intangShare = (intang != null && assets != null && assets > 0) ? intang / assets : null;
    var goodwillShare = (goodwill != null && assets != null && assets > 0) ? goodwill / assets : null;

    // 近5年年报净利润（盈利稳定性）与近5年净利累计增长
    var net5 = annual.slice(-5).map(function (r) { return r['净利润']; });
    var posN = net5.filter(function (v) { return v != null && v > 0; }).length;
    var grow5 = (net5.length >= 2 && net5[0] != null && net5[net5.length - 1] != null && net5[0] > 0)
      ? net5[net5.length - 1] / net5[0] - 1 : null;

    // ROE 近5年均值（披露口径）
    var roeVals = va.dupont.map(function (r) { return r.roeReported; }).filter(function (v) { return v != null; });
    var roe5 = roeVals.length ? sum(roeVals) / roeVals.length : null;

    var basis = '评分基准：' + (lastYear ? lastYear + ' 年报' : '最新财报') +
      (s.time ? ' + ' + fmtDate(s.time) + ' 收盘价/市值' : '') +
      '；有息负债含一年内到期与租赁负债（全口径）';

    // ---- 格雷厄姆 · 进取型烟蒂（net-net 净流动资产折价）----
    var gA = [
      it('价格/净流动资产（市值/NCAV）', pncavVal, '≤ 0.67×（2/3 净流动资产）', 30, ncav == null ? null : (ncav > 0 ? lerpScore(pncav, 0.67, 1.5, 30, 0) : 0)),
      it('价格/净现金（市值/现金-有息负债）', pnetcashVal, '≤ 1×', 20, netCash == null ? null : (netCash > 0 ? lerpScore(pnetcash, 1, 2, 20, 0) : 0)),
      it('流动资产/总负债', liqRatio == null ? '-' : fmtNum(liqRatio), '≥ 2（资产覆盖债务）', 20, lerpScore(liqRatio, 1, 2, 0, 20)),
      it('最新年报净利润', fmtMoney(netProfit), '> 0（清算缓冲）', 15, netProfit != null && netProfit > 0 ? 15 : 0),
      it('资产负债率', fmtPct(debtr), '≤ 60%', 10, lerpScore(debtr, 0.6, 0.8, 10, 0)),
      it('连续分红年数', (divConsecutive || 0) + ' 年', '≥ 3 年', 5, divConsecutive >= 3 ? 5 : divConsecutive >= 1 ? 2.5 : 0)
    ];
    var gATotal = sum(gA.map(function (x) { return x.score; }));

    // ---- 格雷厄姆 · 防御型烟蒂（《聪明的投资者》防御型标准）----
    // 严格性设计：规模为硬门槛（≥100亿满分）；关键安全项（流动比率/长期负债比/盈利稳定/增长）
    // 严重不达标时直接负分惩罚，而非仅给 0 分，避免“凑分式”达标
    function sizeScore(v) {
      if (v == null) return null;
      if (v >= 1e10) return 10;   // ≥100 亿
      if (v >= 5e9) return 6;     // 50~100 亿
      if (v >= 3e9) return 3;     // 30~50 亿
      return 0;                   // <30 亿（过小，防御型不参与）
    }
    function divScore10(years) {
      if (years >= 10) return 15;
      if (years >= 7) return 10;
      if (years >= 5) return 5;
      if (years >= 3) return 2;
      return 0;                   // <3 年分红史，防御型不给分
    }
    var ltdScore;
    if (wc == null) { ltdScore = null; }
    else if (wc <= 0) { ltdScore = -10; }  // 营运资本为负（流动负债>流动资产）危险信号
    else if (ltd <= wc) { ltdScore = 20; }
    else if (ltd <= wc * 1.5) { ltdScore = lerpScore(ltd / wc, 1, 1.5, 20, 5); }
    else { ltdScore = 0; }
    var gD = [
      it('企业规模（总资产）', fmtMoney(assets), '≥ 100 亿', 10, sizeScore(assets)),
      it('流动比率', fmtNum(curRatio), '≥ 2', 20, curRatio == null ? null
        : (curRatio >= 2 ? 20 : curRatio >= 1.5 ? lerpScore(curRatio, 1.5, 2, 0, 20) : curRatio >= 1 ? 5 : -10)),
      it('长期有息负债 / 营运资本', (ltd == null ? '-' : fmtMoney(ltd)) + ' / ' + (wc == null ? '-' : fmtMoney(wc)), '长期负债 ≤ 营运资本', 20, ltdScore),
      it('盈利稳定（近5年净利为正）', posN + '/5 年', '5 年全部为正', 15, posN >= 5 ? 15 : posN === 4 ? 9 : posN === 3 ? 4 : -5),
      it('连续分红年数', (divConsecutive || 0) + ' 年', '≥ 10 年', 15, divScore10(divConsecutive || 0)),
      it('近5年净利累计增长', fmtPct(grow5), '≥ 33%', 10, grow5 == null ? null : (grow5 >= 0.33 ? 10 : grow5 >= 0 ? lerpScore(grow5, 0, 0.33, 0, 10) : -5)),
      it('市盈率（TTM）', fmtNum(pe), '≤ 15', 5, lerpScore(pe, 15, 25, 5, 0)),
      it('PE × PB', pepb == null ? '-' : fmtNum(pepb), '≤ 22.5', 5, pepb != null ? (pepb <= 22.5 ? 5 : (pepb <= 45 ? lerpScore(pepb, 22.5, 45, 5, 0) : 0)) : null)
    ];
    var gDTotal = sum(gD.map(function (x) { return x.score; }));

    // ---- 施洛斯风险扣分（资产萎缩/减值结构/债务恶化/经营溃败的量化危险信号，仅负分）----
    // 归母权益（优先归母，缺则全部权益）
    function eqOf(row) {
      if (!row) return null;
      var v = row['归属于母公司股东权益合计'];
      return v != null ? v : row['所有者权益(或股东权益)合计'];
    }
    // 有息负债全口径（与上方 intDebt 一致：短借+一年内到期+长借+债券+租赁，缺键当 0）
    function intDebtOf(row) {
      if (!row) return null;
      var v = sum([row['短期借款'], row['一年内到期的非流动负债'], row['长期借款'], row['应付债券'], row['租赁负债']]);
      return v == null ? 0 : v;
    }
    var baAnnual = annualBalanceRows(d.balance);   // 三大报表年报序列（升序）
    var inAnnual = annualBalanceRows(d.income);
    var cfAnnual = annualBalanceRows(d.cashflow);
    var lastEq = eqOf(lastBa);
    var earliestEq = baAnnual.length >= 5 ? eqOf(baAnnual[0]) : null;
    var intDebtNow = lastBa ? intDebtOf(lastBa) : null;
    var intDebtEarliest = baAnnual.length >= 5 ? intDebtOf(baAnnual[0]) : null;
    // 近5年扣非亏损年数（annual 最后 5 行）
    var adjNet = annual.slice(-5).map(function (r) { return r['扣非净利润']; });
    var adjLossN = adjNet.filter(function (v) { return v != null && v < 0; }).length;
    var adjValid = adjNet.filter(function (v) { return v != null; }).length;
    // 应收账款/营收 3 年年报均值（位置对齐，缺失年忽略；港股“应收帐款”科目兼容）
    var ar3 = baAnnual.slice(-3).map(arOf);
    var rev3 = inAnnual.slice(-3).map(function (r) { return r['营业总收入']; });
    var arRev3 = (ar3.length === 3 && rev3.length === 3) ? sum(ar3) / sum(rev3) : null;
    // 近3年累计经营现金流 vs 累计利息费用
    var ocf3 = cfAnnual.slice(-3).map(function (r) { return r['经营活动产生的现金流量净额']; });
    var intExp3 = inAnnual.slice(-3).map(function (r) { return r['利息费用']; });
    var ocf3Sum = sum(ocf3), intExp3Sum = sum(intExp3);
    var ocfCovers = (ocf3Sum != null && intExp3Sum != null) ? ocf3Sum >= intExp3Sum : null;
    // 近5年累计经营现金流（区分扩张举债 vs 补亏举债）
    var ocf5Sum = sum(cfAnnual.slice(-5).map(function (r) { return r['经营活动产生的现金流量净额']; }));
    // 5 年趋势（最新 vs 最早年报，要求 ≥5 个年报）
    var spanOk = annual.length >= 5;
    var revNow = last ? last['营业总收入'] : null;
    var revEarliest = spanOk ? annual[0]['营业总收入'] : null;
    var gMarginNow = last ? last['销售毛利率'] : null;
    var gMarginEarliest = spanOk ? annual[0]['销售毛利率'] : null;
    var eqGrow = (lastEq != null && earliestEq != null && earliestEq > 0) ? lastEq / earliestEq - 1 : null;
    var intDebtGrow = (intDebtNow != null && intDebtEarliest != null && intDebtEarliest > 0) ? intDebtNow / intDebtEarliest - 1 : null;
    var revGrow = (revNow != null && revEarliest != null && revEarliest > 0) ? revNow / revEarliest - 1 : null;
    var gMarginDelta = (gMarginNow != null && gMarginEarliest != null) ? gMarginNow - gMarginEarliest : null;
    var gwIntSum = (goodwill != null ? goodwill : 0) + (intang != null ? intang : 0);
    var inv = lastBa ? lastBa['存货'] : null;
    // 9 个量化扣分项：危险信号触发负分（与正向分叠加），数据不足给 0 不误伤
    var riskItems = [
      it('净资产5年变动（归母权益）', eqGrow == null ? '-' : fmtPct(eqGrow), '≥ -20%（萎缩扣分）', 5,
        eqGrow == null ? 0 : (eqGrow <= -0.4 ? -5 : eqGrow <= -0.2 ? -3 : 0)),
      it('近5年扣非亏损年数', adjValid < 3 ? '-' : adjLossN + '/5 年', '≤ 1 年（扣非口径）', 5,
        adjValid < 3 ? 0 : (adjLossN >= 3 ? -5 : adjLossN === 2 ? -3 : 0)),
      it('(商誉+无形资产)/归母权益', (lastEq != null && lastEq > 0) ? fmtPct(gwIntSum / lastEq) : '-', '≤ 30%（减值风险）', 4,
        (lastEq != null && lastEq > 0) ? (gwIntSum / lastEq > 0.6 ? -4 : gwIntSum / lastEq > 0.3 ? -2 : 0) : 0),
      it('应收账款/营收（3年年报均值）', arRev3 == null ? '-' : fmtPct(arRev3), '≤ 40%（坏账风险）', 3,
        arRev3 == null ? 0 : (arRev3 > 0.6 ? -3 : arRev3 > 0.4 ? -1.5 : 0)),
      it('存货/总资产（最新年报）', (inv != null && assets != null && assets > 0) ? fmtPct(inv / assets) : '-', '≤ 35%（跌价风险）', 2,
        (inv != null && assets != null && assets > 0) ? (inv / assets > 0.5 ? -2 : inv / assets > 0.35 ? -1 : 0) : 0),
      it('有息负债5年变动', intDebtGrow == null ? '-' : fmtPct(intDebtGrow), '≤ 50%；翻倍且5年经营现金流为负重扣（补亏举债）', 6,
        intDebtGrow == null ? 0 : (intDebtGrow > 1 ? ((ocf5Sum != null && ocf5Sum < 0) ? -6 : -3) : intDebtGrow > 0.5 ? -2 : 0)),
      it('近3年经营现金流 vs 利息费用', (ocf3Sum == null || intExp3Sum == null) ? '-' : fmtMoney(ocf3Sum) + ' / ' + fmtMoney(intExp3Sum), '经营现金流 ≥ 利息费用', 4,
        ocfCovers === false ? -4 : 0),
      it('营收5年变动', revGrow == null ? '-' : fmtPct(revGrow), '≥ -20%（竞争地位）', 4,
        revGrow == null ? 0 : (revGrow <= -0.5 ? -4 : revGrow <= -0.2 ? -2 : 0)),
      it('毛利率5年变动', gMarginDelta == null ? '-' : fmtPct(gMarginDelta), '≥ -10pct（定价权）', 4,
        gMarginDelta == null ? 0 : (gMarginDelta <= -0.2 ? -4 : gMarginDelta <= -0.1 ? -2 : 0))
    ];

    // ---- 施洛斯烟蒂（资产折扣 + 低估值 + 低负债 + 股息）----
    var sItems = [
      it('市净率', fmtNum(pb), '≤ 0.75（资产折扣）', 25, lerpScore(pb, 0.75, 1.5, 25, 0)),
      it('市盈率（TTM）', fmtNum(pe), '≤ 10', 20, lerpScore(pe, 10, 20, 20, 0)),
      it('流动资产/总负债', liqRatio == null ? '-' : fmtNum(liqRatio), '≥ 2', 20, lerpScore(liqRatio, 1, 2, 0, 20)),
      it('股息率（近12月）', fmtPct(divYield), '≥ 3%', 15, lerpScore(divYield, 0, 0.03, 0, 15)),
      it('最新年报净利润', fmtMoney(netProfit), '> 0', 10, netProfit != null && netProfit > 0 ? 10 : 0),
      it('市值 / 流动资产', (mcap == null ? '-' : fmtMoney(mcap)) + ' / ' + (ca == null ? '-' : fmtMoney(ca)), '市值 ≤ 流动资产', 10,
        (mcap != null && ca != null && ca > 0) ? (mcap <= ca ? 10 : lerpScore(mcap / ca, 1, 2, 10, 0)) : null)
    ];
    var sTotal = sum(sItems.concat(riskItems).map(function (x) { return x.score; }));

    // ---- 巴菲特芒格（优质企业 + 护城河）----
    var moatItems = [
      it('销售毛利率', fmtPct(gMargin), '≥ 40%（定价权迹象）', 5, lerpScore(gMargin, 0.2, 0.4, 0, 5)),
      it('ROE（近5年均值）', fmtPct(roe5), '≥ 15%', 4, lerpScore(roe5, 0.08, 0.15, 0, 4)),
      it('无形资产+商誉 / 总资产', fmtPct((intangShare != null || goodwillShare != null) ? (intangShare || 0) + (goodwillShare || 0) : null), '≥ 10%（品牌/专利/特许权）', 3,
        lerpScore((intangShare != null || goodwillShare != null) ? (intangShare || 0) + (goodwillShare || 0) : null, 0, 0.1, 0, 3)),
      it('连续分红且分红率 ≤ 70%', (divConsecutive || 0) + ' 年 / ' + fmtPct(va.payout), '≥ 5 年且 ≤ 70%', 3,
        divConsecutive >= 5 ? (va.payout != null && va.payout <= 0.7 ? 3 : 1.5) : 0)
    ];
    var bItems = [
      it('ROE（近5年均值）', fmtPct(roe5), '≥ 15%', 25, lerpScore(roe5, 0.10, 0.15, 0, 25)),
      it('销售净利率（最新年报）', fmtPct(nMargin), '≥ 10%', 15, lerpScore(nMargin, 0.05, 0.10, 0, 15)),
      it('资产负债率', fmtPct(debtr), '≤ 50%', 15, lerpScore(debtr, 0.5, 0.75, 15, 0)),
      it('5年累计净现比', fmtNum(va.ratio5), '≥ 1', 15, lerpScore(va.ratio5, 0.5, 1, 0, 15)),
      it('净利润 5 年 CAGR', fmtPct(va.netCagr5), '≥ 10%', 15, lerpScore(va.netCagr5, 0, 0.1, 0, 15))
    ];
    var bTotal = sum(bItems.concat(moatItems).map(function (x) { return x.score; }));

    // 护城河备注：无形资产/商誉明细 + 特许经营（定价权）证据说明
    var moatNote = '';
    if (intang != null || goodwill != null) {
      moatNote = '无形资产 ' + fmtMoney(intang) + '（占总资产 ' + fmtPct(intangShare) + '），商誉 ' + fmtMoney(goodwill) + '（占 ' + fmtPct(goodwillShare) + '）。';
      if (gMargin != null && gMargin >= 0.4 && roe5 != null && roe5 >= 0.15) {
        moatNote += '高毛利率（≥40%）+ 高 ROE（≥15%）组合通常意味着品牌溢价或特许经营（定价权）等护城河，是无形资产创造超额回报的量化证据；若该特征为行业通性（如医药/软件），则更多体现行业属性而非个体优势，需结合行业地位判断。';
      } else if (gMargin != null && gMargin >= 0.4 || roe5 != null && roe5 >= 0.15) {
        moatNote += '毛利率或 ROE 单项突出，特许经营/品牌优势的证据不完全，需结合行业地位判断其可持续性。';
      } else {
        moatNote += '毛利率与 ROE 均未达强护城河量化线（40%/15%），暂未见品牌溢价或特许经营定价权证据。';
      }
      if (goodwillShare != null && goodwillShare > 0.2) moatNote += '商誉占比偏高（>20%），若增长依赖并购需警惕商誉减值风险。';
      if (intangShare != null && intangShare > 0.3) moatNote += '无形资产占比较高（>30%），注意区分专利/特许经营权与土地使用权，前者才是定价权来源。';
    } else {
      moatNote = '最新年报未披露无形资产/商誉明细，无法量化评估特许经营资产。';
    }

    // 有效满分/缺维数：数据缺失项不计分也不计入满分，总分实际按有效满分折算，需向用户标注（跨市场可比性）
    function effOf(arr) {
      var mx = 0, miss = 0;
      arr.forEach(function (x) { if (x.score != null) mx += x.max; else miss += 1; });
      return { max: mx, miss: miss };
    }

    return {
      basis: basis,
      grahamAgg: { title: '进取型烟蒂 · net-net（低于净流动资产买入）', total: gATotal, items: gA, eff: effOf(gA),
        note: '格雷厄姆 net-net 思路：以低于净流动资产（流动资产-全部负债）2/3 的价格买入，赚取清算价值与市价之差。得分越高代表越接近“捡烟蒂”状态。' },
      grahamDef: { title: '防御型烟蒂 · 防御型投资者标准', total: gDTotal, items: gD, eff: effOf(gD),
        note: '对应《聪明的投资者》第 14 章防御型投资者选股标准（规模/流动比率/长期负债/盈利稳定/分红历史/盈利增长/估值）。规模为硬门槛（总资产≥100亿），关键安全项（流动比率<1、营运资本为负、近5年过半亏损、净利负增长）直接负分惩罚，比进取型更严格。' },
      schloss: { title: '施洛斯烟蒂 · 资产折扣+低估值+低负债', total: sTotal, items: sItems.concat(riskItems), eff: effOf(sItems),
        note: '沃尔特·施洛斯风格：以低于净资产/流动资产的价格买入、负债极低、有股息，分散持有等待价值回归。风险扣分项为量化危险信号：净资产萎缩/扣非亏损、商誉无形与应收存货减值结构、有息负债攀升与利息覆盖不足、营收毛利率趋势溃败，数据不足不扣分；管理层掏空等无公开量化数据的信号未纳入。' },
      buffett: { title: '巴菲特芒格 · 优质企业合理价格+护城河', total: bTotal, items: bItems.concat(moatItems), eff: effOf(bItems.concat(moatItems)),
        note: moatNote }
    };
  }

  // ---- 财务报表造假可能性分析（Beneish M-Score 思路的量化红旗加权）----
  // 百分制：分数越高造假可能性越大；8 项红旗各按严重度(0~1)×权重计分，权重合计 100；
  // 数据不足该项计 0 不误伤；仅为量化筛查，不构成造假认定
  function fraudAnalysis(d) {
    var annual = annualRows(d.indicators || []);
    var last = annual.length ? annual[annual.length - 1] : null;
    var prev = annual.length >= 2 ? annual[annual.length - 2] : null;
    var lastDate = last ? String(last['报告期']).slice(0, 10) : null;
    var prevDate = prev ? String(prev['报告期']).slice(0, 10) : null;
    var baList = (d.balance || []).slice().sort(function (a, b) { return a['报告日'] < b['报告日'] ? -1 : 1; });
    var cfList = (d.cashflow || []).slice().sort(function (a, b) { return a['报告日'] < b['报告日'] ? -1 : 1; });
    var lastBa = lastDate ? sheetRowByDate(baList, lastDate) : null;
    var prevBa = prevDate ? sheetRowByDate(baList, prevDate) : null;
    var lastCf = lastDate ? sheetRowByDate(cfList, lastDate) : null;
    var lastYear = lastDate ? lastDate.slice(0, 4) : null;

    var rev = last ? last['营业总收入'] : null;
    var revPrev = prev ? prev['营业总收入'] : null;
    var net = last ? last['净利润'] : null;
    var ocf = lastCf ? lastCf['经营活动产生的现金流量净额'] : null;
    var soldCash = lastCf ? lastCf['销售商品、提供劳务收到的现金'] : null;
    var assets = lastBa ? lastBa['资产总计'] : null;
    var ar = arOf(lastBa);
    var arPrev = arOf(prevBa);
    var inv = lastBa ? lastBa['存货'] : null;
    var invPrev = prevBa ? prevBa['存货'] : null;
    var otherAr = lastBa ? (lastBa['其他应收款'] != null ? lastBa['其他应收款'] : lastBa['其他应收款(合计)']) : null;
    var soft = lastBa ? ((lastBa['商誉'] || 0) + (lastBa['无形资产'] || 0)) : null;
    var gm = last ? last['销售毛利率'] : null;
    var gmPrev = prev ? prev['销售毛利率'] : null;

    // 近5年累计净现比（比单年稳健：累计经营现金流 ÷ 累计净利润）
    var sumNet = 0, sumOcf = 0, hitNO = false;
    annual.slice(-5).forEach(function (r) {
      var cf = sheetRowByDate(cfList, String(r['报告期']).slice(0, 10));
      var n = r['净利润'], o = cf ? cf['经营活动产生的现金流量净额'] : null;
      if (n != null && o != null) { sumNet += n; sumOcf += o; hitNO = true; }
    });
    var ratio5 = (hitNO && sumNet > 0) ? sumOcf / sumNet : null;

    function grow(cur, pre) { return (cur != null && pre != null && pre > 0) ? cur / pre - 1 : null; }
    var revGrow = grow(rev, revPrev);
    var arGap = (grow(ar, arPrev) != null && revGrow != null) ? grow(ar, arPrev) - revGrow : null;
    var invGap = (grow(inv, invPrev) != null && revGrow != null) ? grow(inv, invPrev) - revGrow : null;
    var gmDelta = (gm != null && gmPrev != null) ? gm - gmPrev : null;
    var tata = (net != null && ocf != null && assets != null && assets > 0) ? (net - ocf) / assets : null;
    var otherShare = (otherAr != null && assets != null && assets > 0) ? otherAr / assets : null;
    var softShare = (soft != null && assets != null && assets > 0) ? soft / assets : null;
    var collect = (soldCash != null && rev != null && rev > 0) ? soldCash / rev : null;

    // 严重度分段：v≤a→0；a~b→0~0.5；b~c→0.5~1；≥c→1（越高越可疑）
    function sev(v, a, b, c) {
      if (v == null) return null;
      if (v <= a) return 0;
      if (v >= c) return 1;
      if (v <= b) return (v - a) / (b - a) * 0.5;
      return 0.5 + (v - b) / (c - b) * 0.5;
    }
    function w(score, maxV) { return score == null ? null : score * maxV; }

    // 净现比：≥1 无红旗；0~1 线性升；≤0 满严重（利润无现金支撑）
    var s1 = ratio5 == null ? null : lerpScore(ratio5, 0, 1, 1, 0);
    // 收现比：≥100% 无红旗；60%~100% 线性升；≤60% 满严重
    var s8 = collect == null ? null : lerpScore(collect, 0.6, 1, 1, 0);
    // 毛利率上升才可疑（下降属经营问题）
    var s5 = gmDelta == null ? null : (gmDelta <= 0 ? 0 : sev(gmDelta, 0, 0.05, 0.10));

    var items = [
      it('5年累计净现比（经营现金流÷净利润）', ratio5 == null ? '-' : fmtNum(ratio5), '≥ 1（利润有现金支撑）', 25, w(s1, 25)),
      it('总应计比率（净利润−经营现金流）÷总资产', fmtPct(tata), '≤ 2%（应计越高越可疑）', 20, w(sev(tata, 0.02, 0.06, 0.10), 20)),
      it('应收账款增速 − 营收增速', fmtPct(arGap), '≤ 5pp（应收异常快于营收）', 15, w(sev(arGap, 0.05, 0.20, 0.40), 15)),
      it('存货增速 − 营收增速', fmtPct(invGap), '≤ 5pp（存货异常堆积）', 10, w(sev(invGap, 0.05, 0.25, 0.50), 10)),
      it('销售毛利率同比变动', gmDelta == null ? '-' : (gmDelta > 0 ? '+' : '') + (gmDelta * 100).toFixed(1) + 'pp', '上升≤0（逆势上升可疑）', 10, w(s5, 10)),
      it('其他应收款÷总资产（关联方占用）', fmtPct(otherShare), '≤ 2%', 10, w(sev(otherShare, 0.02, 0.05, 0.10), 10)),
      it('（商誉＋无形资产）÷总资产（资产偏软）', fmtPct(softShare), '≤ 10%', 5, w(sev(softShare, 0.10, 0.20, 0.35), 5)),
      it('销售收现比（销售收现÷营收）', fmtPct(collect), '≥ 100%', 5, w(s8, 5))
    ];
    var avail = items.filter(function (x) { return x.score != null; });
    var total = avail.length ? Math.min(100, avail.reduce(function (s, x) { return s + x.score; }, 0)) : null;
    return {
      title: '财务报表造假可能性 · 量化红旗筛查',
      basis: '评分基准：' + (lastYear || '-') + ' 年报（同比项对比 ' + (prevDate ? prevDate.slice(0, 4) : '-') + ' 年报）',
      total: total == null ? null : Math.round(total * 10) / 10,
      items: items,
      note: '借鉴 Beneish M-Score 思路：将净现背离、高应计、应收/存货增速背离营收、毛利率逆势上升、其他应收款占用、资产偏软、收现不足等量化红旗按严重度加权为 0~100 分，分数越高造假可能性越大。数据不足的项计 0 分不误伤；本分为量化筛查信号，不构成对造假的认定，需结合审计意见、监管问询等定性信息综合判断。'
    };
  }

  // 造假分析评分卡（与 scoreCard 同构但等级方向相反：分低=安全=绿）
  function fraudCard(fa) {
    var g = fraudGradeOf(fa.total);
    var rows = fa.items.map(function (x) {
      var mCls = x.match == null ? 'sc-na' : x.match <= 0.01 ? 'sc-good' : x.match < 0.5 ? 'sc-mid' : x.match < 0.99 ? 'sc-low' : 'sc-bad';
      var mTxt = x.match == null ? '-' : (x.match * 100).toFixed(0) + '%';
      return '<tr><td>' + x.std + '</td><td class="v">' + x.val + '</td><td class="v">' + x.thr + '</td>' +
        '<td class="v ' + mCls + '">' + mTxt + '</td>' +
        '<td class="v"><b>' + (x.score == null ? '-' : fmtNum(x.score)) + '</b> / ' + x.max + '</td></tr>';
    }).join('');
    return '<div class="score-card-head"><h4>' + fa.title + '</h4>' +
      '<div class="score-circle va-grade-' + g + '"><span>造假分</span><b>' + (fa.total == null ? '-' : fmtNum(fa.total)) + '</b><i>' + fraudGradeText(g) + '</i></div></div>' +
      '<p class="score-basis">' + fa.basis + '</p>' +
      '<div class="stock-compare-wrap"><table class="stock-compare">' +
      '<thead><tr><th>红旗指标</th><th>当前值</th><th>安全阈值</th><th>严重度</th><th>得分</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<p class="score-note">' + fa.note + '</p>';
  }

  // ---- 管理层管理水平评分（融合 DEA 投入产出效率思想的 8 维百分制加权）----
  // 分数越高管理水平越好（与价值评分同向）；数据不足该项不计分不误伤。
  // 纯 DEA 相对效率依赖同行业样本且为黑盒无法逐项展示，故采用其“投入→产出”效率内核的透明加权替代。
  function managementAnalysis(d) {
    var annual = annualRows(d.indicators || []);
    var last = annual.length ? annual[annual.length - 1] : null;
    var lastDate = last ? String(last['报告期']).slice(0, 10) : null;
    var lastYear = lastDate ? lastDate.slice(0, 4) : null;
    var incList = (d.income || []).slice().sort(function (a, b) { return a['报告日'] < b['报告日'] ? -1 : 1; });
    var baList = (d.balance || []).slice().sort(function (a, b) { return a['报告日'] < b['报告日'] ? -1 : 1; });
    var cfList = (d.cashflow || []).slice().sort(function (a, b) { return a['报告日'] < b['报告日'] ? -1 : 1; });
    var lastInc = lastDate ? sheetRowByDate(incList, lastDate) : null;
    var lastBa = lastDate ? sheetRowByDate(baList, lastDate) : null;

    var rev = last ? last['营业总收入'] : (lastInc ? lastInc['营业总收入'] : null);
    var sellExp = lastInc ? lastInc['销售费用'] : null;
    var admExp = lastInc ? lastInc['管理费用'] : null;
    var finExp = lastInc ? lastInc['财务费用'] : null;
    var assets = lastBa ? lastBa['资产总计'] : null;
    var ar = arOf(lastBa);
    var inv = lastBa ? lastBa['存货'] : null;
    var roe = last ? (last['净资产收益率'] != null ? last['净资产收益率'] : last['净资产收益率-摊薄']) : null;
    var eps = last ? last['基本每股收益'] : null;

    // 1. 三费率（销售＋管理＋财务费用）÷营收，越低越好（费用纪律/代理成本控制）；
    // 三费科目全缺（港股/美股报表口径）时回退替代科目近似计算：美股“营业费用”（销售+管理+研发合计）、
    // 港股“销售及分销费用”，避免整维缺失，口径为近似值（与三费合计不完全可比）
    var feeSum = (sellExp != null || admExp != null || finExp != null)
      ? (sellExp || 0) + (admExp || 0) + (finExp || 0) : null;
    var feeLabel = '费用纪律：三费率（销售＋管理＋财务费用）÷营收';
    if (feeSum == null && lastInc != null) {
      feeSum = lastInc['营业费用'] != null ? lastInc['营业费用'] : lastInc['销售及分销费用'];
      if (feeSum != null) feeLabel = '费用纪律：费用÷营收（营业费用/销售及分销费用近似口径）';
    }
    var feeRatio = (feeSum != null && rev != null && rev > 0) ? feeSum / rev : null;

    // 2. 总资产周转率 = 营收 ÷ 总资产（资产运营效率）
    var turnover = (rev != null && assets != null && assets > 0) ? rev / assets : null;

    // 4. 营收约 5 年 CAGR（成长质量；取不晚于 lastYear-5 的最近年报作基期，缺则用最早年报）
    var revCagr = null;
    if (annual.length >= 2 && lastYear != null) {
      var base = null;
      for (var i = annual.length - 2; i >= 0; i--) {
        var yy = Number(String(annual[i]['报告期']).slice(0, 4));
        if (yy <= Number(lastYear) - 5) { base = annual[i]; break; }
      }
      if (!base) base = annual[0];
      var span = Number(lastYear) - Number(String(base['报告期']).slice(0, 4));
      if (span > 0) revCagr = cagr(rev, base['营业总收入'], span);
    }

    // 5. 营运资金占用（应收＋存货）÷营收，越低越好（回款与库存管理）
    var wc = (ar != null && inv != null && rev != null && rev > 0) ? (ar + inv) / rev : null;

    // 6. 近 5 年累计净现比（累计经营现金流 ÷ 累计净利润，现金流质量）
    var sumNet = 0, sumOcf = 0, hit = false;
    annual.slice(-5).forEach(function (r) {
      var cfRow = sheetRowByDate(cfList, String(r['报告期']).slice(0, 10));
      var n = r['净利润'], o = cfRow ? cfRow['经营活动产生的现金流量净额'] : null;
      if (n != null && o != null) { sumNet += n; sumOcf += o; hit = true; }
    });
    var cashRatio = (hit && sumNet > 0) ? sumOcf / sumNet : null;

    // 7. 现金分红率 = 最近一次每股分红 ÷ 最近年报每股收益（股东回报意愿）；异常高（>150%）视为口径不可比置空
    var payout = null;
    var divs = (d.dividends || []).filter(function (x) { return x.bonus_per_10 != null && x.bonus_per_10 > 0; });
    if (divs.length && eps != null && eps > 0) {
      payout = (divs[0].bonus_per_10 / 10) / eps;
      if (payout > 1.5) payout = null;
    }

    // 8. 治理与诚信（造假风险反向）：造假分越低越诚信，管理越透明
    var fraud = null;
    try { fraud = fraudAnalysis(d).total; } catch (e) { /* 造假分缺失不影响其余维度 */ }

    var items = [
      it(feeLabel, fmtPct(feeRatio), '≤ 10%', 15, lerpScore(feeRatio, 0.10, 0.30, 15, 0)),
      it('资产运营：总资产周转率（营收÷总资产）', turnover == null ? '-' : fmtNum(turnover), '≥ 1.0', 10, lerpScore(turnover, 0.2, 1.0, 0, 10)),
      it('资本回报：净资产收益率（年报）', fmtPct(roe), '≥ 15%', 20, lerpScore(roe, 0, 0.15, 0, 20)),
      it('成长质量：营收约5年CAGR', fmtPct(revCagr), '≥ 10%', 10, lerpScore(revCagr, 0, 0.10, 0, 10)),
      it('营运资金：（应收＋存货）÷营收', fmtPct(wc), '≤ 15%', 10, lerpScore(wc, 0.15, 0.45, 10, 0)),
      it('现金流质量：近5年累计净现比（经营现金流÷净利润）', cashRatio == null ? '-' : fmtNum(cashRatio), '≥ 1.0', 15, lerpScore(cashRatio, 0, 1.0, 0, 15)),
      it('股东回报：现金分红率（每股分红÷每股收益）', fmtPct(payout), '≥ 50%', 10, lerpScore(payout, 0, 0.50, 0, 10)),
      it('治理诚信：财报造假风险反向（100−造假分）', fraud == null ? '-' : fmtNum(fraud), '造假分 0（最诚信）', 10, fraud == null ? null : lerpScore(fraud, 0, 100, 10, 0))
    ];
    var avail = items.filter(function (x) { return x.score != null; });
    var total = avail.length ? Math.min(100, avail.reduce(function (s, x) { return s + x.score; }, 0)) : null;
    return {
      title: '管理层管理水平 · 投入产出效率量化',
      basis: '评分基准：' + (lastYear || '-') + ' 年报（比率类按年报口径，成长/现金流按近5年累计，分红取最近一次）',
      total: total == null ? null : Math.round(total * 10) / 10,
      items: items,
      note: '借鉴 DEA 数据包络分析的“投入→产出”效率思想，将管理层能力拆为 8 个可量化维度加权 0~100 分：费用纪律/资产周转/资本回报/成长质量/营运资金/现金流质量/股东回报/治理诚信，分数越高管理水平越好。纯 DEA 相对效率依赖同行业大样本且为黑盒、无法逐项展示，故采用其效率内核的透明加权替代；数据不足的项不计分不误伤。本分为量化参考，需结合公司治理结构、股权激励、管理层履历等定性信息综合判断。'
    };
  }

  // 管理层评分卡（与 scoreCard 同构，等级方向高分=好=绿；符合度列 = 得分/权重）
  function managementCard(ma) {
    var g = gradeOf(ma.total);
    var effMax = 0, missN = 0;
    ma.items.forEach(function (x) { if (x.score != null) effMax += x.max; else missN += 1; });
    var rows = ma.items.map(function (x) {
      var mCls = x.match == null ? 'sc-na' : x.match >= 0.99 ? 'sc-good' : x.match >= 0.5 ? 'sc-mid' : 'sc-low';
      var mTxt = x.match == null ? '-' : (x.match * 100).toFixed(0) + '%';
      return '<tr><td>' + x.std + '</td><td class="v">' + x.val + '</td><td class="v">' + x.thr + '</td>' +
        '<td class="v ' + mCls + '">' + mTxt + '</td>' +
        '<td class="v"><b>' + (x.score == null ? '-' : fmtNum(x.score)) + '</b> / ' + x.max + '</td></tr>';
    }).join('');
    return '<div class="score-card-head"><h4>' + ma.title + '</h4>' +
      '<div class="score-circle va-grade-' + g + '"><span>管理分</span><b>' + (ma.total == null ? '-' : fmtNum(ma.total)) + '</b><i>' + gradeText(g) + '</i></div></div>' +
      '<p class="score-basis">' + ma.basis + (missN ? '；⚠ ' + missN + ' 项数据缺失未计分，本卡按有效满分 ' + effMax + '/100 折算' : '') + '</p>' +
      '<div class="stock-compare-wrap"><table class="stock-compare">' +
      '<thead><tr><th>评判维度</th><th>当前值</th><th>参考阈值</th><th>符合度</th><th>得分</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<p class="score-note">' + ma.note + '</p>';
  }

  // ---- 周期性行业判定 + 周期位置评分（0~100，分数越低越接近周期底部）----
  // 两阶段：①周期强度 0~100（净利波动40 + 深度下滑频率35 + 毛利率波动25），≥40 判为周期性；
  // ②周期性公司才打周期位置分（利润/毛利率/营收位置 + 同比动能 + 现金流 + 库存/资本开支周期 + 单季环比）。
  function cycleAnalysis(d) {
    var annual = annualRows(d.indicators || []);
    var cfList = (d.cashflow || []).slice().sort(function (a, b) { return a['报告日'] < b['报告日'] ? -1 : 1; });
    var baList = (d.balance || []).slice().sort(function (a, b) { return a['报告日'] < b['报告日'] ? -1 : 1; });
    var last = annual.length ? annual[annual.length - 1] : null;
    var lastDate = last ? String(last['报告期']).slice(0, 10) : null;
    var lastYear = lastDate ? Number(lastDate.slice(0, 4)) : null;

    // ---- 阶段一：周期强度判定（样本标准差，窗口取近 8 年年报）----
    var w8 = annual.slice(-8);
    var nets = w8.map(function (r) { return r['净利润']; }).filter(function (v) { return v != null; });
    var gms = w8.map(function (r) { return r['销售毛利率']; }).filter(function (v) { return v != null; });
    function sd(arr) {
      if (arr.length < 2) return null;
      var m = arr.reduce(function (s, x) { return s + x; }, 0) / arr.length;
      var v = arr.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (arr.length - 1);
      return Math.sqrt(v);
    }
    // 1a 净利变异系数 = 标准差 ÷ |均值|（均值取绝对值防近零放大；全亏取各年绝对值均值）
    var cvNet = null;
    if (nets.length >= 3) {
      var meanNet = nets.reduce(function (s, x) { return s + x; }, 0) / nets.length;
      var denom = Math.abs(meanNet);
      if (denom === 0) denom = nets.reduce(function (s, x) { return s + Math.abs(x); }, 0) / nets.length;
      if (denom > 0) cvNet = sd(nets) / denom;
    }
    // 1b 利润深度下滑频率：年度净利同比 ≤ -30% 的年数（同比自算，与报表口径一致）
    var drops = 0, yoyHist = [], hitDrop = false;
    for (var ci = 1; ci < annual.length; ci++) {
      var nCur = annual[ci]['净利润'], nPre = annual[ci - 1]['净利润'];
      var yoy = (nCur != null && nPre != null && nPre > 0) ? nCur / nPre - 1 : null;
      if (yoy != null) { yoyHist.push(yoy); hitDrop = true; if (yoy <= -0.3) drops++; }
    }
    // 1c 毛利率波动 = 年度毛利率标准差（价格驱动型周期行业毛利率大起大落）
    var gmSd = gms.length >= 3 ? sd(gms) : null;

    var cItems = [
      it('净利润波动：年度净利变异系数（标准差÷|均值|）', cvNet == null ? '-' : fmtNum(cvNet), '≥ 1.2 强周期', 40, lerpScore(cvNet, 0.3, 1.2, 0, 40)),
      it('利润深度下滑：年度净利同比≤-30% 的年数', hitDrop ? drops + ' 年' : '-', '≥ 2 年', 35, hitDrop ? lerpScore(drops, 0, 2, 0, 35) : null),
      it('毛利率波动：年度毛利率标准差', gmSd == null ? '-' : (gmSd * 100).toFixed(1) + ' pct', '≥ 10 pct', 25, lerpScore(gmSd, 0.03, 0.10, 0, 25))
    ];
    var cAvail = cItems.filter(function (x) { return x.score != null; });
    var cyc = cAvail.length ? Math.min(100, cAvail.reduce(function (s, x) { return s + x.score; }, 0)) : null;
    cyc = cyc == null ? null : Math.round(cyc * 10) / 10;
    var cyclical = cyc != null && cyc >= 40;

    if (!cyclical) {
      return {
        cyclical: false, cyclicalScore: cyc, cyclicalItems: cItems, total: null, items: [],
        title: '周期位置 · 周期性行业判定与底部概率量化',
        basis: cyc == null ? '样本不足：年报数据少于 3 期，无法判定周期性' :
          '周期强度 ' + fmtNum(cyc) + ' < 40，判定为非周期性/弱周期行业',
        note: '周期强度由近 8 年年报的净利润变异系数（40 分）+ 利润深度下滑频率（35 分）+ 毛利率波动（25 分）构成；≥ 40 判为周期性行业才进行周期位置打分。已知局限：判定基于约 8 年财务样本，近 8 年处于单边景气期的典型周期股（如上行期的资源股）波动特征不明显会被判为“非周期”，若窗口恰好覆盖单边行情也可能误判，需结合行业属性（如公用事业/消费/医药通常弱周期，钢铁/有色/化工/航运/造纸通常强周期）复核。'
      };
    }

    // ---- 阶段二：周期位置评分（分数越低越接近周期底部）----
    function pctOf(v, arr) {
      var vs = arr.filter(function (x) { return x != null; });
      if (v == null || vs.length < 2) return null;
      var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
      return mx === mn ? 0.5 : (v - mn) / (mx - mn);
    }
    var netLast = last ? last['净利润'] : null;
    var revLast = last ? last['营业总收入'] : null;
    var gmLast = last ? last['销售毛利率'] : null;
    // 2a/2c/2d 利润/毛利率/营收在近 8 年区间的位置（越接近最低越接近底部）
    var netPct = pctOf(netLast, nets);
    var gmPct = pctOf(gmLast, gms);
    var revs = w8.map(function (r) { return r['营业总收入']; });
    var revPct = pctOf(revLast, revs);
    // 2b 最新年报净利同比（深负=底部区域，过热=远离底部）
    var netYoy = yoyHist.length ? yoyHist[yoyHist.length - 1] : null;
    // 2e 最新年报净现比（底部常伴随现金流恶化）
    var lastCf = lastDate ? sheetRowByDate(cfList, lastDate) : null;
    var ocfLast = lastCf ? lastCf['经营活动产生的现金流量净额'] : null;
    var ncr = (netLast != null && ocfLast != null && netLast > 0) ? ocfLast / netLast : null;
    // 2f 存货同比（去库存 → 接近底部）
    var lastBa = lastDate ? sheetRowByDate(baList, lastDate) : null;
    var prevDate = annual.length >= 2 ? String(annual[annual.length - 2]['报告期']).slice(0, 10) : null;
    var prevBa = prevDate ? sheetRowByDate(baList, prevDate) : null;
    var invNow = lastBa ? lastBa['存货'] : null;
    var invPrev = prevBa ? prevBa['存货'] : null;
    var invGrow = (invNow != null && invPrev != null && invPrev > 0) ? invNow / invPrev - 1 : null;
    // 2g 资本开支强度 = 当年购建支出 ÷ 近 3 年均值（收缩 → 供给出清接近底部）
    var CAPEX_K = '购建固定资产、无形资产和其他长期资产所支付的现金';
    var annualCf = cfList.filter(function (r) { return String(r['报告日'] || '').slice(5) === '12-31'; });
    var capexNow = lastCf ? lastCf[CAPEX_K] : null;
    var capexPrev = annualCf.slice(-4, -1).map(function (r) { return r[CAPEX_K]; }).filter(function (v) { return v != null; });
    var capexRatio = null;
    if (capexNow != null && capexPrev.length >= 2) {
      var capexAvg = capexPrev.reduce(function (s, x) { return s + x; }, 0) / capexPrev.length;
      if (capexAvg > 0) capexRatio = capexNow / capexAvg;
    }
    // 2h 最新单季营收环比（仍在回落 → 未到底；环比回升 → 开始离开底部）
    var qRows = (d.indicators || []).filter(function (r) { return String(r['报告期'] || '').slice(5) !== '12-31'; })
      .sort(function (a, b) { return String(a['报告期']) < String(b['报告期']) ? -1 : 1; });
    var qrev = qRows.map(function (r) { return r['营业总收入_单季']; });
    var qoq = (qrev.length >= 2 && qrev[qrev.length - 2] != null && qrev[qrev.length - 2] > 0 && qrev[qrev.length - 1] != null)
      ? qrev[qrev.length - 1] / qrev[qrev.length - 2] - 1 : null;

    var items = [
      it('利润位置：最新年报净利在近' + w8.length + '年区间的位置', netLast == null ? '-' : fmtMoney(netLast), '接近最低分→底部', 25, netPct == null ? null : netPct * 25),
      it('利润动能：最新年报净利同比', netYoy == null ? '-' : fmtPct(netYoy), '≤ -50% 底部', 15, lerpScore(netYoy, -0.50, 0.30, 0, 15)),
      it('毛利率位置：最新年报毛利率在近' + w8.length + '年区间的位置', gmLast == null ? '-' : fmtPct(gmLast), '接近最低分→底部', 15, gmPct == null ? null : gmPct * 15),
      it('营收位置：最新年报营收在近' + w8.length + '年区间的位置', revLast == null ? '-' : fmtMoney(revLast), '接近最低分→底部', 10, revPct == null ? null : revPct * 10),
      it('现金流压力：最新年报净现比（经营现金流÷净利润）', ncr == null ? '-' : fmtNum(ncr), '≤ 0 底部', 10, lerpScore(ncr, 0, 1.2, 0, 10)),
      it('库存周期：存货同比（去库存→接近底部）', invGrow == null ? '-' : fmtPct(invGrow), '≤ -10% 去库存', 10, lerpScore(invGrow, -0.10, 0.20, 0, 10)),
      it('资本开支周期：当年购建支出÷近3年均值（收缩→出清）', capexRatio == null ? '-' : fmtNum(capexRatio), '≤ 0.7 收缩', 10, lerpScore(capexRatio, 0.7, 1.3, 0, 10)),
      it('单季环比：最新单季营收环比（回升→离开底部）', qoq == null ? '-' : fmtPct(qoq), '≤ -10% 仍在探底', 10, lerpScore(qoq, -0.10, 0.05, 0, 10))
    ];
    var avail = items.filter(function (x) { return x.score != null; });
    var total = avail.length ? Math.min(100, avail.reduce(function (s, x) { return s + x.score; }, 0)) : null;
    return {
      cyclical: true, cyclicalScore: cyc, cyclicalItems: cItems,
      total: total == null ? null : Math.round(total * 10) / 10,
      items: items,
      title: '周期位置 · 周期性行业判定与底部概率量化',
      basis: '周期强度 ' + fmtNum(cyc) + '（≥ 40 判为周期性）；位置评分基准：' + (lastYear || '-') + ' 年报 + 最新单季',
      note: '两阶段量化：①周期强度（净利变异系数 40 + 深度下滑频率 35 + 毛利率波动 25，≥ 40 判为周期性，非周期性不打分）；②周期位置 0~100，分数越低越接近周期底部（利润/毛利率/营收处于历史低位、同比深负、现金流承压、去库存、资本开支收缩、单季仍在回落均为底部特征）。已知局限：基于约 8 年样本的相对位置，近 8 年单边景气期的典型周期股会被判为“非周期”；无历史市价分位数据故未纳入估值维度；周期位置低≠立即反转，需结合行业供需与产能数据确认，仅供研究参考。'
    };
  }

  // 周期位置等级（分数越低越接近底部=机会=绿，方向同造假分）与文案
  function cycleGradeText(g) {
    return { good: '底部区域', mid: '磨底过渡', low: '周期中段', bad: '景气偏高', na: '不适用' }[g];
  }

  // 周期评分卡：非周期性公司显示判定依据表；周期性公司另加周期强度表 + 8 维位置表（低分=绿）
  function cycleCard(ca) {
    function dimRows(items) {
      return items.map(function (x) {
        var mCls = x.match == null ? 'sc-na' : x.match >= 0.99 ? 'sc-good' : x.match >= 0.5 ? 'sc-mid' : 'sc-low';
        var mTxt = x.match == null ? '-' : (x.match * 100).toFixed(0) + '%';
        return '<tr><td>' + x.std + '</td><td class="v">' + x.val + '</td><td class="v">' + x.thr + '</td>' +
          '<td class="v ' + mCls + '">' + mTxt + '</td>' +
          '<td class="v"><b>' + (x.score == null ? '-' : fmtNum(x.score)) + '</b> / ' + x.max + '</td></tr>';
      }).join('');
    }
    var head;
    if (!ca.cyclical) {
      head = '<div class="score-circle va-grade-na"><span>周期</span><b>非周期</b><i>不适用</i></div>';
    } else {
      var g = fraudGradeOf(ca.total);
      head = '<div class="score-circle va-grade-' + g + '"><span>周期位</span><b>' + (ca.total == null ? '-' : fmtNum(ca.total)) + '</b><i>' + cycleGradeText(g) + '</i></div>';
    }
    var tableHead = '<thead><tr><th>指标</th><th>当前值</th><th>参考阈值</th><th>符合度</th><th>得分</th></tr></thead>';
    var h = '<div class="score-card-head"><h4>' + ca.title + '</h4>' + head + '</div>' +
      '<p class="score-basis">' + ca.basis + '</p>';
    if (ca.cyclical) {
      h += '<div class="stock-compare-wrap"><h4 style="margin:8px 0 4px">阶段一：周期强度判定（' + (ca.cyclicalScore == null ? '-' : fmtNum(ca.cyclicalScore)) + ' / 40 即判为周期性）</h4>' +
        '<table class="stock-compare">' + tableHead + '<tbody>' + dimRows(ca.cyclicalItems) + '</tbody></table></div>';
    }
    if (ca.items.length) {
      h += '<div class="stock-compare-wrap"><h4 style="margin:8px 0 4px">阶段二：周期位置评分（分数越低越接近周期底部）</h4>' +
        '<table class="stock-compare">' + tableHead + '<tbody>' + dimRows(ca.items) + '</tbody></table></div>';
    } else {
      h += '<div class="stock-compare-wrap"><h4 style="margin:8px 0 4px">阶段一：周期强度判定明细</h4>' +
        '<table class="stock-compare">' + tableHead + '<tbody>' + dimRows(ca.cyclicalItems) + '</tbody></table></div>';
    }
    return h + '<p class="score-note">' + ca.note + '</p>';
  }

  // ---- 年度周期位置分回溯 + 趋势状态（上行/反转/筑底/下行）----
  // 逐年回溯：对每个年报年，以该年为窗口末尾取最近 8 年年报，用与 cycleAnalysis 阶段二相同的 8 维逻辑打分；
  // 单季环比逐年参与：历史年用该年自身单季营收环比，末年用全局最新单季环比（与当期总分口径对齐），故各年均为满 8 维、同口径可比。
  function cycleHistory(d) {
    var annual = annualRows(d.indicators || []);
    var cfList = (d.cashflow || []).slice().sort(function (a, b) { return a['报告日'] < b['报告日'] ? -1 : 1; });
    var baList = (d.balance || []).slice().sort(function (a, b) { return a['报告日'] < b['报告日'] ? -1 : 1; });
    var CAPEX_K = '购建固定资产、无形资产和其他长期资产所支付的现金';
    var annualCf = cfList.filter(function (r) { return String(r['报告日'] || '').slice(5) === '12-31'; });
    var qRows = (d.indicators || []).filter(function (r) { return String(r['报告期'] || '').slice(5) !== '12-31'; })
      .sort(function (a, b) { return String(a['报告期']) < String(b['报告期']) ? -1 : 1; });
    var qrev = qRows.map(function (r) { return r['营业总收入_单季']; });
    var qoq = (qrev.length >= 2 && qrev[qrev.length - 2] != null && qrev[qrev.length - 2] > 0 && qrev[qrev.length - 1] != null)
      ? qrev[qrev.length - 1] / qrev[qrev.length - 2] - 1 : null;
    // 按年归档单季营收（升序，保留 null），供逐年环比：各年取该年最后两个单季（Q3/Q2）
    var interimByYear = {};
    qRows.forEach(function (r) {
      var yr = String(r['报告期'] || '').slice(0, 4);
      (interimByYear[yr] = interimByYear[yr] || []).push(r['营业总收入_单季']);
    });
    function yearQoq(yr) {
      var vals = interimByYear[String(yr)] || [];
      if (vals.length >= 2 && vals[vals.length - 2] != null && vals[vals.length - 2] > 0 && vals[vals.length - 1] != null) {
        return vals[vals.length - 1] / vals[vals.length - 2] - 1;
      }
      return null;
    }
    function pctOf(v, arr) {
      var vs = arr.filter(function (x) { return x != null; });
      if (v == null || vs.length < 2) return null;
      var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
      return mx === mn ? 0.5 : (v - mn) / (mx - mn);
    }
    var out = [];
    for (var i = 2; i < annual.length; i++) {  // 需至少 3 年窗口且同比可算（i≥2）
      var row = annual[i];
      var year = Number(String(row['报告期']).slice(0, 4));
      var win = annual.slice(Math.max(0, i - 7), i + 1);
      var nets = win.map(function (r) { return r['净利润']; });
      var gms = win.map(function (r) { return r['销售毛利率']; });
      var revs = win.map(function (r) { return r['营业总收入']; });
      var net = row['净利润'], prev = annual[i - 1]['净利润'];
      var yoy = (net != null && prev != null && prev > 0) ? net / prev - 1 : null;
      var date = String(row['报告期']).slice(0, 10);
      var cf = sheetRowByDate(cfList, date);
      var ba = sheetRowByDate(baList, date);
      var baPrev = sheetRowByDate(baList, String(annual[i - 1]['报告期']).slice(0, 10));
      var ocf = cf ? cf['经营活动产生的现金流量净额'] : null;
      var ncr = (net != null && ocf != null && net > 0) ? ocf / net : null;
      var invNow = ba ? ba['存货'] : null;
      var invPrev = baPrev ? baPrev['存货'] : null;
      var invGrow = (invNow != null && invPrev != null && invPrev > 0) ? invNow / invPrev - 1 : null;
      var capexNow = cf ? cf[CAPEX_K] : null;
      var capexPrev = annualCf.slice(Math.max(0, annualCf.indexOf(cf) - 3), annualCf.indexOf(cf))
        .map(function (r) { return r[CAPEX_K]; }).filter(function (v) { return v != null; });
      var capexRatio = null;
      if (capexNow != null && capexPrev.length >= 2) {
        var capexAvg = capexPrev.reduce(function (s, x) { return s + x; }, 0) / capexPrev.length;
        if (capexAvg > 0) capexRatio = capexNow / capexAvg;
      }
      // 单季环比：末年用全局最新单季环比（与当期总分一致），历史年用该年自身单季环比（满 8 维）
      var qoqI = (i === annual.length - 1) ? qoq : yearQoq(year);
      var scores = [
        pctOf(net, nets) == null ? null : pctOf(net, nets) * 25,
        lerpScore(yoy, -0.50, 0.30, 0, 15),
        pctOf(row['销售毛利率'], gms) == null ? null : pctOf(row['销售毛利率'], gms) * 15,
        pctOf(row['营业总收入'], revs) == null ? null : pctOf(row['营业总收入'], revs) * 10,
        lerpScore(ncr, 0, 1.2, 0, 10),
        lerpScore(invGrow, -0.10, 0.20, 0, 10),
        lerpScore(capexRatio, 0.7, 1.3, 0, 10),
        lerpScore(qoqI, -0.10, 0.05, 0, 10)
      ];
      var avail = scores.filter(function (s) { return s != null; });
      var sc = avail.length ? Math.round(Math.min(100, avail.reduce(function (s, x) { return s + x; }, 0)) * 10) / 10 : null;
      out.push({ year: year, score: sc });
    }
    return out;
  }

  // 趋势状态（基于逐年回溯分，最新年相对上一年）：
  // 反转=上一年还在底部区（≤30）且最新分明显回升；上行=持续回升；筑底=低位（≤40）横盘；下行=分数走低（基本面恶化）
  function cycleTrendOf(hist) {
    var h = (hist || []).filter(function (x) { return x.score != null; });
    if (h.length < 2) return null;
    var d1 = h[h.length - 1].score - h[h.length - 2].score;
    if (d1 > 5) return h[h.length - 2].score <= 30 ? 'rev' : 'up';
    if (d1 < -5) return 'down';
    if (h[h.length - 1].score <= 40) return 'flat';
    return d1 >= 0 ? 'up' : 'down';
  }

  function cycleTrendText(t) {
    return { up: '上行', rev: '反转', flat: '筑底', down: '下行' }[t] || '';
  }

  // 详情页历年周期位置分趋势图（仅周期性公司且 ≥2 个有效年份才显示；曲线下探=接近底部）
  function renderCycleChart(d, ca) {
    var block = $('stock-cycle-chart-block');
    var el = $('stock-chart-cycle');
    if (!block || !el) return;
    if (!ca.cyclical || typeof echarts === 'undefined') { block.style.display = 'none'; return; }
    var hist = cycleHistory(d).filter(function (x) { return x.score != null; });
    if (hist.length < 2) { block.style.display = 'none'; return; }
    block.style.display = '';
    var chart = echarts.init(el);
    state.charts.push(chart);
    chart.setOption({
      grid: { left: 44, right: 18, top: 32, bottom: 30 },
      tooltip: { trigger: 'axis', valueFormatter: function (v) { return v == null ? '-' : v + ' 分'; } },
      xAxis: { type: 'category', data: hist.map(function (x) { return x.year; }) },
      yAxis: { type: 'value', min: 0, max: 100, name: '周期位置分', splitLine: { lineStyle: { type: 'dashed' } } },
      series: [{
        name: '周期位置分', type: 'line', data: hist.map(function (x) { return x.score; }),
        smooth: false, symbol: 'circle', symbolSize: 8,
        label: { show: true, position: 'top', fontSize: 10 },
        itemStyle: { color: '#b07a10' }, lineStyle: { width: 2 },
        markLine: { symbol: 'none', silent: true, label: { formatter: '底部区 ≤ 30', position: 'insideEndTop', fontSize: 10 },
          lineStyle: { color: '#1e7e44', type: 'dashed' }, data: [{ yAxis: 30 }] },
        markArea: { silent: true, itemStyle: { color: 'rgba(30,126,68,0.08)' }, data: [[{ yAxis: 0 }, { yAxis: 30 }]] }
      }]
    });
  }

  // 趋势图标（列表宽表/移动端徽标共用）：反转/上行 ▲绿、筑底 ◆琥珀、下行 ▼红；无趋势返回空串
  function cycleTrendIcon(t, title) {
    if (!t) return '';
    var sym = (t === 'up' || t === 'rev') ? '▲' : (t === 'down' ? '▼' : '◆');
    var cls = (t === 'up' || t === 'rev') ? 'cy-up' : (t === 'down' ? 'cy-down' : 'cy-flat');
    return '<i class="cy-t ' + cls + '" title="' + (title || cycleTrendText(t)) + '">' + sym + '</i>';
  }

  // ---- 价格参考（买入/保守卖出/公允卖出）----
  // 买入价：二分反推使该流派总分 ≥ 90 的最高市值对应股价；质量项托底已达标或不随价格变化时为 null。
  // 卖出价：锚定各流派核心估值指标的阈值倍数（不随质量分托底失真）。
  // ⚠ 二分循环调用 valueScores，本函数绝不可在 valueScores 内部调用（防递归），由 renderDetail 单独挂载。

  // 类现金加权口径（与 scoring.py 一致）：科目键 → [展示名, 折算系数]
  var NET_CASH_W = [
    ['cash', '货币资金', 1],
    ['fin', '交易性金融资产', 0.7],
    ['notes', '应收票据', 0.4],
    ['otherCA', '其他流动资产', 0.3]
  ];

  // 净现金/市值 代入计算式（多行文本，桌面 title 与移动端点击浮层共用）；无明细返回空串
  function netCashFormula(refs) {
    var c = refs && refs.netCashCalc;
    if (!c || !c.mcap) return '';
    var wSum = 0, items = [];
    NET_CASH_W.forEach(function (it) {
      var v = c[it[0]];
      if (v == null) return;               // 缺失科目不参与折算也不展示
      wSum += v * it[2];
      items.push(it[1] + fmtMoney(v) + '×' + it[2]);
    });
    var lines = [
      '净现金/市值 ＝（' + items.join(' ＋ ') + ' − 负债合计' + fmtMoney(c.tl) + '）÷ 总市值' + fmtMoney(c.mcap),
      '＝ (' + fmtMoney(wSum) + ' − ' + fmtMoney(c.tl) + ') ÷ ' + fmtMoney(c.mcap) +
        ' ＝ ' + ((wSum - c.tl) / c.mcap * 100).toFixed(1) + '%'
    ];
    if (c.report) lines.push('资产负债表：' + c.report);
    return lines.join('\n');
  }

  // 点击处弹出代入计算式浮层（桌面/移动端共用；点空白处或滚动时关闭）
  function showNetFormulaPop(anchor) {
    var row = anchor.closest('.stock-row');
    if (!row) return;
    var code = row.getAttribute('data-code');
    var sc = state.scores[code];
    var text = sc ? netCashFormula(sc.priceRefs) : '';
    if (!text) return;
    var name = null;
    state.companies.forEach(function (cc) { if (cc.code === code) name = cc.name; });
    if (name) text = name + '\n' + text;
    var pop = document.getElementById('sc-net-pop');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'sc-net-pop';
      pop.className = 'sc-net-pop';
      pop.addEventListener('click', function (e) { e.stopPropagation(); });
      document.body.appendChild(pop);
    }
    pop.textContent = text;
    pop.style.display = 'block';
    var r = anchor.getBoundingClientRect();
    var pw = Math.min(window.innerWidth - 16, 460), ph = pop.offsetHeight;
    var x = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 8);
    var y = (r.bottom + ph + 12 > window.innerHeight) ? Math.max(8, r.top - ph - 10) : r.bottom + 10;
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
    setTimeout(function () {
      document.addEventListener('click', closeNetFormulaPop);
      document.addEventListener('keydown', escNetFormulaPop);
      window.addEventListener('resize', closeNetFormulaPop);
      window.addEventListener('scroll', closeNetFormulaPop, true);
    }, 0);
  }

  function escNetFormulaPop(e) {
    if (e.key === 'Escape') closeNetFormulaPop();
  }

  function closeNetFormulaPop() {
    var pop = document.getElementById('sc-net-pop');
    if (pop) pop.style.display = 'none';
    document.removeEventListener('click', closeNetFormulaPop);
    document.removeEventListener('keydown', escNetFormulaPop);
    window.removeEventListener('resize', closeNetFormulaPop);
    window.removeEventListener('scroll', closeNetFormulaPop, true);
  }

  // 巴菲特合理市盈率 = 净利5年CAGR×100，夹在 [8, 25]；无数据取 15
  function fairPe(netCagr5) {
    if (netCagr5 == null) return 15;
    return Math.max(8, Math.min(25, netCagr5 * 100));
  }

  // 二分找总分 ≥ 目标的最大缩放因子 k，返回买入价 = price0×k；无解返回 null
  function bisectBuy(scoreFn, price0) {
    var TARGET = 90, K_HI = 1000, ITERS = 80; // 常量与 scoring.py 一致
    var tMax = scoreFn(1e-9);        // k→0：价格项全满分的上限
    var tInf = scoreFn(K_HI);        // k→很大：价格项归零后的质量分托底
    if (tMax == null || tInf == null) return null;
    if (tMax - tInf < 1e-9) return null;   // 总分不随价格变（无价格项），无法反推
    if (tInf >= TARGET) return null;       // 质量分已达标，买入价无上界
    var tgt = Math.min(TARGET, tMax);      // 上限不足 90 时取“刚好到上限”
    var lo = 0, hi = K_HI;
    for (var i = 0; i < ITERS; i++) {
      var mid = (lo + hi) / 2;
      if (scoreFn(mid) >= tgt) lo = mid; else hi = mid;
    }
    return price0 * lo;
  }

  // 公允清算价值 + 四大流派买入/保守卖出/公允卖出价格参考（对应 scoring.py price_references）
  // fairLiq = 每股公允清算价值（流动资产合计-负债合计）/财报股本，格雷厄姆清算口径
  // netCashRatio = 净现金/市值（最近一期财报 加权类现金−负债合计 ÷ 快照总市值）
  function priceReferences(d, va) {
    var s = d.snapshot || {};
    var price0 = s.price, mcap0 = s.market_cap, pe0 = s.pe_ttm, pb0 = s.pb;
    var none = { fairLiq: null, buy: null, sellCons: null, sellFair: null };
    if (price0 == null || price0 <= 0) {
      return { fairLiq: null, netCashRatio: null, netCashCalc: null, grahamAgg: none, grahamDef: none, schloss: none, buffett: none };
    }
    // ---- 基础量（最新年报资产负债表）----
    var annual = annualRows(d.indicators || []);
    var last = annual[annual.length - 1];
    var lastDate = last ? String(last['报告期']).slice(0, 10) : null;
    var baList = (d.balance || []).slice().sort(function (a, b) { return a['报告日'] < b['报告日'] ? -1 : 1; });
    var lastBa = lastDate ? sheetRowByDate(baList, lastDate) : null;
    var ca = lastBa ? lastBa['流动资产合计'] : null;
    var tl = lastBa ? lastBa['负债合计'] : null;
    var ncav = (ca != null && tl != null) ? ca - tl : null;
    var lastEq = lastBa ? (lastBa['归属于母公司股东权益合计'] != null ? lastBa['归属于母公司股东权益合计'] : lastBa['所有者权益(或股东权益)合计']) : null;
    // 每股净资产优先用指标字段（数据源按财报算好、随财报更新，与实时价无关），
    // 避免快照 pb/pe 舍入与 mcap 滞后导致参考价随行情漂移（财务无变化时参考价应不变）
    var bps = latestField(d.indicators, '每股净资产');
    // 股本优先用财报实收资本（最新年报），快照 mcap/price 会随实时价抖动（快照舍入/滞后）
    var shares = shareCount(d.balance, mcap0 != null ? mcap0 / price0 : null, bps);
    var ncavPs = (ncav != null && shares) ? ncav / shares : null;   // 每股净流动资产
    if (bps == null && lastEq != null && shares) bps = lastEq / shares;
    if (bps == null && pb0 != null && pb0 > 0) bps = price0 / pb0;
    var epsTtm = epsTtmField(d.indicators);
    if (epsTtm == null) {
      var ttmNet = ttmNetProfit(d.indicators);
      if (ttmNet != null && shares) epsTtm = ttmNet / shares;
    }
    if (epsTtm == null && pe0 != null && pe0 > 0) epsTtm = price0 / pe0;
    // 净现金/市值：最近一期财报（加权类现金 − 负债合计）÷ 快照总市值；
    // 类现金保守折算：货币资金×1.0 ＋ 交易性金融资产×0.7 ＋ 应收票据×0.4 ＋ 其他流动资产×0.3；
    // 分子随财报更新（含季报），分母随行情快照，缺失科目按 0 折入
    var lastBaAll = baList[baList.length - 1];
    function gv(key) {
      var v = lastBaAll ? lastBaAll[key] : null;
      return (typeof v === 'number') ? v : null;
    }
    var cashV = gv('货币资金');
    var finV = gv('交易性金融资产');
    var notesV = gv('应收票据');
    var otherV = gv('其他流动资产');
    var tlLatest = gv('负债合计');
    function wgt(v, k) { return v != null ? v * k : 0; }
    var weightedCash = wgt(cashV, 1) + wgt(finV, 0.7) + wgt(notesV, 0.4) + wgt(otherV, 0.3);
    var hasCore = cashV != null && tlLatest != null && mcap0;
    var netCashRatio = hasCore ? (weightedCash - tlLatest) / mcap0 : null;
    var netCashCalc = hasCore ? {
      cash: cashV, fin: finV, notes: notesV, otherCA: otherV,
      tl: tlLatest, mcap: mcap0,
      report: String(lastBaAll['报告日'] || '').slice(0, 10) || null
    } : null;
    var fpe = fairPe(va.netCagr5);
    function buyOf(key) {
      return bisectBuy(function (kk) { return valueScores(d, va, kk, true)[key].total; }, price0);
    }
    // 买入价不超过本流派估值锚（保守卖出价）：质量分托底时反推价可能高于锚位，
    // 截断后仍满足“该价时评分≥90”且避免买入参考高于卖出参考的矛盾
    function clampBuy(buy, anchor) {
      if (buy != null && anchor != null && buy > anchor) return anchor;
      return buy;
    }
    var gACons = (ncavPs != null && ncavPs > 0) ? ncavPs : null;
    var gDCons = (epsTtm != null && epsTtm > 0) ? 15 * epsTtm : null;
    var sCons = (bps != null && bps > 0) ? bps : null;
    // TTM 每股亏损（≤0）时基于 EPS 的估值锚无意义，锚位与买入价一并置空（避免负价/误导价）
    var epsOk = epsTtm != null && epsTtm > 0;
    var bCons = epsOk ? fpe * epsTtm : null;
    return {
      fairLiq: (ncavPs != null && ncavPs > 0) ? ncavPs : null,
      netCashRatio: netCashRatio,
      netCashCalc: netCashCalc,
      grahamAgg: {
        buy: clampBuy(buyOf('grahamAgg'), gACons),
        sellCons: gACons,
        sellFair: (ncavPs != null && ncavPs > 0) ? 1.5 * ncavPs : null
      },
      grahamDef: {
        buy: epsOk ? clampBuy(buyOf('grahamDef'), gDCons) : null,
        sellCons: gDCons,
        sellFair: epsOk ? 20 * epsTtm : null
      },
      schloss: {
        buy: clampBuy(buyOf('schloss'), sCons),
        sellCons: sCons,
        sellFair: (bps != null && bps > 0) ? 1.5 * bps : null
      },
      buffett: {
        buy: epsOk ? clampBuy(fpe * epsTtm * 2 / 3, bCons) : null,
        sellCons: bCons,
        sellFair: epsOk ? fpe * epsTtm * 1.3 : null
      }
    };
  }

  // 渲染四大评分卡（格雷厄姆进取/防御、施洛斯、巴菲特芒格）
  function renderScores(sc) {
    var curPrice = ((sc.d || {}).snapshot || {}).price;
    var refs = sc.priceRefs || {};
    var cards = [
      ['stock-score-graham-agg', sc.grahamAgg, refs.grahamAgg],
      ['stock-score-graham-def', sc.grahamDef, refs.grahamDef],
      ['stock-score-schloss', sc.schloss, refs.schloss],
      ['stock-score-buffett', sc.buffett, refs.buffett]
    ];
    cards.forEach(function (trio) {
      var el = $(trio[0]);
      // 缺维标注：存在数据缺失项时标注有效满分，提醒总分非同口径 100 分制（跨市场可比性）
      var eff = trio[1].eff;
      var basis = sc.basis + (eff && eff.miss
        ? '；⚠ ' + eff.miss + ' 项数据缺失未计分，本卡按有效满分 ' + eff.max + '/100 折算' : '');
      if (el) el.innerHTML = scoreCard(trio[1].title, basis, trio[1].total, trio[1].items, trio[1].note, trio[2], curPrice);
    });
  }

  // 模块锚点导航：平滑滚动（避免与 #/code 路由冲突）
  function bindVaNav() {
    document.querySelectorAll('.va-nav a').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var el = $(a.getAttribute('data-scroll'));
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // 每股派息柱状图 + 净现比柱状图（renderDetail 时重建实例，随 state.charts 统一销毁）
  function renderVaCharts(va) {
    if (typeof echarts === 'undefined') return;
    if (!state.charts.length) return; // 图表区未初始化时也不建（正常流程 charts 已由 renderCharts 建立）

    var divData = va.divChart.map(function (r) { return r.value; });
    var divYears = va.divChart.map(function (r) { return String(r.year); });
    var ch1 = echarts.init($('stock-chart-dividend'));
    state.charts.push(ch1);
    ch1.setOption({
      tooltip: { trigger: 'axis', valueFormatter: function (v) { return v == null ? '-' : v + ' 元'; } },
      grid: { left: 46, right: 16, top: 24, bottom: 30 },
      xAxis: { type: 'category', data: divYears, axisLabel: { fontSize: 11 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 11, formatter: function (v) { return v + ' 元'; } } },
      series: [{ type: 'bar', barMaxWidth: 28, itemStyle: { color: '#61c0a8' },
        data: divData, label: { show: true, position: 'top', fontSize: 10, formatter: function (p) { return p.value; } } }]
    });

    var cf5 = va.cfRows;
    var ch2 = echarts.init($('stock-chart-netcash'));
    state.charts.push(ch2);
    ch2.setOption({
      tooltip: { trigger: 'axis', valueFormatter: function (v) { return v == null ? '-' : v; } },
      grid: { left: 46, right: 16, top: 24, bottom: 30 },
      xAxis: { type: 'category', data: cf5.map(function (r) { return r.year; }), axisLabel: { fontSize: 11 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 11 } },
      series: [{
        name: '净现比', type: 'bar', barMaxWidth: 28,
        itemStyle: { color: '#5b8ff9' },
        data: cf5.map(function (r) { return r.ratio; }),
        markLine: { silent: true, symbol: 'none', lineStyle: { color: '#e8684a', type: 'dashed' },
          data: [{ yAxis: 1, label: { formatter: '净现比=1', fontSize: 10 } }] }
      }]
    });
  }

  function fmtPct(v) {
    if (v == null || isNaN(v)) return '-';
    return (v * 100).toFixed(2) + '%';
  }

  function kv(k, v) {
    return '<div class="kv"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
  }

  function sheetTab(key, label) {
    return '<button data-sheet="' + key + '">' + label + '</button>';
  }

  /* ---------------- 指标趋势图（3 个独立图表，支持季/年视图切换） ---------------- */

  function renderCharts(indicators) {
    if (typeof echarts === 'undefined') {
      $('stock-chart-revenue').innerHTML = '<p class="stock-hint">图表库加载失败（ECharts CDN 不可用）</p>';
      return;
    }
    var isYear = state.view === 'year';
    var rows = indicators.slice().reverse(); // 升序排列
    // 年视图仅保留年报（12-31）报告期
    var data = isYear
      ? rows.filter(function (r) { return String(r['报告期']).indexOf('12-31') >= 0; })
      : rows;
    var dates = data.map(function (r) { return fmtDate(r['报告期']); });

    // 标题与注释随视图切换
    $('stock-chart-title').textContent = isYear
      ? '关键指标趋势（年度口径）'
      : '关键指标趋势（近 ' + indicators.length + ' 期）';
    $('stock-chart-revenue-title').textContent = '营业总收入 & 净利润（' + (isYear ? '全年' : '单季') + '，亿元）';
    $('stock-chart-margin-title').textContent = '销售毛利率 & 销售净利率（' + (isYear ? '年度' : '报告期') + '口径）';
    $('stock-chart-roe-title').textContent = '净资产收益率（' + (isYear ? '年度' : '各期累计') + '）';
    $('stock-chart-note').textContent = isYear
      ? '年度口径：柱为全年累计值，折线为年度同比（右轴 %）'
      : '季度口径：柱为单季值（本期累计 - 上期累计），折线为同比/环比（右轴 %，虚线=环比）；ROE 为报告期累计值';

    // 首次渲染创建实例，切换视图时复用并整体替换 option
    if (!state.charts.length) {
      ['stock-chart-revenue', 'stock-chart-margin', 'stock-chart-roe'].forEach(function (id) {
        state.charts.push(echarts.init($(id)));
      });
      window.onresize = function () {
        state.charts.forEach(function (c) { c.resize(); });
      };
    }

    // 通用配置：图例 + 缩放条 + 双 Y 轴（左=指标值，右=增长率 %）
    // 默认显示窗口：年度=最近 3 年，季度=最近 8 个季度（可拖动缩放条查看全部）
    var zoomN = isYear ? 3 : 8;
    function baseOption(legendData, yName, yFormatter) {
      return {
        tooltip: {
          trigger: 'axis',
          valueFormatter: function (v) { return v == null ? '-' : (yFormatter ? yFormatter(v) : v); }
        },
        legend: { data: legendData, top: 0 },
        grid: { left: 60, right: 56, top: 34, bottom: 46 },
        xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 11 } },
        yAxis: [
          { type: 'value', name: yName, axisLabel: { fontSize: 11, formatter: yFormatter } },
          {
            type: 'value', name: '增长率',
            axisLabel: { fontSize: 11, formatter: fmtPctAxis },
            splitLine: { show: false }
          }
        ],
        dataZoom: [
          { type: 'inside', startValue: data.length - zoomN, endValue: data.length - 1 },
          { type: 'slider', height: 14, bottom: 6, startValue: data.length - zoomN, endValue: data.length - 1 }
        ],
        series: []
      };
    }

    // 金额系列（亿元柱状；年视图取累计字段，季视图取单季字段）
    function barYiSeries(name, key, color) {
      return {
        name: name, type: 'bar', barMaxWidth: 22,
        itemStyle: { color: color },
        data: data.map(function (r) {
          return r[key] == null ? null : +(r[key] / 1e8).toFixed(2);
        })
      };
    }

    // 比率系列（% 折线，服务端已是小数）
    function pctLineSeries(name, key, color) {
      return {
        name: name, type: 'line', smooth: true,
        itemStyle: { color: color },
        data: data.map(function (r) {
          return r[key] == null ? null : +(r[key] * 100).toFixed(2);
        })
      };
    }

    function fmtPctAxis(v) { return v + '%'; }

    // 增长率折线（右轴 %）：同比=隔 N 期，环比=隔 1 期；虚线为环比
    function growthLine(name, field, color, step, dashed) {
      return {
        name: name, type: 'line', smooth: true, yAxisIndex: 1,
        symbolSize: 4,
        itemStyle: { color: color },
        lineStyle: { color: color, width: 1.5, type: dashed ? 'dashed' : 'solid' },
        data: data.map(function (r, i) {
          if (i < step) return null;
          var cur = r[field], prev = data[i - step][field];
          if (cur == null || prev == null || prev === 0) return null;
          return +((cur - prev) / Math.abs(prev) * 100).toFixed(1);
        })
      };
    }

    // 图 1：营业总收入 & 净利润（柱）+ 同比/环比增长率（折线，右轴 %）
    var revKey = isYear ? '营业总收入' : '营业总收入_单季';
    var netKey = isYear ? '净利润' : '净利润_单季';
    var opt1Legend = isYear
      ? ['营业总收入', '净利润', '营收同比', '净利同比']
      : ['营业总收入', '净利润', '营收同比', '净利同比', '营收环比', '净利环比'];
    var opt1 = baseOption(opt1Legend, '亿元');
    opt1.series = [
      barYiSeries('营业总收入', revKey, '#5b8ff9'),
      barYiSeries('净利润', netKey, '#61c0a8'),
      growthLine('营收同比', revKey, '#5b8ff9', isYear ? 1 : 4, false),
      growthLine('净利同比', netKey, '#61c0a8', isYear ? 1 : 4, false)
    ];
    if (!isYear) {
      opt1.series.push(growthLine('营收环比', revKey, '#5b8ff9', 1, true));
      opt1.series.push(growthLine('净利环比', netKey, '#61c0a8', 1, true));
    }
    state.charts[0].setOption(opt1, true);

    // 图 2：销售毛利率 & 销售净利率
    var opt2 = baseOption(['销售毛利率', '销售净利率'], '%', fmtPctAxis);
    opt2.series = [
      pctLineSeries('销售毛利率', '销售毛利率', '#f6bd16'),
      pctLineSeries('销售净利率', '销售净利率', '#e8684a')
    ];
    state.charts[1].setOption(opt2, true);

    // 图 3：净资产收益率
    var opt3 = baseOption(['净资产收益率'], '%', fmtPctAxis);
    opt3.series = [pctLineSeries('净资产收益率', '净资产收益率', '#5b8ff9')];
    state.charts[2].setOption(opt3, true);
  }

  /* ---------------- 季/年视图切换 ---------------- */

  function bindViewToggle() {
    var btns = document.querySelectorAll('.stock-view-toggle button');
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.classList.contains('active')) return;
        btns.forEach(function (x) { x.classList.toggle('active', x === b); });
        state.view = b.dataset.view;
        if (state.current) renderCharts(state.current.indicators || []);
      });
    });
  }

  /* ---------------- 财务对比（年报/季报，任意两个报告期） ---------------- */

  // 对比指标配置（type: amount=亿元相对变化, pct=百分点差, ratio/yuan=绝对差, days=天数差）
  // keySingle: 金额类在季报对比时改用单季字段（与图表季视图口径一致）
  // src: 数据来源（缺省 indicators；income/balance/cashflow 三大报表按报告日关联）
  //      金额类在季报对比时自动单季化（本期累计 - 上期累计），single:false 为时点值不单季化
  var ANNUAL_METRICS = [
    { group: '规模与成长', key: '营业总收入', keySingle: '营业总收入_单季', label: '营业总收入', type: 'amount' },
    { group: '规模与成长', key: '净利润', keySingle: '净利润_单季', label: '净利润', type: 'amount' },
    { group: '规模与成长', key: '扣非净利润', label: '扣非净利润', type: 'amount' },
    { group: '成长能力', key: '营业总收入同比增长率', label: '营收同比增长率', type: 'pct' },
    { group: '成长能力', key: '净利润同比增长率', label: '净利同比增长率', type: 'pct' },
    { group: '成长能力', key: '扣非净利润同比增长率', label: '扣非净利同比增长率', type: 'pct' },
    { group: '盈利能力', key: '销售毛利率', label: '销售毛利率', type: 'pct' },
    { group: '盈利能力', key: '销售净利率', label: '销售净利率', type: 'pct' },
    { group: '盈利能力', key: '净资产收益率', label: '净资产收益率', type: 'pct' },
    { group: '盈利能力', key: '净资产收益率-摊薄', label: '净资产收益率(摊薄)', type: 'pct' },
    { group: '偿债能力', key: '资产负债率', label: '资产负债率', type: 'pct' },
    { group: '偿债能力', key: '产权比率', label: '产权比率', type: 'ratio' },
    { group: '偿债能力', key: '流动比率', label: '流动比率', type: 'ratio' },
    { group: '偿债能力', key: '速动比率', label: '速动比率', type: 'ratio' },
    { group: '偿债能力', key: '保守速动比率', label: '保守速动比率', type: 'ratio' },
    { group: '费用与利润', src: 'income', key: '营业总成本', label: '营业总成本', type: 'amount' },
    { group: '费用与利润', src: 'income', key: '营业成本', label: '营业成本', type: 'amount' },
    { group: '费用与利润', src: 'income', key: '销售费用', label: '销售费用', type: 'amount' },
    { group: '费用与利润', src: 'income', key: '管理费用', label: '管理费用', type: 'amount' },
    { group: '费用与利润', src: 'income', key: '财务费用', label: '财务费用', type: 'amount' },
    { group: '费用与利润', src: 'income', key: '研发费用', label: '研发费用', type: 'amount' },
    { group: '费用与利润', src: 'income', key: '营业利润', label: '营业利润', type: 'amount' },
    { group: '费用与利润', src: 'income', key: '利润总额', label: '利润总额', type: 'amount' },
    { group: '资产与负债', src: 'balance', key: '资产总计', label: '资产总计', type: 'amount', single: false },
    { group: '资产与负债', src: 'balance', key: '负债合计', label: '负债合计', type: 'amount', single: false },
    { group: '资产与负债', src: 'balance', key: '所有者权益(或股东权益)合计', label: '所有者权益合计', type: 'amount', single: false },
    { group: '资产与负债', src: 'balance', key: '归属于母公司股东权益合计', label: '归母股东权益', type: 'amount', single: false },
    { group: '资产与负债', src: 'balance', key: '货币资金', label: '货币资金', type: 'amount', single: false },
    { group: '资产与负债', src: 'balance', key: '存货', label: '存货', type: 'amount', single: false },
    { group: '资产与负债', src: 'balance', key: '应收账款', label: '应收账款', type: 'amount', single: false },
    { group: '现金流量', src: 'cashflow', key: '经营活动产生的现金流量净额', label: '经营现金流净额', type: 'amount' },
    { group: '现金流量', src: 'cashflow', key: '投资活动产生的现金流量净额', label: '投资现金流净额', type: 'amount' },
    { group: '现金流量', src: 'cashflow', key: '筹资活动产生的现金流量净额', label: '筹资现金流净额', type: 'amount' },
    { group: '现金流量', src: 'cashflow', key: '销售商品、提供劳务收到的现金', label: '销售商品收到现金', type: 'amount' },
    { group: '现金流量', src: 'cashflow', key: '期末现金及现金等价物余额', label: '期末现金及等价物', type: 'amount', single: false },
    { group: '每股与营运', key: '基本每股收益', label: '基本每股收益', type: 'yuan' },
    { group: '每股与营运', key: '每股净资产', label: '每股净资产', type: 'yuan' },
    { group: '每股与营运', key: '每股经营现金流', label: '每股经营现金流', type: 'yuan' },
    { group: '每股与营运', key: '每股未分配利润', label: '每股未分配利润', type: 'yuan' },
    { group: '每股与营运', key: '每股资本公积金', label: '每股资本公积金', type: 'yuan' },
    { group: '每股与营运', key: '存货周转率', label: '存货周转率', type: 'ratio' },
    { group: '每股与营运', key: '存货周转天数', label: '存货周转天数', type: 'days' },
    { group: '每股与营运', key: '应收账款周转天数', label: '应收账款周转天数', type: 'days' },
    { group: '每股与营运', key: '营业周期', label: '营业周期', type: 'days' }
  ];

  function periodLabel(p) {
    var names = { '03': '一季报', '06': '半年报', '09': '三季报', '12': '年报' };
    return String(p).slice(0, 4) + (names[String(p).slice(5, 7)] || '');
  }

  function bindComparePicks() {
    var selA = $('stock-compare-a');
    var selB = $('stock-compare-b');
    if (!selA || !selB) return;
    var refresh = function () {
      if (selA.value && selA.value === selB.value) return; // 两选同一报告期时忽略
      if (state.current) renderCompare(state.current);
    };
    selA.onchange = refresh;
    selB.onchange = refresh;
  }

  function renderCompare(d) {
    var rows = ((d && d.indicators) || []).slice(); // 保持倒序（最新报告期在前）
    if (!rows.length) return;
    var selA = $('stock-compare-a');
    var selB = $('stock-compare-b');
    if (!selA || !selB) return;

    // 三大报表按报告日升序（金额项单季化：本期累计 - 上期累计）
    var rpt = {};
    ['income', 'balance', 'cashflow'].forEach(function (sec) {
      rpt[sec] = ((d[sec] || []).slice()).sort(function (x, y) {
        return x['报告日'] < y['报告日'] ? -1 : 1;
      });
    });
    var indBy = {};
    rows.forEach(function (r) { indBy[r['报告期']] = r; });

    // 首次填充报告期下拉（按年份分组），默认最新年报 vs 上一年报
    if (!selA.options.length) {
      var lastYear = null, ogA = null, ogB = null;
      rows.forEach(function (r) {
        var y = String(r['报告期']).slice(0, 4);
        if (y !== lastYear) {
          lastYear = y;
          ogA = document.createElement('optgroup');
          ogA.label = y + ' 年';
          selA.appendChild(ogA);
          ogB = document.createElement('optgroup');
          ogB.label = y + ' 年';
          selB.appendChild(ogB);
        }
        ogA.appendChild(new Option(periodLabel(r['报告期']), r['报告期']));
        ogB.appendChild(new Option(periodLabel(r['报告期']), r['报告期']));
      });
      var annual = rows.filter(function (r) { return String(r['报告期']).indexOf('12-31') >= 0; });
      selA.value = annual[0] ? annual[0]['报告期'] : rows[0]['报告期'];
      selB.value = annual[1] ? annual[1]['报告期'] : selA.value;
    }

    var a = selA.value, b = selB.value;
    // 两期均为年报时用累计值（全年），否则用单季值（与图表季视图口径一致）
    var isAnnualCmp = a.indexOf('12-31') >= 0 && b.indexOf('12-31') >= 0;

    // 取数：indicators 直接取值；报表按报告日关联，非年报对比时金额类单季化（时点值除外）
    function valOf(period, m) {
      if (m.src && m.src !== 'indicator') {
        var list = rpt[m.src];
        for (var i = 0; i < list.length; i++) {
          if (list[i]['报告日'] === period) {
            var v = list[i][m.key];
            if (v == null) return null;
            if (m.type === 'amount' && !isAnnualCmp && m.single !== false) {
              // 一季报累计即当季值，无需差分；其余季度单季 = 本期累计 - 上期累计
              if (String(period).slice(5, 7) !== '03' && i > 0) {
                var pv = list[i - 1][m.key];
                return pv == null ? null : v - pv;
              }
              return v;
            }
            return v;
          }
        }
        return null;
      }
      var row = indBy[period];
      if (!row) return null;
      var k = (m.type === 'amount' && !isAnnualCmp && m.keySingle) ? m.keySingle : m.key;
      return row[k] == null ? null : row[k];
    }

    var html = '<thead><tr><th>指标</th><th>' + periodLabel(a) + '</th><th>' + periodLabel(b) +
      '</th><th>变化</th></tr></thead><tbody>';

    var curGroup = null, gIdx = -1;
    // 移动端默认只展开前 2 组核心指标（规模成长/成长能力），其余折叠；桌面端全量；展开过则记住
    var fold = mqMobile.matches && !state.compareExpanded;
    ANNUAL_METRICS.forEach(function (m) {
      if (m.group !== curGroup) {
        curGroup = m.group;
        gIdx++;
        html += '<tr class="cmp-group' + (fold && gIdx >= 2 ? ' cmp-more' : '') + '"><td colspan="4">' + m.group + '</td></tr>';
      }
      var va = valOf(a, m), vb = valOf(b, m);
      html += '<tr' + (fold && gIdx >= 2 ? ' class="cmp-more"' : '') + '><td>' + m.label + '</td>' +
        '<td>' + fmtMetric(va, m) + '</td>' +
        '<td>' + fmtMetric(vb, m) + '</td>' +
        '<td>' + fmtChange(va, vb, m) + '</td></tr>';
    });
    html += '</tbody>';
    if (fold) html += '<button type="button" class="cmp-more-btn" id="stock-compare-more">展开全部指标</button>';

    $('stock-compare-body').innerHTML = html;
    var moreBtn = $('stock-compare-more');
    if (moreBtn) {
      moreBtn.addEventListener('click', function () {
        state.compareExpanded = true;
        $('stock-compare-body').querySelectorAll('.cmp-more').forEach(function (tr) { tr.classList.remove('cmp-more'); });
        moreBtn.parentNode.removeChild(moreBtn);
      });
    }
  }

  function fmtMetric(v, m) {
    if (v == null) return '-';
    if (m.type === 'amount') return (v / 1e8).toFixed(1) + '亿';
    if (m.type === 'pct') return (v * 100).toFixed(1) + '%';
    if (m.type === 'days') return (+v).toFixed(1) + '天';
    return (+v).toFixed(2); // ratio / yuan
  }

  // 变化列：A 相对 B（红涨绿跌；比率用 pp，倍数/每股/天数用绝对差）
  function fmtChange(va, vb, m) {
    if (va == null || vb == null || vb === 0) return '-';
    var d, cls, txt;
    if (m.type === 'amount') {
      d = (va - vb) / Math.abs(vb) * 100;
      txt = (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
    } else if (m.type === 'pct') {
      d = (va - vb) * 100;
      txt = (d >= 0 ? '+' : '') + d.toFixed(1) + 'pp';
    } else if (m.type === 'days') {
      d = va - vb;
      txt = (d >= 0 ? '+' : '') + d.toFixed(1) + '天';
    } else if (m.type === 'yuan') {
      d = va - vb;
      txt = (d >= 0 ? '+' : '') + d.toFixed(2) + '元';
    } else {
      d = va - vb;
      txt = (d >= 0 ? '+' : '') + d.toFixed(2);
    }
    cls = d >= 0 ? 'up' : 'down';
    return '<span class="cmp-' + cls + '">' + txt + '</span>';
  }

  /* ---------------- 三大报表 ---------------- */

  function initSheet(d) {
    var body = $('stock-sheet-body');
    var periodSel = $('stock-period');
    var key = 'income';

    var buttons = document.querySelectorAll('.stock-tabs button[data-sheet]');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        buttons.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        key = btn.dataset.sheet;
        fillSheet(d, key, periodSel.value);
      });
    });

    var rows = d[key] || [];
    var periods = rows.map(function (r) { return r['报告日']; });
    periodSel.innerHTML = periods
      .map(function (p) { return '<option>' + fmtDate(p) + '</option>'; })
      .join('');
    periodSel.onchange = function () { fillSheet(d, key, periodSel.value); };

    if (buttons.length) buttons[0].classList.add('active');
    fillSheet(d, key, periods[0]);
  }

  function fillSheet(d, key, period) {
    var rows = (d[key] || []).filter(function (r) { return fmtDate(r['报告日']) === period; });
    if (!rows.length) {
      $('stock-sheet-body').innerHTML = '<tr><td>暂无数据</td></tr>';
      return;
    }
    var row = rows[0];
    var html = Object.keys(row)
      .filter(function (k) { return !['报告日', '公告日期', '数据源', '是否审计', '币种', '类型', '更新日期'].includes(k); })
      .map(function (k) {
        var v = row[k];
        return '<tr><td class="k">' + k + '</td><td class="v">' + fmtMoney(v) + '</td></tr>';
      })
      .join('');
    $('stock-sheet-body').innerHTML = html;
  }

  /* ---------------- 启动 ---------------- */

  route();
})();
