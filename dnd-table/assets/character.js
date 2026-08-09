/* =========================================================
 * 跑团桌 · 角色卡模块 (character.js)
 * 建卡向导：基本信息 → 种族 → 属性 → 职业 → 装备
 * 内置 SRD 静态数据（离线可用），API 详情作为补充
 * ========================================================= */
(function (global) {
  'use strict';

  var DnD = global.DnD = global.DnD || {};
  var G = DnD.Glossary;

  var ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  var SLOTS_KEY = 'dnd_characters';
  var MAX_SLOTS = 4;

  /* 9 宫格阵营（行：守序/中立/混乱，列：善良/中立/邪恶） */
  var ALIGN_GRID = [
    'lawful-good', 'neutral-good', 'chaotic-good',
    'lawful-neutral', 'true-neutral', 'chaotic-neutral',
    'lawful-evil', 'neutral-evil', 'chaotic-evil'
  ];

  /* 熟练加值表（等级 1-20） */
  var PROF_BONUS = [0, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6];

  /* 标准购点成本表 */
  var POINT_BUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
  var POINT_BUY_MAX = 27;

  /* ---------- 内置 SRD 种族数据（API 不可用时的降级 + 快速应用） ---------- */
  var STATIC_RACES = [
    { index: 'dwarf', name: 'Dwarf', cn: '矮人', size: 'Medium', speed: 25, bonuses: [{ stat: 'con', val: 2 }] },
    { index: 'elf', name: 'Elf', cn: '精灵', size: 'Medium', speed: 30, bonuses: [{ stat: 'dex', val: 2 }] },
    { index: 'halfling', name: 'Halfling', cn: '半身人', size: 'Small', speed: 25, bonuses: [{ stat: 'dex', val: 2 }] },
    { index: 'human', name: 'Human', cn: '人类', size: 'Medium', speed: 30, bonuses: [
      { stat: 'str', val: 1 }, { stat: 'dex', val: 1 }, { stat: 'con', val: 1 },
      { stat: 'int', val: 1 }, { stat: 'wis', val: 1 }, { stat: 'cha', val: 1 }
    ]},
    { index: 'dragonborn', name: 'Dragonborn', cn: '龙裔', size: 'Medium', speed: 30, bonuses: [
      { stat: 'str', val: 2 }, { stat: 'cha', val: 1 }
    ]},
    { index: 'gnome', name: 'Gnome', cn: '侏儒', size: 'Small', speed: 25, bonuses: [{ stat: 'int', val: 2 }] },
    { index: 'half-elf', name: 'Half-Elf', cn: '半精灵', size: 'Medium', speed: 30, bonuses: [
      { stat: 'cha', val: 2 }, { choose: 2, val: 1 }
    ]},
    { index: 'half-orc', name: 'Half-Orc', cn: '半兽人', size: 'Medium', speed: 30, bonuses: [
      { stat: 'str', val: 2 }, { stat: 'con', val: 1 }
    ]},
    { index: 'tiefling', name: 'Tiefling', cn: '提夫林', size: 'Medium', speed: 30, bonuses: [
      { stat: 'cha', val: 2 }, { stat: 'int', val: 1 }
    ]}
  ];

  /* ---------- 内置 SRD 职业数据 ---------- */
  var STATIC_CLASSES = [
    { index: 'barbarian', name: 'Barbarian', cn: '野蛮人', hitDie: 12, skillChoices: 2 },
    { index: 'bard', name: 'Bard', cn: '吟游诗人', hitDie: 8, skillChoices: 3 },
    { index: 'cleric', name: 'Cleric', cn: '牧师', hitDie: 8, skillChoices: 2 },
    { index: 'druid', name: 'Druid', cn: '德鲁伊', hitDie: 8, skillChoices: 2 },
    { index: 'fighter', name: 'Fighter', cn: '战士', hitDie: 10, skillChoices: 2 },
    { index: 'monk', name: 'Monk', cn: '武僧', hitDie: 8, skillChoices: 2 },
    { index: 'paladin', name: 'Paladin', cn: '圣武士', hitDie: 10, skillChoices: 2 },
    { index: 'ranger', name: 'Ranger', cn: '游侠', hitDie: 10, skillChoices: 3 },
    { index: 'rogue', name: 'Rogue', cn: '游荡者', hitDie: 8, skillChoices: 4 },
    { index: 'sorcerer', name: 'Sorcerer', cn: '术士', hitDie: 6, skillChoices: 2 },
    { index: 'warlock', name: 'Warlock', cn: '邪术师', hitDie: 8, skillChoices: 2 },
    { index: 'wizard', name: 'Wizard', cn: '法师', hitDie: 6, skillChoices: 2 }
  ];

  /* 技能列表（与 glossary 对应） */
  var SKILL_LIST = [
    { index: 'acrobatics', name: '杂技', abil: 'dex' }, { index: 'animal-handling', name: '驯兽', abil: 'wis' },
    { index: 'arcana', name: '奥秘', abil: 'int' }, { index: 'athletics', name: '运动', abil: 'str' },
    { index: 'deception', name: '欺瞒', abil: 'cha' }, { index: 'history', name: '历史', abil: 'int' },
    { index: 'insight', name: '洞悉', abil: 'wis' }, { index: 'intimidation', name: '威吓', abil: 'cha' },
    { index: 'investigation', name: '调查', abil: 'int' }, { index: 'medicine', name: '医药', abil: 'wis' },
    { index: 'nature', name: '自然', abil: 'int' }, { index: 'perception', name: '察觉', abil: 'wis' },
    { index: 'performance', name: '表演', abil: 'cha' }, { index: 'persuasion', name: '说服', abil: 'cha' },
    { index: 'religion', name: '宗教', abil: 'int' }, { index: 'sleight-of-hand', name: '巧手', abil: 'dex' },
    { index: 'stealth', name: '隐匿', abil: 'dex' }, { index: 'survival', name: '求生', abil: 'wis' }
  ];

  /* ---------- 角色模型 ---------- */
  function newCharacter() {
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: '', player: '', level: 1, alignment: '',
      scores: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
      bonusMap: {}, /* 种族加成固化 {con:2} */
      raceIndex: '', raceName: '',
      classIndex: '', className: '', hitDie: 8,
      skills: [], /* 熟练技能 index */
      speed: 30, size: 'Medium',
      weapons: [], /* {name, dice, ability, bonus} */
      armorName: '', baseAc: 10, dexCap: null, shield: false,
      equipment: [], gold: 0, xp: 0, notes: '', traits: []
    };
  }

  function modOf(c, key) {
    return G.abilityMod(c.scores[key] + (c.bonusMap[key] || 0));
  }

  function profBonusOf(c) {
    return PROF_BONUS[Math.min(20, Math.max(1, c.level))] || 2;
  }

  /* 派生值计算 */
  function computeDerived(c) {
    var prof = profBonusOf(c);
    var ac = c.baseAc;
    var dexMod = modOf(c, 'dex');
    if (c.dexCap != null) dexMod = Math.min(dexMod, c.dexCap);
    ac = ac + (c.armorName ? dexMod : Math.max(0, dexMod));
    if (c.shield) ac += 2;
    var hpPerLevel = Math.floor(c.hitDie / 2) + 1; /* 每级取平均值 */
    var maxHp = c.level === 1 ? c.hitDie + modOf(c, 'con')
      : c.hitDie + modOf(c, 'con') + (c.level - 1) * (hpPerLevel + modOf(c, 'con'));
    if (c.level === 1) maxHp = Math.max(1, maxHp);
    var passive = 10 + modOf(c, 'wis') + (c.skills.indexOf('perception') !== -1 ? prof : 0);
    return {
      mods: ABILITY_KEYS.reduce(function (o, k) { o[k] = modOf(c, k); return o; }, {}),
      profBonus: prof,
      ac: ac,
      initiative: modOf(c, 'dex'),
      maxHp: maxHp,
      passivePerception: passive,
      skillCheck: function (sidx) {
        return G.abilityMod(c.scores[SKILL_LIST.filter(function (s) { return s.index === sidx; })[0].abil] + (c.bonusMap[SKILL_LIST.filter(function (s) { return s.index === sidx; })[0].abil] || 0))
          + (c.skills.indexOf(sidx) !== -1 ? prof : 0);
      }
    };
  }

  /* ---------- 存档 ---------- */
  function loadSlots() {
    try {
      var raw = localStorage.getItem(SLOTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function saveSlots(list) {
    try { localStorage.setItem(SLOTS_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function exportJSON(c) {
    var blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (c.name || '角色') + '.dnd.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 300);
  }
  function importJSON(text) {
    try {
      var obj = JSON.parse(text);
      if (!obj || !obj.scores || !obj.name) return { error: '文件不是有效的角色数据' };
      var c = newCharacter();
      for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) c[k] = obj[k];
      c.id = Date.now().toString(36);
      var slots = loadSlots();
      if (slots.length >= MAX_SLOTS) slots.pop();
      slots.unshift(c);
      saveSlots(slots);
      return { ok: true, c: c };
    } catch (e) { return { error: '解析失败: ' + e.message }; }
  }

  /* =========================================================
   * 角色卡 UI
   * ========================================================= */
  var CharacterUI = {};
  var root;
  var wizard = null; /* { step, c, mode: 'new'|'edit', allocMode, rollResult, arrValue } */

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

  /* ---------- 视图切换 ---------- */
  function showList() { wizard = null; renderList(); }
  function startWizard(mode, c) {
    wizard = { step: 1, c: c, mode: mode, allocMode: 'buy', arrPool: [15, 14, 13, 12, 10, 8] };
    renderWizard();
  }

  /* ---------- 列表视图 ---------- */
  function renderList() {
    root.innerHTML = '';
    var slots = loadSlots();

    var title = el('h2', 'dnd-card-title', '角色槽位');
    root.appendChild(title);

    var grid = el('div', 'dnd-grid');
    slots.forEach(function (c) {
      var card = el('div', 'dnd-card char-slot-card');
      card.innerHTML = ''
        + '<div class="char-slot-head">'
        + '<span class="char-slot-name">' + esc(c.name || '未命名') + '</span>'
        + '<span class="char-slot-lv">Lv.' + c.level + '</span>'
        + '</div>'
        + '<div class="char-slot-sub">'
        + (G.raceName(c.raceIndex) || '—') + ' · ' + (G.className(c.classIndex) || '—')
        + '</div>';
      var d = computeDerived(c);
      var stats = el('div', 'char-slot-stats');
      stats.innerHTML = ''
        + '<span title="护甲等级">AC ' + d.ac + '</span>'
        + '<span title="生命值">HP ' + d.maxHp + '</span>'
        + '<span title="先攻">先攻 ' + G.modStr(modOf(c, 'dex')) + '</span>'
        + '<span title="熟练加值">熟练+' + d.profBonus + '</span>';
      card.appendChild(stats);

      var btns = el('div', 'char-slot-btns');
      var bView = el('button', 'dnd-btn dnd-btn-sm', '查看');
      bView.addEventListener('click', function () { showSheet(c); });
      var bEdit = el('button', 'dnd-btn dnd-btn-sm', '编辑');
      bEdit.addEventListener('click', function () { startWizard('edit', c); });
      var bExp = el('button', 'dnd-btn dnd-btn-sm', '导出');
      bExp.addEventListener('click', function () { exportJSON(c); });
      var bShare = el('button', 'dnd-btn dnd-btn-sm', '分享');
      bShare.addEventListener('click', function () { shareCharacter(c); });
      var bDel = el('button', 'dnd-btn dnd-btn-sm dnd-btn-danger', '删除');
      bDel.addEventListener('click', function () {
        if (!confirm('删除角色「' + c.name + '」？')) return;
        saveSlots(loadSlots().filter(function (x) { return x.id !== c.id; }));
        renderList();
      });
      btns.appendChild(bView); btns.appendChild(bEdit); btns.appendChild(bExp); btns.appendChild(bShare); btns.appendChild(bDel);
      card.appendChild(btns);
      grid.appendChild(card);
    });

    if (slots.length < MAX_SLOTS) {
      var newCard = el('div', 'dnd-card char-new-card');
      var btn = el('button', 'dnd-btn dnd-btn-gold char-new-btn', '新建角色');
      btn.addEventListener('click', function () { startWizard('new', newCharacter()); });
      newCard.appendChild(btn);
      grid.appendChild(newCard);
    }
    root.appendChild(grid);

    /* 导入区 */
    var imp = el('div', 'dnd-card char-import');
    imp.innerHTML = '<h2 class="dnd-card-title">导入角色</h2>';
    var row = el('div', 'dnd-field-row');
    var fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.className = 'dnd-input';
    var impBtn = el('button', 'dnd-btn', '导入');
    impBtn.addEventListener('click', function () {
      if (!fileInput.files.length) return;
      var reader = new FileReader();
      reader.onload = function () {
        var r = importJSON(reader.result);
        if (r.error) alert(r.error);
        renderList();
      };
      reader.readAsText(fileInput.files[0]);
    });
    row.appendChild(fileInput); row.appendChild(impBtn);
    imp.appendChild(row);
    var tip = el('p', 'dnd-hint', '从导出的 .dnd.json 文件恢复角色');
    imp.appendChild(tip);
    root.appendChild(imp);
  }

  /* ---------- 角色卡视图 ---------- */
  function showSheet(c) {
    root.innerHTML = '';
    var d = computeDerived(c);

    var back = el('p');
    back.innerHTML = '<a href="#" class="dnd-back">← 返回列表</a>';
    back.querySelector('a').addEventListener('click', function (e) { e.preventDefault(); showList(); });
    root.appendChild(back);

    var card = el('div', 'dnd-card sheet-card');
    var head = el('div', 'sheet-head');
    head.innerHTML = '<div class="sheet-name">' + esc(c.name || '未命名') + '</div>'
      + '<div class="sheet-classline">' + G.raceName(c.raceIndex) + ' · '
      + G.className(c.classIndex) + ' · 等级 ' + c.level + '</div>'
      + '<div class="sheet-meta">' + (c.player ? '玩家: ' + esc(c.player) + ' · ' : '')
      + (c.alignment ? '阵营 ' + G.alignmentName(c.alignment) + ' · ' : '')
      + '体型 ' + (c.size || '—') + ' · 速度 ' + (c.speed || '—') + ' 尺'
      + (c.xp ? ' · 经验 ' + c.xp + (function () {
        var nx = G.nextLevelXp(c.level, c.xp);
        return nx.ready ? '（可升级 Lv.' + (c.level + 1) + '）' : '（距 Lv.' + (c.level + 1) + ' 差 ' + nx.left + '）';
      })() : '') + '</div>';
    card.appendChild(head);

    /* 核心数值 */
    var core = el('div', 'sheet-core');
    core.innerHTML = ''
      + '<div class="sheet-stat-box"><span class="sheet-stat-label">护甲</span><span class="sheet-stat-val">' + d.ac + '</span></div>'
      + '<div class="sheet-stat-box"><span class="sheet-stat-label">生命值</span><span class="sheet-stat-val">' + d.maxHp + '</span></div>'
      + '<div class="sheet-stat-box"><span class="sheet-stat-label">先攻</span><span class="sheet-stat-val">' + G.modStr(modOf(c, 'dex')) + '</span></div>'
      + '<div class="sheet-stat-box"><span class="sheet-stat-label">熟练加值</span><span class="sheet-stat-val">+' + d.profBonus + '</span></div>'
      + '<div class="sheet-stat-box"><span class="sheet-stat-label">被动察觉</span><span class="sheet-stat-val">' + d.passivePerception + '</span></div>';
    card.appendChild(core);

    /* 属性 */
    var abilGrid = el('div', 'sheet-abil-grid');
    ABILITY_KEYS.forEach(function (k) {
      var total = c.scores[k] + (c.bonusMap[k] || 0);
      var box = el('div', 'sheet-abil');
      box.innerHTML = '<div class="sheet-abil-name">' + G.abilities[k] + '</div>'
        + '<div class="sheet-abil-mod">' + G.modText(total) + '</div>'
        + '<div class="sheet-abil-score">' + total
        + (c.bonusMap[k] ? '<span class="sheet-abil-bonus">+' + c.bonusMap[k] + '</span>' : '')
        + '</div>';
      abilGrid.appendChild(box);
    });
    card.appendChild(abilGrid);

    /* 技能 */
    var skillBox = el('div', 'sheet-section');
    skillBox.innerHTML = '<h3 class="sheet-section-title">技能</h3>';
    var skillList = el('div', 'sheet-skills');
    SKILL_LIST.forEach(function (s) {
      var trained = c.skills.indexOf(s.index) !== -1;
      var total = G.abilityMod(c.scores[s.abil] + (c.bonusMap[s.abil] || 0)) + (trained ? d.profBonus : 0);
      var row = el('div', 'sheet-skill' + (trained ? ' trained' : ''));
      row.innerHTML = '<span class="sheet-skill-dot">' + (trained ? '●' : '○') + '</span>'
        + '<span class="sheet-skill-name">' + s.name + '</span>'
        + '<span class="sheet-skill-mod">' + G.modStr(total) + '</span>';
      skillList.appendChild(row);
    });
    skillBox.appendChild(skillList);
    card.appendChild(skillBox);

    /* 武器与护甲 */
    var eqBox = el('div', 'sheet-section');
    eqBox.innerHTML = '<h3 class="sheet-section-title">武器与护甲</h3>';
    var eqRows = '';
    c.weapons.forEach(function (w) {
      eqRows += '<div class="sheet-eq-row"><span class="sheet-eq-name">' + esc(w.name) + '</span>'
        + '<span class="sheet-eq-sub">' + esc(w.dice) + ' + ' + G.abilities[w.ability] + '修正'
        + (w.bonus ? ' +' + w.bonus : '') + '</span></div>';
    });
    eqRows += '<div class="sheet-eq-row"><span class="sheet-eq-name">护甲</span>'
      + '<span class="sheet-eq-sub">' + esc(c.armorName || '无甲') + (c.shield ? ' + 盾牌' : '') + '</span></div>';
    eqBox.innerHTML += eqRows;
    card.appendChild(eqBox);

    /* 装备与备注 */
    if (c.equipment.length || c.notes) {
      var noteBox = el('div', 'sheet-section');
      if (c.equipment.length) {
        noteBox.innerHTML += '<h3 class="sheet-section-title">装备</h3>'
          + '<div class="sheet-notes">' + esc(c.equipment.join('、')) + '</div>';
      }
      if (c.notes) {
        noteBox.innerHTML += '<h3 class="sheet-section-title">备注</h3>'
          + '<div class="sheet-notes">' + esc(c.notes) + '</div>';
      }
      card.appendChild(noteBox);
    }

    root.appendChild(card);

    var ops = el('div', 'sheet-ops');
    var bEdit = el('button', 'dnd-btn', '编辑角色');
    bEdit.addEventListener('click', function () { startWizard('edit', c); });
    var bExp = el('button', 'dnd-btn', '导出 JSON');
    bExp.addEventListener('click', function () { exportJSON(c); });
    ops.appendChild(bEdit); ops.appendChild(bExp);
    root.appendChild(ops);
  }

  /* =========================================================
   * 建卡向导
   * ========================================================= */
  function wizardHeader() {
    var steps = ['基本信息', '种族', '属性', '职业', '装备'];
    var bar = el('div', 'wizard-steps');
    steps.forEach(function (s, i) {
      var n = i + 1;
      var item = el('span', 'wizard-step'
        + (n === wizard.step ? ' active' : n < wizard.step ? ' done' : ''), String(n) + '. ' + s);
      bar.appendChild(item);
    });
    return bar;
  }

  function wizardNav(onPrev, onNext, nextLabel) {
    var nav = el('div', 'wizard-nav');
    var prev = el('button', 'dnd-btn', '上一步');
    prev.addEventListener('click', onPrev);
    var next = el('button', 'dnd-btn dnd-btn-gold', nextLabel || '下一步');
    next.addEventListener('click', onNext);
    if (wizard.step > 1) nav.appendChild(prev);
    nav.appendChild(next);
    return nav;
  }

  function renderWizard() {
    root.innerHTML = '';
    root.appendChild(wizardHeader());
    var body = el('div', 'wizard-body');
    var c = wizard.c;

    if (wizard.step === 1) renderStep1(body, c);
    else if (wizard.step === 2) renderStep2(body, c);
    else if (wizard.step === 3) renderStep3(body, c);
    else if (wizard.step === 4) renderStep4(body, c);
    else if (wizard.step === 5) renderStep5(body, c);

    root.appendChild(body);
  }

  /* --- 步骤 1：基本信息 --- */
  function renderStep1(body, c) {
    var card = el('div', 'dnd-card');
    card.innerHTML = '<h2 class="dnd-card-title">基本信息</h2>'
      + '<div class="dnd-field-row"><label class="dnd-label">角色名</label>'
      + '<input type="text" id="w-name" class="dnd-input" value="' + esc(c.name) + '" placeholder="例如：伊尔·影风"></div>'
      + '<div class="dnd-field-row"><label class="dnd-label">玩家名</label>'
      + '<input type="text" id="w-player" class="dnd-input" value="' + esc(c.player) + '" placeholder="可选"></div>'
      + '<div class="dnd-field-col"><label class="dnd-label">阵营</label>'
      + '<div class="align-grid">'
      + ALIGN_GRID.map(function (a) {
        return '<button type="button" class="align-cell' + (c.alignment === a ? ' selected" data-align="' + a : '" data-align="' + a) + '">' + G.alignmentName(a) + '</button>';
      }).join('')
      + '</div>'
      + '<button type="button" class="align-none' + (c.alignment === 'none' ? ' selected" data-align="none' : '" data-align="none') + '">无阵营</button>'
      + '</div>';
    body.appendChild(card);
    /* 阵营 9 宫格点选 */
    card.querySelectorAll('[data-align]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        c.alignment = this.getAttribute('data-align');
        card.querySelectorAll('[data-align]').forEach(function (b) { b.classList.remove('selected'); });
        this.classList.add('selected');
      });
    });
    body.appendChild(wizardNav(
      function () {},
      function () {
        c.name = document.getElementById('w-name').value.trim() || '未命名';
        c.player = document.getElementById('w-player').value.trim();
        wizard.step = 2; renderWizard();
      }
    ));
  }

  /* --- 步骤 2：种族 --- */
  function renderStep2(body, c) {
    body.innerHTML = '';
    var card = el('div', 'dnd-card');
    card.innerHTML = '<h2 class="dnd-card-title">选择种族</h2>';

    var grid = el('div', 'race-grid');
    STATIC_RACES.forEach(function (r) {
      var btn = el('button', 'race-item' + (c.raceIndex === r.index ? ' selected' : ''),
        '<span class="race-cn">' + r.cn + '</span>'
        + '<span class="race-en">' + r.name + '</span>'
        + '<span class="race-bonus">' + r.bonuses.map(function (b) {
          return b.choose ? '任选 ' + b.choose + ' 项 +' + b.val : G.abilities[b.stat] + ' +' + b.val;
        }).join('，') + '</span>');
      btn.addEventListener('click', function () {
        c.raceIndex = r.index; c.raceName = r.name;
        c.size = r.size; c.speed = r.speed;
        c.traits = [];
        c.bonusMap = {};
        r.bonuses.forEach(function (b) {
          if (b.stat) c.bonusMap[b.stat] = b.val;
        });
        /* 任选加成：默认补到未加成的属性 */
        r.bonuses.forEach(function (b) {
          if (b.choose) {
            var candidates = ABILITY_KEYS.filter(function (k) { return !c.bonusMap[k]; });
            for (var i = 0; i < b.choose && i < candidates.length; i++) {
              c.bonusMap[candidates[i]] = b.val;
            }
          }
        });
        renderStep2(body, c);
      });
      grid.appendChild(btn);
    });
    card.appendChild(grid);

    /* 半精灵等任选加成调整 */
    if (c.raceIndex && hasChoose(c)) {
      var pick = el('div', 'race-pick');
      pick.innerHTML = '<p class="dnd-hint">调整任选属性加成（' + chooseDesc(c) + '）</p>';
      var row = el('div', 'dnd-field-row');
      var sel = el('select', 'dnd-input');
      ABILITY_KEYS.forEach(function (k) {
        var o = el('option', null, G.abilities[k] + (c.bonusMap[k] ? ' (+' + c.bonusMap[k] + ')' : ''));
        o.value = k;
        if (c.bonusMap[k] && !STATIC_RACES.filter(function (r) { return r.index === c.raceIndex; })[0].bonuses.some(function (b) { return b.stat === k; })) {
          o.selected = true;
        }
        sel.appendChild(o);
      });
      var pickBtn = el('button', 'dnd-btn dnd-btn-sm', '应用');
      pickBtn.addEventListener('click', function () {
        var target = sel.value;
        var fixed = STATIC_RACES.filter(function (r) { return r.index === c.raceIndex; })[0]
          .bonuses.filter(function (b) { return b.stat; });
        /* 重置所有任选加成 */
        ABILITY_KEYS.forEach(function (k) {
          if (!fixed.some(function (b) { return b.stat === k; })) delete c.bonusMap[k];
        });
        c.bonusMap[target] = 1;
        renderStep2(body, c);
      });
      row.appendChild(sel); row.appendChild(pickBtn);
      pick.appendChild(row);
      card.appendChild(pick);
    }

    if (c.raceIndex) {
      var info = el('div', 'race-info');
      info.innerHTML = '<span class="race-info-item">体型 ' + (c.size || '—') + '</span>'
        + '<span class="race-info-item">速度 ' + (c.speed || '—') + ' 尺</span>'
        + '<span class="race-info-item">属性加成 ' + ABILITY_KEYS.filter(function (k) { return c.bonusMap[k]; })
          .map(function (k) { return G.abilities[k] + ' +' + c.bonusMap[k]; }).join('，') + '</span>';
      card.appendChild(info);
    }

    body.appendChild(card);
    body.appendChild(wizardNav(
      function () { wizard.step = 1; renderWizard(); },
      function () { wizard.step = 3; renderWizard(); }
    ));
  }

  function hasChoose(c) {
    var r = STATIC_RACES.filter(function (x) { return x.index === c.raceIndex; })[0];
    return !!(r && r.bonuses.some(function (b) { return b.choose; }));
  }
  function chooseDesc(c) {
    var r = STATIC_RACES.filter(function (x) { return x.index === c.raceIndex; })[0];
    return r.bonuses.filter(function (b) { return b.choose; })
      .map(function (b) { return '任选 ' + b.choose + ' 项 +' + b.val; }).join('，');
  }

  /* --- 步骤 3：属性 --- */
  function renderStep3(body, c) {
    body.innerHTML = '';
    var card = el('div', 'dnd-card');
    card.innerHTML = '<h2 class="dnd-card-title">属性值</h2>'
      + '<p class="dnd-hint">基础值不包含种族加成，合计 = 基础 + 种族加成</p>';

    /* 模式选择 */
    var modes = el('div', 'alloc-modes');
    [['buy', '标准购点'], ['roll', '4d6 掷点'], ['arr', '标准数组'], ['manual', '手动输入']].forEach(function (m) {
      var b = el('button', 'dnd-btn dnd-btn-sm' + (wizard.allocMode === m[0] ? ' active' : ''), m[1]);
      b.addEventListener('click', function () { wizard.allocMode = m[0]; renderStep3(body, c); });
      modes.appendChild(b);
    });
    card.appendChild(modes);

    var board = el('div', 'ability-board');
    var pointsLeft = 0;

    if (wizard.allocMode === 'buy') {
      pointsLeft = POINT_BUY_MAX - ABILITY_KEYS.reduce(function (s, k) {
        return s + (POINT_BUY_COST[c.scores[k]] || 0);
      }, 0);
    }

    ABILITY_KEYS.forEach(function (k) {
      var row = el('div', 'ability-row');
      var bonus = c.bonusMap[k] || 0;
      var total = c.scores[k] + bonus;

      var nameEl = el('span', 'ability-name', G.abilityFull[k]);
      var modEl = el('span', 'ability-mod', G.modText(total));

      var rowBtns = el('div', 'ability-btns');
      var minus = el('button', 'dnd-btn dnd-btn-sm', '−');
      var plus = el('button', 'dnd-btn dnd-btn-sm', '+');
      var scoreEl = el('span', 'ability-score', String(c.scores[k]));
      var bonusEl = el('span', 'ability-racebonus', bonus ? '+' + bonus : '');
      rowBtns.appendChild(minus); rowBtns.appendChild(scoreEl); rowBtns.appendChild(bonusEl); rowBtns.appendChild(plus);
      row.appendChild(nameEl); row.appendChild(modEl); row.appendChild(rowBtns);
      board.appendChild(row);

      function canMinus() {
        if (wizard.allocMode === 'buy') return c.scores[k] > 8;
        if (wizard.allocMode === 'arr') return wizard.arrPool.indexOf(c.scores[k]) !== -1;
        return true;
      }
      function canPlus() {
        if (wizard.allocMode === 'buy') return c.scores[k] < 15 && (POINT_BUY_COST[c.scores[k] + 1] - POINT_BUY_COST[c.scores[k]]) <= pointsLeft;
        if (wizard.allocMode === 'arr') return true; /* 数组模式用下方分配 */
        return true;
      }

      minus.addEventListener('click', function () {
        if (wizard.allocMode === 'arr') {
          if (wizard.arrPool.indexOf(c.scores[k]) === -1) return;
          wizard.arrPool.push(c.scores[k]);
          c.scores[k] = 8;
        } else if (wizard.allocMode === 'buy') {
          if (c.scores[k] <= 8) return;
          c.scores[k]--;
        } else if (c.scores[k] > 3) c.scores[k]--;
        renderStep3(body, c);
      });
      plus.addEventListener('click', function () {
        if (wizard.allocMode === 'arr') {
          if (!wizard.arrPool.length) return;
          var v = wizard.arrPool.pop();
          c.scores[k] = v;
        } else if (wizard.allocMode === 'buy') {
          if (c.scores[k] >= 15) return;
          var cost = POINT_BUY_COST[c.scores[k] + 1] - POINT_BUY_COST[c.scores[k]];
          if (cost > pointsLeft) return;
          c.scores[k]++;
        } else if (c.scores[k] < 20) c.scores[k]++;
        renderStep3(body, c);
      });
    });
    card.appendChild(board);

    /* 数组模式提示 */
    if (wizard.allocMode === 'arr') {
      var arrBox = el('div', 'arr-pool');
      arrBox.innerHTML = '<span class="dnd-hint">点击 "+" 将待分配数值填入属性：</span>';
      var chips = el('div', 'arr-chips');
      wizard.arrPool.slice().sort(function (a, b) { return b - a; }).forEach(function (v) {
        chips.appendChild(el('span', 'dice-chip', String(v)));
      });
      arrBox.appendChild(chips);
      card.appendChild(arrBox);
    }

    /* 掷点模式 */
    if (wizard.allocMode === 'roll') {
      var rollBox = el('div', 'dnd-field-row');
      var rBtn = el('button', 'dnd-btn', '重新掷点');
      rBtn.addEventListener('click', function () {
        ABILITY_KEYS.forEach(function (k) {
          var rolls = [DnD.Dice.rollDie(6), DnD.Dice.rollDie(6), DnD.Dice.rollDie(6), DnD.Dice.rollDie(6)];
          rolls.sort(function (a, b) { return b - a; });
          c.scores[k] = rolls[0] + rolls[1] + rolls[2];
        });
        renderStep3(body, c);
      });
      rollBox.appendChild(rBtn);
      card.appendChild(rollBox);
    }

    /* 手动模式 */
    if (wizard.allocMode === 'manual') {
      var mBox = el('div', 'dnd-field-row');
      var mBtn = el('button', 'dnd-btn', '应用输入');
      mBtn.addEventListener('click', function () {
        ABILITY_KEYS.forEach(function (k) {
          var inp = document.getElementById('manual-' + k);
          var v = parseInt(inp.value, 10);
          if (!isNaN(v) && v >= 1 && v <= 30) c.scores[k] = v;
        });
        renderStep3(body, c);
      });
      var inputs = el('div', 'manual-inputs');
      ABILITY_KEYS.forEach(function (k) {
        inputs.appendChild(el('span', 'manual-item',
          G.abilities[k] + ' <input type="number" id="manual-' + k + '" class="dnd-input manual-num" value="' + c.scores[k] + '" min="1" max="30">'));
      });
      mBox.appendChild(inputs); mBox.appendChild(mBtn);
      card.appendChild(mBox);
    }

    if (wizard.allocMode === 'buy') {
      var pts = el('p', 'dnd-hint buy-points', '剩余点数：' + pointsLeft + ' / ' + POINT_BUY_MAX);
      card.appendChild(pts);
    }

    body.appendChild(card);
    body.appendChild(wizardNav(
      function () { wizard.step = 2; renderWizard(); },
      function () {
        if (wizard.allocMode === 'roll' && !wizard.rolled) {
          /* 首次进入掷点模式自动掷 */
          wizard.rolled = true;
        }
        wizard.step = 4; renderWizard();
      }
    ));
  }

  /* --- 步骤 4：职业 --- */
  function renderStep4(body, c) {
    body.innerHTML = '';
    var card = el('div', 'dnd-card');
    card.innerHTML = '<h2 class="dnd-card-title">职业与等级</h2>';

    var grid = el('div', 'class-grid');
    STATIC_CLASSES.forEach(function (cl) {
      var btn = el('button', 'class-item' + (c.classIndex === cl.index ? ' selected' : ''),
        '<span class="class-cn">' + cl.cn + '</span>'
        + '<span class="class-en">' + cl.name + '</span>'
        + '<span class="class-die">生命骰 d' + cl.hitDie + ' · 技能选 ' + cl.skillChoices + ' 项</span>');
      btn.addEventListener('click', function () {
        c.classIndex = cl.index; c.className = cl.name;
        c.hitDie = cl.hitDie;
        c.skills = [];
        renderStep4(body, c);
      });
      grid.appendChild(btn);
    });
    card.appendChild(grid);

    if (c.classIndex) {
      var cl = STATIC_CLASSES.filter(function (x) { return x.index === c.classIndex; })[0];
      var lvBox = el('div', 'level-row');
      lvBox.innerHTML = '<span class="dnd-hint">等级</span>'
        + '<input type="range" id="w-level" class="dnd-range" min="1" max="20" value="' + c.level + '">'
        + '<span class="level-val" id="w-level-val">' + c.level + '</span>';
      lvBox.querySelector('#w-level').addEventListener('input', function () {
        c.level = parseInt(this.value, 10);
        document.getElementById('w-level-val').textContent = c.level;
      });
      card.appendChild(lvBox);

      /* 技能熟练选择 */
      var skillCard = el('div', 'skill-pick');
      skillCard.innerHTML = '<h3 class="sheet-section-title">技能熟练（选 ' + cl.skillChoices + ' 项）</h3>';
      var skillGrid = el('div', 'skill-grid');
      SKILL_LIST.forEach(function (s) {
        var trained = c.skills.indexOf(s.index) !== -1;
        var btn = el('button', 'skill-item' + (trained ? ' selected' : ''),
          '<span class="skill-dot">' + (trained ? '●' : '○') + '</span>' + s.name
          + '<span class="skill-abil">' + G.abilities[s.abil] + '</span>');
        btn.addEventListener('click', function () {
          var idx = c.skills.indexOf(s.index);
          if (idx !== -1) c.skills.splice(idx, 1);
          else if (c.skills.length < cl.skillChoices) c.skills.push(s.index);
          renderStep4(body, c);
        });
        skillGrid.appendChild(btn);
      });
      skillCard.appendChild(skillGrid);
      card.appendChild(skillCard);

      var preview = el('div', 'class-preview');
      preview.innerHTML = '<span class="dnd-hint">生命骰 d' + c.hitDie + ' · 熟练加值 +'
        + PROF_BONUS[c.level] + ' · 满级 HP ' + computeDerived(c).maxHp + '</span>';
      card.appendChild(preview);
    }

    body.appendChild(card);
    body.appendChild(wizardNav(
      function () { wizard.step = 3; renderWizard(); },
      function () {
        if (!c.classIndex) { alert('请先选择职业'); return; }
        wizard.step = 5; renderWizard();
      }
    ));
  }

  /* --- 步骤 5：装备与完成 --- */
  function renderStep5(body, c) {
    body.innerHTML = '';
    var card = el('div', 'dnd-card');
    card.innerHTML = '<h2 class="dnd-card-title">装备与完成</h2>';

    /* 武器行编辑 */
    var wBox = el('div', 'weapon-box');
    wBox.innerHTML = '<h3 class="sheet-section-title">武器</h3>';
    c.weapons.forEach(function (w, i) {
      var row = el('div', 'eq-edit-row');
      row.innerHTML = '<input type="text" class="dnd-input eq-name" value="' + esc(w.name) + '" placeholder="名称">'
        + '<input type="text" class="dnd-input eq-dice" value="' + esc(w.dice) + '" placeholder="1d8">'
        + '<select class="dnd-input eq-abil">'
        + ABILITY_KEYS.map(function (k) { return '<option value="' + k + '"' + (w.ability === k ? ' selected' : '') + '>' + G.abilities[k] + '</option>'; }).join('')
        + '</select>'
        + '<button type="button" class="dnd-btn dnd-btn-sm eq-del">删除</button>';
      row.querySelector('.eq-del').addEventListener('click', function () {
        c.weapons.splice(i, 1); renderStep5(body, c);
      });
      wBox.appendChild(row);
    });
    var addW = el('button', 'dnd-btn dnd-btn-sm', '+ 添加武器');
    addW.addEventListener('click', function () {
      c.weapons.push({ name: '', dice: '1d8', ability: 'str', bonus: 0 });
      renderStep5(body, c);
    });
    wBox.appendChild(addW);
    card.appendChild(wBox);

    /* 护甲 */
    var aBox = el('div', 'armor-box');
    aBox.innerHTML = '<h3 class="sheet-section-title">护甲</h3>'
      + '<div class="dnd-field-row"><label class="dnd-label">名称</label>'
      + '<input type="text" id="eq-armor" class="dnd-input" value="' + esc(c.armorName) + '" placeholder="无甲则留空"></div>'
      + '<div class="dnd-field-row"><label class="dnd-label">基础 AC</label>'
      + '<input type="number" id="eq-ac" class="dnd-input" value="' + c.baseAc + '" min="0" max="30"></div>'
      + '<div class="dnd-field-row"><label class="dnd-label">敏捷上限</label>'
      + '<input type="number" id="eq-dexcap" class="dnd-input" value="' + (c.dexCap == null ? '' : c.dexCap) + '" placeholder="无上限" min="0" max="10"></div>'
      + '<div class="dnd-field-row"><label class="dnd-label"><input type="checkbox" id="eq-shield"' + (c.shield ? ' checked' : '') + '> 携带盾牌 (+2 AC)</label></div>';
    card.appendChild(aBox);

    /* 装备文本 */
    var eBox = el('div', 'equip-box');
    eBox.innerHTML = '<h3 class="sheet-section-title">装备清单</h3>'
      + '<textarea id="eq-list" class="dnd-input dnd-textarea" placeholder="每行一件">' + esc(c.equipment.join('\n')) + '</textarea>';
    card.appendChild(eBox);

    /* 备注 */
    var nBox = el('div', 'notes-box');
    nBox.innerHTML = '<h3 class="sheet-section-title">备注</h3>'
      + '<textarea id="eq-notes" class="dnd-input dnd-textarea" placeholder="背景、特质等">' + esc(c.notes) + '</textarea>';
    card.appendChild(nBox);

    body.appendChild(card);
    body.appendChild(wizardNav(
      function () { wizard.step = 4; renderWizard(); },
      function () {
        /* 收集武器输入 */
        var rows = card.querySelectorAll('.eq-edit-row');
        c.weapons = [];
        rows.forEach(function (r) {
          var name = r.querySelector('.eq-name').value.trim();
          var dice = r.querySelector('.eq-dice').value.trim();
          if (!name || !dice) return;
          c.weapons.push({
            name: name, dice: dice, ability: r.querySelector('.eq-abil').value,
            bonus: 0
          });
        });
        c.armorName = card.querySelector('#eq-armor').value.trim();
        c.baseAc = parseInt(card.querySelector('#eq-ac').value, 10) || 10;
        var cap = card.querySelector('#eq-dexcap').value;
        c.dexCap = cap === '' ? null : (parseInt(cap, 10) || 0);
        c.shield = card.querySelector('#eq-shield').checked;
        c.equipment = card.querySelector('#eq-list').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        c.notes = card.querySelector('#eq-notes').value.trim();

        /* 保存 */
        var slots = loadSlots();
        if (wizard.mode === 'edit') {
          slots = slots.map(function (x) { return x.id === c.id ? c : x; });
        } else {
          if (slots.length >= MAX_SLOTS) slots.pop();
          slots.unshift(c);
        }
        saveSlots(slots);
        showList();
      }, '完成并保存'
    ));
  }

  /* ---------- 分享（URL base64） ---------- */
  function shareCharacter(c) {
    var url = location.origin + location.pathname
      + '?dnd=' + btoa(encodeURIComponent(JSON.stringify(c)));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        alert('分享链接已复制到剪贴板，发给朋友即可导入角色');
      }, function () { prompt('复制分享链接：', url); });
    } else {
      prompt('复制分享链接：', url);
    }
  }

  /* ---------- 检测 URL 分享链接 ---------- */
  function checkShareLink() {
    var params = new URLSearchParams(location.search);
    var enc = params.get('dnd');
    if (!enc) return;
    var text, obj;
    try { text = decodeURIComponent(atob(enc)); } catch (e) { return; }
    try { obj = JSON.parse(text); } catch (e) { return; }
    if (!obj || !obj.scores) return;

    var bar = el('div', 'share-bar');
    bar.innerHTML = '<span>发现分享的角色卡：<b>' + esc(obj.name || '未命名') + '</b>（'
      + G.className(obj.classIndex) + ' Lv.' + obj.level + '）</span>';
    var btnImport = el('button', 'dnd-btn dnd-btn-sm dnd-btn-gold', '导入到槽位');
    btnImport.addEventListener('click', function () {
      var r = importJSON(text);
      if (r.error) alert(r.error);
      bar.remove();
      try { history.replaceState(null, '', location.pathname); } catch (e) {}
      renderList();
    });
    var btnIgnore = el('button', 'dnd-btn dnd-btn-sm', '忽略');
    btnIgnore.addEventListener('click', function () {
      bar.remove();
      try { history.replaceState(null, '', location.pathname); } catch (e) {}
    });
    bar.appendChild(btnImport); bar.appendChild(btnIgnore);
    root.insertBefore(bar, root.firstChild);
  }

  /* ---------- 初始化 ---------- */
  function init() {
    root = document.getElementById('character-root');
    if (!root) return;
    root.innerHTML = '';
    renderList();
    checkShareLink();
  }

  DnD.Character = {
    newCharacter: newCharacter,
    computeDerived: computeDerived,
    loadSlots: loadSlots,
    saveSlots: saveSlots,
    exportJSON: exportJSON,
    importJSON: importJSON,
    profBonusOf: profBonusOf,
    modOf: modOf
  };
  DnD.CharacterUI = { init: init };
})(window);
