/* map.js - tilemap：字符画解析、碰撞推导、出口检测
 * 数据（data/maps/*.js）为字符画字符串数组，加载时解析为 tile 类型二维数组；
 * 碰撞由地形类型推导（grass 可走 / wall·tree·door 阻挡 / water 减速）；
 * 门（door）初始阻挡，对应 flag 置真后可走（M1 事件系统联动），
 * 不单独维护 collision 层，避免多处数据不一致（设计文档 §4）。 */
(function (G) {
  'use strict';

  var T = { GRASS: 0, WALL: 1, WATER: 2, TREE: 3, DOOR: 4, BED: 5 };

  var SOLID = {};
  SOLID[T.WALL] = true;
  SOLID[T.TREE] = true;

  var SLOW = {};
  SLOW[T.WATER] = true;

  function Map(raw) {
    var legend = raw.legend || { '.': 'grass', '#': 'wall', '~': 'water', 'T': 'tree' };
    var type2tile = { grass: T.GRASS, wall: T.WALL, water: T.WATER, tree: T.TREE, door: T.DOOR, bed: T.BED };
    var char2tile = {};
    for (var ch in legend) char2tile[ch] = type2tile[legend[ch]] || T.GRASS;

    this.id = raw.id;
    this.name = raw.name;
    this.tileSize = raw.tileSize || 32;
    this.width = raw.width;
    this.height = raw.height;
    this.pixelWidth = this.width * this.tileSize;
    this.pixelHeight = this.height * this.tileSize;
    this.exits = raw.exits || [];
    this.triggers = raw.triggers || [];
    this.npcSpawns = raw.npcSpawns || [];
    this.enemySpawns = raw.enemySpawns || []; // [{type,x,y,path:[{x,y}..],battle}]（M2 明雷）
    this.doors = raw.doors || []; // [{x, y, flag}]：flag 为真时门可走

    // 字符画 → tile 类型（缺行/缺列按草地补齐，宽松容错）
    var rows = raw.ground || [];
    this.tiles = [];
    for (var y = 0; y < this.height; y++) {
      var row = rows[y] || '';
      var line = [];
      for (var x = 0; x < this.width; x++) {
        line.push(char2tile[row.charAt(x)] || T.GRASS);
      }
      this.tiles.push(line);
    }
  }

  // 界外一律视为墙（地图永远有闭合边界）
  Map.prototype.tileAt = function (tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return T.WALL;
    return this.tiles[ty][tx];
  };

  // (tx,ty) 处门对应的 flag（无门返回 null）
  Map.prototype.doorFlagAt = function (tx, ty) {
    for (var i = 0; i < this.doors.length; i++) {
      if (this.doors[i].x === tx && this.doors[i].y === ty) return this.doors[i].flag;
    }
    return null;
  };

  Map.prototype.isDoorOpen = function (tx, ty) {
    var flag = this.doorFlagAt(tx, ty);
    return !!flag && !!G.Flags.get(flag);
  };

  Map.prototype.isSolidAt = function (tx, ty) {
    if (this.tileAt(tx, ty) === T.DOOR) return !this.isDoorOpen(tx, ty); // 门：flag 开则放行
    return !!SOLID[this.tileAt(tx, ty)];
  };
  Map.prototype.isSlowAt = function (tx, ty) { return !!SLOW[this.tileAt(tx, ty)]; };

  // 玩家像素矩形中心点落入出口矩形 → 返回该出口
  Map.prototype.exitAt = function (px, py) {
    var ts = this.tileSize;
    for (var i = 0; i < this.exits.length; i++) {
      var e = this.exits[i];
      var x0 = e.x * ts, y0 = e.y * ts;
      var x1 = x0 + (e.w || 1) * ts, y1 = y0 + (e.h || 1) * ts;
      if (px >= x0 && px < x1 && py >= y0 && py < y1) return e;
    }
    return null;
  };

  G.Map = Map;
  G.MAP_TILE = T;
})(window.Game = window.Game || {});
