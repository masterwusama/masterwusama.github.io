/* battle.js - 回合制战斗场景（M2 核心）
 * 独立子状态机，由 core 的 battle 场景驱动 update/render。
 * 回合流程（§6.2）：敌我按有效敏捷排序 → 我方选指令（攻击/技能/道具/防御/逃跑）→
 *   逐个行动结算（伤害 = 攻×倍率×区间随机 − 防）→ 回合末结算状态效果（流血/中毒扣血、
 *   恐惧/黑暗扣精神，断臂封技能、断腿减速）→ 判定胜负。
 * 结束回调：胜利→ win 节点；战败→ lose 节点（濒死剧情，非直接 Game Over，§6.4）；逃跑→ 回探索。
 * 玩家 HP/SP 直接读写 G.Status（战斗内外同一份生存状态）。 */
(function (G) {
  'use strict';

  var B = {
    active: false,
    phase: 'menu',     // menu | target | log | over
    depth: 'main',     // main | skill | item（menu 阶段的子菜单）
    round: 1,
    player: null,
    enemies: [],
    queue: [],
    logs: [],
    defending: false,
    pending: null,     // {kind:'attack'|'skill', skill}
    outcome: null,     // win | lose | flee
    finished: false,   // 有结局且玩家已确认 → 交给 core 收尾
    winNode: null,
    loseNode: null,
    menuIdx: 0,
    subIdx: 0,
    _step: 0
  };

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ---------- 效果倍率工具（玩家用 G.Status.effects，敌人用自身 effects） ---------- */
  function effectRate(effects, key) {
    var r = 1;
    for (var id in effects) {
      var def = G.EFFECTS.get(id);
      if (def && typeof def[key] === 'number') r *= def[key];
    }
    return r;
  }
  function hasFlagEffect(effects, key) {
    for (var id in effects) {
      var def = G.EFFECTS.get(id);
      if (def && def[key]) return true;
    }
    return false;
  }
  function sumEffect(effects, key) {
    var s = 0;
    for (var id in effects) {
      var def = G.EFFECTS.get(id);
      if (def && typeof def[key] === 'number') s += def[key];
    }
    return s;
  }

  /* ---------- 战斗单位有效属性 ---------- */
  function playerAki() {
    var p = B.player;
    return p.attr.agi * effectRate(G.Status.effects, 'agiRate');
  }
  function playerAtk() {
    var p = B.player;
    return p.atk() * effectRate(G.Status.effects, 'atkRate');
  }
  function enemyDef(e) {
    var d = e.def;
    if (e.defDown && e.defDown.turns > 0) d -= e.defDown.amt;
    return Math.max(0, d);
  }
  function enemyAgi(e) { return e.agi * effectRate(e.effects, 'agiRate'); }

  /* ---------- 伤害结算 ---------- */
  function calcDamage(atk, def, power) {
    var raw = atk * power * rnd(0.85, 1.15);
    return Math.max(1, Math.round(raw - def));
  }

  function addLog(s) { B.logs.push(s); if (B.logs.length > 40) B.logs.shift(); }

  function applyEffectTo(target, statusId, turns) {
    // target='player' → G.Status；否则敌人对象
    if (target === 'player') G.Status.addEffect(statusId, turns);
    else target.effects[statusId] = { turns: turns || 0 };
  }
  function effTurns(effects, id) { return effects[id] ? effects[id].turns : 0; }

  /* ---------- 一次攻击（技能/普攻通用） ---------- */
  function performStrike(src, srcName, srcAtk, target, power, hits, eff, defDown) {
    for (var h = 0; h < (hits || 1); h++) {
      var tDef = (target === 'player') ? B.player.def() : enemyDef(target);
      var dmg = calcDamage(srcAtk, tDef, power);
      if (target === 'player' && B.defending) dmg = Math.max(1, Math.round(dmg * 0.5));
      if (target === 'player') {
        G.Status.adjust('hp', -dmg);
        addLog(srcName + ' 攻击你，造成 ' + dmg + ' 点伤害' + (B.defending ? '（防御减半）' : ''));
      } else {
        target.hp -= dmg;
        addLog(srcName + ' 命中 ' + target.name + '，造成 ' + dmg + ' 点伤害');
      }
      // 附加状态效果
      if (eff && eff.status && Math.random() < (eff.chance == null ? 1 : eff.chance)) {
        var def = G.EFFECTS.get(eff.status);
        var tn = eff.turns || 3;
        if (target === 'player') { G.Status.addEffect(eff.status, tn); }
        else { target.effects[eff.status] = { turns: tn }; }
        if (def) addLog((target === 'player' ? '你' : target.name) + '陷入「' + def.name + '」！');
      }
      // 破甲：降防
      if (defDown && target !== 'player') {
        target.defDown = { amt: defDown.amt, turns: defDown.turns };
        addLog(target.name + ' 的防御被削弱');
      }
    }
  }

  /* ---------- 敌人选技能（按 rate 加权） ---------- */
  function enemyPickSkill(e) {
    var skills = e.data.skills || [{ id: 'gnaw', rate: 1 }];
    var total = 0, i;
    for (i = 0; i < skills.length; i++) total += (skills[i].rate || 0);
    var roll = Math.random() * total;
    for (i = 0; i < skills.length; i++) {
      roll -= (skills[i].rate || 0);
      if (roll <= 0) return G.SKILLS.get(skills[i].id);
    }
    return G.SKILLS.get(skills[0].id);
  }

  /* ---------- 行动队列 ---------- */
  function buildQueue() {
    var q = [{ who: 'player', agi: playerAki() + rnd(0, 1) }];
    for (var i = 0; i < B.enemies.length; i++) {
      if (B.enemies[i].hp > 0) q.push({ who: 'enemy', ref: B.enemies[i], agi: enemyAgi(B.enemies[i]) + rnd(0, 1) });
    }
    q.sort(function (a, b) { return b.agi - a.agi; });
    return q;
  }

  function fearSkip(effects) {
    var sc = sumEffect(effects, 'skipChance');
    return sc > 0 && Math.random() < sc;
  }

  /* ---------- 执行整回合 ---------- */
  function resolveRound() {
    B.defending = (B.pending && B.pending.kind === 'defend');
    if (B.defending) addLog('—— 第 ' + B.round + ' 回合：你摆出防御姿态 ——');
    else addLog('—— 第 ' + B.round + ' 回合 ——');

    var queue = buildQueue();
    var fled = false;
    for (var qi = 0; qi < queue.length; qi++) {
      if (G.Status.hp <= 0) break; // 玩家已倒
      var act = queue[qi];
      if (act.who === 'player') {
        var pk = B.pending.kind;
        // 恐惧仅干扰进攻（攻击/技能）；防御/道具/逃跑不受跳过影响
        if ((pk === 'attack' || pk === 'skill') && fearSkip(G.Status.effects)) { addLog('你被恐惧攫住，无法行动！'); }
        else if (B.pending.kind === 'attack') {
          performStrike('enemyTarget', '你', playerAtk(), B.pending.target, 1.0, 1, null, null);
        } else if (B.pending.kind === 'skill') {
          var sk = B.pending.skill;
          addLog('你使出「' + sk.name + '」！');
          performStrike('enemyTarget', '你', playerAtk(), B.pending.target, sk.power, sk.hits, sk.effect, sk.defDown);
        } else if (B.pending.kind === 'item') {
          if (G.Inventory.use(B.pending.itemId)) addLog('你使用了 ' + (G.ITEMS.get(B.pending.itemId) || {}).name);
          else addLog('使用失败');
        } else if (B.pending.kind === 'flee') {
          var chance = clamp(0.5 + (playerAki() - avgEnemyAgi()) * 0.05, 0.2, 0.9);
          if (Math.random() < chance) { addLog('你成功脱离了战斗！'); fled = true; break; }
          addLog('逃跑失败，敌人截住了你！');
        }
      } else {
        var e = act.ref;
        if (e.hp <= 0) continue;
        if (fearSkip(e.effects)) { addLog(e.name + ' 因反噬僵住'); continue; }
        var skill = enemyPickSkill(e);
        if (!skill) skill = { name: '攻击', power: 1, hits: 1 };
        var eatk = e.atk * effectRate(e.effects, 'atkRate');
        performStrike(e, e.name, eatk, 'player', skill.power, skill.hits || 1, skill.effect, null);
      }
    }

    B.pending = null;
    if (fled) { B.outcome = 'flee'; B.phase = 'log'; return; }
    endOfRound();
  }

  function avgEnemyAgi() {
    var s = 0, n = 0;
    for (var i = 0; i < B.enemies.length; i++) if (B.enemies[i].hp > 0) { s += enemyAgi(B.enemies[i]); n++; }
    return n ? s / n : 0;
  }

  /* ---------- 回合末：持续伤害 + 精神消耗 + 效果倒计时 ---------- */
  function tickEffects(effects, who) {
    for (var id in effects) {
      var def = G.EFFECTS.get(id);
      if (!def) continue;
      if (def.perTurn) {
        if (who === 'player') { G.Status.adjust('hp', -def.perTurn); addLog((who === 'player' ? '你' : '') + '受到「' + def.name + '」' + def.perTurn + ' 点伤害'); }
        else { who.hp -= def.perTurn; addLog(who.name + ' 受到「' + def.name + '」伤害'); }
      }
      if (def.mindPerTurn && who === 'player') { G.Status.adjust('mind', -def.mindPerTurn); }
      if (effects[id].turns > 0) { effects[id].turns--; if (effects[id].turns <= 0) delete effects[id]; }
    }
  }

  function endOfRound() {
    tickEffects(G.Status.effects, 'player');
    for (var i = 0; i < B.enemies.length; i++) {
      var e = B.enemies[i];
      if (e.hp > 0) tickEffects(e.effects, e);
      if (e.defDown && e.defDown.turns > 0) e.defDown.turns--;
    }
    // 胜负判定
    var alive = 0;
    for (var j = 0; j < B.enemies.length; j++) if (B.enemies[j].hp > 0) alive++;
    if (G.Status.hp <= 0) { B.outcome = 'lose'; B.phase = 'log'; }
    else if (alive === 0) { B.outcome = 'win'; victory(); B.phase = 'log'; }
    else { B.round++; B.phase = 'log'; }
  }

  function victory() {
    addLog('敌人被击倒了！');
    for (var i = 0; i < B.enemies.length; i++) {
      var e = B.enemies[i];
      G.Status.adjust('gold', e.data.gold || 0);
      var loot = e.data.loot || [];
      for (var k = 0; k < loot.length; k++) {
        if (Math.random() < loot[k].rate) { G.Inventory.add(loot[k].item, 1); addLog('获得 ' + (G.ITEMS.get(loot[k].item) || {}).name); }
      }
    }
  }

  /* ---------- 菜单构建 ---------- */
  function mainCommands() {
    return [
      { label: '攻击', kind: 'attack' },
      { label: '技能', kind: 'skill' },
      { label: '道具', kind: 'item' },
      { label: '防御', kind: 'defend' },
      { label: '逃跑', kind: 'flee' }
    ];
  }
  function playerSkills() {
    var noSkills = hasFlagEffect(G.Status.effects, 'noSkills');
    var r = [];
    var list = B.player.skills || [];
    for (var i = 0; i < list.length; i++) {
      var sk = G.SKILLS.get(list[i]);
      if (!sk) continue;
      r.push({ label: sk.name + '（SP' + sk.cost + '）', skill: sk, usable: !noSkills && G.Status.sp >= sk.cost, reason: noSkills ? '断臂无法施展' : 'SP 不足' });
    }
    return r;
  }
  function itemEntries() {
    var list = G.Inventory.usable();
    var r = [];
    for (var i = 0; i < list.length; i++) r.push({ label: list[i].name + ' ×' + list[i].count, itemId: list[i].id });
    return r;
  }
  function aliveEnemies() {
    var r = [];
    for (var i = 0; i < B.enemies.length; i++) if (B.enemies[i].hp > 0) r.push(B.enemies[i]);
    return r;
  }

  function chooseMain(cmd) {
    if (cmd.kind === 'skill') {
      if (playerSkills().length) { B.depth = 'skill'; B.subIdx = 0; }
      return;
    }
    if (cmd.kind === 'attack') {
      var targets = aliveEnemies();
      if (targets.length === 1) startAction({ kind: 'attack', target: targets[0] });
      else { B.phase = 'target'; B.pending = { kind: 'attack' }; B.subIdx = 0; }
      return;
    }
    if (cmd.kind === 'item') { B.depth = 'item'; B.subIdx = 0; return; }
    if (cmd.kind === 'defend') { startAction({ kind: 'defend' }); return; }
    if (cmd.kind === 'flee') { startAction({ kind: 'flee' }); return; }
  }

  function startAction(pending) {
    if (pending.kind === 'skill') {
      if (G.Status.sp < pending.skill.cost) return; // 不可选
      G.Status.adjust('sp', -pending.skill.cost);
    }
    B.pending = pending;
    resolveRound();
  }

  function confirmSkill(entry) {
    if (!entry.usable) return;
    var targets = aliveEnemies();
    if (targets.length === 1) startAction({ kind: 'skill', skill: entry.skill, target: targets[0] });
    else { B.phase = 'target'; B.pending = { kind: 'skill', skill: entry.skill }; B.subIdx = 0; }
  }
  function confirmItem(entry) {
    if (G.Inventory.count(entry.itemId) <= 0) return;
    startAction({ kind: 'item', itemId: entry.itemId });
  }
  function confirmTarget(e) {
    B.pending.target = e;
    startAction(B.pending);
  }

  /* ---------- 外部接口 ---------- */
  G.Battle = {
    isActive: function () { return B.active; },
    outcome: function () { return B.outcome; },
    isFinished: function () { return B.finished; },
    resultNodes: function () { return { win: B.winNode, lose: B.loseNode }; },

    start: function (enemyTypeIds, opts) {
      B.active = true;
      B.phase = 'menu';
      B.depth = 'main';
      B.round = 1;
      B.logs = [];
      B.outcome = null;
      B.finished = false;
      B.pending = null;
      B.defending = false;
      B.menuIdx = 0;
      B.subIdx = 0;
      B.player = opts.player;
      B.winNode = opts.win || null;
      B.loseNode = opts.lose || null;
      B.enemies = [];
      for (var i = 0; i < enemyTypeIds.length; i++) {
        var data = G.ENEMIES.get(enemyTypeIds[i]);
        if (!data) { addLog('（缺失敌人数据：' + enemyTypeIds[i] + '）'); continue; }
        B.enemies.push({
          type: enemyTypeIds[i], data: data, name: data.name,
          hp: data.hp, maxHp: data.hp, atk: data.atk, def: data.def, agi: data.agi,
          effects: {}, defDown: null
        });
      }
      addLog('遭遇了 ' + B.enemies.map(function (e) { return e.name; }).join('、') + '！');
    },

    end: function () { B.active = false; },

    update: function (input) {
      B._step++;
      if (B.phase === 'log') {
        if (input.pressed('confirm') || input.tap()) {
          if (B.outcome) B.finished = true; // 有结局 → 交给 core 收尾
          else { B.phase = 'menu'; B.depth = 'main'; B.menuIdx = 0; }
        }
        G.Input.endFrame();
        return;
      }
      // menu / target 阶段的键盘导航
      if (B.phase === 'menu') {
        var list = B.depth === 'main' ? mainCommands()
          : B.depth === 'skill' ? playerSkills()
          : itemEntries();
        navList(input, list, 'menu');
        if (input.pressed('confirm')) selectMenu(list);
        if (input.pressed('cancel')) {
          if (B.depth !== 'main') { B.depth = 'main'; B.menuIdx = 0; }
        }
        var tap = input.tap();
        if (tap) { var ti = tapList(tap, list, 'menu'); if (ti >= 0) { setIdx(list, ti); selectMenu(list); } }
      } else if (B.phase === 'target') {
        var tg = aliveEnemies();
        navList(input, tg, 'sub');
        if (input.pressed('confirm')) confirmTarget(tg[B.subIdx]);
        if (input.pressed('cancel')) { B.phase = 'menu'; B.depth = 'main'; B.menuIdx = 0; B.pending = null; }
        var tap2 = input.tap();
        if (tap2) { var ti2 = tapList(tap2, tg, 'sub'); if (ti2 >= 0) { B.subIdx = ti2; confirmTarget(tg[ti2]); } }
      }
      G.Input.endFrame();
    },

    render: function (ctx) { renderBattle(ctx); }
  };

  function setIdx(list, i) {
    if (B.phase === 'target') B.subIdx = i;
    else if (B.depth === 'main') B.menuIdx = i;
    else B.subIdx = i;
  }
  function getIdx(list) {
    if (B.phase === 'target') return B.subIdx;
    if (B.depth === 'main') return B.menuIdx;
    return B.subIdx;
  }
  function navList(input, list, tag) {
    if (!list.length) return;
    var idx = getIdx(list);
    if (input.pressed('up')) setIdx(list, (idx - 1 + list.length) % list.length);
    if (input.pressed('down')) setIdx(list, (idx + 1) % list.length);
  }
  function selectMenu(list) {
    if (!list.length) return;
    var idx = getIdx(list);
    var entry = list[idx];
    if (B.depth === 'main') chooseMain(entry);
    else if (B.depth === 'skill') confirmSkill(entry);
    else if (B.depth === 'item') confirmItem(entry);
  }

  /* ---------- 布局矩形（供触摸命中 + 绘制共用） ---------- */
  function menuRect() {
    var W = G.Camera.VIEW_W, H = G.Camera.VIEW_H;
    return { x: W - 210, y: H - 250, w: 196, h: 210 };
  }
  function itemRowRect(i, count) {
    var m = menuRect();
    var rowH = 30, top = m.y + 32;
    return { x: m.x + 8, y: top + i * rowH, w: m.w - 16, h: rowH - 2 };
  }
  function tapList(tap, list, tag) {
    for (var i = 0; i < list.length; i++) {
      var r = itemRowRect(i, list.length);
      if (tap.x >= r.x && tap.x < r.x + r.w && tap.y >= r.y && tap.y < r.y + r.h) return i;
    }
    return -1;
  }

  /* ---------- 渲染 ---------- */
  function renderBattle(ctx) {
    var W = G.Camera.VIEW_W, H = G.Camera.VIEW_H;
    // 背景（战斗氛围：暗红渐变）
    var grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#140a0c');
    grd.addColorStop(1, '#2a1414');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    drawEnemies(ctx);
    drawPlayerPanel(ctx);
    drawMenu(ctx);
    drawLogs(ctx);
  }

  function drawEnemies(ctx) {
    var n = B.enemies.length;
    var W = G.Camera.VIEW_W;
    for (var i = 0; i < n; i++) {
      var e = B.enemies[i];
      var cx = Math.round(W / (n + 1) * (i + 1));
      var baseY = 150;
      var s = e.data.size || 24;
      var scale = 2.2; // 战斗立绘放大
      var dw = s * scale, dh = s * scale;
      if (e.hp <= 0) {
        ctx.globalAlpha = 0.28;
      }
      ctx.fillStyle = e.data.color;
      ctx.fillRect(cx - dw / 2, baseY - dh / 2, dw, dh);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - dw / 2, baseY - dh / 2, dw, dh);
      // 眼睛
      ctx.fillStyle = e.hp <= 0 ? '#555' : '#e04040';
      ctx.fillRect(cx - dw / 4, baseY - dh / 8, 8, 8);
      ctx.fillRect(cx + dw / 4 - 8, baseY - dh / 8, 8, 8);
      ctx.globalAlpha = 1;
      // 名称 + HP 条
      ctx.fillStyle = '#e8d8c8';
      ctx.font = '14px "Noto Serif SC", serif';
      ctx.textAlign = 'center';
      ctx.fillText(e.name, cx, baseY + dh / 2 + 18);
      var bw = 110, bh = 8, bx = cx - bw / 2, by = baseY + dh / 2 + 26;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = '#3a1414'; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#c04040'; ctx.fillRect(bx, by, bw * clamp(e.hp / e.maxHp, 0, 1), bh);
      ctx.fillStyle = '#e8d8c8'; ctx.font = '11px sans-serif';
      ctx.fillText(Math.max(0, e.hp) + '/' + e.maxHp, bx, by + bh + 12);
      // 敌人状态效果标记
      drawEffectTags(ctx, e.effects, bx, by + bh + 26);
    }
  }

  function drawEffectTags(ctx, effects, x, y) {
    var ids = [];
    for (var k in effects) ids.push(k);
    ctx.font = '11px "Noto Serif SC", serif';
    for (var i = 0; i < ids.length; i++) {
      var def = G.EFFECTS.get(ids[i]);
      if (!def) continue;
      ctx.fillStyle = def.color;
      ctx.fillText('[' + def.name + '·' + (def.turns || effects[ids[i]].turns) + ']', x + i * 62, y);
    }
  }

  function drawPlayerPanel(ctx) {
    var W = G.Camera.VIEW_W, H = G.Camera.VIEW_H;
    var x = 18, y = H - 150;
    ctx.fillStyle = 'rgba(10,8,12,0.78)';
    ctx.fillRect(x, y, 250, 132);
    ctx.strokeStyle = '#d8c8a8'; ctx.lineWidth = 2; ctx.strokeRect(x, y, 250, 132);
    ctx.fillStyle = '#f0e6d0'; ctx.font = '15px "Noto Serif SC", serif';
    ctx.fillText('旅者', x + 12, y + 24);
    bar(ctx, 'HP', G.Status.hp, 100, '#c84a4a', x + 12, y + 36);
    bar(ctx, 'SP', G.Status.sp, G.Status.maxSp, '#4a86c8', x + 12, y + 60);
    bar(ctx, '神', G.Status.mind, 100, '#7a6ac8', x + 12, y + 84);
    // 玩家状态效果
    drawEffectTags(ctx, G.Status.effects, x + 12, y + 120);
  }

  function bar(ctx, label, v, max, color, x, y) {
    ctx.fillStyle = '#c8bca8'; ctx.font = '12px "Noto Serif SC", serif';
    ctx.fillText(label, x, y + 10);
    var bx = x + 26, bw = 180, bh = 12;
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(bx, y, bw, bh);
    ctx.fillStyle = color; ctx.fillRect(bx, y, bw * clamp(v / max, 0, 1), bh);
    ctx.fillStyle = '#f0e6d0'; ctx.font = '11px sans-serif';
    ctx.fillText(Math.round(v) + '/' + max, bx + bw + 4, y + 10);
  }

  function drawMenu(ctx) {
    var m = menuRect();
    ctx.fillStyle = 'rgba(12,8,14,0.82)';
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.strokeStyle = '#d8c8a8'; ctx.lineWidth = 2; ctx.strokeRect(m.x, m.y, m.w, m.h);
    var title = B.phase === 'target' ? '选择目标'
      : B.depth === 'main' ? '指令'
      : B.depth === 'skill' ? '技能' : '道具';
    var list;
    if (B.phase === 'target') list = aliveEnemies().map(function (e) { return { label: e.name + ' (' + e.hp + ')', _e: e }; });
    else if (B.depth === 'main') list = mainCommands();
    else if (B.depth === 'skill') list = playerSkills();
    else list = itemEntries();

    ctx.fillStyle = '#f0e6d0'; ctx.font = '14px "Noto Serif SC", serif';
    ctx.fillText('【' + title + '】', m.x + 10, m.y + 22);

    var idx = getIdx(list);
    for (var i = 0; i < list.length; i++) {
      var r = itemRowRect(i, list.length);
      var entry = list[i];
      var disabled = entry.usable === false;
      ctx.fillStyle = (i === idx && B.phase !== 'log') ? 'rgba(216,200,168,0.28)' : 'rgba(0,0,0,0)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      if (i === idx) { ctx.strokeStyle = '#f0e6d0'; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1); }
      ctx.fillStyle = disabled ? '#6a6258' : (i === idx ? '#fff' : '#d8c8a8');
      ctx.font = '15px "Noto Serif SC", serif';
      var label = entry.label || entry.name;
      ctx.fillText(label, r.x + 10, r.y + 21);
      if (disabled && entry.reason) { ctx.fillStyle = '#8a5a5a'; ctx.font = '11px sans-serif'; ctx.fillText(entry.reason, r.x + 120, r.y + 20); }
    }
  }

  function drawLogs(ctx) {
    var W = G.Camera.VIEW_W, H = G.Camera.VIEW_H;
    var lh = 20, rows = 4;
    var y = H - 26 - (rows - 1) * lh;
    ctx.fillStyle = 'rgba(8,6,10,0.72)';
    ctx.fillRect(18, y - 16, W - 246, rows * lh + 8);
    ctx.font = '13px "Noto Serif SC", serif';
    var start = Math.max(0, B.logs.length - rows);
    for (var i = start; i < B.logs.length; i++) {
      var row = i - start;
      ctx.fillStyle = row === B.logs.length - 1 - start ? '#f0e6d0' : '#b8ac98';
      ctx.fillText(B.logs[i], 26, y + row * lh);
    }
    if (B.phase === 'log') {
      ctx.fillStyle = '#e8d8a8';
      ctx.fillText((B.outcome ? '▶ 按 Z / 点击 继续' : '▶ 按 Z / 点击 下一回合'), 26, y + rows * lh - 2);
    }
  }
})(window.Game = window.Game || {});
