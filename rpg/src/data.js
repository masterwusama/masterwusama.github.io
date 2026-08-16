/* data.js - 数据注册表（M0：地图数据注册与获取）
 * 地图数据文件（data/maps/*.js）调用 Game.MAPS.register() 注册，
 * 引擎只从这里取数据，不关心数据文件怎么产生。 */
(function (G) {
  'use strict';

  var MAPS = {};

  G.MAPS = {
    register: function (map) {
      MAPS[map.id] = map;
    },
    get: function (id) {
      return MAPS[id] || null;
    }
  };
})(window.Game = window.Game || {});
