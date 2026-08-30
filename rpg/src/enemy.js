/* enemy.js - 敌人实体（M2 明雷：地图可见 + 巡逻/视野追击 + 接触触发战斗）
 * 实例由地图 enemySpawns 生成（位置 + 巡逻路径），类型属性取自 G.ENEMIES。
 * AI：视野内看到玩家 → 追击（向玩家移动）；否则沿巡逻路径移动；
 * 接触（中心距离 < 30）→ 由 core 触发战斗。 */
(function (G) {
  'use strict';

  var TILE = 32;
  var TOUCH_DIST = 30;   // 接触触发半径（像素）

  function Enemy(inst) {
    var data = G.ENEMIES.get(inst.type);
    if (!data) throw new Error('敌人类型不存在：' + inst.type);
    this.type = inst.type;
    this.data = data;
    this.battle = inst.battle;      // 战斗节点 id（触发时 run）
    this.x = inst.x * TILE + TILE / 2;  // 中心像素
    this.y = inst.y * TILE + TILE / 2;
    this.path = inst.path || [];    // 巡逻路径（tile 坐标）
    this.pathIdx = 0;
    this.dir = 'down';
    this.size = data.size || 24;
    this.cooldown = 0;             // 逃跑后接触冷却（逻辑步），防立即重新触发
  }

  Enemy.prototype.centerX = function () { return this.x; };
  Enemy.prototype.centerY = function () { return this.y; };

  // 是否在玩家视野内（欧氏距离）
  Enemy.prototype.seesPlayer = function (player) {
    var sightPx = this.data.sight * TILE;
    var dx = player.centerX() - this.x, dy = player.centerY() - this.y;
    return Math.sqrt(dx * dx + dy * dy) <= sightPx;
  };

  // 接触检测：玩家与敌人中心距离
  Enemy.prototype.touches = function (player) {
    var dx = player.centerX() - this.x, dy = player.centerY() - this.y;
    return Math.sqrt(dx * dx + dy * dy) < TOUCH_DIST;
  };

  // 朝目标点移动（像素速度，避墙）
  function moveToward(self, map, tx, ty, speed) {
    var dx = tx - self.x, dy = ty - self.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;
    var nx = self.x + dx / len * speed;
    var ny = self.y + dy / len * speed;
    // 简化碰撞：目标格非墙才移动（按轴分离）
    var ts = map.tileSize;
    if (!map.isSolidAt(Math.floor(nx / ts), Math.floor(self.y / ts))) self.x = nx;
    if (!map.isSolidAt(Math.floor(self.x / ts), Math.floor(ny / ts))) self.y = ny;
    // 更新朝向（渲染用）
    if (Math.abs(dx) > Math.abs(dy)) self.dir = dx > 0 ? 'right' : 'left';
    else self.dir = dy > 0 ? 'down' : 'up';
  }

  Enemy.prototype.update = function (map, player) {
    if (this.seesPlayer(player)) {
      // 追击：向玩家移动
      moveToward(this, map, player.centerX(), player.centerY(), this.data.chaseSpeed * 2);
      return;
    }
    // 巡逻：沿路径点移动
    if (this.path.length > 0) {
      var p = this.path[this.pathIdx];
      var px = p.x * TILE + TILE / 2, py = p.y * TILE + TILE / 2;
      var dx = px - this.x, dy = py - this.y;
      if (Math.sqrt(dx * dx + dy * dy) < 4) {
        this.pathIdx = (this.pathIdx + 1) % this.path.length;
      } else {
        moveToward(this, map, px, py, this.data.patrolSpeed * 2);
      }
    }
  };

  // P0 占位绘制：色块敌人（主体 + 眼睛朝向 + 轮廓）
  Enemy.prototype.render = function (ctx) {
    var s = this.size;
    var x = this.x - s / 2, y = this.y - s / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; // 阴影
    ctx.beginPath(); ctx.ellipse(this.x, this.y + s / 2, s / 2, s / 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = this.data.color;
    ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    // 眼睛（按朝向偏移，红色 = 警戒）
    ctx.fillStyle = '#e04040';
    var ex = this.x, ey = this.y;
    if (this.dir === 'left') ex -= 4;
    if (this.dir === 'right') ex += 4;
    if (this.dir === 'up') ey -= 4;
    if (this.dir === 'down') ey += 4;
    ctx.fillRect(ex - 5, ey - 1, 3, 3);
    ctx.fillRect(ex + 2, ey - 1, 3, 3);
  };

  G.Enemy = Enemy;
})(window.Game = window.Game || {});
