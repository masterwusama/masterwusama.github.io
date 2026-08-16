/* camera.js - 摄像机：跟随玩家 + 边界钳制
 * 视口 25×19 tile（800×608，接近 RMMV 默认 816×624）。
 * 硬跟随（LERP=1）：摄像机与玩家严格同步滚动，人物移动/停下画面即时响应，
 * 保证“地图同步跟随”的贴手感（平滑 lerp 会造成尾随滞后，已弃用）。
 * 地图小于视口时 clamp 使摄像机停在 (0,0)，渲染端会做居中偏移。 */
(function (G) {
  'use strict';

  var VIEW_W = 800;
  var VIEW_H = 608;
  var LERP = 1; // 硬跟随；如需轻微顺滑可调小（如 0.9），但会引入少量尾随

  var cam = { x: 0, y: 0, target: null };

  G.Camera = {
    VIEW_W: VIEW_W,
    VIEW_H: VIEW_H,

    follow: function (entity) {
      cam.target = entity;
    },

    getX: function () { return cam.x; },
    getY: function () { return cam.y; },

    // 逻辑步调用：目标 = 玩家中心 - 半视口，lerp 趋近后钳制到地图边界
    update: function (map) {
      var t = cam.target;
      if (!t) return;
      var tx = t.x + t.w / 2 - VIEW_W / 2;
      var ty = t.y + t.h / 2 - VIEW_H / 2;
      cam.x += (tx - cam.x) * LERP;
      cam.y += (ty - cam.y) * LERP;
      var maxX = map.pixelWidth - VIEW_W;
      var maxY = map.pixelHeight - VIEW_H;
      cam.x = Math.max(0, Math.min(maxX, cam.x));
      cam.y = Math.max(0, Math.min(maxY, cam.y));
    }
  };
})(window.Game = window.Game || {});
