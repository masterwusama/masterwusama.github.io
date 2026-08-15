/* =========================================================
 * 跑团桌 · 文字冒险引擎 (de-engine.js)
 * 通用节点式剧情引擎：状态 / 技能检定 / 思维内阁 / 双槽生存 / 存档 / 结局
 * 剧本数据：de-story-d1.js 等（注册到 DnD.DE_SCRIPTS，按 day 合并）
 * ========================================================= */
(function (global) {
  'use strict';

  var DnD = global.DnD = global.DnD || {};

  var SAVE_KEY = 'dnd_de_save_';
  var SAVE_SLOTS = 3;
  var ROOT_ID = 'de-root';

  var DE = {};        /* 模块命名空间（内部用） */
  DE.skills = DnD.DE_SKILLS || [];
  DE.groups = DnD.DE_GROUPS || { 智力: '#e0675c', 精神: '#a97fd8', 体格: '#5fa86a', 运动: '#d9a441' };
  DE.thoughts = DnD.DE_THOUGHTS || [];
  DE.items = DnD.DE_ITEMS || [];
  DE.bestiary = DnD.DE_BESTIARY || [];
  DE.npcs = DnD.DE_NPCS || [];

  var state = null;   /* 当前游戏状态 */
  var node = null;    /* 当前场景节点 */
  var root = null;    /* 容器 */
  var busy = false;   /* 检定/过渡期间锁 */

  /* ---------- 工具 ---------- */
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
  function findNode(id) {
    for (var i = 0; i < (DnD.DE_SCRIPTS || []).length; i++) {
      var sc = DnD.DE_SCRIPTS[i].scenes;
      if (sc && sc[id]) return sc[id];
    }
    return null;
  }
  function startSceneId() {
    for (var i = 0; i < (DnD.DE_SCRIPTS || []).length; i++) {
      if (DnD.DE_SCRIPTS[i].start) return DnD.DE_SCRIPTS[i].start;
    }
    return null;
  }
  function skillColor(name) {
    for (var i = 0; i < DE.skills.length; i++) {
      if (DE.skills[i].name === name) return DE.groups[DE.skills[i].group] || '#d4af37';
    }
    return '#d4af37';
  }
  function skillInfo(name) {
    for (var i = 0; i < DE.skills.length; i++) if (DE.skills[i].name === name) return DE.skills[i];
    return null;
  }
  /* 属性值（技能基础值 = 所属属性） */
  function attrVal(group) { return (state.attrs || {})[group] || 1; }
  /* 装备加成（穿在身上的服装 bonus 之和） */
  function gearBonus(name) {
    var b = 0;
    var eq = state.equip || {};
    for (var k in eq) {
      if (!eq[k]) continue;
      var info = itemInfo(eq[k]);
      if (info && info.bonus && info.bonus[name]) b += info.bonus[name];
    }
    return b;
  }
  /* 醉酒惩罚 */
  function drunkPenalty() {
    if (state.drunk >= 8) return -2;
    if (state.drunk >= 5) return -1;
    return 0;
  }
  function skillVal(name) {
    var v = attrVal((skillInfo(name) || {}).group) + gearBonus(name) + ((state.skills || {})[name] || 0) + drunkPenalty();
    return v;
  }
  function itemInfo(name) {
    for (var i = 0; i < DE.items.length; i++) if (DE.items[i].name === name) return DE.items[i];
    return null;
  }
  function thoughtInfo(name) {
    for (var i = 0; i < DE.thoughts.length; i++) if (DE.thoughts[i].name === name) return DE.thoughts[i];
    return null;
  }

  /* ---------- 新游戏 ---------- */
  /* 属性驱动：4 组属性（智力/精神/体格/运动）决定组内 6 技能的基础值。
     开局 12 点分配（每属性至少 1、至多 6），state.skills 仅存额外点（skillup/思维）。 */
  function newState(attrs, name) {
    var s = {
      v: 2,
      name: (typeof name === 'string' && name) ? name : '？？？',  /* 失忆开局：名字未知，待剧本解锁 */
      job: '？？？',  /* 失忆开局：身份未知（金确认公民武装后解锁） */
      place: '？？？',  /* 失忆开局：地名未知（走廊日历解锁） */
      attrs: attrs || { 智力: 1, 精神: 1, 体格: 1, 运动: 1 },
      skills: {},
      equip: { 颈: null, 衣: null, 裤: null, 脚: null, 手: null },
      hp: 20, hpMax: 20,
      morale: 20, moraleMax: 20,
      drunk: 0,
      day: 1, hour: 9,
      money: 0,
      items: [],
      thoughts: {},   /* name -> {stage:'locked'|'doing'|'done', need, prog} */
      flags: {},
      history: [],
      ending: null
    };
    return s;
  }

  /* 旧存档兼容：补齐 attrs / equip / skills 字段 */
  function normalizeState(s) {
    if (!s) return s;
    if (!s.attrs) s.attrs = { 智力: 2, 精神: 2, 体格: 2, 运动: 2 };
    if (!s.equip) s.equip = { 颈: null, 衣: null, 裤: null, 脚: null, 手: null };
    if (!s.skills) s.skills = {};
    if (!s.job) s.job = '？？？';
    if (!s.place) s.place = '？？？';
    return s;
  }

  function startNew(attrs, name) {
    if (!attrs) { showAlloc(); return; }   /* 无分配数据 → 打开属性分配弹层 */
    state = newState(attrs, name);
    gotoId(startSceneId());
  }

  /* ---------- 时间 ---------- */
  function timeStr() {
    var h = Math.floor(state.hour);
    var m = Math.round((state.hour - h) * 60);
    return '第 ' + state.day + ' 天 · ' + pad(h) + ':' + pad(m);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function advanceTime(h) {
    state.hour += h;
    var over = Math.floor(state.hour / 24);
    if (over > 0) { state.day += over; state.hour = state.hour % 24; }
    /* 思维内阁内化进度 */
    Object.keys(state.thoughts).forEach(function (k) {
      var t = state.thoughts[k];
      if (t.stage === 'doing') {
        t.prog += h;
        if (t.prog >= t.need) {
          t.stage = 'done';
          var info = thoughtInfo(k);
          if (info && info.effect) applySkillEffects(info.effect);
          pushLog('思维内阁：『' + k + '』已完成内化' + (info && info.effect ? '，获得加成' : ''));
        }
      }
    });
  }

  /* ---------- 效果 ---------- */
  /* 额外点可为负（思维副作用/换装惩罚），下限 = 抵消该技能属性值（总值不为负） */
  function applySkillEffects(ef) {
    if (!ef) return;
    Object.keys(ef).forEach(function (k) {
      var info = skillInfo(k);
      var floor = info ? -attrVal(info.group) : -99;
      var v = (state.skills[k] || 0) + ef[k];
      state.skills[k] = v < floor ? floor : v;
    });
  }
  function applyEffect(ef) {
    if (!ef) return;
    if (ef.hp) { state.hp += ef.hp; if (state.hp > state.hpMax) state.hp = state.hpMax; }
    if (ef.morale) { state.morale += ef.morale; if (state.morale > state.moraleMax) state.morale = state.moraleMax; }
    if (ef.money) state.money += ef.money;
    if (ef.time) advanceTime(ef.time);
    if (ef.drunk) { state.drunk += ef.drunk; if (state.drunk < 0) state.drunk = 0; if (state.drunk > 10) state.drunk = 10; }
    if (ef.item) { if (state.items.indexOf(ef.item) === -1) state.items.push(ef.item); }
    if (ef.equip) {
      var eqInfo = itemInfo(ef.equip);
      if (eqInfo && eqInfo.slot) state.equip[eqInfo.slot] = ef.equip;  /* 剧本自动穿上（物品仍在背包） */
    }
    if (ef.lose) {
      var i = state.items.indexOf(ef.lose);
      if (i > -1) state.items.splice(i, 1);
    }
    if (ef.flag) {
      (Array.isArray(ef.flag) ? ef.flag : [ef.flag]).forEach(function (f) { state.flags[f] = true; });
    }
    if (ef.unflag) {
      (Array.isArray(ef.unflag) ? ef.unflag : [ef.unflag]).forEach(function (f) { state.flags[f] = false; });
    }
    if (ef.skillup) applySkillEffects(ef.skillup);
    if (ef.thought) unlockThought(ef.thought);
    if (ef.name) state.name = ef.name;  /* 解锁玩家名字（失忆开局：翻笔记本/自报姓名/被同事点名） */
    if (ef.job) state.job = ef.job;  /* 解锁身份（金确认公民武装身份） */
    if (ef.place) state.place = ef.place;  /* 解锁地名（走廊日历） */
  }

  function unlockThought(name) {
    if (state.thoughts[name]) return;
    var info = thoughtInfo(name);
    if (!info) return;
    state.thoughts[name] = { stage: 'locked', need: info.need || 2, prog: 0 };
    pushLog('思维内阁：新想法『' + name + '』出现（可内化）');
  }

  function internalizeThought(name) {
    var t = state.thoughts[name];
    if (!t || t.stage !== 'locked') return;
    var info = thoughtInfo(name);
    t.stage = 'doing';
    t.prog = 0;
    /* 解锁副作用立即生效（如果有） */
    if (info && info.penalty) applySkillEffects(info.penalty);
    pushLog('思维内阁：开始内化『' + name + '』（约 ' + t.need + ' 小时）');
  }

  /* ---------- 条件 ---------- */
  function condOk(expr) {
    if (!expr) return true;
    return expr.split('&&').every(function (c) { return condOne(c.trim()); });
  }
  function condOne(c) {
    if (c.indexOf('!flag:') === 0) return !state.flags[c.slice(6)];
    if (c.indexOf('flag:') === 0) return !!state.flags[c.slice(5)];
    if (c.indexOf('!item:') === 0) return state.items.indexOf(c.slice(6)) === -1;
    if (c.indexOf('item:') === 0) return state.items.indexOf(c.slice(5)) > -1;
    if (c.indexOf('money>=') === 0) return state.money >= Number(c.slice(7));
    if (c.indexOf('skill:') === 0) {
      var m = c.slice(6).match(/^(.+?)(>=|<=|>|<)(\d+)$/);
      if (m) {
        var v = skillVal(m[1]);   /* 条件对照技能总值（属性+装备+额外点+醉酒），而非仅额外点 */
        var n = Number(m[3]);
        return m[2] === '>=' ? v >= n : m[2] === '<=' ? v <= n : m[2] === '>' ? v > n : v < n;
      }
    }
    return false;
  }

  /* ---------- 检定 ---------- */
  /* 技能值分解：属性(基础) + 装备 + 额外点 + 醉酒惩罚 */
  function checkParts(skill) {
    var info = skillInfo(skill);
    return {
      attr: info ? attrVal(info.group) : 0,
      gear: gearBonus(skill),
      extra: (state.skills || {})[skill] || 0,
      drunk: drunkPenalty()
    };
  }

  /* ---------- 被动检定 ---------- */
  /* [技能] 叙述段与 pcheck 选项共用：渲染节点时掷一次，同节点同技能共享结果（装备/想法变化后重新渲染会重掷） */
  var PASSIVE_DC = 12;   /* 被动检定统一难度 */
  function passiveResult(skill) {
    if (state.passive && state.passive[skill]) return state.passive[skill];
    var p = checkParts(skill);
    var base = p.attr + p.gear + p.extra + p.drunk;
    var roll = DnD.Dice.rollDie(20);
    var r = { skill: skill, roll: roll, parts: p, base: base, total: roll + base, dc: PASSIVE_DC, ok: roll + base >= PASSIVE_DC };
    if (!state.passive) state.passive = {};
    state.passive[skill] = r;
    return r;
  }
  function doCheck(check, okCb, failCb) {
    var p = checkParts(check.skill);
    var base = p.attr + p.gear + p.extra + p.drunk;
    var roll = DnD.Dice.rollDie(20);
    var total = roll + base;
    var ok = total >= check.dc;
    /* 检定失败可携带 fail_flag：剧本用它锁定后续分支（cond: '!flag:xxx'），失败即错过 */
    if (!ok && check.fail_flag) state.flags[check.fail_flag] = true;
    renderCheck(check.skill, roll, p, total, check.dc, ok);
    setTimeout(function () {
      pushLog((ok ? '✓ ' : '✗ ') + check.skill + '检定 ' + total + '/' + check.dc + (ok ? ' 成功' : ' 失败'));
      if (ok) okCb(); else failCb();
    }, 1400);
  }

  /* ---------- 节点流转 ---------- */
  function pickChoice(c) {
    if (busy || !c) return;
    busy = true;
    if (c.effect) {
      applyEffect(c.effect);
      pushLog(effectLog(c.effect));
      if (checkDeath()) return;
    }
    if (c.check) {
      doCheck(c.check, function () { busy = false; gotoId(c.success); }, function () { busy = false; gotoId(c.fail); });
    } else {
      busy = false;
      gotoId(c.goto);
    }
  }

  function effectLog(ef) {
    var parts = [];
    if (ef.hp) parts.push(ef.hp > 0 ? '+' + ef.hp + ' HP' : ef.hp + ' HP');
    if (ef.morale) parts.push(ef.morale > 0 ? '+' + ef.morale + ' 士气' : ef.morale + ' 士气');
    if (ef.money) parts.push(ef.money > 0 ? '+' + ef.money + ' 元' : ef.money + ' 元');
    if (ef.drunk) parts.push('醉酒 ' + (ef.drunk > 0 ? '+' : '') + ef.drunk);
    if (ef.item) parts.push('获得『' + ef.item + '』');
    if (ef.lose) parts.push('失去『' + ef.lose + '』');
    if (ef.time) parts.push('时间 +' + ef.time + ' 小时');
    if (ef.job) parts.push('身份解锁：' + ef.job);
    if (ef.place) parts.push('地名解锁：' + ef.place);
    return parts.length ? parts.join('，') : '';
  }

  function gotoId(id) {
    if (id === 'RESTART') { startNew(); return; }
    var n = findNode(id);
    if (!n) { renderError('缺少场景节点：' + id); return; }
    node = n;
    state.lastNode = id;
    if (n.day) state.day = n.day;
    if (n.hour != null) state.hour = n.hour;
    if (n.onEnter) applyEffect(n.onEnter);
    if (checkDeath()) return;
    if (n.ending) { state.ending = n.title; render(); renderEndingModal(n.title); return; }
    pushScene(n);
    localStorage.setItem(SAVE_KEY + 'auto', JSON.stringify(state));   /* 每步自动存档：刷新页面可继续 */
    render();
  }

  function checkDeath() {
    if (state.hp <= 0) {
      state.ending = 'END_HP';
      pushLog('你的生命耗尽了。');
      renderEndingModal('死亡 · 酒与海的尽头');
      return true;
    }
    if (state.morale <= 0) {
      state.ending = 'END_MORALE';
      pushLog('你的精神崩溃了。');
      renderEndingModal('精神崩溃 · 意识熄灭');
      return true;
    }
    return false;
  }

  function endGame(id, title, text, lows) {
    state.ending = id;
    renderEnding(title, text);
    return true;
  }

  /* ---------- 日志 ---------- */
  function pushLog(msg) {
    state.history.push(msg);
    if (state.history.length > 60) state.history.shift();
  }
  function pushScene(n) {
    state.history.push('[场景] ' + n.title);
    if (state.history.length > 60) state.history.shift();
  }

  /* ---------- 文本渲染 ---------- */
  function renderTextInto(box, text) {
    var paras = Array.isArray(text) ? text : String(text).split(/\n{2,}/);
    paras.forEach(function (raw) {
      var p = raw.replace(/\n/g, ' ');
      var m = p.match(/^\[([^\]]+)\]\s*(.*)$/);
      var paraEl;
      if (m && skillColor(m[1]) !== '#d4af37') {
        /* 被动检定：技能叙述段掷被动检定，通过才揭示内容；失败留一条检定记录不显示内容。
           【成功】【失败】为主动检定结果段，原样展示不重掷 */
        if (m[2].indexOf('【') === 0) {
          paraEl = el('p', 'de-skill-line');
          paraEl.style.color = skillColor(m[1]);
          paraEl.innerHTML = '<span class="de-skill-tag">' + esc(m[1]) + '</span> ' + esc(m[2]);
        } else {
          var pr = passiveResult(m[1]);
          if (pr.ok) {
            paraEl = el('p', 'de-skill-line');
            paraEl.style.color = skillColor(m[1]);
            paraEl.innerHTML = '<span class="de-skill-tag">' + esc(m[1]) + '</span> ' + esc(m[2]);
          } else {
            paraEl = el('p', 'de-passive-fail', '✗ ' + esc(m[1]) + ' 被动检定失败 · d20 ' + pr.roll + ' + ' + pr.base + ' = ' + pr.total + ' / DC ' + pr.dc);
          }
        }
      } else if (p.indexOf('「') === 0 || p.indexOf('『') === 0) {
        paraEl = el('p', 'de-dialog');
        paraEl.textContent = p;
      } else {
        paraEl = el('p', 'de-para');
        paraEl.textContent = p;
      }
      box.appendChild(paraEl);
    });
  }

  /* ---------- 渲染 ---------- */
  function render() {
    if (!root) return;
    root.innerHTML = '';
    if (!state) { renderWelcome(); return; }
    state.passive = {};   /* 渲染即重掷被动检定（同节点同技能共享一次结果） */
    if (!node) { renderWelcome(); return; }
    root.appendChild(renderStatus());
    if (state.ending) { renderEndingInto(root, state.ending); return; }
    if (node) {
      var story = el('div', 'de-story');
      var head = el('div', 'de-node-head');
      head.innerHTML = '<span class="de-node-title">' + esc(node.title) + '</span>'
        + '<span class="de-node-time">' + timeStr() + '</span>';
      story.appendChild(head);
      var box = el('div', 'de-text');
      renderTextInto(box, node.text);
      story.appendChild(box);
      root.appendChild(story);

      var choices = el('div', 'de-choices');
      (node.choices || []).forEach(function (c) {
        if (!condOk(c.cond)) return;
        if (c.pcheck && !passiveResult(c.pcheck).ok) return;   /* 被动检定选项：检定未过不出现（失败信息已在文本流留痕） */
        var b = el('button', 'de-choice' + (c.check ? ' has-check' : ''), esc(c.text));
        if (c.check) {
          var tip = el('span', 'de-check-tip', esc(c.check.skill) + ' · DC ' + c.check.dc + ' · 当前 ' + skillVal(c.check.skill));
          b.appendChild(tip);
        }
        b.addEventListener('click', function () { pickChoice(c); });
        choices.appendChild(b);
      });
      if (!node.choices || !node.choices.length) {
        choices.appendChild(el('p', 'dnd-hint', '（等待自动推进…）'));
      }
      root.appendChild(choices);

      root.appendChild(renderSidebar());
    }
  }

  function renderStatus() {
    var bar = el('div', 'de-status');
    var hpPct = Math.max(0, Math.min(100, state.hp / state.hpMax * 100));
    var moPct = Math.max(0, Math.min(100, state.morale / state.moraleMax * 100));
    bar.innerHTML = '<span class="de-st-name">' + esc(state.name) + '</span>'
      + '<span class="de-st-id" title="身份 · 地点">' + esc(state.job || '？？？') + ' · ' + esc(state.place || '？？？') + '</span>'
      + '<span class="de-st-hp" title="生命值">❤ ' + state.hp + '/' + state.hpMax + '</span>'
      + '<span class="de-st-mo" title="士气">◈ ' + state.morale + '/' + state.moraleMax + '</span>'
      + '<span class="de-st-time">' + timeStr() + '</span>'
      + '<span class="de-st-money" title="货币">¢ ' + state.money + '</span>'
      + (state.drunk > 0 ? '<span class="de-st-drunk">🍺 ' + state.drunk + '</span>' : '')
      + '<span class="de-st-btns">'
      + '<button type="button" class="de-st-btn" id="de-btn-attr">属性</button>'
      + '<button type="button" class="de-st-btn" id="de-btn-bag">背包</button>'
      + '<button type="button" class="de-st-btn" id="de-btn-think">思维</button>'
      + '<button type="button" class="de-st-btn" id="de-btn-log">日志</button>'
      + '<button type="button" class="de-st-btn" id="de-btn-save">存档</button>'
      + '</span>';
    bar.querySelector('#de-btn-attr').addEventListener('click', openAttrs);
    bar.querySelector('#de-btn-bag').addEventListener('click', openBag);
    bar.querySelector('#de-btn-think').addEventListener('click', openThoughts);
    bar.querySelector('#de-btn-log').addEventListener('click', openLog);
    bar.querySelector('#de-btn-save').addEventListener('click', openSave);
    return bar;
  }

  function renderSidebar() {
    var side = el('div', 'de-side');
    /* 最近日志 */
    var log = el('div', 'de-log');
    log.appendChild(el('div', 'de-log-title', '记录'));
    var recent = state.history.slice(-8).reverse();
    recent.forEach(function (m) { log.appendChild(el('div', 'de-log-line', esc(m))); });
    side.appendChild(log);
    return side;
  }

  /* ---------- 检定弹层 ---------- */
  function renderCheck(skill, roll, p, total, dc, ok) {
    var mask = el('div', 'de-mask');
    mask.addEventListener('click', function () { mask.remove(); });
    var box = el('div', 'de-check-pop');
    box.style.borderColor = skillColor(skill);
    var parts = 'd20 = <b>' + roll + '</b>';
    if (p.attr) parts += ' + ' + p.attr + ' <i>属性</i>';
    if (p.gear) parts += ' + ' + p.gear + ' <i>装备</i>';
    if (p.extra) parts += (p.extra > 0 ? ' + ' : ' ') + p.extra + ' <i>其他</i>';
    if (p.drunk) parts += ' <i>' + p.drunk + ' 醉酒</i>';
    box.innerHTML = '<div class="de-check-skill" style="color:' + skillColor(skill) + '">' + esc(skill) + '</div>'
      + '<div class="de-check-dice">' + parts + '</div>'
      + '<div class="de-check-total">' + total + ' <i>/ DC ' + dc + '</i></div>'
      + '<div class="de-check-result ' + (ok ? 'ok' : 'no') + '">' + (ok ? '检定成功' : '检定失败') + '</div>';
    mask.appendChild(box);
    document.body.appendChild(mask);
    setTimeout(function () { mask.remove(); }, 1500);
  }

  /* ---------- 背包 / 装备 ---------- */
  var EQUIP_SLOTS = ['颈', '衣', '裤', '脚', '手'];
  function openBag() {
    var m = modal('背包 · 装备');
    /* 装备栏 */
    var eq = el('div', 'de-equip');
    eq.appendChild(el('div', 'de-equip-title', '装备栏'));
    EQUIP_SLOTS.forEach(function (slot) {
      var name = (state.equip || {})[slot];
      var row = el('div', 'de-equip-row');
      row.innerHTML = '<span class="de-equip-slot">' + slot + '</span>'
        + '<span class="de-equip-name">' + (name ? esc(name) : '空') + '</span>';
      if (name) {
        var btn = el('button', 'dnd-btn dnd-btn-sm', '脱下');
        btn.addEventListener('click', function () { unequip(slot); m.close(); openBag(); });
        row.appendChild(btn);
      }
      eq.appendChild(row);
    });
    m.body.appendChild(eq);
    /* 物品列表 */
    if (!state.items.length) {
      m.body.appendChild(el('p', 'dnd-hint', '空空如也。'));
    } else {
      state.items.forEach(function (n) {
        var info = itemInfo(n);
        var card = el('div', 'de-item-card');
        var meta = info ? (info.type || '') + (info.slot ? ' · ' + info.slot + '槽' : '') : '';
        card.innerHTML = '<div class="de-item-name">' + esc(n)
          + (meta ? '<span class="de-item-meta">' + esc(meta) + '</span>' : '') + '</div>'
          + '<div class="de-item-desc">' + esc(info ? info.desc : '') + '</div>';
        if (info && info.bonus) {
          card.appendChild(el('div', 'de-item-fx', '加成：' + Object.keys(info.bonus).map(function (k) {
            return k + (info.bonus[k] > 0 ? '+' : '') + info.bonus[k];
          }).join('，')));
        }
        if (info && info.slot) {
          var worn = (state.equip || {})[info.slot] === n;
          var wbtn = el('button', 'dnd-btn dnd-btn-sm de-item-btn', worn ? '已装备' : '穿上');
          if (worn) { wbtn.disabled = true; wbtn.className += ' is-worn'; }
          else { wbtn.addEventListener('click', function () { equip(info.slot, n); m.close(); openBag(); }); }
          card.appendChild(wbtn);
        }
        if (info && info.use) {
          var ubtn = el('button', 'dnd-btn dnd-btn-sm de-item-btn', '使用');
          ubtn.addEventListener('click', function () { useItem(n); });
          card.appendChild(ubtn);
        }
        m.body.appendChild(card);
      });
    }
  }

  function equip(slot, itemName) {
    state.equip[slot] = itemName;   /* 物品始终留在背包，装备栏为独立状态指示 */
    pushLog('装备了『' + itemName + '』');
    render();
  }

  function unequip(slot) {
    var eq = state.equip;
    if (eq[slot]) {
      pushLog('脱下了『' + eq[slot] + '』');
      eq[slot] = null;
      render();
    }
  }

  function useItem(name) {
    var info = itemInfo(name);
    if (!info || !info.use) return;
    applyEffect(info.use);
    var i = state.items.indexOf(name);
    if (i > -1) state.items.splice(i, 1);
    pushLog('使用了『' + name + '』');
    if (checkDeath()) return;
    render();
    openBag();
  }

  /* ---------- 属性栏 ---------- */
  function openAttrs() {
    var m = modal('属性 · 技能');
    ['智力', '精神', '体格', '运动'].forEach(function (g) {
      var gEl = el('div', 'de-attr-group');
      gEl.style.borderColor = DE.groups[g] || '#d4af37';
      var head = el('div', 'de-attr-head');
      head.innerHTML = '<span style="color:' + (DE.groups[g] || '#d4af37') + '">' + g + '</span><b>' + attrVal(g) + '</b>';
      gEl.appendChild(head);
      DE.skills.forEach(function (sk) {
        if (sk.group !== g) return;
        var p = checkParts(sk.name);
        var row = el('div', 'de-attr-skill');
        var parts = '属性 ' + p.attr;
        if (p.gear) parts += ' · 装备 +' + p.gear;
        if (p.extra) parts += ' · 其他 ' + (p.extra > 0 ? '+' : '') + p.extra;
        if (p.drunk) parts += ' · 醉酒 ' + p.drunk;
        row.innerHTML = '<span>' + esc(sk.name) + '</span><b>' + (p.attr + p.gear + p.extra + p.drunk) + '</b><i>' + esc(parts) + '</i>';
        gEl.appendChild(row);
      });
      m.body.appendChild(gEl);
    });
    m.body.appendChild(el('p', 'de-save-tip', '技能值 = 属性 + 装备加成 + 思维/技能点 + 醉酒惩罚。检定掷 d20 + 技能值，≥ DC 即成功。'));
  }

  /* ---------- 属性分配（新游戏） ---------- */
  var ALLOC_TOTAL = 12, ALLOC_MIN = 1, ALLOC_MAX = 6;
  function showAlloc() {
    var m = modal('构建你的警探 · 属性分配');
    var pts = { 智力: 1, 精神: 1, 体格: 1, 运动: 1 };
    var left = ALLOC_TOTAL - 4;
    var leftEl = el('div', 'de-alloc-left', '剩余点数：' + left);
    var okBtn = el('button', 'dnd-btn dnd-btn-gold', '开始调查');
    okBtn.disabled = true;
    ['智力', '精神', '体格', '运动'].forEach(function (g) {
      var row = el('div', 'de-alloc-row');
      var nameEl = el('span', 'de-alloc-name', g);
      nameEl.style.color = DE.groups[g] || '#d4af37';
      var valEl = el('b', 'de-alloc-val', String(pts[g]));
      var minus = el('button', 'dnd-btn dnd-btn-sm', '−');
      var plus = el('button', 'dnd-btn dnd-btn-sm', '+');
      var skEl = el('span', 'de-alloc-skills', DE.skills.filter(function (s) { return s.group === g; })
        .map(function (s) { return s.name; }).join(' · '));
      row.appendChild(nameEl); row.appendChild(minus); row.appendChild(valEl); row.appendChild(plus); row.appendChild(skEl);
      m.body.appendChild(row);
      var refresh = function () {
        valEl.textContent = pts[g];
        minus.disabled = pts[g] <= ALLOC_MIN;
        plus.disabled = pts[g] >= ALLOC_MAX || left <= 0;
        okBtn.disabled = left > 0;
        leftEl.textContent = '剩余点数：' + left;
      };
      minus.addEventListener('click', function () { if (pts[g] > ALLOC_MIN) { pts[g]--; left++; refresh(); } });
      plus.addEventListener('click', function () { if (pts[g] < ALLOC_MAX && left > 0) { pts[g]++; left--; refresh(); } });
      refresh();
    });
    okBtn.addEventListener('click', function () { m.close(); startNew(pts); });
    m.body.appendChild(leftEl);
    m.body.appendChild(okBtn);
    m.body.appendChild(el('p', 'de-save-tip', '4 项属性决定 24 项技能的等级（技能值 = 属性）。共 12 点，每项至少 1、至多 6。'));
  }

  /* ---------- 思维内阁 ---------- */
  function openThoughts() {
    var m = modal('思维内阁');
    var list = Object.keys(state.thoughts);
    if (!list.length) {
      m.body.appendChild(el('p', 'dnd-hint', '尚未出现任何想法。去经历一些事吧。'));
    } else {
      list.forEach(function (name) {
        var t = state.thoughts[name];
        var info = thoughtInfo(name);
        var card = el('div', 'de-thought-card');
        var stText = t.stage === 'locked' ? '待内化' : t.stage === 'doing' ? '内化中 ' + Math.floor(t.prog) + '/' + t.need + ' 小时' : '已内化';
        card.innerHTML = '<div class="de-thought-head">' + esc(name)
          + '<span class="de-thought-stage s-' + t.stage + '">' + stText + '</span></div>'
          + '<div class="de-thought-desc">' + esc(info ? info.desc : '') + '</div>';
        if (info && info.effect) {
          card.appendChild(el('div', 'de-thought-fx', '内化加成：' + Object.keys(info.effect).map(function (k) {
            return k + (info.effect[k] > 0 ? '+' : '') + info.effect[k];
          }).join('，')));
        }
        if (t.stage === 'locked') {
          var btn = el('button', 'dnd-btn dnd-btn-sm de-thought-btn', '开始内化');
          btn.addEventListener('click', function () { internalizeThought(name); m.close(); openThoughts(); });
          card.appendChild(btn);
        }
        m.body.appendChild(card);
      });
    }
  }

  /* ---------- 日志 ---------- */
  function openLog() {
    var m = modal('事件记录');
    state.history.slice().reverse().forEach(function (h) {
      m.body.appendChild(el('div', 'de-log-line', esc(h)));
    });
  }

  /* ---------- 存档 ---------- */
  function openSave() {
    var m = modal('存档 / 读档');
    for (var i = 1; i <= SAVE_SLOTS; i++) {
      (function (slot) {
        var raw = localStorage.getItem(SAVE_KEY + slot);
        var line = el('div', 'de-save-row');
        var parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = null; }
        var info = parsed
          ? ((typeof parsed.name === 'string' && parsed.name) ? parsed.name : '？？？') + ' · 第' + parsed.day + '天 ' + parsed.hour + '时'
          : '空';
        line.innerHTML = '<span>槽位 ' + slot + '：' + esc(info) + '</span>'
          + '<button type="button" class="dnd-btn dnd-btn-sm" data-a="save">存</button>'
          + '<button type="button" class="dnd-btn dnd-btn-sm" data-a="load"' + (raw ? '' : ' disabled') + '>读</button>';
        line.querySelector('[data-a="save"]').addEventListener('click', function () {
          saveGame(slot);
          m.close();
          render();
        });
        line.querySelector('[data-a="load"]').addEventListener('click', function () {
          loadGame(slot);
          m.close();
          render();
        });
        m.body.appendChild(line);
      })(i);
    }
    m.body.appendChild(el('p', 'de-save-tip', '提示：游戏会自动记住最近一次操作，刷新页面可继续。'));
  }

  function saveGame(slot) {
    localStorage.setItem(SAVE_KEY + slot, JSON.stringify(state));
    localStorage.setItem(SAVE_KEY + 'auto', JSON.stringify(state));
  }
  function loadGame(slot) {
    var raw = localStorage.getItem(SAVE_KEY + slot);
    if (!raw) return;
    try { state = JSON.parse(raw); } catch (e) { return; }
    state = normalizeState(state);
    if (typeof state.name !== 'string' || !state.name) state.name = '？？？';
    node = state.lastNode ? findNode(state.lastNode) : null;
    if (!node) node = findNode(startSceneId());
    localStorage.setItem(SAVE_KEY + 'auto', JSON.stringify(state));   /* 读档后同步自动存档，刷新不丢进度 */
  }

  /* ---------- 结局 ---------- */
  function renderError(msg) {
    console.error('[DE] ' + msg);
    if (root) {
      var b = el('div', 'de-error', msg);
      b.style.cssText = 'padding:12px;color:#f55;border:1px solid #f55;margin:8px;font-family:monospace;';
      root.appendChild(b);
    }
  }

  function endGame(id, title, text, lows) {
    state.ending = id;
    renderEndingModal(title);
    return true;
  }

  function renderEndingModal(title) {
    var m = modal('结局 · ' + title);
    m.box.className = 'de-modal de-end-modal';
    m.body.innerHTML = '<div class="de-end-title">' + esc(title) + '</div>'
      + '<div class="de-end-stat">第 ' + state.day + ' 天 ' + pad(Math.floor(state.hour)) + ':' + pad(Math.round((state.hour % 1) * 60))
      + ' · 金钱 ¢' + state.money
      + ' · 内化思维 ' + Object.keys(state.thoughts).filter(function (k) { return state.thoughts[k].stage === 'done'; }).length + ' 个'
      + ' · 关键抉择 ' + Object.keys(state.flags).length + ' 项</div>'
      + '<button type="button" class="dnd-btn dnd-btn-gold" id="de-end-restart">重新开始</button>';
    m.body.querySelector('#de-end-restart').addEventListener('click', function () {
      localStorage.removeItem(SAVE_KEY + 'auto');
      m.close();
      startNew();
    });
  }
  function renderEndingInto(box, title) {
    box.appendChild(el('div', 'de-ending-box', '（结局：' + esc(title) + '）'));
  }

  function renderWelcome() {
    var box = el('div', 'de-welcome');
    box.innerHTML = '<div class="de-welcome-badge">🎲</div>'
      + '<div class="de-welcome-title">极乐迪斯科</div>'
      + '<div class="de-welcome-sub">一款极乐迪斯科风格的文字冒险 · 基于 D&D 5e 骰子引擎</div>'
      + '<div class="de-welcome-desc">'
      + '<p>你在褴褛飞旋旅店的房间里醒来：宿醉、头疼，脑子里像被人擦掉了一块。你叫什么名字？你是什么人？——想不起来。雾里的码头上，有一具尸体吊在树上，等你三天了。</p>'
      + '<p>· 24 项技能检定 · 思维内阁 · HP/士气双槽生存 · 多结局</p>'
      + '</div>'
      + '<div class="de-welcome-actions">'
      + '<button type="button" class="dnd-btn dnd-btn-gold" id="de-welcome-start">睁开眼睛</button>'
      + '<button type="button" class="dnd-btn" id="de-welcome-load">读取存档</button>'
      + '</div>';
    box.querySelector('#de-welcome-start').addEventListener('click', function () { startNew(); });
    box.querySelector('#de-welcome-load').addEventListener('click', openSave);
    root.appendChild(box);
  }
  
  /* ---------- 状态栏 ---------- */
  var curModal = null;   /* 当前打开的弹层（新弹层打开前自动关闭旧弹层，避免叠加） */
  function modal(title) {
    if (curModal) curModal.close();
    var mask = el('div', 'de-mask');
    var box = el('div', 'de-modal');
    box.innerHTML = '<div class="de-modal-head">' + esc(title) + '<span class="de-modal-x">✕</span></div>'
      + '<div class="de-modal-body"></div>';
    var body = box.querySelector('.de-modal-body');
    var ret = { box: box, body: body, close: function () { mask.remove(); if (curModal === ret) curModal = null; } };
    box.querySelector('.de-modal-x').addEventListener('click', function () { ret.close(); });
    mask.appendChild(box);
    document.body.appendChild(mask);
    curModal = ret;
    return ret;
  }

  /* ---------- 初始化 ---------- */
  function init() {
    root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.innerHTML = '';

    /* 剧本装配：de-story-d1~d4.js 按加载顺序注册，合并为 DE_SCRIPTS */
    if (!DnD.DE_SCRIPTS) {
      DnD.DE_SCRIPTS = [DnD.DE_DAY1, DnD.DE_DAY2, DnD.DE_DAY3, DnD.DE_DAY4].filter(Boolean);
    }

    /* 自动存档恢复（损坏数据容错） */
    var auto = null;
    try {
      var raw = localStorage.getItem(SAVE_KEY + 'auto');
      auto = raw ? JSON.parse(raw) : null;
    } catch (e) { auto = null; }
    if (auto && auto.ending == null) {
      state = normalizeState(JSON.parse(auto));
      node = findNode(state.lastNode);
      if (!node) node = findNode(startSceneId());
      render();
      return;
    }
    state = newState();
    node = null;
    render();
  }

  DnD.TextAdv = {
    init: init,
    startNew: startNew,
    getState: function () { return state; }
  };
})(window);
