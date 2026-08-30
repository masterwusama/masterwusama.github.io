/* 农化制品价格跟踪 —— 加载 agro-price/data/products.json 并渲染
 * 营收结构卡片 + 分类筛选 + 产品卡片 + ECharts 走势图（支持归一化对比）
 */
(function () {
  'use strict';

  var DATA_FILE = './data/products.json';
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    data: null,
    cat: '全部',
    selected: [],       // 走势图中选中的产品 id
    normalize: false,
    range: 'all',
    chart: null
  };

  /* ---------------- 工具 ---------------- */

  function fmtPrice(v) {
    if (v == null || isNaN(v)) return '-';
    if (v >= 10000) return (v / 10000).toFixed(2) + ' 万';
    return v.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }

  function fmtFullDate(s) {
    return s ? String(s).replace('T', ' ').slice(0, 16) : '-';
  }

  function cls(v) {
    if (v == null || isNaN(v) || v === 0) return 'flat';
    return v > 0 ? 'up' : 'down';
  }

  function pct(v) {
    if (v == null || isNaN(v)) return '-';
    return (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  }

  // 取某产品在指定日期之前的最近一条价格
  function priceAt(prices, dateStr) {
    for (var i = prices.length - 1; i >= 0; i--) {
      if (prices[i].date <= dateStr) return prices[i];
    }
    return null;
  }

  // 距 dateStr 往前 n 天的日期
  function daysAgo(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  // 过滤出指定时间范围内的价格序列
  function rangePrices(prices, range) {
    if (range === 'all') return prices;
    var cutoff = range === '1y' ? daysAgo(365) : daysAgo(1095);
    return prices.filter(function (p) { return p.date >= cutoff; });
  }

  /* ---------------- 视图切换 ---------------- */

  function show(id) {
    ['agro-loading', 'agro-error', 'agro-main'].forEach(function (n) {
      $(n).style.display = n === id ? '' : 'none';
    });
  }

  function fail(msg) {
    $('agro-error').textContent = msg;
    show('agro-error');
  }

  /* ---------------- 营收结构 ---------------- */

  // 2025 年报营收结构（农药 54.5% / 中间体 44.58%，余下为其他）
  var REVENUE = [
    { cat: '杀菌剂', pct: 32.7, note: '多菌灵 / 甲基硫菌灵 / 噁唑菌酮等' },
    { cat: '除草剂', pct: 21.8, note: '敌草隆 / 草甘膦 / 环嗪酮等' },
    { cat: '中间体', pct: 44.58, note: '邻苯二胺 / 对硝基氯化苯等' },
    { cat: '其他', pct: 0.92, note: '制剂及其他' }
  ];

  function renderRevenue() {
    var bar = $('agro-revenue-bar');
    var html = '';
    REVENUE.forEach(function (r) {
      html += '<div class="agro-rev-item" data-cat="' + r.cat + '">' +
        '<span class="agro-rev-name">' + r.cat + '</span>' +
        '<span class="agro-rev-track"><span class="agro-rev-fill" style="width:' + r.pct + '%"></span></span>' +
        '<span class="agro-rev-pct">' + r.pct + '%</span>' +
        '<span class="agro-rev-note">' + r.note + '</span>' +
        '</div>';
    });
    bar.innerHTML = html;
    // 点击营收条目跳转对应分类
    bar.querySelectorAll('.agro-rev-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var cat = item.getAttribute('data-cat');
        if (cat === '其他') return;
        setCat(cat);
      });
    });
  }

  /* ---------------- 分类筛选 ---------------- */

  function setCat(cat) {
    state.cat = cat;
    document.querySelectorAll('.agro-tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-cat') === cat);
    });
    renderCards();
  }

  /* ---------------- 产品卡片 ---------------- */

  function productStats(p) {
    var prices = p.prices;
    if (!prices.length) return { last: null, chg1w: null, chg1m: null, chgYtd: null, date: null };
    var last = prices[prices.length - 1];
    var today = daysAgo(0);
    var p1w = priceAt(prices, daysAgo(7));
    var p1m = priceAt(prices, daysAgo(30));
    var ytd = priceAt(prices, today.slice(0, 4) + '-01-01');
    return {
      last: last,
      chg1w: p1w ? (last.price - p1w.price) / p1w.price : null,
      chg1m: p1m ? (last.price - p1m.price) / p1m.price : null,
      chgYtd: ytd ? (last.price - ytd.price) / ytd.price : null
    };
  }

  function renderCards() {
    var box = $('agro-cards');
    var html = '';
    state.data.products.forEach(function (p) {
      if (state.cat !== '全部' && p.category !== state.cat) return;
      var s = productStats(p);
      var checked = state.selected.indexOf(p.id) >= 0 ? ' checked' : '';
      html += '<div class="agro-card' + (checked ? ' on' : '') + '" data-id="' + p.id + '">' +
        '<div class="agro-card-head">' +
        '<label class="agro-card-check"><input type="checkbox"' + checked + ' data-id="' + p.id + '"></label>' +
        '<span class="agro-card-name">' + p.name + '</span>' +
        '<span class="agro-card-cat">' + p.category + '</span>' +
        '<span class="agro-card-spec">' + (p.spec || '') + '</span>' +
        '</div>' +
        '<div class="agro-card-body">' +
        '<span class="agro-card-price">' + fmtPrice(s.last ? s.last.price : null) +
        '<em>元/吨</em></span>' +
        '<span class="agro-card-chg ' + cls(s.chg1w) + '">周 ' + pct(s.chg1w) + '</span>' +
        '<span class="agro-card-chg ' + cls(s.chg1m) + '">月 ' + pct(s.chg1m) + '</span>' +
        '<span class="agro-card-chg ' + cls(s.chgYtd) + '">年初 ' + pct(s.chgYtd) + '</span>' +
        '</div>' +
        '<div class="agro-card-foot">共 ' + p.prices.length + ' 期 · 最新 ' +
        (s.last ? s.last.date + '（' + (s.last.note || s.last.source) + '）' : '无') + '</div>' +
        '</div>';
    });
    box.innerHTML = html;

    // 勾选产品 → 加入走势图
    box.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-id');
        var i = state.selected.indexOf(id);
        if (cb.checked && i < 0) state.selected.push(id);
        if (!cb.checked && i >= 0) state.selected.splice(i, 1);
        renderChart();
        box.querySelectorAll('.agro-card[data-id="' + id + '"]').forEach(function (c) {
          c.classList.toggle('on', cb.checked);
        });
      });
    });
    // 点击卡片主体 = 切换勾选
    box.querySelectorAll('.agro-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('.agro-card-check')) return;
        var cb = card.querySelector('input[type=checkbox]');
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      });
    });
  }

  /* ---------------- 走势图 ---------------- */

  function renderChart() {
    if (!state.chart) return;
    var ids = state.selected.length ? state.selected :
      state.data.products.filter(function (p) {
        return state.cat === '全部' || p.category === state.cat;
      }).slice(0, 5).map(function (p) { return p.id; });

    var series = [];
    var legend = [];
    state.data.products.forEach(function (p) {
      if (ids.indexOf(p.id) < 0) return;
      var prices = rangePrices(p.prices, state.range);
      if (prices.length < 2) return;
      var data = prices.map(function (r) { return [r.date, r.price]; });
      if (state.normalize) {
        var base = data[0][1];
        data = data.map(function (d) { return [d[0], +(d[1] / base * 100).toFixed(2)]; });
      }
      legend.push(p.name);
      series.push({
        name: p.name,
        type: 'line',
        symbol: 'circle',
        symbolSize: 5,
        showSymbol: false,
        connectNulls: true,
        data: data
      });
    });

    state.chart.setOption({
      legend: { data: legend, top: 0, type: 'scroll' },
      tooltip: {
        trigger: 'axis',
        valueFormatter: function (v) {
          return state.normalize ? (+v).toFixed(1) : fmtPrice(v) + ' 元/吨';
        }
      },
      grid: { left: 64, right: 20, top: 40, bottom: 30 },
      xAxis: { type: 'time' },
      yAxis: {
        type: 'value',
        name: state.normalize ? '指数（基准=100）' : '元/吨',
        scale: true
      },
      series: series
    }, true);
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    // 事件绑定
    document.querySelectorAll('.agro-tab').forEach(function (t) {
      t.addEventListener('click', function () { setCat(t.getAttribute('data-cat')); });
    });
    $('agro-normalize').addEventListener('change', function () {
      state.normalize = this.checked;
      renderChart();
    });
    $('agro-range').addEventListener('change', function () {
      state.range = this.value;
      renderChart();
    });
    window.addEventListener('resize', function () {
      if (state.chart) state.chart.resize();
    });

    // 加载数据
    fetch(DATA_FILE)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.products || !data.products.length) throw new Error('数据为空');
        state.data = data;
        // 默认选中每个分类下最新价最高的产品
        var byCat = {};
        data.products.forEach(function (p) {
          if (!byCat[p.category]) byCat[p.category] = [];
          byCat[p.category].push(p);
        });
        Object.keys(byCat).forEach(function (c) {
          byCat[c].sort(function (a, b) {
            var pa = a.prices[a.prices.length - 1];
            var pb = b.prices[b.prices.length - 1];
            return (pb ? pb.price : 0) - (pa ? pa.price : 0);
          });
          if (byCat[c][0]) state.selected.push(byCat[c][0].id);
        });

        show('agro-main');
        renderRevenue();
        renderCards();
        state.chart = echarts.init($('agro-chart'));
        renderChart();
        $('agro-foot').textContent =
          '数据来源：生意社商品报价动态 / 3456.tv 行情历史 · 更新于 ' + fmtFullDate(data.updated_at) +
          ' · 价格为市场报价，仅供个人学习研究';
      })
      .catch(function (e) {
        fail('数据加载失败：' + e.message + '（请确认 data/products.json 已生成）');
      });
  }

  // 供行业切换控制器调用：农化视图重新显示时恢复图表尺寸
  window.__agroRefresh = function () {
    if (state.chart) state.chart.resize();
  };

  document.addEventListener('DOMContentLoaded', init);
})();
