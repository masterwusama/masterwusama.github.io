/* status.js - 生存状态（M1：HP / 饥饿 / 精神 + 游戏时钟）
 * 饥饿随时间衰减，归零后持续扣 HP；夜间精神缓慢下降；时间每 4 现实秒推进 1 游戏小时。
 * 数值全部收敛在 0~100（HP 归零进入濒死剧情——M2 实现）。 */
(function (G) {
  'use strict';

  var MAX = 100;

  // 衰减周期（逻辑步，1 步 = 50ms）
  var HUNGER_TICK = 240;    // 每 12s 饥饿 -1
  var STARVE_TICK = 100;    // 饥饿归零后每 5s HP -1
  var NIGHT_TICK = 300;     // 夜间（22:00~06:00）每 15s 精神 -1
  var TIME_TICK = 80;       // 每 4s 推进 1 游戏小时

  var S = {
    hp: MAX,
    hunger: MAX,
    mind: MAX,
    day: 1,
    hour: 8,
    _tick: 0
  };

  function clamp(v) { return Math.max(0, Math.min(MAX, v)); }

  function isNight() { return S.hour >= 22 || S.hour < 6; }

  S.update = function () {
    S._tick++;
    if (S._tick % HUNGER_TICK === 0) S.hunger = clamp(S.hunger - 1);
    if (S.hunger <= 0 && S._tick % STARVE_TICK === 0) S.hp = clamp(S.hp - 1);
    if (isNight() && S._tick % NIGHT_TICK === 0) S.mind = clamp(S.mind - 1);
    if (S._tick % TIME_TICK === 0) {
      S.hour++;
      if (S.hour >= 24) { S.hour = 0; S.day++; }
    }
  };

  // 数值增减（effect 支持：hp/hunger/mind 增正减负）
  S.adjust = function (key, delta) {
    if (key === 'hp' || key === 'hunger' || key === 'mind') {
      S[key] = clamp(S[key] + delta);
    }
  };

  // 休息推进 N 游戏小时（跨天处理）
  S.advanceHours = function (n) {
    S.hour += n;
    while (S.hour >= 24) { S.hour -= 24; S.day++; }
  };

  S.timeText = function () {
    var h = ('0' + S.hour).slice(-2);
    return '第' + S.day + '天 ' + h + ':00';
  };

  S.snapshot = function () {
    return { hp: S.hp, hunger: S.hunger, mind: S.mind, day: S.day, hour: S.hour };
  };

  S.restore = function (d) {
    if (!d) return;
    S.hp = clamp(d.hp); S.hunger = clamp(d.hunger); S.mind = clamp(d.mind);
    S.day = d.day || 1; S.hour = d.hour || 8;
    S._tick = 0;
  };

  G.Status = S;
})(window.Game = window.Game || {});
