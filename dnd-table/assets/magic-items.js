/* =========================================================
 * 跑团桌 · 魔法物品模块 (magic-items.js)
 * 魔法物品生成器（按稀有度随机）+ 物品库（稀有度/类型筛选 + 中英文搜索 + 详情）
 * + 2024 专长速查（数据来自 feats.js，5E 不全书）
 * ========================================================= */
(function (global) {
  'use strict';

  var DnD = global.DnD = global.DnD || {};
  var G = DnD.Glossary;

  var RARITY_CN = {
    Common: '普通', Uncommon: '非普通', Rare: '稀有', 'Very Rare': '极稀有',
    Legendary: '传说', Artifact: '神器', Varies: '视物品而定'
  };
  var TYPE_CN = {
    Ammunition: '弹药', Armor: '护甲', Potion: '药剂', Ring: '戒指', Rod: '权杖',
    Scroll: '卷轴', Staff: '法杖', Wand: '魔杖', Weapon: '武器', 'Wondrous Items': '奇物'
  };

  var MagicUI = {};
  var root;
  var list = [];
  var meta = DnD.MagicMeta || {};
  var rarityFilter = null;    /* null=全部 */
  var typeFilter = null;      /* null=全部 */
  var keyword = '';
  var detailIndex = null;
  var detailData = null;
  /* 生成器 */
  var genRarity = 'all';
  var genResult = null;       /* {index, rarity, type} */
  var genHistory = [];        /* index 列表 */
  /* 专长速查 */
  var featCat = 'all';
  var featKeyword = '';
  var featOpen = null;        /* 展开的专长 en */

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
  function rarityName(r) { return RARITY_CN[r] || r; }
  function typeName(t) { return TYPE_CN[t] || t; }

  function filtered() {
    var kw = keyword.trim().toLowerCase();
    return list.filter(function (it) {
      var m = meta[it.index] || {};
      if (rarityFilter && m.r !== rarityFilter) return false;
      if (typeFilter && m.t !== typeFilter) return false;
      if (kw) {
        var cn = G.magicItemName(it.index);
        if (it.name.toLowerCase().indexOf(kw) === -1 && cn.toLowerCase().indexOf(kw) === -1) return false;
      }
      return true;
    });
  }

  /* ---------- 渲染 ---------- */
  function render() {
    if (!root) return;
    root.innerHTML = '';
    root.appendChild(renderGenerator());
    root.appendChild(renderLibrary());
    root.appendChild(renderFeats());
  }

  /* 生成器 */
  function renderGenerator() {
    var card = el('div', 'dnd-card');
    card.appendChild(el('h2', 'dnd-card-title', '魔法物品生成器'));
    var row = el('div', 'dnd-field-row');
    var sel = el('select', 'dnd-input enc-lv');
    [['all', '任意稀有度'], ['Common', '普通'], ['Uncommon', '非普通'], ['Rare', '稀有'],
     ['Very Rare', '极稀有'], ['Legendary', '传说'], ['Artifact', '神器'], ['Varies', '视物品而定']]
      .forEach(function (o) {
        var opt = el('option', null, o[1]);
        opt.value = o[0];
        if (o[0] === genRarity) opt.selected = true;
        sel.appendChild(opt);
      });
    sel.addEventListener('change', function () { genRarity = this.value; });
    row.appendChild(sel);
    var btn = el('button', 'dnd-btn dnd-btn-gold', '随机生成');
    btn.addEventListener('click', generate);
    row.appendChild(btn);
    card.appendChild(row);

    if (genResult) {
      var m = meta[genResult.index] || {};
      var res = el('div', 'mi-gen-result');
      res.appendChild(el('span', 'mi-gen-name', esc(G.magicItemName(genResult.index))));
      if (G.magicItemName(genResult.index) !== genResult.name) {
        res.appendChild(el('span', 'mi-gen-en', esc(genResult.name)));
      }
      res.appendChild(el('span', 'mi-gen-tag', rarityName(m.r || genResult.rarity)));
      if (m.t) res.appendChild(el('span', 'mi-gen-tag', typeName(m.t)));
      var view = el('button', 'dnd-btn dnd-btn-sm', '查看详情');
      view.addEventListener('click', function () { openDetail(genResult.index); });
      res.appendChild(view);
      card.appendChild(res);
    }
    if (genHistory.length) {
      var his = el('div', 'mi-history');
      genHistory.forEach(function (idx) {
        var chip = el('button', 'dnd-btn dnd-btn-sm', esc(G.magicItemName(idx)));
        chip.addEventListener('click', function () { openDetail(idx); });
        his.appendChild(chip);
      });
      card.appendChild(his);
    }
    return card;
  }

  function generate() {
    if (!list.length) return;
    var pool = list.filter(function (it) {
      return genRarity === 'all' || (meta[it.index] && meta[it.index].r === genRarity);
    });
    if (!pool.length) pool = list; /* 元数据未就绪时退化为全随机 */
    var pick = pool[Math.floor(Math.random() * pool.length)];
    genResult = { index: pick.index, name: pick.name };
    genHistory = [pick.index].concat(genHistory.filter(function (x) { return x !== pick.index; })).slice(0, 20);
    render();
    loadDetail(pick.index, true);
  }

  /* 物品库 */
  function renderLibrary() {
    var card = el('div', 'dnd-card');
    card.appendChild(el('h2', 'dnd-card-title', '魔法物品库 · ' + list.length + ' 件'));
    card.appendChild(renderToolbar());
    var wrap = el('div', 'lib-wrap');
    wrap.appendChild(renderList());
    wrap.appendChild(renderDetail());
    card.appendChild(wrap);
    return card;
  }

  function renderToolbar() {
    var bar = el('div', 'lib-toolbar');
    var rRow = el('div', 'lib-filters');
    [['Common', '普通'], ['Uncommon', '非普通'], ['Rare', '稀有'], ['Very Rare', '极稀有'],
     ['Legendary', '传说'], ['Artifact', '神器']].forEach(function (o) {
      var b = el('button', 'dnd-btn dnd-btn-sm' + (rarityFilter === o[0] ? ' active' : ''), o[1]);
      b.addEventListener('click', function () {
        rarityFilter = rarityFilter === o[0] ? null : o[0];
        render();
      });
      rRow.appendChild(b);
    });
    bar.appendChild(rRow);

    var tRow = el('div', 'lib-filters');
    var types = [];
    list.forEach(function (it) {
      var t = meta[it.index] && meta[it.index].t;
      if (t && types.indexOf(t) === -1) types.push(t);
    });
    types.forEach(function (t) {
      var b = el('button', 'dnd-btn dnd-btn-sm' + (typeFilter === t ? ' active' : ''), typeName(t));
      b.addEventListener('click', function () {
        typeFilter = typeFilter === t ? null : t;
        render();
      });
      tRow.appendChild(b);
    });
    if (types.length) bar.appendChild(tRow);

    var search = el('input');
    search.type = 'text';
    search.className = 'dnd-input lib-search';
    search.placeholder = '搜索物品名（中文或英文）…';
    search.value = keyword;
    search.addEventListener('input', function () { keyword = this.value; render(); });
    bar.appendChild(search);
    return bar;
  }

  function renderList() {
    var side = el('div', 'lib-list');
    var items = filtered();
    if (!items.length) {
      side.appendChild(el('p', 'dnd-hint', '无匹配物品'));
      return side;
    }
    var groups = {};
    items.forEach(function (it) {
      var k = rarityName((meta[it.index] || {}).r || 'Varies');
      (groups[k] = groups[k] || []).push(it);
    });
    Object.keys(groups).forEach(function (k) {
      side.appendChild(el('div', 'lib-group', k + ' · ' + groups[k].length + ' 件'));
      groups[k].forEach(function (it) {
        var cn = G.magicItemName(it.index);
        var item = el('button', 'lib-item' + (detailIndex === it.index ? ' active' : ''),
          esc(cn) + (cn !== it.name ? ' <i>' + esc(it.name) + '</i>' : ''));
        item.addEventListener('click', function () { openDetail(it.index); });
        side.appendChild(item);
      });
    });
    return side;
  }

  function renderDetail() {
    var box = el('div', 'lib-detail');
    var inner = el('div', 'lib-detail-body');
    inner.id = 'mi-detail';
    box.appendChild(inner);
    if (detailIndex === null) {
      inner.innerHTML = '<p class="dnd-hint">点击左侧物品或生成结果查看详情</p>';
    } else if (detailData && detailData.index === detailIndex) {
      renderDetailInto(inner, detailData);
    } else {
      inner.innerHTML = '<p class="dnd-hint">加载中…</p>';
      loadDetail(detailIndex);
    }
    return box;
  }

  function openDetail(index) {
    detailIndex = index;
    detailData = null;
    render();
  }

  function loadDetail(index, silent) {
    DnD.Data.getMagicItem(index).then(function (d) {
      detailData = d;
      if (meta[index]) {
        meta[index].r = (d.rarity && d.rarity.name) || meta[index].r;
        meta[index].t = (d.equipment_category && d.equipment_category.name) || meta[index].t;
      }
      if (silent) {
        /* 生成器场景：补全元数据后重渲染，让稀有度/类型标签显示出来 */
        if (genResult && genResult.index === index) render();
        return;
      }
      var box = document.getElementById('mi-detail');
      if (box) renderDetailInto(box, d);
    }).catch(function (err) {
      if (silent) return;
      var box = document.getElementById('mi-detail');
      if (box) box.innerHTML = '<p class="dice-error">加载失败：' + esc(err.message) + '</p>';
    });
  }

  function renderDetailInto(box, d) {
    box.innerHTML = '';
    var cn = G.magicItemName(d.index);
    var rarity = (d.rarity && d.rarity.name) || '';
    var type = (d.equipment_category && d.equipment_category.name) || '';
    var head = el('div', 'lib-detail-head');
    head.innerHTML = '<div class="lib-detail-name">' + esc(cn) + '</div>'
      + '<div class="lib-detail-sub">' + (cn !== d.name ? esc(d.name) + ' · ' : '')
      + (rarity ? esc(rarityName(rarity)) + ' · ' : '') + (type ? esc(typeName(type)) : '') + '</div>';
    box.appendChild(head);

    var descBox = el('div', 'lib-desc');
    (d.desc || []).forEach(function (p) { descBox.appendChild(el('p', 'lib-desc-p', esc(p))); });
    if (d.desc && d.desc.length) box.appendChild(descBox);
  }

  /* ---------- 专长速查 ---------- */
  function renderFeats() {
    var feats = DnD.FEATS || [];
    var card = el('div', 'dnd-card');
    card.appendChild(el('h2', 'dnd-card-title', '2024 专长速查 · ' + feats.length + ' 个（玩家手册 2024）'));
    var bar = el('div', 'lib-toolbar');
    var fRow = el('div', 'lib-filters');
    [['all', '全部'], ['起源', '起源'], ['通用', '通用'], ['战斗风格', '战斗风格'], ['传奇恩惠', '传奇恩惠']]
      .forEach(function (o) {
        var b = el('button', 'dnd-btn dnd-btn-sm' + (featCat === o[0] ? ' active' : ''), o[1]);
        b.addEventListener('click', function () { featCat = o[0]; render(); });
        fRow.appendChild(b);
      });
    bar.appendChild(fRow);
    var search = el('input');
    search.type = 'text';
    search.className = 'dnd-input lib-search';
    search.placeholder = '搜索专长（中文或英文）…';
    search.value = featKeyword;
    search.addEventListener('input', function () { featKeyword = this.value; render(); });
    bar.appendChild(search);
    card.appendChild(bar);

    var kw = featKeyword.trim().toLowerCase();
    var items = feats.filter(function (f) {
      if (featCat !== 'all' && f.cat !== featCat) return false;
      if (kw && f.cn.toLowerCase().indexOf(kw) === -1 && f.en.toLowerCase().indexOf(kw) === -1) return false;
      return true;
    });
    if (!items.length) {
      card.appendChild(el('p', 'dnd-hint', '无匹配专长'));
      return card;
    }
    var listBox = el('div', 'feat-list');
    items.forEach(function (f) {
      var open = featOpen === f.en;
      var item = el('div', 'feat-item' + (open ? ' open' : ''));
      var headBtn = el('button', 'feat-head');
      headBtn.innerHTML = '<span class="feat-cn">' + esc(f.cn) + '</span>'
        + '<span class="feat-en">' + esc(f.en) + '</span>'
        + '<span class="feat-cat">' + esc(f.cat) + '</span>'
        + '<span class="feat-arrow">' + (open ? '▾' : '▸') + '</span>';
      headBtn.addEventListener('click', function () { featOpen = open ? null : f.en; render(); });
      item.appendChild(headBtn);
      if (open) {
        var body = el('div', 'feat-body');
        if (f.desc && f.desc !== '你获得以下增益。') {
          body.appendChild(el('p', 'lib-desc-p', esc(f.desc)));
        }
        (f.gains || []).forEach(function (g) {
          body.appendChild(el('p', 'feat-gain', '· ' + esc(g)));
        });
        if (!(f.gains || []).length) body.appendChild(el('p', 'dnd-hint', '详见规则书原文'));
        item.appendChild(body);
      }
      listBox.appendChild(item);
    });
    card.appendChild(listBox);
    return card;
  }

  /* ---------- 初始化 ---------- */
  function init() {
    root = document.getElementById('magic-root');
    if (!root) return;
    root.innerHTML = '';
    render();
    if (!list.length) {
      DnD.Data.getMagicItems().then(function (items) {
        list = items;
        render();
      }).catch(function (err) {
        root.innerHTML = '<p class="dice-error">魔法物品列表加载失败：' + esc(err.message) + '（可稍后重试或检查网络）</p>';
      });
    }
  }

  DnD.MagicUI = { init: init };
})(window);
