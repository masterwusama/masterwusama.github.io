/* =========================================================
 * 跑团桌 · 装备库模块 (equipment.js)
 * 武器/护甲/冒险装备/工具/坐骑载具：分类筛选 + 中英文搜索 + 详情
 * 装备名为中文译名；详情为 SRD 英文原文；字段名与分类为中文
 * ========================================================= */
(function (global) {
  'use strict';

  var DnD = global.DnD = global.DnD || {};
  var G = DnD.Glossary;

  var CAT_CN = {
    weapon: '武器', armor: '护甲', 'adventuring-gear': '冒险装备',
    tools: '工具', 'mounts-and-vehicles': '坐骑与载具', other: '其他'
  };
  var UNIT_CN = { gp: '金币', sp: '银币', cp: '铜币', pp: '铂金币' };
  var PROP_CN = {
    ammunition: '弹药', finesse: '灵巧', heavy: '重型', light: '轻型', loading: '装填',
    monk: '武僧', range: '射程', reach: '触及', special: '特殊', thrown: '投掷',
    'two-handed': '双手', versatile: '多用'
  };
  var RANGE_CN = { Simple: '简易', Martial: '军用', 'Simple Melee': '简易近战',
    'Simple Ranged': '简易远程', 'Martial Melee': '军用近战', 'Martial Ranged': '军用远程' };
  var SPEED_CN = { feet: '尺', miles: '英里' };

  var EquipmentUI = {};
  var root;
  var list = [];
  var meta = DnD.EquipMeta || {};   /* index -> {c: 大类, cr: 武器类别, ac: 护甲类别} */
  var catFilter = null;   /* null=全部, 或 equipment_category.index */
  var keyword = '';
  var detailIndex = null;
  var detailData = null;

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
  function catName(index) {
    return CAT_CN[index] || index;
  }
  /* 列表项本身不含分类字段，分类信息来自元数据表 */
  function catOf(item) {
    var m = meta[item.index];
    return m ? (m.c || 'other') : 'other';
  }
  function costText(cost) {
    if (!cost) return '';
    return cost.quantity + ' ' + (UNIT_CN[cost.unit] || cost.unit);
  }

  function filtered() {
    var kw = keyword.trim().toLowerCase();
    return list.filter(function (e) {
      if (catFilter && catOf(e) !== catFilter) return false;
      if (kw) {
        var cn = G.equipmentName(e.index);
        if (e.name.toLowerCase().indexOf(kw) === -1 && cn.toLowerCase().indexOf(kw) === -1) return false;
      }
      return true;
    });
  }

  /* ---------- 渲染 ---------- */
  function render() {
    if (!root) return;
    root.innerHTML = '';
    root.appendChild(renderToolbar());
    var wrap = el('div', 'lib-wrap');
    wrap.appendChild(renderList());
    wrap.appendChild(renderDetail());
    root.appendChild(wrap);
  }

  function renderToolbar() {
    var bar = el('div', 'lib-toolbar');
    var fRow = el('div', 'lib-filters');
    var cats = [[null, '全部']];
    list.forEach(function (e) {
      var c = catOf(e);
      if (!cats.some(function (x) { return x[0] === c; })) cats.push([c, catName(c)]);
    });
    cats.forEach(function (c) {
      var b = el('button', 'dnd-btn dnd-btn-sm' + (catFilter === c[0] ? ' active' : ''), c[1]);
      b.addEventListener('click', function () { catFilter = c[0]; render(); });
      fRow.appendChild(b);
    });
    bar.appendChild(fRow);
    bar.appendChild(el('span', 'lib-count', list.length + ' 件装备'));

    var search = el('input');
    search.type = 'text';
    search.className = 'dnd-input lib-search';
    search.placeholder = '搜索装备名（中文或英文）…';
    search.value = keyword;
    search.addEventListener('input', function () { keyword = this.value; render(); });
    bar.appendChild(search);
    return bar;
  }

  /* 左侧列表：按大类分组 */
  function renderList() {
    var side = el('div', 'lib-list');
    var items = filtered();
    if (!items.length) {
      side.appendChild(el('p', 'dnd-hint', '无匹配装备'));
      return side;
    }
    var groups = {};
    items.forEach(function (e) {
      var k = catName(catOf(e));
      (groups[k] = groups[k] || []).push(e);
    });
    Object.keys(groups).forEach(function (k) {
      side.appendChild(el('div', 'lib-group', k + ' · ' + groups[k].length + ' 件'));
      groups[k].forEach(function (e) {
        var cn = G.equipmentName(e.index);
        var item = el('button', 'lib-item' + (detailIndex === e.index ? ' active' : ''),
          esc(cn) + (cn !== e.name ? ' <i>' + esc(e.name) + '</i>' : ''));
        item.addEventListener('click', function () { openDetail(e.index); });
        side.appendChild(item);
      });
    });
    return side;
  }

  /* 右侧详情 */
  function renderDetail() {
    var box = el('div', 'lib-detail');
    var inner = el('div', 'lib-detail-body');
    inner.id = 'equip-detail';
    box.appendChild(inner);
    if (detailIndex === null) {
      inner.innerHTML = '<p class="dnd-hint">点击左侧装备查看详细数据</p>';
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

  function loadDetail(index) {
    DnD.Data.getEquipmentItem(index).then(function (d) {
      detailData = d;
      var box = document.getElementById('equip-detail');
      if (box) renderDetailInto(box, d);
    }).catch(function (err) {
      var box = document.getElementById('equip-detail');
      if (box) box.innerHTML = '<p class="dice-error">加载失败：' + esc(err.message) + '</p>';
    });
  }

  function renderDetailInto(box, d) {
    box.innerHTML = '';
    var cn = G.equipmentName(d.index);
    var head = el('div', 'lib-detail-head');
    var sub = [];
    sub.push(catName((meta[d.index] || {}).c || 'other'));
    if (d.category_range) sub.push(RANGE_CN[d.category_range] || d.category_range);
    else if (d.armor_category) sub.push(G.armorName(d.armor_category.toLowerCase()));
    else if (d.vehicle_category) sub.push(d.vehicle_category);
    head.innerHTML = '<div class="lib-detail-name">' + esc(cn) + '</div>'
      + '<div class="lib-detail-sub">' + (cn !== d.name ? esc(d.name) + ' · ' : '')
      + sub.join(' · ') + '</div>';
    box.appendChild(head);

    var grid = el('div', 'lib-info-grid');
    function row(label, value) {
      if (value == null || value === '') return;
      var r = el('div', 'lib-info-row');
      r.innerHTML = '<span class="lib-info-label">' + label + '</span><span class="lib-info-val">' + value + '</span>';
      grid.appendChild(r);
    }
    row('价格', esc(costText(d.cost)));
    row('重量', d.weight != null ? esc(String(d.weight) + ' 磅') : '');
    if (d.damage) {
      row('伤害', esc(d.damage.damage_dice) + ' ' + esc(G.damageName(d.damage.damage_type.name)));
    }
    if (d.range && d.range.normal) {
      row('射程', esc(d.range.normal + ' 尺') + (d.range.long ? ' / ' + esc(d.range.long + ' 尺') : ''));
    }
    if (d.properties && d.properties.length) {
      row('武器属性', d.properties.map(function (p) { return PROP_CN[p.index] || p.name; }).join('、'));
    }
    if (d.armor_category) {
      row('护甲类别', esc(G.armorName(d.armor_category.toLowerCase())));
      var ac = d.armor_class;
      var acTxt = String(ac.base);
      if (ac.dex_bonus) acTxt += (ac.max_bonus ? ' + 敏捷加值（上限 +' + ac.max_bonus + '）' : ' + 敏捷加值');
      row('护甲等级', esc(acTxt));
      if (d.str_minimum) row('力量需求', esc(String(d.str_minimum)));
      row('潜行', d.stealth_disadvantage ? '劣势' : '正常');
    }
    if (d.speed) {
      row('速度', esc(String(d.speed.quantity) + ' ' + (SPEED_CN[d.speed.unit] || d.speed.unit)));
    }
    if (d.capacity) row('载具容量', esc(d.capacity));
    if (d.weapon_category && !d.damage) row('武器类别', esc(RANGE_CN[d.weapon_category] || d.weapon_category));
    box.appendChild(grid);

    if (d.special && d.special.length) {
      var sp = el('div', 'lib-desc');
      sp.appendChild(el('div', 'lib-higher-title', '特殊'));
      d.special.forEach(function (p) { sp.appendChild(el('p', 'lib-desc-p', esc(p))); });
      box.appendChild(sp);
    }
    if (d.desc && d.desc.length) {
      var descBox = el('div', 'lib-desc');
      d.desc.forEach(function (p) { descBox.appendChild(el('p', 'lib-desc-p', esc(p))); });
      box.appendChild(descBox);
    }
  }

  /* ---------- 初始化 ---------- */
  function init() {
    root = document.getElementById('equipment-root');
    if (!root) return;
    root.innerHTML = '';
    render();
    if (!list.length) {
      DnD.Data.getEquipment().then(function (items) {
        list = items;
        render();
      }).catch(function (err) {
        root.innerHTML = '<p class="dice-error">装备列表加载失败：' + esc(err.message) + '（可稍后重试或检查网络）</p>';
      });
    }
  }

  DnD.EquipmentUI = { init: init };
})(window);
