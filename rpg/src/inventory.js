/* inventory.js - 背包（M2：消耗品持有/使用，战斗内外通用）
 * 物品数据取自 G.ITEMS（type=use 可用）。内部计数表 { id: count }。
 * use(id) 应用效果（hp/sp/hunger/mind 增减 + cure 解除状态效果），成功返回 true 并扣 1。
 * 装备/材料类物品留待后续里程碑；当前仅消耗品。 */
(function (G) {
  'use strict';

  // 初始背包（新游戏装载；读档时被快照覆盖）
  var START = { bandage: 2, ration: 1 };

  var items = {};

  function reset() {
    items = {};
    for (var k in START) items[k] = START[k];
  }

  G.Inventory = {
    init: function () { reset(); },

    count: function (id) { return items[id] || 0; },
    add: function (id, n) {
      if (!G.ITEMS.get(id)) return; // 未注册物品忽略
      items[id] = (items[id] || 0) + (n || 1);
    },
    remove: function (id, n) {
      if (!items[id]) return false;
      items[id] -= (n || 1);
      if (items[id] <= 0) delete items[id];
      return true;
    },

    // 可用（type=use）物品列表，供菜单展示
    usable: function () {
      var r = [];
      for (var id in items) {
        var def = G.ITEMS.get(id);
        if (def && def.type === 'use') r.push({ id: id, name: def.name, desc: def.desc, count: items[id] });
      }
      r.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
      return r;
    },
    totalKinds: function () {
      var n = 0;
      for (var id in items) if (items[id] > 0) n++;
      return n;
    },

    // 使用消耗品：应用效果并扣减；物品不存在/不可用/数量为 0 → false
    use: function (id) {
      var def = G.ITEMS.get(id);
      if (!def || def.type !== 'use' || !items[id]) return false;
      var eff = def.effect || {};
      if (typeof eff.hp === 'number') G.Status.adjust('hp', eff.hp);
      if (typeof eff.sp === 'number') G.Status.adjust('sp', eff.sp);
      if (typeof eff.hunger === 'number') G.Status.adjust('hunger', eff.hunger);
      if (typeof eff.mind === 'number') G.Status.adjust('mind', eff.mind);
      if (eff.cure) {
        for (var i = 0; i < eff.cure.length; i++) G.Status.removeEffect(eff.cure[i]);
      }
      G.Inventory.remove(id, 1);
      return true;
    },

    // 濒死代价：散落部分物品（每类至多保留 1 个，多余的丢失）
    scatter: function () {
      for (var id in items) {
        if (items[id] > 1) items[id] = 1;
      }
    },

    snapshot: function () { return JSON.parse(JSON.stringify(items)); },
    restore: function (obj) { items = obj ? JSON.parse(JSON.stringify(obj)) : {}; }
  };
})(window.Game = window.Game || {});
