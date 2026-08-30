/* player.js - 玩家实体：移动、碰撞（0.5 tile 内缩）、水域减速、面向 + 角色属性体系（M2）
 * 属性体系（§14）：力量/敏捷/智力/精神 → 衍生攻击/防御/行动序；技能列表（战斗用）。
 * 逻辑步移动（固定步长由 core 驱动）；prevX/prevY 供渲染插值平滑。 */
(function (G) {
  'use strict';

  var SPEED = 4;        // px / 逻辑步（50ms）→ 80 px/s
  var W = 32, H = 32;   // 绘制尺寸
  var HIT_W = 16, HIT_H = 16; // 碰撞盒：0.5 tile 内缩，居中
  var SLOW_FACTOR = 0.5;

  function Player(x, y) {
    this.x = x;
    this.y = y;
    this.prevX = x;
    this.prevY = y;
    this.w = W;
    this.h = H;
    this.dir = 'down';
    this.walkFrame = 0;
    // 角色属性（M2：力量/敏捷/智力/精神）
    this.attr = { str: 5, agi: 6, int: 4, spirit: 4 };
    // 初始技能（战斗指令用）
    this.skills = ['heavy_strike', 'double_slash', 'rend_armor'];
  }

  Player.prototype.centerX = function () { return this.x + this.w / 2; };
  Player.prototype.centerY = function () { return this.y + this.h / 2; };

  /* ---------- 战斗数值（由属性衍生） ---------- */
  Player.prototype.atk = function () { return 8 + this.attr.str; };
  Player.prototype.def = function () { return 4 + Math.floor(this.attr.str / 2); };
  // 行动序敏捷（断腿减半）
  Player.prototype.battleAgi = function () { return this.attr.agi * G.Status.moveRate(); };
  // 移动速度倍率（断腿减半）
  Player.prototype.moveRate = function () { return G.Status.moveRate(); };

  // 碰撞盒覆盖的所有 tile 是否含阻挡
  Player.prototype.hits = function (map, nx, ny) {
    var ts = map.tileSize;
    var x0 = Math.floor((nx + (this.w - HIT_W) / 2) / ts);
    var y0 = Math.floor((ny + (this.h - HIT_H) / 2) / ts);
    var x1 = Math.floor((nx + (this.w + HIT_W) / 2 - 1) / ts);
    var y1 = Math.floor((ny + (this.h + HIT_H) / 2 - 1) / ts);
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        if (map.isSolidAt(tx, ty)) return true;
      }
    }
    return false;
  };

  Player.prototype.onSlow = function (map) {
    var ts = map.tileSize;
    return map.isSlowAt(Math.floor(this.centerX() / ts), Math.floor(this.centerY() / ts));
  };

  // 玩家面前一格的 tile 坐标（按当前面向），供 interact 触发检测
  Player.prototype.facingTile = function (map) {
    var ts = map.tileSize;
    var tx = Math.floor(this.centerX() / ts);
    var ty = Math.floor(this.centerY() / ts);
    if (this.dir === 'up') ty--;
    else if (this.dir === 'down') ty++;
    else if (this.dir === 'left') tx--;
    else if (this.dir === 'right') tx++;
    return { x: tx, y: ty };
  };

  Player.prototype.update = function (map, input) {
    this.prevX = this.x;
    this.prevY = this.y;

    var vx = 0, vy = 0;
    if (input.held('left')) vx -= 1;
    if (input.held('right')) vx += 1;
    if (input.held('up')) vy -= 1;
    if (input.held('down')) vy += 1;
    if (vx !== 0 && vy !== 0) { vx *= 0.7071; vy *= 0.7071; } // 斜向归一化

    var speed = SPEED * (this.onSlow(map) ? SLOW_FACTOR : 1) * this.moveRate();

    // 轴分离移动：先 X 后 Y，贴墙可沿墙滑动
    if (vx !== 0 && !this.hits(map, this.x + vx * speed, this.y)) {
      this.x += vx * speed;
    }
    if (vy !== 0 && !this.hits(map, this.x, this.y + vy * speed)) {
      this.y += vy * speed;
    }

    if (vx > 0) this.dir = 'right';
    else if (vx < 0) this.dir = 'left';
    if (vy > 0) this.dir = 'down';
    else if (vy < 0) this.dir = 'up';

    if (vx !== 0 || vy !== 0) this.walkFrame++;
  };

  // P0 占位绘制：色块小人（头 + 身体 + 摆动双腿 + 面向眼睛）；(ix, iy) 为插值后的渲染位置
  Player.prototype.render = function (ctx, ix, iy) {
    var x = ix, y = iy;
    var t = this.walkFrame % 8;
    var legA = (t < 4) ? 2 : 8;  // 两腿交替摆动
    var legB = (t < 4) ? 8 : 2;

    // 腿
    ctx.fillStyle = '#3a2f28';
    ctx.fillRect(x + 8, y + 24, 6, legA + 2);
    ctx.fillRect(x + 18, y + 24, 6, legB + 2);
    // 身体（向上时背对玩家，色深一档）
    ctx.fillStyle = (this.dir === 'up') ? '#3f3538' : '#5a4a3c';
    ctx.fillRect(x + 5, y + 12, 22, 14);
    // 手臂
    ctx.fillRect(x + 1, y + 14, 4, 9);
    ctx.fillRect(x + 27, y + 14, 4, 9);
    // 头
    ctx.fillStyle = '#cfa277';
    ctx.fillRect(x + 9, y + 2, 14, 12);
    // 眼睛（按面向偏移；向上时画后脑勺两点）
    ctx.fillStyle = '#1c1410';
    if (this.dir === 'down') { ctx.fillRect(x + 12, y + 6, 2, 3); ctx.fillRect(x + 18, y + 6, 2, 3); }
    else if (this.dir === 'left') { ctx.fillRect(x + 11, y + 7, 2, 3); ctx.fillRect(x + 11, y + 11, 2, 3); }
    else if (this.dir === 'right') { ctx.fillRect(x + 19, y + 7, 2, 3); ctx.fillRect(x + 19, y + 11, 2, 3); }
    else { ctx.fillRect(x + 12, y + 5, 2, 3); ctx.fillRect(x + 18, y + 5, 2, 3); }
    // 头发
    ctx.fillStyle = '#2a2220';
    ctx.fillRect(x + 9, y + 1, 14, 3);
  };

  G.Player = Player;
})(window.Game = window.Game || {});
