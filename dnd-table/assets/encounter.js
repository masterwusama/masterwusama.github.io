/* =========================================================
 * 跑团桌 · 遭遇难度计算器模块 (encounter.js)
 * DMG XP 阈值判定：队伍等级 → 4 档阈值；怪物 CR/数量 → 调整后 XP → 难度
 * 规则来源: Basic Rules (2014) Chapter 13 Building Combat Encounters
 * ========================================================= */
(function (global) {
  'use strict';

  var DnD = global.DnD = global.DnD || {};

  var EncounterUI = {};
  var root;

  /* 每级 4 档阈值（索引 1-20） */
  var THRESH = [
    null,
    { easy: 25, medium: 50, hard: 75, deadly: 100 },
    { easy: 50, medium: 100, hard: 150, deadly: 200 },
    { easy: 75, medium: 150, hard: 225, deadly: 400 },
    { easy: 125, medium: 250, hard: 375, deadly: 500 },
    { easy: 250, medium: 500, hard: 750, deadly: 1100 },
    { easy: 300, medium: 600, hard: 900, deadly: 1400 },
    { easy: 350, medium: 750, hard: 1100, deadly: 1700 },
    { easy: 450, medium: 900, hard: 1400, deadly: 2100 },
    { easy: 550, medium: 1100, hard: 1600, deadly: 2400 },
    { easy: 600, medium: 1200, hard: 1900, deadly: 2800 },
    { easy: 800, medium: 1600, hard: 2400, deadly: 3600 },
    { easy: 1000, medium: 2000, hard: 3000, deadly: 4500 },
    { easy: 1100, medium: 2200, hard: 3400, deadly: 5100 },
    { easy: 1250, medium: 2500, hard: 3800, deadly: 5700 },
    { easy: 1400, medium: 2800, hard: 4300, deadly: 6400 },
    { easy: 1600, medium: 3200, hard: 4800, deadly: 7200 },
    { easy: 2000, medium: 3900, hard: 5900, deadly: 8800 },
    { easy: 2100, medium: 4200, hard: 6300, deadly: 9500 },
    { easy: 2400, medium: 4900, hard: 7300, deadly: 10900 },
    { easy: 2800, medium: 5700, hard: 8500, deadly: 12700 }
  ];
  /* 冒险日 XP（每人每级，索引 1-20） */
  var DAY_XP = [0, 300, 600, 1200, 1700, 3500, 4000, 5000, 6000, 7500, 9000,
    10500, 11500, 13500, 15000, 18000, 20000, 25000, 27000, 30000, 40000];
  /* CR 列表与 XP 值 */
  var CR_LIST = ['0', '1/8', '1/4', '1/2', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23',
    '24', '25', '26', '27', '28', '29', '30'];
  var CR_XP = {
    '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, '1': 200, '2': 450, '3': 700,
    '4': 1100, '5': 1800, '6': 2300, '7': 2900, '8': 3900, '9': 5000, '10': 5900,
    '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000, '16': 15000,
    '17': 18000, '18': 20000, '19': 22000, '20': 25000, '21': 33000, '22': 41000,
    '23': 50000, '24': 62000, '25': 75000, '26': 90000, '27': 105000, '28': 120000,
    '29': 135000, '30': 155000
  };
  var DIFF_CN = ['平凡', '简单', '中等', '困难', '致命'];

  /* 状态：成员等级列表 + 怪物 (CR, 数量) 列表 */
  var members = [5, 5, 5, 5];
  var monsters = [{ cr: '1/4', qty: 4 }];

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
  function fmt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* 怪物数量 → 基础倍数；再按队伍规模偏移（<3 人上一档，≥6 人下一档） */
  function multiplier(count, partySize) {
    var T = [1, 1.5, 2, 2.5, 3, 4, 5];
    var idx;
    if (count >= 15) idx = 5;
    else if (count >= 11) idx = 4;
    else if (count >= 7) idx = 3;
    else if (count >= 3) idx = 2;
    else if (count === 2) idx = 1;
    else idx = 0;
    if (partySize >= 6) idx = Math.max(0, idx - 1);
    else if (partySize < 3) idx = Math.min(6, idx + 1);
    if (idx === 0 && count === 1 && partySize >= 6) return 0.5; /* 官方: 6+ 人单怪 ×0.5 */
    return T[idx];
  }

  function calc() {
    var th = { easy: 0, medium: 0, hard: 0, deadly: 0 };
    members.forEach(function (lv) {
      var t = THRESH[lv] || THRESH[1];
      th.easy += t.easy; th.medium += t.medium; th.hard += t.hard; th.deadly += t.deadly;
    });
    var total = 0, count = 0;
    monsters.forEach(function (m) {
      total += (CR_XP[m.cr] || 0) * m.qty;
      count += m.qty;
    });
    var mult = multiplier(count, members.length);
    var adj = Math.round(total * mult);
    var diff = 0;
    if (adj >= th.deadly) diff = 4;
    else if (adj >= th.hard) diff = 3;
    else if (adj >= th.medium) diff = 2;
    else if (adj >= th.easy) diff = 1;
    var day = members.reduce(function (s, lv) { return s + DAY_XP[lv]; }, 0);
    return { th: th, total: total, count: count, mult: mult, adj: adj, diff: diff, day: day };
  }

  /* ---------- 渲染 ---------- */
  function render() {
    if (!root) return;
    root.innerHTML = '';
    var grid = el('div', 'enc-grid');
    grid.appendChild(renderParty());
    grid.appendChild(renderMonsterCard());
    root.appendChild(grid);
    root.appendChild(renderRules());
  }

  /* 队伍配置卡 */
  function renderParty() {
    var card = el('div', 'dnd-card');
    card.appendChild(el('h2', 'dnd-card-title', '队伍配置'));
    var list = el('div', 'enc-rows');
    members.forEach(function (lv, i) {
      var row = el('div', 'enc-row');
      row.appendChild(el('span', 'enc-row-label', '成员 ' + (i + 1)));
      var sel = el('select', 'dnd-input enc-lv');
      for (var n = 1; n <= 20; n++) {
        var opt = el('option', null, n + ' 级');
        opt.value = n;
        if (n === lv) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', function () { members[i] = Number(this.value); render(); });
      row.appendChild(sel);
      if (members.length > 1) {
        var rm = el('button', 'dnd-btn dnd-btn-sm enc-rm', '移除');
        rm.addEventListener('click', function () { members.splice(i, 1); render(); });
        row.appendChild(rm);
      }
      list.appendChild(row);
    });
    card.appendChild(list);
    var add = el('button', 'dnd-btn dnd-btn-sm', '+ 添加成员');
    add.addEventListener('click', function () {
      if (members.length < 12) { members.push(5); render(); }
    });
    card.appendChild(add);

    var r = calc();
    var thBox = el('div', 'enc-thresholds');
    [['简单', r.th.easy, 'enc-easy'], ['中等', r.th.medium, 'enc-medium'],
     ['困难', r.th.hard, 'enc-hard'], ['致命', r.th.deadly, 'enc-deadly']].forEach(function (t) {
      var item = el('div', 'enc-th');
      item.innerHTML = '<span class="' + t[2] + '">' + t[0] + '</span> ' + esc(fmt(t[1])) + ' XP';
      thBox.appendChild(item);
    });
    card.appendChild(thBox);
    card.appendChild(el('p', 'dnd-hint enc-day',
      '冒险日预算（全部调整后 XP）约 ' + fmt(r.day) + ' XP'));
    return card;
  }

  /* 怪物卡 */
  function renderMonsterCard() {
    var card = el('div', 'dnd-card');
    card.appendChild(el('h2', 'dnd-card-title', '遭遇怪物'));
    var list = el('div', 'enc-rows');
    monsters.forEach(function (m, i) {
      var row = el('div', 'enc-row');
      var sel = el('select', 'dnd-input enc-cr');
      CR_LIST.forEach(function (cr) {
        var opt = el('option', null, 'CR ' + cr + '（' + fmt(CR_XP[cr]) + ' XP）');
        opt.value = cr;
        if (cr === m.cr) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function () { monsters[i].cr = this.value; render(); });
      row.appendChild(sel);
      var qty = el('input');
      qty.type = 'number';
      qty.min = 1;
      qty.max = 99;
      qty.value = m.qty;
      qty.className = 'dnd-input enc-qty';
      qty.addEventListener('change', function () {
        monsters[i].qty = Math.max(1, Math.min(99, Number(this.value) || 1));
        render();
      });
      row.appendChild(qty);
      var rm = el('button', 'dnd-btn dnd-btn-sm enc-rm', '移除');
      rm.addEventListener('click', function () { monsters.splice(i, 1); render(); });
      row.appendChild(rm);
      list.appendChild(row);
    });
    card.appendChild(list);
    var add = el('button', 'dnd-btn dnd-btn-sm', '+ 添加怪物');
    add.addEventListener('click', function () { monsters.push({ cr: '1', qty: 1 }); render(); });
    card.appendChild(add);

    var r = calc();
    var box = el('div', 'enc-result');
    box.appendChild(el('div', 'enc-math',
      '基础 XP ' + esc(fmt(r.total)) + ' × ' + r.mult + '（' + r.count + ' 个敌人）= '
      + esc(fmt(r.adj)) + ' 调整后 XP'));
    var badge = el('div', 'enc-diff enc-diff-' + r.diff, '遭遇难度：' + DIFF_CN[r.diff]);
    box.appendChild(badge);
    /* 难度进度条：按 4 档阈值位置 */
    var bar = el('div', 'enc-bar');
    var pct = Math.min(100, Math.round(r.adj / (r.th.deadly * 1.25) * 100));
    var fill = el('div', 'enc-bar-fill enc-bar-' + r.diff);
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    box.appendChild(bar);
    var marks = el('div', 'enc-marks');
    [['简单', r.th.easy], ['中等', r.th.medium], ['困难', r.th.hard], ['致命', r.th.deadly]].forEach(function (t) {
      marks.appendChild(el('span', null, t[0] + ' ' + esc(fmt(t[1]))));
    });
    box.appendChild(marks);
    card.appendChild(box);
    return card;
  }

  /* 规则说明 */
  function renderRules() {
    var box = el('div', 'dnd-card');
    box.appendChild(el('h2', 'dnd-card-title', '判定规则（Basic Rules 2014 · 第 13 章）'));
    var ul = el('ul', 'enc-rules');
    ['XP 阈值：将队伍中每名成员的 4 档阈值相加，得到队伍阈值。',
      '调整后 XP：怪物基础 XP 合计 × 敌人数量倍数（1 个 ×1、2 个 ×1.5、3-6 ×2、7-10 ×2.5、11-14 ×3、15+ ×4）。',
      '队伍规模：少于 3 人时使用下一档最高倍数（单怪 ×1.5、15+ 怪 ×5）；6 人及以上使用下一档最低倍数（单怪 ×0.5）。',
      '难度判定：调整后 XP 达到哪一档阈值即为该难度（低于简单档为「平凡」）。',
      '冒险日：一天通常可承受 6-8 场中等/困难遭遇，总调整后 XP 约为冒险日预算。'
    ].forEach(function (t) { ul.appendChild(el('li', null, t)); });
    box.appendChild(ul);
    return box;
  }

  /* ---------- 初始化 ---------- */
  function init() {
    root = document.getElementById('encounter-root');
    if (!root) return;
    root.innerHTML = '';
    render();
  }

  DnD.EncounterUI = { init: init };
})(window);
