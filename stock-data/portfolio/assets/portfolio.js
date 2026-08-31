// 模拟持仓页面：三策略页签 + 汇总 + 持仓（桌面表格/移动卡片）+ 调仓记录
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { pf: null, trades: null, key: 'schloss', sort: { key: null, dir: -1 } };
  var KEYS = ['schloss', 'grahamDef', 'buffett'];

  function load(url) {
    return fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now())
      .then(function (r) {
        if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
        return r.json();
      });
  }

  function fail(msg) {
    $('pf-loading').style.display = 'none';
    var el = $('pf-error');
    el.style.display = 'block';
    el.textContent = msg;
  }

  function fmt(n, d) {
    if (n == null || isNaN(n)) return '-';
    return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  }
  function cls(v) { return v > 0 ? 'up' : (v < 0 ? 'down' : 'flat'); }
  function sign(v, d) { return (v > 0 ? '+' : '') + fmt(v, d); }

  function renderTabs() {
    var box = $('pf-tabs');
    box.innerHTML = '';
    KEYS.forEach(function (k) {
      var s = state.pf.strategies[k];
      var b = document.createElement('div');
      b.className = 'pf-tab' + (k === state.key ? ' active' : '');
      b.textContent = s.label;
      b.addEventListener('click', function () {
        state.key = k;
        renderTabs();
        renderStrategy();
      });
      box.appendChild(b);
    });
  }

  function stat(k, v, sub) {
    return '<div class="pf-stat"><div class="k">' + k + '</div><div class="v">' + v + '</div>' +
      (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>';
  }

  // 持仓排序：无排序键时保持引擎原始序；文本列（标的）按拼音，其余按数值
  function sortPositions(pos, nav) {
    var k = state.sort.key;
    if (!k) return pos.slice();
    var dir = state.sort.dir;
    var val = function (p) { return k === 'weight' ? p.value / nav : p[k]; };
    return pos.slice().sort(function (a, b) {
      if (k === 'name') return String(a.name).localeCompare(String(b.name), 'zh-CN') * dir;
      return ((val(a) || 0) - (val(b) || 0)) * dir;
    });
  }

  // 表头点击排序：同列再点切换升降，换列时数值列默认降序、文本列默认升序
  function bindSort() {
    var box = $('pf-positions');
    box.querySelectorAll('th[data-key]').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-key');
        if (state.sort.key === key) {
          state.sort.dir *= -1;
        } else {
          state.sort.key = key;
          state.sort.dir = (key === 'name') ? 1 : -1;
        }
        renderStrategy();
      });
    });
  }

  function renderStrategy() {
    var s = state.pf.strategies[state.key];
    var pos = s.positions || [];
    $('pf-asof').textContent = '行情截至 ' + (s.as_of || '');

    // 汇总：总资产/整体盈亏/当日盈亏/仓位
    $('pf-summary').innerHTML =
      stat('总资产', fmt(s.nav) + ' 元', '初始 ' + fmt(s.init_cap, 0) + ' · 现金 ' + fmt(s.cash)) +
      stat('持仓整体盈亏', '<span class="' + cls(s.total_pnl) + '">' + sign(s.total_pnl) + '</span>',
        '<span class="' + cls(s.total_pnl_pct) + '">' + sign(s.total_pnl_pct) + '%</span>') +
      stat('当日盈亏', '<span class="' + cls(s.day_pnl) + '">' + sign(s.day_pnl) + '</span>',
        '<span class="' + cls(s.day_pnl_pct) + '">' + sign(s.day_pnl_pct) + '%</span>') +
      stat('总持仓比例', fmt(s.position_pct, 1) + '%', '持仓 ' + pos.length + ' 只');

    // 持仓：桌面表格（点表头排序）+ 移动卡片（CSS 切换显示）
    var COLS = [
      { key: 'name', label: '标的' },
      { key: 'cost', label: '成本价' },
      { key: 'shares', label: '持股数' },
      { key: 'value', label: '市值' },
      { key: 'weight', label: '持仓比例' },
      { key: 'price', label: '现价' },
      { key: 'pnl_pct', label: '盈亏比例' },
      { key: 'pnl', label: '盈亏额' },
      { key: 'days', label: '持仓天数' }
    ];
    var list = sortPositions(pos, s.nav);
    var thead = '<tr>' + COLS.map(function (col) {
      var active = state.sort.key === col.key;
      var caret = active ? (state.sort.dir < 0 ? ' ▼' : ' ▲') : '';
      return '<th data-key="' + col.key + '" class="pf-th-sort' + (active ? ' pf-th-on' : '') +
        '" title="点击排序">' + col.label + caret + '</th>';
    }).join('') + '</tr>';
    var rows = '', cards = '';
    if (!list.length) {
      cards = '<div class="pf-empty">当前空仓（等待买点出现）</div>';
      rows = '<tr><td colspan="' + COLS.length + '" style="text-align:center;color:#8a94a6">当前空仓（等待买点出现）</td></tr>';
    }
    list.forEach(function (p) {
      rows += '<tr>' +
        '<td><b>' + p.name + '</b> <span style="color:#8a94a6">' + p.code + '</span></td>' +
        '<td>' + fmt(p.cost) + '</td><td>' + p.shares.toLocaleString('zh-CN') + '</td>' +
        '<td>' + fmt(p.value) + '</td>' +
        '<td>' + fmt(p.value / s.nav * 100, 1) + '%</td>' +
        '<td>' + fmt(p.price) + '</td>' +
        '<td class="' + cls(p.pnl_pct) + '">' + sign(p.pnl_pct) + '%</td>' +
        '<td class="' + cls(p.pnl) + '">' + sign(p.pnl) + '</td>' +
        '<td>' + p.days + ' 天</td></tr>';
      cards += '<div class="pf-card">' +
        '<div class="pf-card-top"><div><span class="pf-name">' + p.name + '</span>' +
        '<span class="pf-code">' + p.code + '</span></div>' +
        '<div class="pf-pnl-big ' + cls(p.pnl_pct) + '">' + sign(p.pnl_pct) + '%</div></div>' +
        '<div class="pf-grid">' +
        '<div><div class="k">成本价</div><div class="v">' + fmt(p.cost) + '</div></div>' +
        '<div><div class="k">现价</div><div class="v">' + fmt(p.price) + '</div></div>' +
        '<div><div class="k">持股数</div><div class="v">' + p.shares.toLocaleString('zh-CN') + '</div></div>' +
        '<div><div class="k">市值</div><div class="v">' + fmt(p.value) + '</div></div>' +
        '<div><div class="k">持仓比例</div><div class="v">' + fmt(p.value / s.nav * 100, 1) + '%</div></div>' +
        '<div><div class="k">盈亏额</div><div class="v ' + cls(p.pnl) + '">' + sign(p.pnl) + '</div></div>' +
        '<div><div class="k">持仓天数</div><div class="v">' + p.days + ' 天</div></div>' +
        '</div></div>';
    });
    $('pf-positions').innerHTML =
      '<table class="pf-table"><thead>' + thead + '</thead><tbody>' + rows + '</tbody></table>' + cards;
    bindSort();

    // 调仓记录（该策略，倒序）
    var tr = (state.trades[state.key] || []).slice().reverse();
    $('pf-trades-summary').textContent = '调仓记录（' + s.label + '，共 ' + tr.length + ' 笔）';
    var body = $('pf-trades-body');
    if (!tr.length) {
      body.innerHTML = '<div class="pf-trades-empty">暂无调仓记录</div>';
      return;
    }
    body.innerHTML = tr.map(function (t) {
      var isBuy = t.side === 'buy', isDiv = t.side === 'dividend';
      var qty = isDiv
        ? (t.amount > 0 ? '现金分红入账' : '转增股 ' + t.shares.toLocaleString('zh-CN') + ' 股')
        : fmt(t.price) + ' 元 × ' + t.shares.toLocaleString('zh-CN') + ' 股';
      return '<div class="pf-trade-row">' +
        '<span class="pf-trade-meta">' + t.date + '</span>' +
        '<span class="pf-side ' + (isBuy ? 'up' : isDiv ? 'flat' : 'down') + '">' +
          (isBuy ? '买入' : isDiv ? '分红' : '卖出') + '</span>' +
        '<span><b>' + t.name + '</b> <span class="pf-trade-meta">' + t.code + '</span></span>' +
        '<span>' + qty + '</span>' +
        '<span>' + fmt(t.amount) + ' 元</span>' +
        '<span class="pf-trade-meta">' + (t.reason || '') + '</span></div>';
    }).join('');
  }

  Promise.all([load('data/portfolio.json'), load('data/trades.json')])
    .then(function (res) {
      state.pf = res[0];
      state.trades = res[1];
      $('pf-loading').style.display = 'none';
      $('pf-main').style.display = 'block';
      renderTabs();
      renderStrategy();
    })
    .catch(function (e) { fail('持仓数据加载失败：' + e.message); });
})();
