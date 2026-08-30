/* data.js - 数据注册表（地图 / 剧本节点 / 初始 flag）
 * 数据文件（data/maps/*.js、data/story/*.js、data/flags.js）调用注册接口，
 * 引擎只从这里取数据，不关心数据文件怎么产生。 */
(function (G) {
  'use strict';

  var MAPS = {};
  var NODES = {};

  G.MAPS = {
    register: function (map) {
      MAPS[map.id] = map;
    },
    get: function (id) {
      return MAPS[id] || null;
    }
  };

  G.NODES = {
    register: function (list) {
      for (var i = 0; i < list.length; i++) {
        NODES[list[i].id] = list[i];
      }
    },
    get: function (id) {
      return NODES[id] || null;
    }
  };

  // 初始 flag 白名单（data/flags.js 声明），首次启动时装载
  G.FLAGS_INIT = G.FLAGS_INIT || {};
})(window.Game = window.Game || {});
