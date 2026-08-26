/* 价值分析模块 —— 加载 stock-data/data/*.json 并渲染
 * 路由：#/600519 → 公司详情；无 hash → 公司列表
 */
(function () {
  'use strict';

  var DATA_BASE = './data/';

  var $ = function (id) { return document.getElementById(id); };
  var state = { companies: [], current: null, charts: [], view: 'year',
    indexUpdatedAt: null, listScroll: 0, keyword: '', tab: 'A',
    scores: {}, details: {}, scoresLoaded: false, sortKey: null, sortDir: 'desc' };

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

  // 复合增长率：cur 较 prev 跨越 years 年
  function cagr(cur, prev, years) {
    if (cur == null || prev == null || prev <= 0 || !years) return null;
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

  // 渲染列表（市场 Tab 过滤 + 搜索过滤 + 评分排序 + 宽表展示），重建 DOM 后重新绑定交互
  function renderList() {
    var box = $('stock-list');
    var kw = (state.keyword || '').trim().toLowerCase();
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
      '<div class="s-sort">' +
      sortBtn('score-grahamAgg', '格·进取') +
      sortBtn('score-grahamDef', '格·防御') +
      sortBtn('score-schloss', '施洛斯') +
      sortBtn('score-buffett', '巴菲特') +
      // 移动端卡片流补充入口：按各策略买入性价比排序（参考价÷现价，倍数大在前）
      (isMobile ? '<span class="s-sort-divider">买入性价比</span>' +
        sortBtn('buy-grahamAgg', '进取买') +
        sortBtn('buy-grahamDef', '防御买') +
        sortBtn('buy-schloss', '施洛斯买') +
        sortBtn('buy-buffett', '巴菲特买') : '') +
      '<span class="s-sort-hint">评分列按分数排，买入/卖出列按性价比排（参考价 ÷ 现价，倍数大在前），再点同列切换升/降序</span></div></div>';
    if (isMobile) {
      // 移动端卡片流：名称/代码/行业/现价 + 四流派评分四宫格 + 买入参考，零横向拖动
      html += '<div class="stock-cards">' + list.map(cardHtml).join('') + '</div>';
    } else {
      // 宽表：双行分组表头（评分/买入参考/保守卖出/公允卖出四组 × 四流派），横向滚动查看；
      // 子表头与基础列均可点击排序（data-sort 键：score-/buy-/sellC-/sellF- + 流派）
      html += '<div class="stock-table-wrap"><table class="stock-list-table"><thead>' +
      '<tr class="th-g1">' +
      thSort('name', '股票名称', 'stick', ' rowspan="2"') +
      thSort('code', '代码', null, ' rowspan="2"') +
      thSort('industry', '所属行业', null, ' rowspan="2"') +
      thSort('price', '现价', null, ' rowspan="2"') +
      '<th colspan="4">四大流派评分</th>' +
      '<th colspan="4">建议买入参考</th>' +
      '<th colspan="4">保守卖出参考</th>' +
      '<th colspan="4">公允卖出参考</th>' +
      '</tr><tr class="th-g2">' +
      ['score', 'buy', 'sellC', 'sellF'].map(function (prefix) {
        return ['grahamAgg', 'grahamDef', 'schloss', 'buffett'].map(function (k, i) {
          // 评分列按分数排；买入/卖出列按性价比（参考价÷现价倍数）排
          return thSort(prefix + '-' + k, ['格进取', '格防御', '施洛斯', '巴菲特'][i], null, null,
            prefix === 'score' ? null : '性价比');
        }).join('');
      }).join('') +
      '</tr></thead><tbody>';
    list.forEach(function (c) {
      var k = (c.name + ' ' + c.code).toLowerCase();
      if (kw && k.indexOf(kw) < 0) return;
      html += '<tr class="stock-row" data-k="' + k + '" data-code="' + c.code + '" ' +
        'data-price="' + (c.price == null ? '' : c.price) + '" tabindex="0" role="link">' +
        listCells(c) + '</tr>';
    });
    html += '</tbody></table></div>';
    }
    html += '<div class="stock-hint" id="stock-search-empty" style="display:none">未找到匹配的公司</div>';
    html += '<div class="stock-list-foot">数据更新于 ' + fmtFullDate(state.indexUpdatedAt) + '</div>';
    box.innerHTML = html;

    // 搜索框输入即时过滤（名称/代码模糊匹配）
    var input = $('stock-search');
    input.addEventListener('input', function () {
      state.keyword = input.value;
      var q = state.keyword.trim().toLowerCase();
      var shown = 0;
      box.querySelectorAll('.stock-row').forEach(function (row) {
        var hit = !q || (row.getAttribute('data-k') || '').indexOf(q) >= 0;
        row.style.display = hit ? '' : 'none';
        if (hit) shown++;
      });
      $('stock-search-empty').style.display = shown ? 'none' : '';
    });

    // 市场 Tab 切换：仅重渲染当前列表，保留搜索词与排序状态
    box.querySelectorAll('.s-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.tab = btn.getAttribute('data-tab');
        renderList();
      });
    });

    // 排序：表头列与下方按钮共用同一逻辑（applySort），首次点击数值列降序、文本列升序
    box.querySelectorAll('thead th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () { applySort(th.getAttribute('data-sort')); });
    });
    box.querySelectorAll('.s-sort button').forEach(function (btn) {
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

  // 单行 20 个单元格：名称/代码/行业/现价 + 评分4 + 买入4 + 保守卖出4 + 公允卖出4
  // data-s 标记供降级路径 fillRowScores 渐进重填；价格与现价对照着色（买区绿/卖区红）
  function listCells(c) {
    var sc = state.scores[c.code] || null;
    var refs = sc ? sc.priceRefs : null;
    var cur = c.price;
    var h = '<td class="c-name stick" title="' + c.name + '">' + c.name + '</td>' +
      '<td class="c-code">' + c.code + '</td>' +
      '<td class="c-industry" title="' + (c.industry || '') + '">' + (c.industry || '-') + '</td>' +
      '<td class="c-num c-now">' + (cur == null ? '-' : fmtNum(cur)) + '</td>';
    ['grahamAgg', 'grahamDef', 'schloss', 'buffett'].forEach(function (k) {
      var v = sc ? sc[k] : null;
      var g = gradeOf(v);
      h += '<td class="c-num sc-' + g + '" data-s="score-' + k + '" title="' + gradeText(g) + '">' +
        (v == null ? '-' : fmtNum(v)) + '</td>';
    });
    // 买入参考：现价 ≤ 买入价（进入买入区）标绿
    ['grahamAgg', 'grahamDef', 'schloss', 'buffett'].forEach(function (k) {
      var p = refs && refs[k] ? refs[k].buy : null;
      var hit = p != null && cur != null && cur <= p ? ' r-hit' : '';
      h += '<td class="c-num' + hit + '" data-s="buy-' + k + '">' + (p == null ? '-' : fmtNum(p)) + '</td>';
    });
    // 保守卖出：现价 ≥ 卖出价（进入卖出区）标红
    ['grahamAgg', 'grahamDef', 'schloss', 'buffett'].forEach(function (k) {
      var p = refs && refs[k] ? refs[k].sellCons : null;
      var hit = p != null && cur != null && cur >= p ? ' r-hit-s' : '';
      h += '<td class="c-num' + hit + '" data-s="sellC-' + k + '">' + (p == null ? '-' : fmtNum(p)) + '</td>';
    });
    ['grahamAgg', 'grahamDef', 'schloss', 'buffett'].forEach(function (k) {
      var p = refs && refs[k] ? refs[k].sellFair : null;
      var hit = p != null && cur != null && cur >= p ? ' r-hit-s' : '';
      h += '<td class="c-num' + hit + '" data-s="sellF-' + k + '">' + (p == null ? '-' : fmtNum(p)) + '</td>';
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
      '</div>';
    // 评分四宫格（等级色与宽表一致：sc-good/mid/low/bad/na）
    h += '<div class="sc-scores">' + ['grahamAgg', 'grahamDef', 'schloss', 'buffett'].map(function (k, i) {
      var v = sc ? sc[k] : null;
      var g = gradeOf(v);
      return '<div class="sc-score sc-' + g + '"><span class="sc-k">' + names[i] + '</span>' +
        '<span class="sc-v" data-s="score-' + k + '">' + (v == null ? '-' : fmtNum(v)) + '</span></div>';
    }).join('') + '</div>';
    // 买/卖参考四列：每列含买入价 + 保守卖出 + 公允卖出（现价 ≤ 买入价整列绿底，
    // 现价 ≥ 卖出价对应值标红，与宽表 r-hit/r-hit-s 语义一致）
    h += '<div class="sc-refs">' + ['grahamAgg', 'grahamDef', 'schloss', 'buffett'].map(function (k, i) {
      var p = refs && refs[k] ? refs[k] : null;
      var buy = p ? p.buy : null;
      var sellC = p ? p.sellCons : null;
      var sellF = p ? p.sellFair : null;
      var hitB = buy != null && cur != null && cur <= buy;
      var hitC = sellC != null && cur != null && cur >= sellC;
      var hitF = sellF != null && cur != null && cur >= sellF;
      return '<div class="sc-ref' + (hitB ? ' sc-r-hit' : '') + '" data-s="buy-' + k + '">' +
        '<em>' + names[i] + '</em>' +
        '<span class="r-buy' + (hitB ? ' r-hit' : '') + '">买 ' + (buy == null ? '-' : fmtNum(buy)) + '</span>' +
        '<span class="r-sell' + (hitC ? ' r-hit-s' : '') + '">保卖 ' + (sellC == null ? '-' : fmtNum(sellC)) + '</span>' +
        '<span class="r-sell' + (hitF ? ' r-hit-s' : '') + '">公卖 ' + (sellF == null ? '-' : fmtNum(sellF)) + '</span>' +
        '</div>';
    }).join('') + '</div>';
    return h + '</div>';
  }

  /* ---------------- 列表评分预载与排序 ---------------- */

  // 排序按钮 HTML（当前选中标准高亮并显示升降箭头）
  function sortBtn(key, label) {
    var active = state.sortKey === key;
    return '<button data-sort="' + key + '"' + (active ? ' class="active"' : '') + '>' +
      label + (active ? (state.sortDir === 'desc' ? ' ↓' : ' ↑') : '') + '</button>';
  }

  // 表头排序单元格 HTML（可点击；激活列高亮并显示箭头；cls 追加样式如 stick，attrs 追加属性如 rowspan；
  // hint 用于替换排序语义说明，如买入/卖出列按性价比排）
  function thSort(key, label, cls, attrs, hint) {
    var active = state.sortKey === key;
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
            state.scores[c.code] = {
              grahamAgg: v.grahamAgg.total, grahamDef: v.grahamDef.total,
              schloss: v.schloss.total, buffett: v.buffett.total,
              priceRefs: priceReferences(d, va)
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
      } else {
        if (refs && refs[k]) p = refs[k][kind === 'buy' ? 'buy' : kind === 'sellC' ? 'sellCons' : 'sellFair'];
        var hit = '';
        if (p != null && cur != null) {
          if (kind === 'buy' && cur <= p) hit = ' r-hit';
          if (kind !== 'buy' && cur >= p) hit = ' r-hit-s';
        }
        td.className = 'c-num' + hit;
      }
      td.innerHTML = p == null ? '-' : fmtNum(p);
    });
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

    $('stock-detail-body').innerHTML = html;
    bindViewToggle();
    bindComparePicks();
    bindVaNav();
    renderCharts(d.indicators || []);
    renderCompare(d);
    initSheet(d);
    renderValueAnalysis(va);
    renderScores(sc);
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
  function valueScores(d, va, k) {
    if (k == null) k = 1;
    var annual = annualRows(d.indicators || []);
    var last = annual[annual.length - 1];
    var lastDate = last ? String(last['报告期']).slice(0, 10) : null;
    var lastYear = lastDate ? Number(lastDate.slice(0, 4)) : null;
    var baList = (d.balance || []).slice().sort(function (a, b) { return a['报告日'] < b['报告日'] ? -1 : 1; });
    var lastBa = lastDate ? sheetRowByDate(baList, lastDate) : null;
    var s = d.snapshot || {};
    var mcap = s.market_cap, pe = s.pe_ttm, pb = s.pb;
    if (k !== 1) {
      mcap = mcap != null ? mcap * k : null;
      pe = pe != null ? pe * k : null;
      pb = pb != null ? pb * k : null;
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
    // 应收账款/营收 3 年年报均值（位置对齐，缺失年忽略）
    var ar3 = baAnnual.slice(-3).map(function (r) { return r['应收账款']; });
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

    return {
      basis: basis,
      grahamAgg: { title: '进取型烟蒂 · net-net（低于净流动资产买入）', total: gATotal, items: gA,
        note: '格雷厄姆 net-net 思路：以低于净流动资产（流动资产-全部负债）2/3 的价格买入，赚取清算价值与市价之差。得分越高代表越接近“捡烟蒂”状态。' },
      grahamDef: { title: '防御型烟蒂 · 防御型投资者标准', total: gDTotal, items: gD,
        note: '对应《聪明的投资者》第 14 章防御型投资者选股标准（规模/流动比率/长期负债/盈利稳定/分红历史/盈利增长/估值）。规模为硬门槛（总资产≥100亿），关键安全项（流动比率<1、营运资本为负、近5年过半亏损、净利负增长）直接负分惩罚，比进取型更严格。' },
      schloss: { title: '施洛斯烟蒂 · 资产折扣+低估值+低负债', total: sTotal, items: sItems.concat(riskItems),
        note: '沃尔特·施洛斯风格：以低于净资产/流动资产的价格买入、负债极低、有股息，分散持有等待价值回归。风险扣分项为量化危险信号：净资产萎缩/扣非亏损、商誉无形与应收存货减值结构、有息负债攀升与利息覆盖不足、营收毛利率趋势溃败，数据不足不扣分；管理层掏空等无公开量化数据的信号未纳入。' },
      buffett: { title: '巴菲特芒格 · 优质企业合理价格+护城河', total: bTotal, items: bItems.concat(moatItems),
        note: moatNote }
    };
  }

  // ---- 价格参考（买入/保守卖出/公允卖出）----
  // 买入价：二分反推使该流派总分 ≥ 90 的最高市值对应股价；质量项托底已达标或不随价格变化时为 null。
  // 卖出价：锚定各流派核心估值指标的阈值倍数（不随质量分托底失真）。
  // ⚠ 二分循环调用 valueScores，本函数绝不可在 valueScores 内部调用（防递归），由 renderDetail 单独挂载。

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

  // 四大流派买入/保守卖出/公允卖出价格参考（对应 scoring.py price_references）
  function priceReferences(d, va) {
    var s = d.snapshot || {};
    var price0 = s.price, mcap0 = s.market_cap, pe0 = s.pe_ttm, pb0 = s.pb;
    var none = { buy: null, sellCons: null, sellFair: null };
    if (price0 == null || price0 <= 0) {
      return { grahamAgg: none, grahamDef: none, schloss: none, buffett: none };
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
    var shares = mcap0 != null ? mcap0 / price0 : null;
    var ncavPs = (ncav != null && shares) ? ncav / shares : null;   // 每股净流动资产
    var bps = (pb0 != null && pb0 > 0) ? price0 / pb0 : null;       // 每股净资产
    var epsTtm = (pe0 != null && pe0 > 0) ? price0 / pe0 : null;    // TTM 每股收益
    var fpe = fairPe(va.netCagr5);
    function buyOf(key) {
      return bisectBuy(function (kk) { return valueScores(d, va, kk)[key].total; }, price0);
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
    var bCons = epsTtm != null ? fpe * epsTtm : null;
    return {
      grahamAgg: {
        buy: clampBuy(buyOf('grahamAgg'), gACons),
        sellCons: gACons,
        sellFair: (ncavPs != null && ncavPs > 0) ? 1.5 * ncavPs : null
      },
      grahamDef: {
        buy: clampBuy(buyOf('grahamDef'), gDCons),
        sellCons: gDCons,
        sellFair: (epsTtm != null && epsTtm > 0) ? 20 * epsTtm : null
      },
      schloss: {
        buy: clampBuy(buyOf('schloss'), sCons),
        sellCons: sCons,
        sellFair: (bps != null && bps > 0) ? 1.5 * bps : null
      },
      buffett: {
        buy: clampBuy(epsTtm != null ? fpe * epsTtm * 2 / 3 : null, bCons),
        sellCons: bCons,
        sellFair: epsTtm != null ? fpe * epsTtm * 1.3 : null
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
      if (el) el.innerHTML = scoreCard(trio[1].title, sc.basis, trio[1].total, trio[1].items, trio[1].note, trio[2], curPrice);
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
