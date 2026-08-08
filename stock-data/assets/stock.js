/* 股票分析模块 —— 加载 stock-data/data/*.json 并渲染
 * 路由：#/600519 → 公司详情；无 hash → 公司列表
 */
(function () {
  'use strict';

  var DATA_BASE = './data/';

  var $ = function (id) { return document.getElementById(id); };
  var state = { companies: [], current: null, chart: null };

  /* ---------------- 工具函数 ---------------- */

  // 金额（元）→ "xx.x亿" / "xx万" / 原值
  function fmtMoney(v) {
    if (v == null || isNaN(v)) return '-';
    var abs = Math.abs(v);
    if (abs >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (abs >= 1e4) return (v / 1e4).toFixed(2) + '万';
    return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  // 小数比率 → "12.34%"
  function fmtPct(v) {
    if (v == null || isNaN(v)) return '-';
    return (v * 100).toFixed(2) + '%';
  }

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

  // 股息率：最近一次年度分红 ÷ 最新价
  function calcYield(d) {
    var ann = (d.dividends || []).filter(function (r) { return r.type === '年度分红'; })[0];
    if (!ann || !ann.bonus_per_10 || !d.snapshot || !d.snapshot.price) return null;
    return ann.bonus_per_10 / 10 / d.snapshot.price;
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
    show('stock-detail');
    var s = d.snapshot || {};
    var yieldRate = calcYield(d);
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
    html += '<div class="stock-section"><div class="stock-snapshot">' +
      kv('市盈率(TTM)', fmtNum(s.pe_ttm)) +
      kv('市净率', fmtNum(s.pb)) +
      kv('总市值', fmtMoney(s.market_cap)) +
      kv('流通市值', fmtMoney(s.float_market_cap)) +
      kv('换手率', fmtPct(s.turnover_rate)) +
      kv('股息率(估算)', fmtPct(yieldRate)) +
      '</div></div>';

    // 指标趋势图
    html += '<div class="stock-section"><h3>关键指标趋势（近 ' + (d.indicators || []).length + ' 期）</h3>' +
      '<div id="stock-chart"></div></div>';

    // 三大报表
    html += '<div class="stock-section"><h3>财务报表</h3>' +
      '<div class="stock-tabs">' +
      sheetTab('income', '利润表') + sheetTab('balance', '资产负债表') + sheetTab('cashflow', '现金流量表') +
      '<select id="stock-period"></select></div>' +
      '<table class="stock-table" id="stock-sheet-body"></table></div>';

    // 分红历史
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
      html += '<div class="stock-list-item">' +
        '<span class="stock-badge">' + r.category + '</span>' +
        '<span class="d-year">' + r.title + '</span>' +
        '<span class="d-date">' + fmtDate(r.date) + '</span>' +
        '<a href="' + r.pdf_url + '" target="_blank" rel="noopener">PDF 原文</a>' +
        '<a href="' + r.detail_url + '" target="_blank" rel="noopener">详情</a>' +
        '</div>';
    });
    html += '</div>';

    $('stock-detail-body').innerHTML = html;
    renderChart(d.indicators || []);
    initSheet(d);
  }

  function kv(k, v) {
    return '<div class="kv"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
  }

  function sheetTab(key, label) {
    return '<button data-sheet="' + key + '">' + label + '</button>';
  }

  /* ---------------- 指标趋势图 ---------------- */

  function renderChart(indicators) {
    if (typeof echarts === 'undefined') {
      $('stock-chart').innerHTML = '<p class="stock-hint">图表库加载失败（ECharts CDN 不可用）</p>';
      return;
    }
    var rows = indicators.slice().reverse(); // 升序排列
    var dates = rows.map(function (r) { return fmtDate(r['报告期']); });

    function series(name, key, fmt, yAxis) {
      return {
        name: name,
        type: 'line',
        yAxisIndex: yAxis,
        smooth: true,
        data: rows.map(function (r) {
          var v = r[key];
          return v == null ? null : fmt(v);
        })
      };
    }

    var chart = echarts.init($('stock-chart'));
    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: ['营业总收入', '净利润', '销售毛利率', '销售净利率', '净资产收益率'], top: 0 },
      grid: { left: 55, right: 55, top: 32, bottom: 28 },
      xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 11 } },
      yAxis: [
        { type: 'value', name: '亿元', axisLabel: { fontSize: 11 } },
        { type: 'value', name: '%', axisLabel: { fontSize: 11, formatter: '{value}%' } }
      ],
      series: [
        {
          name: '营业总收入', type: 'bar', barMaxWidth: 28,
          itemStyle: { color: '#5b8ff9' },
          data: rows.map(function (r) { return r['营业总收入'] == null ? null : +(r['营业总收入'] / 1e8).toFixed(2); })
        },
        {
          name: '净利润', type: 'bar', barMaxWidth: 28,
          itemStyle: { color: '#61c0a8' },
          data: rows.map(function (r) { return r['净利润'] == null ? null : +(r['净利润'] / 1e8).toFixed(2); })
        },
        series('销售毛利率', '销售毛利率', function (v) { return +(v * 100).toFixed(2); }, 1),
        series('销售净利率', '销售净利率', function (v) { return +(v * 100).toFixed(2); }, 1),
        series('净资产收益率', '净资产收益率', function (v) { return +(v * 100).toFixed(2); }, 1)
      ]
    });
    state.chart = chart;
    window.addEventListener('resize', function () { chart.resize(); });
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
