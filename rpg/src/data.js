/* data.js - 数据注册表（地图 / 剧本节点 / 初始 flag / 技能 / 敌人 / 物品 / 状态效果）
 * 数据文件调用注册接口，引擎只从这里取数据，不关心数据文件怎么产生。 */
(function (G) {
  'use strict';

  var MAPS = {};
  var NODES = {};
  var SKILLS = {};
  var ENEMIES = {};
  var ITEMS = {};
  var EFFECTS = {};

  function reg(store, list) {
    for (var i = 0; i < list.length; i++) store[list[i].id] = list[i];
  }

  G.MAPS = {
    register: function (map) { MAPS[map.id] = map; },
    get: function (id) { return MAPS[id] || null; }
  };

  G.NODES = {
    register: function (list) { reg(NODES, list); },
    get: function (id) { return NODES[id] || null; }
  };

  G.SKILLS = {
    register: function (list) { reg(SKILLS, list); },
    get: function (id) { return SKILLS[id] || null; }
  };

  G.ENEMIES = {
    register: function (list) { reg(ENEMIES, list); },
    get: function (id) { return ENEMIES[id] || null; }
  };

  G.ITEMS = {
    register: function (list) { reg(ITEMS, list); },
    get: function (id) { return ITEMS[id] || null; }
  };

  G.EFFECTS = {
    register: function (list) { reg(EFFECTS, list); },
    get: function (id) { return EFFECTS[id] || null; }
  };

  // 初始 flag 白名单（data/flags.js 声明），首次启动时装载
  G.FLAGS_INIT = G.FLAGS_INIT || {};
})(window.Game = window.Game || {});
