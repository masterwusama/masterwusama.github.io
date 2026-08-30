/* status.js - 生存状态（HP/饥饿/精神/SP + 游戏时钟 + 状态效果容器）
 * 游戏时间按“移动距离”推进（非现实时间）：停下/对话/菜单时时间不流逝，
 * 每步行 PX_PER_HOUR 像素推进 1 游戏小时，同时结算饥饿/夜间精神流失。
 * 状态效果（§6.3）战斗内外持续：战斗内按回合结算（battle.js 负责），
 * 战斗外按逻辑步结算（本模块 tickExplore：流血/中毒扣血、黑暗扣精神）。 */
(function (G) {
  'use strict';

  var MAX = 100;

  // 时间推进：每步行 PX_PER_HOUR 像素 = 1 游戏小时（玩家 80px/s → 约 11s 连续行走过 1 小时）
  var PX_PER_HOUR = 900;
  var HUNGER_PER_HOUR = 1;   // 每游戏小时饥饿 -1
  var NIGHT_MIND_PER_HOUR = 1; // 夜间（22:00~06:00）每游戏小时精神 -1
  var STARVE_HP_PER_HOUR = 2;  // 饥饿归零后每游戏小时 HP -2
  var EFFECT_TICK = 20;     // 战斗外状态效果结算间隔（步）≈ 1s（perStep 按此周期计）

  var S = {
    hp: MAX,
    hunger: MAX,
    mind: MAX,
    sp: 30,          // 技能点（战斗用）
    maxSp: 30,
    day: 1,
    hour: 8,
    gold: 0,
    _tick: 0,
    _dist: 0,        // 累计步行像素（满 PX_PER_HOUR 推进 1 小时）
    effects: {}      // 状态效果容器：{ id: { turns, source } }
  };

  function clamp(v) { return Math.max(0, Math.min(MAX, v)); }
  function isNight() { return S.hour >= 22 || S.hour < 6; }

  /* ---------- 状态效果 ---------- */
  S.addEffect = function (id, turns) {
    if (!G.EFFECTS.get(id)) return;
    S.effects[id] = { turns: turns || 0 };
  };
  S.hasEffect = function (id) { return !!S.effects[id]; };
  S.removeEffect = function (id) { delete S.effects[id]; };
  S.clearEffects = function () { S.effects = {}; };
  S.effectIds = function () {
    var r = [];
    for (var k in S.effects) r.push(k);
    return r;
  };

  // 战斗外每 EFFECT_TICK 步结算状态效果（战斗内由 battle.js 按回合结算）
  // 同周期递减 turns→到期移除：避免带流血/断腿逃出战斗后永久掉血/减速
  S.tickExplore = function () {
    var toDel = [];
    for (var id in S.effects) {
      var def = G.EFFECTS.get(id);
      if (!def) { toDel.push(id); continue; }
      if (def.perStep) S.hp = clamp(S.hp - def.perStep);
      if (def.mindPerStep) S.mind = clamp(S.mind - def.mindPerStep);
      if (S.effects[id].turns > 0) {
        S.effects[id].turns--;
        if (S.effects[id].turns <= 0) toDel.push(id);
      }
    }
    for (var i = 0; i < toDel.length; i++) delete S.effects[toDel[i]];
  };

  // 移动速度倍率（断腿）
  S.moveRate = function () {
    var r = 1;
    if (S.hasEffect('broken_leg')) {
      var d = G.EFFECTS.get('broken_leg');
      r *= (d.moveRate || 1);
    }
    return r;
  };

  S.update = function () {
    S._tick++;
    if (S._tick % EFFECT_TICK === 0) S.tickExplore(); // 流血/中毒/黑暗按秒结算（非每步）
  };

  // 按移动距离推进游戏时间：core 探索每步传入实际位移（px）
  // 停下/对话/菜单时位移为 0 → 时间不流逝
  S.travel = function (px) {
    if (!(px > 0)) return;
    S._dist += px;
    while (S._dist >= PX_PER_HOUR) {
      S._dist -= PX_PER_HOUR;
      S.passHour();
    }
  };

  // 过 1 游戏小时：推进时钟 + 结算饥饿/夜间精神/饥饿掉血
  S.passHour = function () {
    S.hour++;
    if (S.hour >= 24) { S.hour = 0; S.day++; }
    S.hunger = clamp(S.hunger - HUNGER_PER_HOUR);
    if (isNight()) S.mind = clamp(S.mind - NIGHT_MIND_PER_HOUR);
    if (S.hunger <= 0) S.hp = clamp(S.hp - STARVE_HP_PER_HOUR);
  };

  // 数值增减（effect 支持：hp/sp/hunger/mind 增正减负）
  S.adjust = function (key, delta) {
    if (key === 'hp' || key === 'hunger' || key === 'mind') {
      S[key] = clamp(S[key] + delta);
    } else if (key === 'sp') {
      S.sp = Math.max(0, Math.min(S.maxSp, S.sp + delta));
    } else if (key === 'gold') {
      S.gold = Math.max(0, S.gold + delta);
    }
  };

  S.advanceHours = function (n) {
    S.hour += n;
    while (S.hour >= 24) { S.hour -= 24; S.day++; }
  };

  S.timeText = function () {
    var h = ('0' + S.hour).slice(-2);
    return '第' + S.day + '天 ' + h + ':00';
  };

  S.snapshot = function () {
    return {
      hp: Math.round(S.hp), hunger: Math.round(S.hunger), mind: Math.round(S.mind),
      sp: Math.round(S.sp), maxSp: S.maxSp,
      day: S.day, hour: S.hour, gold: S.gold,
      effects: JSON.parse(JSON.stringify(S.effects))
    };
  };

  S.restore = function (d) {
    if (!d) return;
    S.hp = clamp(d.hp); S.hunger = clamp(d.hunger); S.mind = clamp(d.mind);
    S.sp = d.sp || 0; S.maxSp = d.maxSp || 30;
    S.day = d.day || 1; S.hour = d.hour || 8;
    S.gold = d.gold || 0;
    S.effects = d.effects ? JSON.parse(JSON.stringify(d.effects)) : {};
    S._tick = 0;
    S._dist = 0;
  };

  G.Status = S;
})(window.Game = window.Game || {});
