/**
 * 行业 EDB 量价跟踪 —— 汽车 / 电解铝 / 航运 / 轮胎橡胶 / 地产链 / 煤炭 / 钢铁
 *
 * 消费 data/edb.json（由 scripts/fetch_edb.py 从万得 Wind 抓取，周/月聚合）。
 * 顶部行业切换栏协调「农化制品（原有 agro.js 视图）」与「EDB 视图」的显隐；
 * EDB 视图按分类渲染：KPI 指标卡 → 相对走势总览 → 多维度分类图表。
 *
 * 说明：同一分类内各指标单位/量级差异极大（万辆 / 辆 / % / 元/吨 / 指数点），
 * 因此总览图统一归一为 100 只比相对涨跌；量级相近的指标才放进同一张维度图。
 */
(function () {
  'use strict';

  var DATA_FILE = './data/edb.json';
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    data: null,          // 解析后的 edb.json
    byId: {},            // catId -> category
    current: null,       // 当前 EDB 分类 id
    loaded: false,       // edb.json 是否已加载
    instances: []        // 当前 EDB 视图的 ECharts 实例
  };

  var COLORS = ['#2f7d32', '#2e75b6', '#c0392b', '#b07a2e', '#7d5ba6',
    '#16a085', '#d35400', '#34495e', '#27ae60', '#8e44ad'];

  /* ---------------- 数值 / 日期工具 ---------------- */

  function fmtVal(v) {
    if (v == null || isNaN(v)) return '-';
    if (Math.abs(v) >= 10000) return v.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
    return (+v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  function fmtPct(v) {
    if (v == null || isNaN(v)) return '-';
    return (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  }

  function cls(v) {
    if (v == null || isNaN(v) || v === 0) return 'flat';
    return v > 0 ? 'up' : 'down';
  }

  function toDate(s) { return new Date(String(s) + 'T00:00:00'); }

  // 区间涨跌（首→末）
  function rangeChg(points) {
    if (points.length < 2) return null;
    var a = points[0][1], b = points[points.length - 1][1];
    return a ? (b - a) / a : null;
  }

  // 环比：最后一点 vs 前一点
  function momChg(points) {
    if (points.length < 2) return null;
    var a = points[points.length - 2][1], b = points[points.length - 1][1];
    return a ? (b - a) / a : null;
  }

  // 同比：最后一点 vs 约一年前最近的一点
  function yoyChg(points) {
    if (points.length < 2) return null;
    var last = points[points.length - 1];
    var t = toDate(last[0]);
    t.setFullYear(t.getFullYear() - 1);
    // 本地日期格式化（不可用 toISOString，UTC+8 下会倒退一天错配上一期）
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var key = t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
    var base = null;
    for (var i = points.length - 1; i >= 0; i--) {
      if (points[i][0] <= key) { base = points[i]; break; }
    }
    if (!base || !base[1]) return null;
    return (last[1] - base[1]) / base[1];
  }

  // 区间位置：末值在 [min,max] 中的百分位
  function posInRange(points) {
    var vals = points.map(function (p) { return p[1]; });
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    var last = points[points.length - 1][1];
    return { min: min, max: max, pos: max > min ? (last - min) / (max - min) : 0.5 };
  }

  function unitOf(ind) {
    var u = ind.unit || '';
    if (!u || u.indexOf('=') > 0) return '点'; // 空单位或指数基准串（如 1998年1月1日=1000）
    return u;
  }

  /* ---------------- 图表渲染 ---------------- */

  function initChart(dom) {
    var inst = echarts.init(dom);
    state.instances.push(inst);
    return inst;
  }

  function disposeCharts() {
    state.instances.forEach(function (c) { c.dispose(); });
    state.instances = [];
  }

  // 归一化：以首点为基准 100
  function normalize(points) {
    var base = points[0][1];
    return points.map(function (p) {
      return [p[0], base ? +(p[1] / base * 100).toFixed(2) : null];
    });
  }

  // 将 B 序列按日期对齐到 A 序列（取 <=A日期的最近 B 值），用于价差
  function alignTo(aPoints, bPoints) {
    var map = {};
    aPoints.forEach(function (a) {
      var bv = null;
      for (var i = 0; i < bPoints.length; i++) {
        if (bPoints[i][0] <= a[0]) bv = bPoints[i][1]; else break;
      }
      map[a[0]] = bv;
    });
    return map;
  }

  function baseGrid() { return { left: 66, right: 60, top: 44, bottom: 34 }; }

  // 总览：所有指标归一为 100
  function renderOverview(cat) {
    var dom = $('edb-chart-overview');
    dom.innerHTML = '';
    var legend = [], series = [], raw = {};
    cat.indicators.forEach(function (ind, i) {
      if (ind.points.length < 2) return;
      var nm = ind.label || ind.name;
      legend.push(nm);
      raw[nm] = { unit: unitOf(ind), pts: ind.points };
      series.push({
        name: nm, type: 'line', showSymbol: false, connectNulls: true,
        smooth: false, lineStyle: { width: 2 },
        itemStyle: { color: COLORS[i % COLORS.length] },
        data: normalize(ind.points)
      });
    });
    var chart = initChart(dom);
    chart.setOption({
      color: COLORS,
      legend: { data: legend, top: 0, type: 'scroll' },
      tooltip: {
        trigger: 'axis',
        formatter: function (ps) {
          if (!ps.length) return '';
          // 时间轴：axisValue 是本地零点的毫秒时间戳，用本地 get* 还原 YYYY-MM-DD
          // （不可用 toISOString，UTC+8 下会倒退一天导致错取上月原始值）
          var d = new Date(ps[0].axisValue);
          var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
          var dateStr = isNaN(d.getTime()) ? ps[0].axisValue
            : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
          var s = dateStr + '<br/>';
          ps.forEach(function (p) {
            var norm = Array.isArray(p.value) ? p.value[1] : p.value;
            var info = raw[p.seriesName];
            var orig = '';
            if (info) {
              for (var i = info.pts.length - 1; i >= 0; i--) {
                if (info.pts[i][0] <= dateStr) {
                  orig = ' <span style="color:#999">(' + fmtVal(info.pts[i][1]) + ' ' + info.unit + ')</span>';
                  break;
                }
              }
            }
            s += p.marker + p.seriesName + '：' + (norm == null ? '-' : (+norm).toFixed(1)) + orig + '<br/>';
          });
          return s;
        }
      },
      grid: baseGrid(),
      xAxis: { type: 'time' },
      yAxis: { type: 'value', scale: true },
      series: series
    });
  }

  // 维度图：series（line/bar，可含 yAxisIndex/scale）或 diff（a-b 面积）
  function renderDimChart(dom, cat, spec) {
    dom.innerHTML = '';
    var byCode = {};
    cat.indicators.forEach(function (ind) { byCode[ind.code] = ind; });

    var series = [], legend = [], yAxes = [], rawMeta = {};

    if (spec.diff) {
      var A = byCode[spec.diff.a], B = byCode[spec.diff.b];
      if (!A || !B) return;
      var bmap = alignTo(A.points, B.points);
      var diff = A.points.map(function (p) {
        var bv = bmap[p[0]];
        return [p[0], bv == null ? null : +(p[1] - bv).toFixed(2)];
      });
      legend.push(spec.legendName || (A.label + ' − ' + B.label));
      series.push({
        name: legend[0], type: 'line', showSymbol: false, connectNulls: true,
        lineStyle: { width: 2 }, areaStyle: { opacity: 0.18 },
        itemStyle: { color: COLORS[0] }, data: diff
      });
      yAxes = [{ type: 'value', name: spec.yName || '', scale: true }];
    } else {
      var hasY2 = false;
      spec.series.forEach(function (sc, i) {
        var ind = byCode[sc.code];
        if (!ind || ind.points.length < 2) return;
        var nm = sc.name || ind.label || ind.name;
        var data = sc.scale
          ? ind.points.map(function (p) { return [p[0], +(p[1] * sc.scale).toFixed(2)]; })
          : ind.points.map(function (p) { return [p[0], p[1]]; });
        legend.push(nm);
        rawMeta[nm] = unitOf(ind);
        if (sc.yAxisIndex === 1) hasY2 = true;
        series.push({
          name: nm, type: sc.type || 'line', showSymbol: false, connectNulls: true,
          smooth: false, yAxisIndex: sc.yAxisIndex || 0,
          barMaxWidth: 26,
          lineStyle: { width: 2 },
          itemStyle: { color: COLORS[i % COLORS.length] },
          data: data
        });
      });
      yAxes = [{ type: 'value', name: spec.yName || '', scale: true }];
      if (hasY2) {
        var y2 = (spec.series.filter(function (s) { return s.yAxisIndex === 1; })[0] || {}).y2 || '';
        yAxes.push({ type: 'value', name: y2, scale: true, splitLine: { show: false } });
      }
    }

    var chart = initChart(dom);
    chart.setOption({
      color: COLORS,
      legend: { data: legend, top: 0, type: 'scroll' },
      tooltip: {
        trigger: 'axis',
        valueFormatter: function (v) { return fmtVal(Array.isArray(v) ? v[1] : v); }
      },
      grid: baseGrid(),
      xAxis: { type: 'time' },
      yAxis: yAxes,
      series: series
    });
  }

  /* ---------------- KPI 卡 ---------------- */

  function renderKpis(cat) {
    var html = '';
    cat.indicators.forEach(function (ind) {
      var pts = ind.points;
      if (!pts.length) return;
      var last = pts[pts.length - 1];
      var mom = momChg(pts), yoy = yoyChg(pts), rng = posInRange(pts);
      var posPct = Math.round(rng.pos * 100);
      html +=
        '<div class="edb-kpi">' +
        '<div class="edb-kpi-name" title="' + ind.name + '">' + (ind.label || ind.name) +
        '<span class="edb-kpi-freq">' + (ind.freq || '') + '</span></div>' +
        '<div class="edb-kpi-val">' + fmtVal(last[1]) + '<em>' + unitOf(ind) + '</em></div>' +
        '<div class="edb-kpi-chgs">' +
        '<span class="edb-chg ' + cls(mom) + '">环比 ' + fmtPct(mom) + '</span>' +
        '<span class="edb-chg ' + cls(yoy) + '">同比 ' + fmtPct(yoy) + '</span>' +
        '</div>' +
        '<div class="edb-kpi-range">' +
        '<span class="edb-rng-label">' + fmtVal(rng.min) + '</span>' +
        '<span class="edb-rng-track"><span class="edb-rng-dot" style="left:' + posPct + '%"></span></span>' +
        '<span class="edb-rng-label">' + fmtVal(rng.max) + '</span>' +
        '</div>' +
        '<div class="edb-kpi-foot">' + last[0] + ' · ' + (ind.source || '') + '</div>' +
        '</div>';
    });
    $('edb-kpis').innerHTML = html;
  }

  /* ---------------- 维度图配置（每分类 2-3 张） ---------------- */

  var DIM_SPECS = {
    auto: [
      {
        title: '汽车产量 & 新能源渗透率', yName: '万辆',
        note: '左轴：汽车/新能源产量（万辆，柱，中汽协）；右轴：新能源渗透率（%，线）',
        series: [
          { code: 'S0105523', type: 'bar', scale: 1e-4 },
          { code: 'S6139215', type: 'bar', scale: 1e-4 },
          { code: 'X2694913', type: 'line', yAxisIndex: 1, y2: '%' }
        ]
      },
      {
        title: '产销对比（万辆）', yName: '万辆',
        note: '中汽协口径：汽车与新能源汽车的月度产量 vs 销量（均为辆，已折算万辆）',
        series: [
          { code: 'S0105523', type: 'line', scale: 1e-4, name: '汽车产量' },
          { code: 'S0105710', type: 'line', scale: 1e-4, name: '汽车销量' },
          { code: 'S6139215', type: 'line', scale: 1e-4, name: '新能源产量' },
          { code: 'S6139212', type: 'line', scale: 1e-4, name: '新能源销量' }
        ]
      },
      {
        title: '乘用车 vs 比亚迪 产量（万辆）', yName: '万辆',
        note: '中汽协口径（辆，已折算万辆），反映比亚迪在乘用车中的量级',
        series: [
          { code: 'S0105526', type: 'line', scale: 1e-4 },
          { code: 'S0105689', type: 'line', scale: 1e-4 }
        ]
      }
    ],
    alu: [
      {
        title: '电解铝价格 vs 氧化铝成本（元/吨）', yName: '元/吨',
        note: '铝锭现货 / 月均价与氧化铝现货，同单位（元/吨）可直接叠比',
        series: [
          { code: 'S0179655', type: 'line' },
          { code: 'S0031718', type: 'line' },
          { code: 'Z9174481', type: 'line' }
        ]
      },
      {
        title: '吨铝价差（铝锭现货 − 氧化铝）', yName: '元/吨',
        note: '铝价与氧化铝现货直接相减；未计氧化铝单耗（约 1.9 吨/吨铝）及电力、阳极等成本，非真实冶炼利润',
        diff: { a: 'S0179655', b: 'Z9174481' },
        legendName: '铝锭 − 氧化铝'
      },
      {
        title: 'LME 铝（美元/吨）', yName: '美元/吨',
        note: '伦铝以美元计价，独立展示',
        series: [{ code: 'S0029755', type: 'line' }]
      }
    ],
    shipping: [
      {
        title: '集运综合指数 CCFI & SCFI', yName: '指数',
        note: 'CCFI（中国出口集装箱综合）与 SCFI（上海出口集装箱综合）',
        series: [
          { code: 'S0000066', type: 'line' },
          { code: 'S0114089', type: 'line' }
        ]
      },
      {
        title: 'CCFI 分航线', yName: '指数',
        note: '综合 / 欧洲 / 美西 / 美东 / 东南亚航线',
        series: [
          { code: 'S0000066', type: 'line' },
          { code: 'S0000075', type: 'line' },
          { code: 'S0000073', type: 'line' },
          { code: 'S0000072', type: 'line' },
          { code: 'S0000069', type: 'line' }
        ]
      },
      {
        title: '散货 & 油运指数', yName: '指数',
        note: 'BDI（干散货）、BDTI（原油运输）、中国沿海散货',
        series: [
          { code: 'S0031550', type: 'line' },
          { code: 'S0031553', type: 'line' },
          { code: 'D9483906', type: 'line' }
        ]
      }
    ],
    tire: [
      {
        title: '轮胎产量 & 出口金额', yName: '万条',
        note: '左轴：轮胎产量（万条，柱，月）；右轴：橡胶轮胎出口金额（万美元，线，月）',
        series: [
          { code: 'F0040955', type: 'bar' },
          { code: 'S0270241', type: 'line', yAxisIndex: 1, y2: '万美元' }
        ]
      },
      {
        title: '橡胶原料价格（元/吨）', yName: '元/吨',
        note: '天然橡胶(标准胶1#) 与 丁苯橡胶(1502) 现货，同为元/吨直接叠比；周频',
        series: [
          { code: 'S5470428', type: 'line' },
          { code: 'S5470420', type: 'line' }
        ]
      },
      {
        title: '半钢胎开工率（%）', yName: '%',
        note: '汽车轮胎(半钢胎)开工率，反映轮胎厂景气度；周频',
        series: [{ code: 'S6124651', type: 'line' }]
      }
    ],
    realestate: [
      {
        title: '销售与投资（统计局累计值）', yName: '万㎡',
        note: '左轴：商品房销售面积累计（万㎡，柱）；右轴：销售额与开发投资完成额累计（亿元，线）；每年 1 月累计重置属正常形态',
        series: [
          { code: 'S0029658', type: 'bar' },
          { code: 'S0029659', type: 'line', yAxisIndex: 1, y2: '亿元' },
          { code: 'S0029656', type: 'line', yAxisIndex: 1, y2: '亿元' }
        ]
      },
      {
        title: '施工端：新开工 vs 竣工（累计万㎡）', yName: '万㎡',
        note: '统计局房屋新开工/竣工面积累计值，同为万平方米直接叠比',
        series: [
          { code: 'S0029669', type: 'line' },
          { code: 'S0029670', type: 'line' }
        ]
      },
      {
        title: '房价同比 & 30 城高频成交', yName: '%',
        note: '左轴：70 城新建商品住宅价格指数当月同比（%）；右轴：30 大中城市日均成交面积（万㎡，日频按月均聚合）',
        series: [
          { code: 'S2707411', type: 'line' },
          { code: 'S2707380', type: 'line', yAxisIndex: 1, y2: '万㎡' }
        ]
      }
    ],
    coal: [
      {
        title: '原煤 / 焦炭产量与煤炭进口（万吨）', yName: '万吨',
        note: '统计局原煤、焦炭当月产量（1-2 月合并发布导致缺月）与海关煤炭进口量，同为万吨',
        series: [
          { code: 'S0026989', type: 'line' },
          { code: 'S0026997', type: 'line' },
          { code: 'S0027001', type: 'line' }
        ]
      },
      {
        title: '动力煤价：秦皇岛港 Q5500（元/吨）', yName: '元/吨',
        note: '秦皇岛港平仓价（周频），动力煤长协/市场价的基准锚',
        series: [{ code: 'S5104572', type: 'line' }]
      },
      {
        title: '焦链价格：炼焦煤 vs 冶金焦（元/吨）', yName: '元/吨',
        note: '主要港口炼焦煤均价与冶金焦平仓价（日频折周），焦炭利润看两线开口',
        series: [
          { code: 'S5132102', type: 'line' },
          { code: 'S5132320', type: 'line' }
        ]
      }
    ],
    steel: [
      {
        title: '粗钢 / 生铁 / 钢材产量（万吨，当月）', yName: '万吨',
        note: '统计局当月值（1-2 月合并发布导致缺月）',
        series: [
          { code: 'S0027374', type: 'line' },
          { code: 'S0027370', type: 'line' },
          { code: 'S0027378', type: 'line' }
        ]
      },
      {
        title: '螺纹钢价 vs 进口铁矿石（元/吨 / 美元/吨）', yName: '元/吨',
        note: '左轴：螺纹钢 HRB400E 20mm 全国价（日频折周）；右轴：进口铁矿石平均价（美元/吨，月）',
        series: [
          { code: 'S5707798', type: 'line' },
          { code: 'S5704501', type: 'line', yAxisIndex: 1, y2: '美元/吨' }
        ]
      },
      {
        title: '钢材社会库存（万吨）', yName: '万吨',
        note: '主要市场钢材社会库存量（周频，非官方整理口径），去库/累库拐点参考',
        series: [{ code: 'L3818799', type: 'line' }]
      }
    ]
  };

  function renderDimCharts(cat) {
    var box = $('edb-dim-charts');
    var specs = DIM_SPECS[state.current] || [];
    var html = '';
    specs.forEach(function (s, i) {
      html +=
        '<div class="edb-panel">' +
        '<div class="edb-panel-head">' +
        '<span class="edb-panel-title">' + s.title + '</span>' +
        '<span class="edb-panel-sub">' + (s.note || '') + '</span>' +
        '</div>' +
        '<div id="edb-dim-' + i + '" class="edb-chart" style="height:360px"></div>' +
        '</div>';
    });
    box.innerHTML = html;
    specs.forEach(function (s, i) {
      renderDimChart($('edb-dim-' + i), cat, s);
    });
  }

  /* ---------------- 分类渲染入口 ---------------- */

  function renderCategory(catId) {
    var cat = state.byId[catId];
    if (!cat) return;
    state.current = catId;
    disposeCharts();

    var rng = cat.range || state.data.range;
    $('edb-cat-head').innerHTML =
      '<span class="edb-cat-name">' + cat.name + '</span>' +
      '<span class="edb-cat-meta">区间 ' + rng.begin + ' ~ ' + rng.end +
      ' · 指标 ' + cat.indicators.length + ' 项 · 更新于 ' + fmtUpdated(state.data.updated_at) + '</span>';

    renderKpis(cat);
    renderOverview(cat);
    renderDimCharts(cat);

    $('edb-foot').textContent =
      '数据来源：万得 Wind 金融数据服务（宏观行业 EDB，周/月聚合）· 仅供个人学习研究';
  }

  function fmtUpdated(s) {
    return s ? String(s).replace('T', ' ').slice(0, 16) : '-';
  }

  /* ---------------- 数据加载 ---------------- */

  function loadEdb(cb) {
    if (state.loaded) { cb(); return; }
    $('edb-loading').style.display = '';
    $('edb-error').style.display = 'none';
    $('edb-body').style.display = 'none';
    fetch(DATA_FILE)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.categories || !data.categories.length) throw new Error('EDB 数据为空');
        state.data = data;
        data.categories.forEach(function (c) { state.byId[c.id] = c; });
        state.loaded = true;
        $('edb-loading').style.display = 'none';
        cb();
      })
      .catch(function (e) {
        $('edb-loading').style.display = 'none';
        $('edb-error').textContent = 'EDB 数据加载失败：' + e.message + '（请确认 data/edb.json 已生成）';
        $('edb-error').style.display = '';
      });
  }

  /* ---------------- 行业切换控制 ---------------- */

  function showEdbBody(on) {
    $('edb-body').style.display = on ? '' : 'none';
  }

  function switchView(view) {
    document.querySelectorAll('.edb-seg').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === view);
    });
    var agro = view === 'agro';
    $('agro-view').style.display = agro ? '' : 'none';
    $('edb-view').style.display = agro ? 'none' : '';
    if (agro) {
      if (window.__agroRefresh) window.__agroRefresh();
      return;
    }
    // EDB 分类
    loadEdb(function () {
      showEdbBody(true);
      renderCategory(view);
      // 视图刚显示，容器尺寸有效，再 resize 一次保证宽度
      setTimeout(function () {
        state.instances.forEach(function (c) { c.resize(); });
      }, 0);
    });
  }

  function init() {
    $('edb-switch').querySelectorAll('.edb-seg').forEach(function (b) {
      b.addEventListener('click', function () {
        switchView(b.getAttribute('data-view'));
      });
    });
    window.addEventListener('resize', function () {
      if ($('edb-view').style.display !== 'none') {
        state.instances.forEach(function (c) { c.resize(); });
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
