/* =========================================================
 * 跑团桌 · 职业升级表模块 (levels.js)
 * 12 职业 1-20 级：熟练加值 / 职业特性（中文）/ 已知法术 / 法术位
 * 数据源: dnd5eapi /classes/{index}/levels + /spellcasting
 * ========================================================= */
(function (global) {
  'use strict';

  var DnD = global.DnD = global.DnD || {};
  var G = DnD.Glossary;

  var LevelsUI = {};
  var root;
  var current = null;     /* 职业 index */
  var levelRows = [];     /* levels 端点返回的 20 级数组 */
  var featDetail = null;  /* 当前查看的特性 {name, desc:[]} */

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /* ---------- 渲染 ---------- */
  function render() {
    if (!root) return;
    root.innerHTML = '';
    root.appendChild(renderClassBar());
    if (!current) {
      root.appendChild(el('p', 'dnd-hint', '选择一个职业查看 1-20 级升级表'));
    } else if (!levelRows.length) {
      root.appendChild(el('p', 'dnd-hint', '加载中…'));
    } else {
      root.appendChild(renderTable());
      root.appendChild(renderFeatDetail());
    }
  }

  function renderClassBar() {
    var bar = el('div', 'lib-toolbar');
    var fRow = el('div', 'lib-filters');
    Object.keys(G.classes).forEach(function (k) {
      var b = el('button', 'dnd-btn dnd-btn-sm' + (current === k ? ' active' : ''), G.classes[k]);
      b.addEventListener('click', function () { selectClass(k); });
      fRow.appendChild(b);
    });
    bar.appendChild(fRow);
    return bar;
  }

  function selectClass(index) {
    current = index;
    levelRows = [];
    featDetail = null;
    render();
    loadClass(index);
  }

  function loadClass(index) {
    DnD.Data.getClassLevels(index).then(function (doc) {
      /* 新版 API 直接返回裸数组；旧版包装为 {levels: [...]} */
      levelRows = Array.isArray(doc) ? doc : (doc.levels || []);
      render();
    }).catch(function (err) {
      var box = root.querySelector('.dnd-hint');
      if (box) box.textContent = '加载失败：' + err.message + '（可稍后重试）';
    });
  }

  /* 表格列：从每级 spellcasting 聚合需要哪些列 */
  function columns() {
    var cols = [];
    var hasCantrips = false;
    var hasKnown = false;
    var maxSlot = 0;
    levelRows.forEach(function (row) {
      var sc = row.spellcasting;
      if (!sc) return;
      if (sc.cantrips_known != null) hasCantrips = true;
      if (sc.spells_known != null) hasKnown = true;
      for (var i = 1; i <= 9; i++) {
        if (sc['spell_slots_level_' + i]) maxSlot = Math.max(maxSlot, i);
      }
    });
    if (hasCantrips) cols.push('已知戏法');
    if (hasKnown) cols.push('已知法术');
    for (var n = 1; n <= maxSlot; n++) cols.push(n + ' 环');
    return cols;
  }

  function renderTable() {
    var wrap = el('div', 'lv-table-wrap');
    var table = el('table', 'lv-table');
    var thead = el('thead');
    var hr = el('tr');
    ['等级', '熟练加值', '职业特性'].forEach(function (t) { hr.appendChild(el('th', null, t)); });
    columns().forEach(function (t) { hr.appendChild(el('th', 'lv-num', t)); });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el('tbody');
    levelRows.forEach(function (row) {
      var tr = el('tr', row.level === 20 ? 'lv-max' : '');
      tr.appendChild(el('td', 'lv-num lv-level', String(row.level)));
      tr.appendChild(el('td', 'lv-num', (row.prof_bonus >= 0 ? '+' : '') + row.prof_bonus));

      var featTd = el('td');
      (row.features || []).forEach(function (f) {
        var btn = el('button', 'lv-feat', esc(G.featureName(f.name)));
        btn.title = f.name;
        btn.addEventListener('click', function () { loadFeat(f); });
        featTd.appendChild(btn);
      });
      if (row.ability_score_bonuses) {
        featTd.appendChild(el('span', 'lv-asi', '属性值 +' + row.ability_score_bonuses));
      }
      tr.appendChild(featTd);

      columns().forEach(function (col) {
        var txt = '—';
        var sc = row.spellcasting;
        if (col === '已知戏法') {
          if (sc && sc.cantrips_known != null) txt = String(sc.cantrips_known);
        } else if (col === '已知法术') {
          if (sc && sc.spells_known != null) txt = String(sc.spells_known);
        } else {
          var n = Number(col.replace(' 环', ''));
          if (sc && sc['spell_slots_level_' + n]) txt = String(sc['spell_slots_level_' + n]);
        }
        tr.appendChild(el('td', 'lv-num', txt));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  /* 特性详情区 */
  function loadFeat(f) {
    featDetail = { name: f.name, loading: true, desc: null };
    render();
    DnD.Data.getFeature(f.index).then(function (d) {
      featDetail = { name: f.name, loading: false, desc: d.desc || [] };
      var box = document.getElementById('lv-feat-detail');
      if (box) box.innerHTML = featDetailHtml();
    }).catch(function () {
      featDetail = { name: f.name, loading: false, desc: null };
      var box = document.getElementById('lv-feat-detail');
      if (box) box.innerHTML = featDetailHtml();
    });
  }

  function featDetailHtml() {
    if (!featDetail) return '';
    var cn = G.featureName(featDetail.name);
    var html = '<div class="lv-feat-head">' + esc(cn)
      + (cn !== featDetail.name ? ' <span class="lv-feat-en">' + esc(featDetail.name) + '</span>' : '')
      + '</div>';
    if (featDetail.loading) return html + '<p class="dnd-hint">加载中…</p>';
    if (!featDetail.desc) return html + '<p class="dnd-hint">该特性无独立描述（通常为子职业占位或选择项），详见职业规则书。</p>';
    html += featDetail.desc.map(function (p) {
      return '<p class="lib-desc-p">' + esc(p) + '</p>';
    }).join('');
    return html;
  }

  function renderFeatDetail() {
    var box = el('div', 'lv-feat-detail');
    box.id = 'lv-feat-detail';
    if (featDetail) box.innerHTML = featDetailHtml();
    return box;
  }

  /* ---------- 初始化 ---------- */
  function init() {
    root = document.getElementById('levels-root');
    if (!root) return;
    root.innerHTML = '';
    render();
  }

  DnD.LevelsUI = { init: init };
})(window);
