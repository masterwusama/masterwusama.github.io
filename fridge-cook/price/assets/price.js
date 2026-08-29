/* 物价查询子模块（前缀 fp-）：加载 data/prices.json，渲染分类卡片与单品走势 */
(function () {
  'use strict';

  var CAT_ORDER = ['肉类', '蔬菜', '水果', '农副产品', '水产'];
  var SRC_SHORT = {
    '杭州市商务局周报': '杭州周报',
    '商务部百家日报（浙江市场）': '浙江日报',
    '商务部周度（全国）': '商务部周度'
  };
  var TREND_FLAT_PCT = 3; // ±3% 以内视为平稳

  var allProducts = [];
  var currentCat = '全部';
  var chart = null;

  function $(id) { return document.getElementById(id); }

  function median(vals) {
    if (!vals.length) return null;
    var v = vals.slice().sort(function (a, b) { return a - b; });
    var n = v.length;
    return n % 2 === 0 ? (v[n / 2 - 1] + v[n / 2]) / 2 : v[Math.floor(n / 2)];
  }

  /* 趋势：近 <=7 个数据点中位数 对比 之前 <=7 个数据点中位数 */
  function trendOf(prices) {
    var n = prices.length;
    if (n < 2) return { dir: 'new', pct: null };
    var recent = prices.slice(Math.max(0, n - 7));
    var prev = prices.slice(Math.max(0, n - 14), Math.max(0, n - 7));
    if (!prev.length) {
      prev = prices.slice(n - 2, n - 1);
      recent = prices.slice(n - 1);
    }
    var a = median(recent.map(function (x) { return x.price; }));
    var b = median(prev.map(function (x) { return x.price; }));
    if (!b) return { dir: 'new', pct: null };
    var pct = (a - b) / b * 100;
    var dir = Math.abs(pct) <= TREND_FLAT_PCT ? 'flat' : (pct > 0 ? 'up' : 'down');
    return { dir: dir, pct: pct };
  }

  function fmtPct(pct) {
    return (pct > 0 ? '+' : '') + pct.toFixed(1) + '%';
  }

  function renderTabs() {
    var cats = ['全部'];
    CAT_ORDER.forEach(function (c) {
      if (allProducts.some(function (p) { return p.category === c; })) cats.push(c);
    });
    var box = $('fp-tabs');
    box.innerHTML = '';
    cats.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'fp-tab' + (c === currentCat ? ' active' : '');
      b.textContent = c;
      b.onclick = function () { currentCat = c; renderTabs(); renderGrid(); };
      box.appendChild(b);
    });
  }

  function renderGrid() {
    var grid = $('fp-grid');
    grid.innerHTML = '';
    var list = allProducts.filter(function (p) {
      return currentCat === '全部' || p.category === currentCat;
    });
    if (!list.length) {
      $('fp-empty').style.display = '';
      grid.style.display = 'none';
      return;
    }
    $('fp-empty').style.display = 'none';
    grid.style.display = '';

    list.forEach(function (p) {
      var prices = p.prices;
      var last = prices[prices.length - 1];
      var t = trendOf(prices);
      var card = document.createElement('div');
      card.className = 'fp-card';

      var trendHtml;
      if (t.dir === 'new') {
        trendHtml = '<span class="fp-trend new">新采</span>';
      } else if (t.dir === 'flat') {
        trendHtml = '<span class="fp-trend flat">→ 平稳 ' + fmtPct(t.pct) + '</span>';
      } else if (t.dir === 'up') {
        trendHtml = '<span class="fp-trend up">↑ 上涨 ' + fmtPct(t.pct) + '</span>';
      } else {
        trendHtml = '<span class="fp-trend down">↓ 下跌 ' + fmtPct(t.pct) + '</span>';
      }

      card.innerHTML =
        '<div class="fp-card-name">' + p.name + '</div>' +
        '<div class="fp-card-src">' + (SRC_SHORT[p.source] || p.source) +
          ' · ' + last.date + '</div>' +
        '<div class="fp-card-row">' +
          '<span class="fp-card-price">' + last.price.toFixed(2) +
            '<span class="fp-card-unit">' + p.unit + '</span></span>' +
          trendHtml +
        '</div>';
      card.onclick = function () { openModal(p); };
      grid.appendChild(card);
    });

    $('fp-note').textContent = '共 ' + list.length + ' 个品种 · 点击卡片查看历史走势 · ' +
      '「杭州周报」为杭州市商务局生活必需品监测（周更），' +
      '「浙江日报」为商务部百家日报浙江市场中位数（日更），' +
      '「商务部周度」为全国批发/零售周均价（含近一年历史）';
  }

  function openModal(p) {
    var modal = $('fp-modal');
    modal.style.display = '';
    $('fp-modal-name').textContent = p.name;
    $('fp-modal-src').textContent = p.source + ' · ' + p.unit;

    var prices = p.prices;
    var last = prices[prices.length - 1];
    var first = prices[0];
    var totalPct = (last.price - first.price) / first.price * 100;
    $('fp-modal-info').textContent =
      '采集区间：' + first.date + ' ~ ' + last.date +
      '（' + prices.length + ' 个数据点）· 区间内累计' +
      (totalPct >= 0 ? '上涨 ' : '下跌 ') + Math.abs(totalPct).toFixed(1) + '%' +
      ' · 价格仅供参考';

    var el = $('fp-chart');
    if (!chart) chart = window.echarts.init(el);
    chart.setOption({
      grid: { left: 46, right: 16, top: 30, bottom: 34 },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: prices.map(function (x) { return x.date; }),
        axisLabel: { fontSize: 11 }
      },
      yAxis: {
        type: 'value', scale: true, name: p.unit,
        axisLabel: { fontSize: 11 }
      },
      series: [{
        name: p.name,
        type: 'line',
        data: prices.map(function (x) { return x.price; }),
        smooth: true,
        symbolSize: 5,
        itemStyle: { color: '#2f6f4f' },
        areaStyle: { opacity: 0.08 }
      }]
    }, true);
    chart.resize();
  }

  function closeModal() { $('fp-modal').style.display = 'none'; }

  document.querySelector('.fp-modal-mask').onclick = closeModal;
  $('fp-modal-close').onclick = closeModal;
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });
  window.addEventListener('resize', function () { if (chart) chart.resize(); });

  fetch('./data/prices.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      allProducts = data.products || [];
      if (data.updated_at) {
        $('fp-updated').textContent = '数据更新于 ' +
          data.updated_at.replace('T', ' ').slice(0, 16);
      }
      if (!allProducts.length) {
        $('fp-empty').style.display = '';
        return;
      }
      renderTabs();
      renderGrid();
    })
    .catch(function (e) {
      $('fp-empty').style.display = '';
      $('fp-empty').innerHTML = '<p>数据加载失败：' + e + '</p>';
    });
})();
