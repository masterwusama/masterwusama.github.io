/* 股票分析模块 —— 加载 stock-data/data/*.json 并渲染
 * 路由：#/600519 → 公司详情；无 hash → 公司列表
 */
(function () {
  'use strict';

  var DATA_BASE = './data/';

  var $ = function (id) { return document.getElementById(id); };
  var state = { companies: [], current: null, charts: [], view: 'year' };

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
    var m = location.hash.match(/^#\/(\d{6})$/);
    if (m) { showDetail(m[1]); } else { showList(); }
  }

  window.addEventListener('hashchange', route);
  $('stock-back').addEventListener('click', function () {
    location.hash = '';
  });

  /* ---------------- 公司列表 ---------------- */

  function showList() {
    if (!state.companies.length) { fetchIndex(); return; }
    show('stock-list');
    var box = $('stock-list');
    var html = '<div class="stock-grid">';
    state.companies.forEach(function (c) {
      html +=
        '<div class="stock-card" onclick="location.hash=\'#/' + c.code + '\'">' +
        '<div><span class="s-name">' + c.name + '</span><span class="s-code">' + c.code + '</span></div>' +
        '</div>';
    });
    html += '</div>';
    box.innerHTML = html;
  }

  function fetchIndex() {
    show('stock-loading');
    fetch(DATA_BASE + 'index.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        state.companies = data.companies || [];
        showList();
      })
      .catch(function () { fail('公司列表加载失败，请稍后刷新重试'); });
  }

  /* ---------------- 公司详情 ---------------- */

  function showDetail(code) {
    show('stock-loading');
    fetch(DATA_BASE + 'companies/' + code + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) { renderDetail(d); })
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

    // 头部
    html += '<div class="stock-header">' +
      '<h2>' + d.name + '</h2>' +
      '<span class="s-code">' + d.code + '</span>' +
      '<span class="s-price ' + cls(chg) + '">' + fmtNum(s.price) + '</span>' +
      '<span class="s-meta ' + cls(chg) + '">' +
      (chg == null ? '-' : (chg > 0 ? '+' : '') + (chg * 100).toFixed(2) + '%') + '</span>' +
      '<span class="s-meta">更新于 ' + fmtDate(s.time || d.updated_at) + '</span>' +
      '</div>';

    // 估值快照
    var recDivs = recentDividends(d);
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
      divBox +
      '</div></div>';

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

    // 三大报表
    html += '<div class="stock-section"><h3>财务报表</h3>' +
      '<div class="stock-tabs">' +
      sheetTab('income', '利润表') + sheetTab('balance', '资产负债表') + sheetTab('cashflow', '现金流量表') +
      '<select id="stock-period"></select></div>' +
      '<table class="stock-table" id="stock-sheet-body"></table></div>';

    // 分红历史（全量）
    var divs = d.dividends || [];
    html += '<div class="stock-section"><h3>分红历史（' + divs.length + ' 条）</h3>';
    divs.forEach(function (r) {
      var desc = r.description || '';
      var extra = '';
      if (r.pay_date) extra += '派息日 ' + fmtDate(r.pay_date);
      html += '<div class="stock-list-item">' +
        '<span class="d-year">' + (r.year || '-') + '</span>' +
        '<span class="stock-badge">' + (r.type || '') + '</span>' +
        '<span class="d-desc">' + desc + '</span>' +
        (extra ? '<span class="d-date">' + extra + '</span>' : '') +
        '</div>';
    });
    html += '</div>';

    // 定期报告
    var reports = d.reports || [];
    html += '<div class="stock-section"><h3>定期报告（' + reports.length + ' 份）</h3>';
    reports.forEach(function (r) {
      var audit = '';
      // 审计信息：年报/半年报附事务所与意见类型（季报不审计，无该字段）
      if (r.audit_firm || r.audit_opinion) {
        audit = '<span class="d-audit">审计：' + (r.audit_firm || '—') +
          (r.audit_opinion ? ' · ' + r.audit_opinion : '') + '</span>';
      }
      html += '<div class="stock-list-item">' +
        '<span class="stock-badge">' + r.category + '</span>' +
        '<span class="d-year">' + r.title + '</span>' +
        '<span class="d-date">' + fmtDate(r.date) + '</span>' +
        audit +
        '<a href="' + r.pdf_url + '" target="_blank" rel="noopener">PDF 原文</a>' +
        '<a href="' + r.detail_url + '" target="_blank" rel="noopener">详情</a>' +
        '</div>';
    });
    html += '</div>';

    $('stock-detail-body').innerHTML = html;
    bindViewToggle();
    bindComparePicks();
    renderCharts(d.indicators || []);
    renderCompare(d);
    initSheet(d);
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

    var curGroup = null;
    ANNUAL_METRICS.forEach(function (m) {
      if (m.group !== curGroup) {
        curGroup = m.group;
        html += '<tr class="cmp-group"><td colspan="4">' + m.group + '</td></tr>';
      }
      var va = valOf(a, m), vb = valOf(b, m);
      html += '<tr><td>' + m.label + '</td>' +
        '<td>' + fmtMetric(va, m) + '</td>' +
        '<td>' + fmtMetric(vb, m) + '</td>' +
        '<td>' + fmtChange(va, vb, m) + '</td></tr>';
    });
    html += '</tbody>';

    $('stock-compare-body').innerHTML = html;
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
