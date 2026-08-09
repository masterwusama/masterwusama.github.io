/* =========================================================
 * 跑团桌 · 魔法书模块 (spells.js)
 * 法术清单（0-9 环分组 / 搜索）+ 法术详细介绍（dnd5eapi）
 * 法术名与描述为 SRD 英文原文；字段名与学派为中文
 * ========================================================= */
(function (global) {
  'use strict';

  var DnD = global.DnD = global.DnD || {};
  var G = DnD.Glossary;

  var COMP_CN = { V: '言语', S: '姿势', M: '材料' };
  var LEVEL_CN = ['戏法', '1 环', '2 环', '3 环', '4 环', '5 环', '6 环', '7 环', '8 环', '9 环'];

  var SpellUI = {};
  var root;
  var list = [];
  var levelFilter = null; /* null=全部, 0-9 */
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
  function levelText(lv) {
    return LEVEL_CN[lv] || (lv + ' 环');
  }
  function filtered() {
    var kw = keyword.trim().toLowerCase();
    return list.filter(function (s) {
      if (levelFilter !== null && s.level !== levelFilter) return false;
      if (kw && s.name.toLowerCase().indexOf(kw) === -1) return false;
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
    var lvRow = el('div', 'lib-filters');
    var opts = [[null, '全部']];
    for (var lv = 0; lv <= 9; lv++) opts.push([lv, levelText(lv)]);
    opts.forEach(function (o) {
      var b = el('button', 'dnd-btn dnd-btn-sm' + (levelFilter === o[0] ? ' active' : ''), o[1]);
      b.addEventListener('click', function () { levelFilter = o[0]; render(); });
      lvRow.appendChild(b);
    });
    bar.appendChild(lvRow);

    var search = el('input');
    search.type = 'text';
    search.className = 'dnd-input lib-search';
    search.placeholder = '搜索法术名（英文）…';
    search.value = keyword;
    search.addEventListener('input', function () { keyword = this.value; render(); });
    bar.appendChild(search);
    return bar;
  }

  /* 左侧列表：按环分组 */
  function renderList() {
    var side = el('div', 'lib-list');
    var items = filtered();
    if (!items.length) {
      side.appendChild(el('p', 'dnd-hint', '无匹配法术'));
      return side;
    }
    var groups = {};
    items.forEach(function (s) { (groups[s.level] = groups[s.level] || []).push(s); });
    Object.keys(groups).sort(function (a, b) { return a - b; }).forEach(function (lv) {
      side.appendChild(el('div', 'lib-group', levelText(Number(lv)) + ' · ' + groups[lv].length + ' 个'));
      groups[lv].forEach(function (s) {
        var item = el('button', 'lib-item' + (detailIndex === s.index ? ' active' : ''), esc(s.name));
        item.addEventListener('click', function () { openDetail(s.index); });
        side.appendChild(item);
      });
    });
    return side;
  }

  /* 右侧详情 */
  function renderDetail() {
    var box = el('div', 'lib-detail');
    var inner = el('div', 'lib-detail-body');
    inner.id = 'spell-detail';
    box.appendChild(inner);
    if (detailIndex === null) {
      inner.innerHTML = '<p class="dnd-hint">点击左侧法术查看详细介绍</p>';
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
    DnD.Data.getSpell(index).then(function (d) {
      detailData = d;
      var box = document.getElementById('spell-detail');
      if (box) renderDetailInto(box, d);
    }).catch(function (err) {
      var box = document.getElementById('spell-detail');
      if (box) box.innerHTML = '<p class="dice-error">加载失败：' + esc(err.message) + '</p>';
    });
  }

  function damageAt(d) {
    var dmg = d.damage;
    if (!dmg) return '';
    if (dmg.damage_at_slot_level) {
      var k = Object.keys(dmg.damage_at_slot_level)[0];
      return k ? dmg.damage_at_slot_level[k] : '';
    }
    if (dmg.damage_at_character_level) {
      var k2 = Object.keys(dmg.damage_at_character_level)[0];
      return k2 ? dmg.damage_at_character_level[k2] : '';
    }
    return '';
  }

  function renderDetailInto(box, d) {
    box.innerHTML = '';
    var school = d.school && G.schoolName(d.school.index);
    var head = el('div', 'lib-detail-head');
    head.innerHTML = '<div class="lib-detail-name">' + esc(d.name) + '</div>'
      + '<div class="lib-detail-sub">' + levelText(d.level) + (school ? ' · ' + school + '学派' : '') + '</div>';
    box.appendChild(head);

    /* 信息网格 */
    var grid = el('div', 'lib-info-grid');
    function row(label, value) {
      if (!value) return;
      var r = el('div', 'lib-info-row');
      r.innerHTML = '<span class="lib-info-label">' + label + '</span><span class="lib-info-val">' + value + '</span>';
      grid.appendChild(r);
    }
    row('施法时间', esc(d.casting_time));
    row('射程', esc(d.range));
    row('成分', (d.components || []).map(function (c) { return COMP_CN[c] || c; }).join('、')
      + (d.material ? '（' + esc(d.material) + '）' : ''));
    row('持续时间', esc(d.duration) + (d.concentration ? ' · 需专注' : ''));
    if (d.ritual) row('仪式', '是');
    if (d.attack_type) row('攻击', d.attack_type === 'ranged' ? '远程法术攻击' : '近战法术攻击');
    if (d.damage && d.damage.damage_type) {
      var dmgTxt = G.damageName(d.damage.damage_type.name);
      var at = damageAt(d);
      row('伤害', dmgTxt + (at ? '（' + esc(at) + '）' : ''));
    }
    if (d.dc) {
      var dcName = d.dc.dc_type ? (G.abilityFull[d.dc.dc_type.index] || d.dc.dc_type.name) : '';
      var succ = d.dc.dc_success && d.dc.dc_success !== 'none' ? '，成功' + esc(d.dc.dc_success) : '';
      row('豁免', esc(dcName + ' 豁免' + succ));
    }
    box.appendChild(grid);

    /* 描述（SRD 英文原文） */
    var descBox = el('div', 'lib-desc');
    (d.desc || []).forEach(function (p) { descBox.appendChild(el('p', 'lib-desc-p', esc(p))); });
    if (d.higher_level && d.higher_level.length) {
      var hl = el('div', 'lib-higher');
      hl.appendChild(el('div', 'lib-higher-title', '更高环级施放'));
      d.higher_level.forEach(function (p) { hl.appendChild(el('p', 'lib-desc-p', esc(p))); });
      descBox.appendChild(hl);
    }
    box.appendChild(descBox);

    if (d.classes && d.classes.length) {
      box.appendChild(el('div', 'lib-classes',
        '可用职业：' + d.classes.map(function (c) { return G.className(c.index); }).join('、')));
    }
  }

  /* ---------- 初始化 ---------- */
  function init() {
    root = document.getElementById('spells-root');
    if (!root) return;
    root.innerHTML = '';
    render();
    if (!list.length) {
      DnD.Data.getSpells().then(function (items) {
        list = items;
        render();
      }).catch(function (err) {
        root.innerHTML = '<p class="dice-error">法术列表加载失败：' + esc(err.message) + '（可稍后重试或检查网络）</p>';
      });
    }
  }

  DnD.SpellUI = { init: init };
})(window);
