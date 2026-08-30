/* npc.js - NPC 实体（M1：站立不动 + interact 触发对话）
 * 由地图 npcSpawns 数据生成；不阻挡移动（简化）；玩家面向 NPC 按 Z 触发 trigger 节点。 */
(function (G) {
  'use strict';

  var W = 32, H = 32;

  function NPC(spec) {
    this.id = spec.id;
    this.x = spec.x * 32;
    this.y = spec.y * 32;
    this.w = W;
    this.h = H;
    this.dir = spec.dir || 'down';
    this.trigger = spec.trigger;
    this.walkFrame = 0;
  }

  NPC.prototype.centerX = function () { return this.x + this.w / 2; };
  NPC.prototype.centerY = function () { return this.y + this.h / 2; };

  // 玩家面向的 tile 是否落在 NPC 占位矩形内
  NPC.prototype.coverTile = function (tx, ty) {
    var t0x = Math.floor(this.x / 32), t0y = Math.floor(this.y / 32);
    return tx >= t0x && tx < t0x + this.w / 32 && ty >= t0y && ty < t0y + this.h / 32;
  };

  // P0 占位绘制：灰衣老人（与玩家小人同构，配色区分）；(ox,oy) 为相机偏移（世界→屏幕）
  NPC.prototype.render = function (ctx, ox, oy) {
    var x = this.x + (ox || 0), y = this.y + (oy || 0);
    ctx.fillStyle = '#2e2a26';
    ctx.fillRect(x + 8, y + 24, 6, 8);
    ctx.fillRect(x + 18, y + 24, 6, 8);
    ctx.fillStyle = '#6a6258';
    ctx.fillRect(x + 5, y + 12, 22, 14);
    ctx.fillRect(x + 1, y + 14, 4, 9);
    ctx.fillRect(x + 27, y + 14, 4, 9);
    ctx.fillStyle = '#c9b8a0';
    ctx.fillRect(x + 9, y + 2, 14, 12);
    ctx.fillStyle = '#1c1410';
    ctx.fillRect(x + 12, y + 6, 2, 3);
    ctx.fillRect(x + 18, y + 6, 2, 3);
    ctx.fillStyle = '#8a8a8a'; // 白发
    ctx.fillRect(x + 9, y + 1, 14, 3);
  };

  G.NPC = NPC;
})(window.Game = window.Game || {});
