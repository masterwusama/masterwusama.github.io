/* save.js - 存档系统（M1：单槽位手动档 + 临时快照）
 * 手动档：仅在存档点（床休息）写入，Esc 菜单读取；
 * 临时快照：地图切换时自动写入，刷新后自动恢复（不是正式档，仅供防丢进度）。 */
(function (G) {
  'use strict';

  var SAVE_KEY = 'rpg_save_v1';
  var SNAP_KEY = 'rpg_snap_v1';
  var SPAWN_KEY = 'rpg_spawn_v1';

  function readLS(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeLS(key, obj) {
    try {
      localStorage.setItem(key, JSON.stringify(obj));
      return true;
    } catch (e) {
      console.error('存档写入失败：' + e);
      return false;
    }
  }

  // 从运行时状态收集存档数据（core 提供当前地图/玩家位置）
  G.Save = {
    collect: function () {
      var cur = G.core.current();
      var p = G.core.player();
      return {
        version: 1,
        flags: G.Flags.all(),
        nodesDone: G.Events.doneSnapshot(),
        status: G.Status.snapshot(),
        inventory: G.Inventory.snapshot(),
        attr: p ? p.attr : null,
        skills: p ? p.skills : null,
        map: cur.mapId,
        x: cur.tileX,
        y: cur.tileY
      };
    },

    write: function () {
      var cur = G.core.current();
      writeLS(SPAWN_KEY, { map: cur.mapId, x: cur.tileX, y: cur.tileY }); // 记为复活点
      return writeLS(SAVE_KEY, G.Save.collect());
    },
    read: function () {
      var d = readLS(SAVE_KEY);
      return d && d.version === 1 ? d : null;
    },
    has: function () {
      return !!readLS(SAVE_KEY);
    },

    // 复活点（最近一次手动存档位置）；无则默认起点
    spawn: function () {
      var d = readLS(SPAWN_KEY);
      return d && d.map ? d : { map: 'prologue', x: 10, y: 60 };
    },

    // 应用存档/快照到运行时（flags、消费记录、状态、背包、属性、回到地图）
    apply: function (d) {
      if (!d) return false;
      G.Flags.restore(d.flags);
      G.Events.restoreDone(d.nodesDone);
      G.Status.restore(d.status);
      G.Inventory.restore(d.inventory);
      G.core.enterMap(d.map, d.x, d.y);
      var p = G.core.player();
      if (p && d.attr) p.attr = d.attr;
      if (p && d.skills) p.skills = d.skills;
      return true;
    },

    // 临时快照
    writeSnapshot: function () {
      return writeLS(SNAP_KEY, G.Save.collect());
    },
    readSnapshot: function () {
      var d = readLS(SNAP_KEY);
      return d && d.version === 1 ? d : null;
    },
    clearSnapshot: function () {
      try { localStorage.removeItem(SNAP_KEY); } catch (e) { /* ignore */ }
    },

    // 新游戏：清空正式档 + 快照，重置运行状态
    newGame: function () {
      try {
        localStorage.removeItem(SAVE_KEY);
        localStorage.removeItem(SNAP_KEY);
        localStorage.removeItem(SPAWN_KEY);
      } catch (e) { /* ignore */ }
      G.Flags.init();
      G.Events.restoreDone({});
      G.Status.restore({ hp: 100, hunger: 100, mind: 100, sp: 30, maxSp: 30, day: 1, hour: 8 });
      G.Inventory.init();
      G.core.enterMap('prologue', 10, 60);
    }
  };
})(window.Game = window.Game || {});
