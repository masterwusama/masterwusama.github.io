/* camera.js - 摄像机：跟随玩家 + 平滑插值 + 边界钳制
 * 视口 40×30 tile（1280×960）。地图小于视口时 clamp 使摄像机停在 (0,0)，
 * 渲染端会做居中偏移。 */
(function (G) {
  'use strict';

  var VIEW_W = 1280;
  var VIEW_H = 960;
  var LERP = 0.25; // 每逻辑步趋近系数（跟随快、防飘，RMMV 式同步感）

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
