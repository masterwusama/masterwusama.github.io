/* =========================================================
 * 跑团桌 · 战斗追踪模块 (combat.js)
 * 先攻排序 / HP与临时HP / 死亡豁免 / 状态效果 / 专注检定 / XP结算
 * ========================================================= */
(function (global) {
  'use strict';

  var DnD = global.DnD = global.DnD || {};
  var G = DnD.Glossary;
  var SESSION_KEY = 'dnd_combat_session';

  /* CR → XP（DMG 表） */
  var CR_XP = {
    0: 10, '1/8': 25, '1/4': 50, '1/2': 100,
    1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900, 9: 5000,
    10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000,
    17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000,
    24: 62000, 25: 75000, 26: 90000, 27: 105000, 28: 120000, 29: 135000, 30: 155000
  };

  var CONDITION_KEYS = Object.keys(G.conditions);

  /* ---------- 会话 ---------- */
  function newSession() {
    return {
      name: '', round: 1, turnIndex: 0,
      focusEnabled: true,
      combatants: []
    };
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : newSession();
    } catch (e) { return newSession(); }
  }
  function saveSession(s) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function newCombatant(kind) {
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      kind: kind, name: '', displayName: '',
      maxHp: 1, hp: 1, tempHp: 0, ac: 10,
      initMod: 0, initRoll: 0, initiative: 0,
      conditions: [], deathSaves: { s: 0, f: 0 },
      stable: false, dead: false, focusing: false, conMod: 0,
      charId: null, cr: null, xp: 0, note: '',
      weapon: null, focusMsg: null
    };
  }

  /* 先攻排序（同值按修正，再按名字） */
  function sortByInitiative(s) {
    s.combatants.sort(function (a, b) {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      if (b.initMod !== a.initMod) return b.initMod - a.initMod;
      return a.name.localeCompare(b.name);
    });
  }

  /* 添加 PC（从角色卡导入） */
  function addPC(s, c) {
    var d = DnD.Character.computeDerived(c);
    var b = newCombatant('pc');
    b.name = c.name || '未命名';
    b.displayName = b.name;
    b.maxHp = d.maxHp; b.hp = d.maxHp;
    b.ac = d.ac; b.initMod = d.initiative; b.conMod = d.mods.con;
    b.charId = c.id;
    b.weapon = c.weapons.length ? c.weapons[0] : null;
    b.initRoll = DnD.Dice.rollDie(20);
    b.initiative = b.initRoll + b.initMod;
    s.combatants.push(b);
    sortByInitiative(s);
  }

  /* 添加怪物（m 为 dnd5eapi 详情） */
  function addMonster(s, m) {
    var b = newCombatant('monster');
    b.name = m.name || '';
    b.displayName = G.monsterName(m.index) + (m.name && G.monsterName(m.index) !== m.name ? ' (' + m.name + ')' : '');
    b.maxHp = m.hit_points || 1; b.hp = b.maxHp;
    b.ac = (m.armor_class && m.armor_class.length) ? m.armor_class[0].value : 10;
    b.initMod = G.abilityMod(m.dexterity != null ? m.dexterity : 10);
    b.conMod = G.abilityMod(m.constitution != null ? m.constitution : 10);
    b.cr = m.challenge_rating != null ? m.challenge_rating : null;
    b.xp = m.xp != null ? m.xp : (CR_XP[m.challenge_rating] || 0);
    b.initRoll = DnD.Dice.rollDie(20);
    b.initiative = b.initRoll + b.initMod;
    s.combatants.push(b);
    sortByInitiative(s);
  }

  /* 手动添加 */
  function addCustom(s, f) {
    var b = newCombatant('custom');
    b.name = f.name || '未知';
    b.displayName = b.name;
    b.maxHp = f.hp || 1; b.hp = b.maxHp;
    b.ac = f.ac || 10;
    b.initMod = f.initMod || 0;
    b.conMod = f.conMod || 0;
    b.note = f.note || '';
    b.initRoll = DnD.Dice.rollDie(20);
    b.initiative = b.initRoll + b.initMod;
    s.combatants.push(b);
    sortByInitiative(s);
  }

  /* ---------- HP 操作 ---------- */
  function applyDamage(b, dmg, s) {
    if (b.dead) return;
    var real = Math.max(0, dmg - b.tempHp);
    b.tempHp = Math.max(0, b.tempHp - dmg);
    b.hp = Math.max(0, b.hp - real);

    if (b.hp <= 0 && b.kind !== 'monster') {
      /* 0 HP 时受伤害：重大伤害立即死亡，否则死亡豁免失败 */
      if (real >= b.maxHp) {
        b.dead = true;
      } else {
        b.deathSaves.f += real >= Math.ceil(b.maxHp / 2) ? 2 : 1;
        if (b.deathSaves.f >= 3) b.dead = true;
      }
      b.stable = false;
    } else if (b.hp <= 0) {
      b.dead = true;
    }

    /* 专注检定（受击时） */
    if (s.focusEnabled && b.focusing && real > 0 && !b.dead) {
      var dc = Math.max(10, Math.ceil(real / 2));
      var roll = DnD.Dice.rollDie(20);
      var total = roll + b.conMod;
      b.focusMsg = {
        ok: total >= dc,
        html: '专注检定 DC' + dc + '：d20 ' + roll + ' ' + G.modStr(b.conMod) + ' = ' + total
          + (total >= dc ? '（成功，专注保持）' : '（失败，专注中断）')
      };
    }
  }

  function applyHeal(b, amount) {
    if (b.dead && amount <= 0) return;
    b.hp = Math.min(b.maxHp, b.hp + amount);
    if (b.hp > 0) {
      b.dead = false;
      b.deathSaves = { s: 0, f: 0 };
      b.stable = false;
    }
  }

  function deathSave(b, success) {
    if (b.hp > 0 || b.dead) return;
    if (success) {
      b.deathSaves.s++;
      if (b.deathSaves.s >= 3) b.stable = true;
    } else {
      b.deathSaves.f++;
      if (b.deathSaves.f >= 3) b.dead = true;
    }
  }

  /* ---------- 回合 ---------- */
  function nextTurn(s) {
    if (!s.combatants.length) return;
    s.turnIndex++;
    if (s.turnIndex >= s.combatants.length) {
      s.turnIndex = 0;
      s.round++;
    }
  }

  /* ---------- XP 结算 ---------- */
  function settleXP(s) {
    var totalXp = s.combatants.reduce(function (sum, b) {
      return sum + (b.kind === 'monster' ? (b.xp || 0) : 0);
    }, 0);
    var players = s.combatants.filter(function (b) { return b.kind === 'pc'; });
    var per = players.length ? Math.floor(totalXp / players.length) : totalXp;
    return { totalXp: totalXp, per: per, players: players };
  }

  function writeBackXP(s, per) {
    var slots = DnD.Character.loadSlots();
    var changed = false;
    s.combatants.forEach(function (b) {
      if (b.kind !== 'pc' || !b.charId) return;
      for (var i = 0; i < slots.length; i++) {
        if (slots[i].id === b.charId) {
          slots[i].xp = (slots[i].xp || 0) + per;
          changed = true;
          break;
        }
      }
    });
    if (changed) DnD.Character.saveSlots(slots);
  }

  /* =========================================================
   * UI
   * ========================================================= */
  var CombatUI = {};
  var root, session;
  var addMode = 'pc'; /* 添加区当前 Tab */

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

  function render() {
    if (!root) return;
    root.innerHTML = '';
    root.appendChild(renderToolbar());
    root.appendChild(renderAddArea());
    if (session.combatants.length) root.appendChild(renderList());
  }

  /* ---------- 工具栏 ---------- */
  function renderToolbar() {
    var card = el('div', 'dnd-card cb-toolbar');
    var row1 = el('div', 'cb-toolbar-row');
    var nameInput = el('input');
    nameInput.type = 'text';
    nameInput.className = 'dnd-input cb-name-input';
    nameInput.placeholder = '战斗名称（可选）';
    nameInput.value = session.name;
    nameInput.addEventListener('change', function () { session.name = this.value; saveSession(session); });
    row1.appendChild(nameInput);

    var turnLabel = el('span', 'cb-turn-label',
      '第 ' + session.round + ' 轮 · 行动 ' + (session.combatants.length ? (session.turnIndex + 1) + '/' + session.combatants.length : '0/0'));
    row1.appendChild(turnLabel);

    var btnNext = el('button', 'dnd-btn dnd-btn-gold cb-next-btn', '下一回合 →');
    btnNext.addEventListener('click', function () {
      if (!session.combatants.length) return;
      nextTurn(session);
      saveSession(session);
      render();
    });
    row1.appendChild(btnNext);
    card.appendChild(row1);

    var row2 = el('div', 'cb-toolbar-row');
    var focusWrap = el('label', 'cb-focus-toggle');
    var focusChk = el('input');
    focusChk.type = 'checkbox';
    focusChk.checked = session.focusEnabled;
    focusChk.addEventListener('change', function () {
      session.focusEnabled = this.checked;
      saveSession(session);
    });
    focusWrap.appendChild(focusChk);
    focusWrap.appendChild(document.createTextNode(' 专注检定（受击自动判定）'));
    row2.appendChild(focusWrap);

    var btnReset = el('button', 'dnd-btn dnd-btn-sm', '重置回合');
    btnReset.addEventListener('click', function () {
      session.round = 1; session.turnIndex = 0;
      saveSession(session); render();
    });
    row2.appendChild(btnReset);

    var btnClear = el('button', 'dnd-btn dnd-btn-sm dnd-btn-danger', '清空战斗');
    btnClear.addEventListener('click', function () {
      if (!confirm('清空所有参战者？')) return;
      clearSession();
      session = newSession();
      render();
    });
    row2.appendChild(btnClear);

    var btnXP = el('button', 'dnd-btn dnd-btn-sm', '结算 XP');
    btnXP.addEventListener('click', function () { renderXPPanel(); });
    row2.appendChild(btnXP);

    card.appendChild(row2);
    return card;
  }

  /* ---------- 添加区 ---------- */
  function renderAddArea() {
    var card = el('div', 'dnd-card cb-add');
    var tabs = el('div', 'cb-add-tabs');
    var modes = [['pc', '导入角色'], ['monster', '搜索怪物'], ['custom', '手动添加']];
    modes.forEach(function (m) {
      var b = el('button', 'dnd-btn dnd-btn-sm' + (addMode === m[0] ? ' active' : ''), m[1]);
      b.addEventListener('click', function () {
        addMode = m[0];
        render();
      });
      tabs.appendChild(b);
    });
    card.appendChild(tabs);

    var body = el('div', 'cb-add-body');
    if (addMode === 'pc') renderAddPC(body);
    else if (addMode === 'monster') renderAddMonster(body);
    else renderAddCustom(body);
    card.appendChild(body);
    return card;
  }

  function renderAddPC(body) {
    var slots = DnD.Character.loadSlots();
    if (!slots.length) {
      body.appendChild(el('p', 'dnd-hint', '还没有角色，请先在「角色卡」Tab 创建角色'));
      return;
    }
    var list = el('div', 'cb-pc-list');
    var checked = {};
    slots.forEach(function (c) {
      var d = DnD.Character.computeDerived(c);
      var label = el('label', 'cb-pc-item');
      var chk = el('input');
      chk.type = 'checkbox';
      chk.value = c.id;
      label.appendChild(chk);
      label.appendChild(document.createTextNode(c.name + '（' + G.className(c.classIndex) + ' ' + c.level + ' · AC ' + d.ac + ' · HP ' + d.maxHp + '）'));
      list.appendChild(label);
    });
    body.appendChild(list);
    var btn = el('button', 'dnd-btn dnd-btn-gold', '加入战斗（自动掷先攻）');
    btn.addEventListener('click', function () {
      var ids = [];
      list.querySelectorAll('input:checked').forEach(function (chk) { ids.push(chk.value); });
      if (!ids.length) { alert('请勾选至少一个角色'); return; }
      slots.forEach(function (c) {
        if (ids.indexOf(c.id) !== -1) addPC(session, c);
      });
      saveSession(session);
      render();
    });
    body.appendChild(btn);
  }

  function renderAddMonster(body) {
    var row = el('div', 'dnd-field-row');
    var input = el('input');
    input.type = 'text';
    input.className = 'dnd-input';
    input.placeholder = '输入怪物英文名，如 goblin / dragon';
    row.appendChild(input);
    var btn = el('button', 'dnd-btn', '搜索');
    row.appendChild(btn);
    body.appendChild(row);

    var resultBox = el('div', 'cb-monster-results');
    body.appendChild(resultBox);

    btn.addEventListener('click', function () { doSearch(input.value); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(input.value); });

    function doSearch(kw) {
      resultBox.innerHTML = '<p class="dnd-hint">搜索中…</p>';
      DnD.Data.searchMonsters(kw).then(function (list) {
        resultBox.innerHTML = '';
        if (!list.length) {
          resultBox.appendChild(el('p', 'dice-error', '未找到匹配的怪物（数据来自 5e SRD）'));
          return;
        }
        list.slice(0, 12).forEach(function (item) {
          var rowEl = el('div', 'cb-monster-item');
          rowEl.innerHTML = '<span class="cb-monster-name">' + esc(G.monsterName(item.index))
            + (G.monsterName(item.index) !== item.name ? ' <i>(' + esc(item.name) + ')</i>' : '') + '</span>';
          var addBtn = el('button', 'dnd-btn dnd-btn-sm', '加入');
          addBtn.addEventListener('click', function () {
            itemBtn(item.index, addBtn);
          });
          rowEl.appendChild(addBtn);
          resultBox.appendChild(rowEl);
        });
      }).catch(function () {
        resultBox.innerHTML = '';
        resultBox.appendChild(el('p', 'dice-error', '数据加载失败（网络不可用？），请改用「手动添加」'));
      });
    }

    function itemBtn(index, btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = '加载中…';
      DnD.Data.getMonster(index).then(function (m) {
        addMonster(session, m);
        saveSession(session);
        render();
      }).catch(function () {
        btnEl.disabled = false;
        btnEl.textContent = '加入';
        alert('怪物数据加载失败，请改用「手动添加」');
      });
    }
  }

  function renderAddCustom(body) {
    var f = { name: '', hp: 1, ac: 10, initMod: 0, conMod: 0, note: '' };
    var fields = [
      ['name', '名称'], ['hp', '生命值'], ['ac', '护甲 AC'],
      ['initMod', '先攻修正'], ['conMod', '体质修正']
    ];
    fields.forEach(function (pair) {
      var row = el('div', 'dnd-field-row');
      row.appendChild(el('label', 'dnd-label', pair[1]));
      var input = el('input');
      input.className = 'dnd-input';
      if (pair[0] === 'name') { input.placeholder = '如：石像鬼'; }
      else { input.type = 'number'; input.value = f[pair[0]]; }
      input.addEventListener('change', function () {
        if (pair[0] === 'name') f.name = this.value;
        else f[pair[0]] = parseInt(this.value, 10) || 0;
      });
      row.appendChild(input);
      body.appendChild(row);
    });
    var btn = el('button', 'dnd-btn dnd-btn-gold', '添加（自动掷先攻）');
    btn.addEventListener('click', function () {
      addCustom(session, f);
      saveSession(session);
      render();
    });
    body.appendChild(btn);
  }

  /* ---------- 参战者列表 ---------- */
  function renderList() {
    var card = el('div', 'dnd-card cb-list');
    card.innerHTML = '<h2 class="dnd-card-title">参战者（按先攻排序）</h2>';
    var box = el('div', 'cb-rows');
    session.combatants.forEach(function (b, idx) {
      box.appendChild(renderCombatant(b, idx));
    });
    card.appendChild(box);
    return card;
  }

  function renderCombatant(b, idx) {
    var row = el('div', 'cb-row'
      + (idx === session.turnIndex ? ' current' : '')
      + (b.dead ? ' dead' : ''));

    /* 头行 */
    var head = el('div', 'cb-head');
    head.appendChild(el('span', 'cb-order', String(idx + 1)));
    var nameEl = el('span', 'cb-name');
    nameEl.innerHTML = esc(b.displayName || b.name)
      + '<span class="cb-badge cb-badge-' + b.kind + '">'
      + (b.kind === 'pc' ? 'PC' : b.kind === 'monster' ? '怪物' : 'NPC') + '</span>'
      + (b.dead ? '<span class="cb-badge cb-badge-dead">死亡</span>' : b.stable ? '<span class="cb-badge cb-badge-stable">稳定</span>' : '');
    head.appendChild(nameEl);

    var initWrap = el('span', 'cb-init');
    initWrap.appendChild(el('span', 'cb-init-label', '先攻'));
    var initInput = el('input');
    initInput.type = 'number';
    initInput.className = 'cb-init-input';
    initInput.value = b.initiative;
    initInput.addEventListener('change', function () {
      var v = parseInt(this.value, 10);
      if (!isNaN(v)) {
        b.initiative = v;
        b.initRoll = v - b.initMod;
        sortByInitiative(session);
        saveSession(session);
        render();
      }
    });
    initWrap.appendChild(initInput);
    head.appendChild(initWrap);
    row.appendChild(head);

    /* 数值行 */
    var stats = el('div', 'cb-stats');
    var hpPct = b.maxHp > 0 ? Math.max(0, Math.min(100, Math.round((b.hp + b.tempHp) / b.maxHp * 100))) : 0;
    stats.innerHTML = ''
      + '<span class="cb-hp">HP <b>' + b.hp + '</b>/' + b.maxHp
      + (b.tempHp ? ' <i class="cb-temp">+' + b.tempHp + '</i>' : '') + '</span>'
      + '<span class="cb-ac">AC ' + b.ac + '</span>'
      + (b.cr != null ? '<span class="cb-cr">CR ' + esc(String(b.cr)) + '</span>' : '')
      + (b.xp ? '<span class="cb-xp">XP ' + b.xp + '</span>' : '');
    row.appendChild(stats);

    var bar = el('div', 'cb-hpbar');
    var fill = el('div', 'cb-hpbar-fill' + (hpPct <= 25 ? ' low' : ''));
    fill.style.width = hpPct + '%';
    bar.appendChild(fill);
    row.appendChild(bar);

    /* 操作行 */
    var ops = el('div', 'cb-ops');
    var dmgInput = el('input');
    dmgInput.type = 'number';
    dmgInput.className = 'cb-op-input';
    dmgInput.value = '5';
    dmgInput.placeholder = '数值';
    ops.appendChild(dmgInput);

    var btnDmg = el('button', 'dnd-btn dnd-btn-sm cb-btn-dmg', '伤害');
    btnDmg.addEventListener('click', function () {
      applyDamage(b, Math.max(0, parseInt(dmgInput.value, 10) || 0), session);
      saveSession(session);
      render();
    });
    ops.appendChild(btnDmg);

    var btnHeal = el('button', 'dnd-btn dnd-btn-sm cb-btn-heal', '治疗');
    btnHeal.addEventListener('click', function () {
      applyHeal(b, Math.max(0, parseInt(dmgInput.value, 10) || 0));
      saveSession(session);
      render();
    });
    ops.appendChild(btnHeal);

    var btnTemp = el('button', 'dnd-btn dnd-btn-sm', '临时HP');
    btnTemp.addEventListener('click', function () {
      var v = parseInt(dmgInput.value, 10) || 0;
      if (v > 0) b.tempHp = Math.max(0, v);
      saveSession(session);
      render();
    });
    ops.appendChild(btnTemp);

    if (b.kind === 'pc' || b.kind === 'custom') {
      var focusBtn = el('button', 'dnd-btn dnd-btn-sm' + (b.focusing ? ' active' : ''), b.focusing ? '专注中' : '专注');
      focusBtn.addEventListener('click', function () {
        b.focusing = !b.focusing;
        saveSession(session);
        render();
      });
      ops.appendChild(focusBtn);
    }

    var condSelect = el('select', 'cb-cond-select');
    condSelect.appendChild(el('option', null, '＋ 状态效果'));
    CONDITION_KEYS.forEach(function (k) {
      var o = el('option', null, G.conditionName(k));
      o.value = k;
      condSelect.appendChild(o);
    });
    condSelect.addEventListener('change', function () {
      var v = this.value;
      if (v && b.conditions.indexOf(v) === -1) b.conditions.push(v);
      this.value = '';
      saveSession(session);
      render();
    });
    ops.appendChild(condSelect);

    var btnDel = el('button', 'dnd-btn dnd-btn-sm dnd-btn-danger', '移除');
    btnDel.addEventListener('click', function () {
      session.combatants = session.combatants.filter(function (x) { return x.id !== b.id; });
      if (session.turnIndex >= session.combatants.length) session.turnIndex = 0;
      saveSession(session);
      render();
    });
    ops.appendChild(btnDel);

    row.appendChild(ops);

    /* 状态 chips */
    if (b.conditions.length) {
      var conds = el('div', 'cb-conds');
      b.conditions.forEach(function (k) {
        var chip = el('span', 'cb-cond-chip', G.conditionName(k) + ' ×');
        chip.title = '点击移除';
        chip.addEventListener('click', function () {
          b.conditions = b.conditions.filter(function (x) { return x !== k; });
          saveSession(session);
          render();
        });
        conds.appendChild(chip);
      });
      row.appendChild(conds);
    }

    /* 死亡豁免 */
    if (b.hp <= 0 && !b.dead && b.kind !== 'monster') {
      var ds = el('div', 'cb-death');
      ds.innerHTML = '<span class="cb-death-label">死亡豁免</span>'
        + '<span class="cb-death-count">成功 ' + b.deathSaves.s + '/3 · 失败 ' + b.deathSaves.f + '/3</span>';
      var btnS = el('button', 'dnd-btn dnd-btn-sm cb-btn-heal', '成功 +1');
      btnS.addEventListener('click', function () { deathSave(b, true); saveSession(session); render(); });
      var btnF = el('button', 'dnd-btn dnd-btn-sm cb-btn-dmg', '失败 +1');
      btnF.addEventListener('click', function () { deathSave(b, false); saveSession(session); render(); });
      ds.appendChild(btnS); ds.appendChild(btnF);
      row.appendChild(ds);
    }

    /* 专注检定消息 */
    if (b.focusMsg) {
      var msg = el('div', 'cb-focus-msg' + (b.focusMsg.ok ? ' ok' : ' fail'));
      msg.innerHTML = esc(b.focusMsg.html);
      row.appendChild(msg);
    }

    return row;
  }

  /* ---------- XP 结算面板 ---------- */
  function renderXPPanel() {
    var r = settleXP(session);
    var overlay = el('div', 'cb-xp-overlay');
    var panel = el('div', 'dnd-card cb-xp-panel');
    panel.innerHTML = '<h2 class="dnd-card-title">经验值结算</h2>'
      + '<div class="cb-xp-line">怪物 XP 合计：<b>' + r.totalXp + '</b></div>'
      + '<div class="cb-xp-line">队伍人数：<b>' + r.players.length + '</b> 名 PC</div>'
      + '<div class="cb-xp-line">每人获得：<b class="cb-xp-gold">' + r.per + '</b> XP</div>';

    if (r.players.length) {
      var btnWrite = el('button', 'dnd-btn dnd-btn-gold', '写入角色卡');
      btnWrite.addEventListener('click', function () {
        writeBackXP(session, r.per);
        /* 升级提示 */
        var hints = [];
        var slots = DnD.Character.loadSlots();
        session.combatants.forEach(function (b) {
          if (b.kind !== 'pc' || !b.charId) return;
          for (var i = 0; i < slots.length; i++) {
            if (slots[i].id === b.charId) {
              var nx = G.nextLevelXp(slots[i].level, slots[i].xp || 0);
              if (nx.ready) hints.push(slots[i].name + ' 可升级到 Lv.' + (slots[i].level + 1));
              break;
            }
          }
        });
        if (hints.length) alert('已写入。' + hints.join('；'));
        overlay.remove();
        render();
      });
      panel.appendChild(btnWrite);
    }

    var btnClose = el('button', 'dnd-btn dnd-btn-sm', '关闭');
    btnClose.addEventListener('click', function () { overlay.remove(); });
    panel.appendChild(btnClose);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }

  function init() {
    root = document.getElementById('combat-root');
    if (!root) return;
    session = loadSession();
    root.innerHTML = '';
    render();
  }

  DnD.Combat = {
    loadSession: loadSession,
    saveSession: saveSession,
    addPC: addPC,
    addMonster: addMonster,
    addCustom: addCustom,
    applyDamage: applyDamage,
    applyHeal: applyHeal,
    settleXP: settleXP
  };
  DnD.CombatUI = { init: init };
})(window);
