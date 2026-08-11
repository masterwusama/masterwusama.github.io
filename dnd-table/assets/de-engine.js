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
  function skillVal(name) {
    var v = (state.skills || {})[name] || 0;
    if (state.drunk >= 5) v -= 1;   /* 醉酒 >4 全技能 -1 */
    if (state.drunk >= 8) v -= 1;
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
  function newState(name) {
    var s = {
      v: 1,
      name: (typeof name === 'string' && name) ? name : '？？？',  /* 失忆开局：名字未知，待剧本解锁 */
      skills: {},
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
    DE.skills.forEach(function (sk) { s.skills[sk.name] = sk.base || 1; });
    return s;
  }

  function startNew(name) {
    state = newState(name);
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
  function applySkillEffects(ef) {
    if (!ef) return;
    Object.keys(ef).forEach(function (k) {
      var v = (state.skills[k] || 0) + ef[k];
      state.skills[k] = v < 0 ? 0 : v;
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
        var v = state.skills[m[1]] || 0;
        var n = Number(m[3]);
        return m[2] === '>=' ? v >= n : m[2] === '<=' ? v <= n : m[2] === '>' ? v > n : v < n;
      }
    }
    return false;
  }

  /* ---------- 检定 ---------- */
  function doCheck(check, okCb, failCb) {
    var base = skillVal(check.skill);
    var roll = DnD.Dice.rollDie(20);
    var total = roll + base;
    var ok = total >= check.dc;
    renderCheck(check.skill, roll, base, total, check.dc, ok);
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
        paraEl = el('p', 'de-skill-line');
        paraEl.style.color = skillColor(m[1]);
        paraEl.innerHTML = '<span class="de-skill-tag">' + esc(m[1]) + '</span> ' + esc(m[2]);
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
    if (!state || !node) { renderWelcome(); return; }
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
        var b = el('button', 'de-choice' + (c.check ? ' has-check' : ''), esc(c.text));
        if (c.check) {
          var tip = el('span', 'de-check-tip', esc(c.check.skill) + '·DC ' + c.check.dc);
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
      + '<span class="de-st-hp" title="生命值">❤ ' + state.hp + '/' + state.hpMax + '</span>'
      + '<span class="de-st-mo" title="士气">◈ ' + state.morale + '/' + state.moraleMax + '</span>'
      + '<span class="de-st-time">' + timeStr() + '</span>'
      + '<span class="de-st-money" title="货币">¢ ' + state.money + '</span>'
      + (state.drunk > 0 ? '<span class="de-st-drunk">🍺 ' + state.drunk + '</span>' : '')
      + '<span class="de-st-btns">'
      + '<button type="button" class="de-st-btn" id="de-btn-bag">背包</button>'
      + '<button type="button" class="de-st-btn" id="de-btn-think">思维</button>'
      + '<button type="button" class="de-st-btn" id="de-btn-log">日志</button>'
      + '<button type="button" class="de-st-btn" id="de-btn-save">存档</button>'
      + '</span>';
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
  function renderCheck(skill, roll, base, total, dc, ok) {
    var mask = el('div', 'de-mask');
    mask.addEventListener('click', function () { mask.remove(); });
    var box = el('div', 'de-check-pop');
    box.style.borderColor = skillColor(skill);
    box.innerHTML = '<div class="de-check-skill" style="color:' + skillColor(skill) + '">' + esc(skill) + '</div>'
      + '<div class="de-check-dice">d20 = <b>' + roll + '</b>' + (base ? ' + ' + base : '') + '</div>'
      + '<div class="de-check-total">' + total + ' <i>/ DC ' + dc + '</i></div>'
      + '<div class="de-check-result ' + (ok ? 'ok' : 'no') + '">' + (ok ? '检定成功' : '检定失败') + '</div>';
    mask.appendChild(box);
    document.body.appendChild(mask);
    setTimeout(function () { mask.remove(); }, 1500);
  }

  /* ---------- 背包 ---------- */
  function openBag() {
    var m = modal('背包');
    if (!state.items.length) {
      m.body.appendChild(el('p', 'dnd-hint', '空空如也。'));
    } else {
      state.items.forEach(function (n) {
        var info = itemInfo(n);
        var card = el('div', 'de-item-card');
        card.innerHTML = '<div class="de-item-name">' + esc(n) + '</div>'
          + '<div class="de-item-desc">' + esc(info ? info.desc : '') + '</div>';
        m.body.appendChild(card);
      });
    }
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
    if (typeof state.name !== 'string' || !state.name) state.name = '？？？';
    node = state.lastNode ? findNode(state.lastNode) : null;
    if (!node) node = findNode(startSceneId());
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
      + '<div class="de-welcome-title">瑞瓦肖 · 极乐迪斯科</div>'
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
  function modal(title) {
    var mask = el('div', 'de-mask');
    var box = el('div', 'de-modal');
    box.innerHTML = '<div class="de-modal-head">' + esc(title) + '<span class="de-modal-x">✕</span></div>'
      + '<div class="de-modal-body"></div>';
    var body = box.querySelector('.de-modal-body');
    box.querySelector('.de-modal-x').addEventListener('click', function () { mask.remove(); });
    mask.appendChild(box);
    document.body.appendChild(mask);
    return { box: box, body: body, close: function () { mask.remove(); } };
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

    /* 自动存档恢复 */
    var auto = localStorage.getItem(SAVE_KEY + 'auto');
    if (auto && JSON.parse(auto).ending == null) {
      state = JSON.parse(auto);
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
