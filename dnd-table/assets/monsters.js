/* =========================================================
 * 跑团桌 · 怪物图鉴模块 (monsters.js)
 * 怪物清单（搜索/译名）+ 怪物详细介绍（dnd5eapi）
 * 属性/AC/HP/速度/抗性/特性/动作；名称为中文译名，描述为 SRD 英文原文
 * ========================================================= */
(function (global) {
  'use strict';

  var DnD = global.DnD = global.DnD || {};
  var G = DnD.Glossary;

  var SIZE_CN = { Tiny: '微型', Small: '小型', Medium: '中型', Large: '大型', Huge: '巨型', Gargantuan: '超巨型' };
  var SPEED_CN = { walk: '步行', fly: '飞行', swim: '游泳', burrow: '掘地', climb: '攀爬', hover: '悬停' };
  var AC_TYPE_CN = { armor: '护甲', natural: '天生', dex: '敏捷', spell: '法术', 'condition': '条件' };

  var MonsterUI = {};
  var root;
  var list = [];
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

  /* CR 数字 → 文本（0.25 → 1/4） */
  function crText(cr) {
    if (cr === 0.125) return '1/8';
    if (cr === 0.25) return '1/4';
    if (cr === 0.5) return '1/2';
    return String(cr);
  }

  /* 阵营字符串 → 中文（'lawful evil' → 守序邪恶） */
  function alignText(str) {
    var s = String(str || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (s === 'unaligned') return '无阵营';
    return G.alignmentName(s);
  }

  function filtered() {
    var kw = keyword.trim().toLowerCase();
    return list.filter(function (m) {
      if (!kw) return true;
      return m.name.toLowerCase().indexOf(kw) !== -1
        || G.monsterName(m.index).toLowerCase().indexOf(kw) !== -1;
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
    var search = el('input');
    search.type = 'text';
    search.className = 'dnd-input lib-search';
    search.placeholder = '搜索怪物（中文或英文）…';
    search.value = keyword;
    search.addEventListener('input', function () { keyword = this.value; render(); });
    bar.appendChild(search);
    var count = el('span', 'lib-count');
    bar.appendChild(count);
    return bar;
  }

  /* 左侧列表 */
  function renderList() {
    var side = el('div', 'lib-list');
    var items = filtered();
    if (!items.length) {
      side.appendChild(el('p', 'dnd-hint', '无匹配怪物'));
      return side;
    }
    var countEl = root.querySelector('.lib-count');
    if (countEl) countEl.textContent = '共 ' + items.length + ' 个怪物';
    items.forEach(function (m) {
      var cn = G.monsterName(m.index);
      var item = el('button', 'lib-item' + (detailIndex === m.index ? ' active' : ''),
        esc(cn) + (cn !== m.name ? ' <i>' + esc(m.name) + '</i>' : ''));
      item.addEventListener('click', function () { openDetail(m.index); });
      side.appendChild(item);
    });
    return side;
  }

  /* 右侧详情 */
  function renderDetail() {
    var box = el('div', 'lib-detail');
    var inner = el('div', 'lib-detail-body');
    inner.id = 'monster-detail';
    box.appendChild(inner);
    if (detailIndex === null) {
      inner.innerHTML = '<p class="dnd-hint">点击左侧怪物查看详细介绍</p>';
    } else if (detailData && detailData.index === detailIndex) {
      try { renderDetailInto(inner, detailData); } catch (err) {
        inner.innerHTML = '<p class="dice-error">详情渲染失败：' + esc(err.message) + '</p>';
      }
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
    DnD.Data.getMonster(index).then(function (d) {
      detailData = d;
      var box = document.getElementById('monster-detail');
      if (box) {
        try { renderDetailInto(box, d); } catch (err) {
          box.innerHTML = '<p class="dice-error">详情渲染失败：' + esc(err.message) + '</p>';
        }
      }
    }).catch(function (err) {
      var box = document.getElementById('monster-detail');
      if (box) box.innerHTML = '<p class="dice-error">加载失败：' + esc(err.message) + '</p>';
    });
  }

  /* 属性值行（名称/数值/修正） */
  function renderAbils(box, d) {
    var grid = el('div', 'sheet-abil-grid mon-abil-grid');
    ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].forEach(function (key) {
      var val = d[key];
      if (val == null) return;
      var abil = el('div', 'sheet-abil');
      abil.innerHTML = '<div class="sheet-abil-name">' + G.abilities[key.slice(0, 3)] + '</div>'
        + '<div class="sheet-abil-mod">' + G.modStr(G.abilityMod(val)) + '</div>'
        + '<div class="sheet-abil-score">' + val + '</div>';
      grid.appendChild(abil);
    });
    box.appendChild(grid);
  }

  /* 伤害词条行（易伤/抗力/免疫） */
  function renderDmgLine(box, label, arr) {
    if (!arr || !arr.length) return;
    var names = arr.map(function (d) {
      var idx = (d && (d.index || d.name)) || d;
      return G.damageName(idx);
    });
    var row = el('div', 'mon-line');
    row.innerHTML = '<span class="mon-line-label">' + label + '</span><span>' + esc(names.join('、')) + '</span>';
    box.appendChild(row);
  }

  function renderFeats(box, title, arr) {
    if (!arr || !arr.length) return;
    var block = el('div', 'mon-block');
    block.appendChild(el('div', 'mon-block-title', title));
    arr.forEach(function (f) {
      var feat = el('div', 'mon-feat');
      feat.innerHTML = '<div class="mon-feat-name">' + esc(f.name) + '</div>'
        + '<div class="mon-feat-desc">' + esc(f.desc || '') + '</div>';
      block.appendChild(feat);
    });
    box.appendChild(block);
  }

  function renderDetailInto(box, d) {
    box.innerHTML = '';
    var cn = G.monsterName(d.index);
    var head = el('div', 'lib-detail-head');
    head.innerHTML = '<div class="lib-detail-name">' + esc(cn) + '</div>'
      + '<div class="lib-detail-sub">' + (cn !== d.name ? esc(d.name) + ' · ' : '')
      + esc((SIZE_CN[d.size] || d.size) + ' ' + G.typeName(d.type)) + '，' + esc(alignText(d.alignment)) + '</div>';
    box.appendChild(head);

    /* 核心数值 */
    var core = el('div', 'sheet-core mon-core');
    var acTxt = (d.armor_class || []).map(function (ac) {
      return ac.value + (ac.type && AC_TYPE_CN[ac.type] ? '（' + AC_TYPE_CN[ac.type] + '）' : '');
    }).join(' / ');
    var spdTxt = Object.keys(d.speed || {}).map(function (k) {
      return (SPEED_CN[k] || k) + ' ' + d.speed[k];
    }).join('，');
    core.innerHTML = ''
      + '<div class="sheet-stat-box"><span class="sheet-stat-label">护甲</span><span class="sheet-stat-val">' + esc(acTxt) + '</span></div>'
      + '<div class="sheet-stat-box"><span class="sheet-stat-label">生命值</span><span class="sheet-stat-val">' + (d.hit_points != null ? d.hit_points : '—') + '</span></div>'
      + '<div class="sheet-stat-box"><span class="sheet-stat-label">速度</span><span class="sheet-stat-val">' + esc(spdTxt) + '</span></div>'
      + '<div class="sheet-stat-box"><span class="sheet-stat-label">挑战等级</span><span class="sheet-stat-val">' + (d.challenge_rating != null ? crText(d.challenge_rating) : '—') + '</span></div>'
      + '<div class="sheet-stat-box"><span class="sheet-stat-label">经验值</span><span class="sheet-stat-val">' + (d.xp != null ? d.xp : '—') + '</span></div>';
    box.appendChild(core);

    renderAbils(box, d);

    /* 明细行 */
    var info = el('div', 'mon-info');
    var profs = (d.proficiencies || []).map(function (p) {
      var nm = p.proficiency ? p.proficiency.name : '';
      var parts = String(nm).split(':');
      if (parts.length === 2) {
        var label = parts[0].trim().toLowerCase();
        var val = parts[1].trim().toLowerCase();
        if (label === 'skill') return '技能 ' + G.skillName(val) + ' +' + (p.value || 0);
        if (label === 'saving throw') return '豁免 ' + (G.abilities[val] || val) + ' +' + (p.value || 0);
        return label + ' ' + val + ' +' + (p.value || 0);
      }
      return nm + (p.value ? ' +' + p.value : '');
    });
    function line(label, value) {
      if (!value) return;
      var row = el('div', 'mon-line');
      row.innerHTML = '<span class="mon-line-label">' + label + '</span><span>' + value + '</span>';
      info.appendChild(row);
    }
    line('技能', profs.join('，'));
    /* senses 可能为对象（{darkvision:'60 ft.'}）或字符串数组，兼容两者 */
    var sensesTxt = '';
    if (d.senses) {
      if (Array.isArray(d.senses)) sensesTxt = d.senses.map(esc).join('，');
      else sensesTxt = Object.keys(d.senses).map(function (k) {
        return k.replace(/_/g, ' ') + ' ' + d.senses[k];
      }).join('，');
    }
    line('感官', sensesTxt);
    line('语言', esc(d.languages));
    box.appendChild(info);

    renderDmgLine(box, '易伤', d.damage_vulnerabilities);
    renderDmgLine(box, '抗力', d.damage_resistances);
    renderDmgLine(box, '免疫', d.damage_immunities);
    var condImm = (d.condition_immunities || []).map(function (c) {
      return G.conditionName((c && (c.index || c.name)) || c);
    });
    if (condImm.length) {
      var row = el('div', 'mon-line');
      row.innerHTML = '<span class="mon-line-label">状态免疫</span><span>' + esc(condImm.join('、')) + '</span>';
      box.appendChild(row);
    }

    renderFeats(box, '特性', d.special_abilities);
    renderFeats(box, '动作', d.actions);
    renderFeats(box, '传奇动作', d.legendary_actions);

    /* 中文完整版外链（灰机 wiki 龙与地下城 TRPG，搜索页保证不落空） */
    var linkBox = el('div', 'lib-links');
    var a = document.createElement('a');
    a.className = 'dnd-btn dnd-btn-sm lib-link';
    a.href = 'https://dnd.huijiwiki.com/index.php?search=' + encodeURIComponent(cn);
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '查看中文完整版（灰机 wiki）';
    linkBox.appendChild(a);
    box.appendChild(linkBox);
  }

  /* ---------- 初始化 ---------- */
  function init() {
    root = document.getElementById('monsters-root');
    if (!root) return;
    root.innerHTML = '';
    render();
    if (!list.length) {
      DnD.Data.getMonsters().then(function (items) {
        list = items.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
        render();
      }).catch(function (err) {
        root.innerHTML = '<p class="dice-error">怪物列表加载失败：' + esc(err.message) + '（可稍后重试或检查网络）</p>';
      });
    }
  }

  DnD.MonsterUI = { init: init };
})(window);
