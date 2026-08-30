/* event.js - 事件系统核心：flag 读写 + 剧本节点解释执行
 * 触发源（interact/enter 触发器、NPC）→ G.Events.run(nodeId)：
 * - cond 不满足 → 拒绝触发；dialog 节点 → 切入 DIALOG 场景；
 * - effect 节点 → 立即应用效果（flag/数值/存档/时间）后按 goto 链继续（深度限制防环）；
 * - once 节点结束后记入 nodesDone（本地消费记录，随存档保存）。 */
(function (G) {
  'use strict';

  var store = {};
  var nodesDone = {};
  var MAX_DEPTH = 20;

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  /* ---------- flag 系统（唯一状态真相） ---------- */
  G.Flags = {
    init: function () {
      store = clone(G.FLAGS_INIT || {});
    },
    get: function (k) { return store[k]; },
    set: function (k, v) { store[k] = v; },
    all: function () { return clone(store); },
    restore: function (obj) {
      store = clone(obj || {});
    }
  };

  /* ---------- 条件求值 ---------- */
  function evalCond(c) {
    if (!c) return true;
    var v = G.Flags.get(c.flag);
    switch (c.op) {
      case '==': return v === c.val;
      case '!=': return v !== c.val;
      case '>': return v > c.val;
      case '<': return v < c.val;
      case '>=': return v >= c.val;
      case '<=': return v <= c.val;
    }
    return false;
  }

  /* ---------- effect 应用 ---------- */
  function applyEffect(eff) {
    if (!eff) return;
    if (typeof eff.flag === 'string') {
      G.Flags.set(eff.flag, eff.val);
    }
    if (typeof eff.hp === 'number') G.Status.adjust('hp', eff.hp);
    if (typeof eff.hunger === 'number') G.Status.adjust('hunger', eff.hunger);
    if (typeof eff.mind === 'number') G.Status.adjust('mind', eff.mind);
    if (typeof eff.time === 'number') G.Status.advanceHours(eff.time);
    if (eff.action === 'save') G.Save.write();
  }

  function applyEffects(list) {
    for (var i = 0; i < list.length; i++) applyEffect(list[i]);
  }

  /* ---------- 节点执行 ---------- */
  function afterNode(node) {
    if (node.once) nodesDone[node.id] = true;
  }

  function run(id, depth) {
    depth = depth || 0;
    if (depth > MAX_DEPTH) {
      console.error('节点链过深（疑似死循环）：' + id);
      return;
    }
    var node = G.NODES.get(id);
    if (!node) {
      console.error('节点不存在：' + id);
      return;
    }
    if (node.once && G.Events.isDone(id)) return; // once 已消费，幂等拒绝（interact 亦可重复触发）
    if (!evalCond(node.cond)) return; // 条件不满足，拒绝触发

    if (node.type === 'dialog') {
      G.Dialog.start(node);
      return; // 对话结束后由 Dialog 回调继续 goto 链
    }
    if (node.type === 'battle') {
      // 明雷/触发器进入战斗：交由 Battle 子状态机，胜负分支在战斗结束时由 core 触发
      afterNode(node);
      G.Battle.start(node.enemies || [], {
        player: G.core.player(),
        win: node.win || null,
        lose: node.lose || null
      });
      G.core.switchScene('battle');
      return;
    }
    if (node.type === 'effect') {
      applyEffects(node.effects || []);
      afterNode(node);
      if (node.goto) run(node.goto, depth + 1);
      return;
    }
    console.error('未知节点类型：' + node.type + ' (' + id + ')');
  }

  // 对话结束回调（Dialog 选择 goto 后调用）：标记 once、写快照（防刷新重放剧情）并继续链
  function dialogEnded(node, nextId) {
    afterNode(node);
    G.Save.writeSnapshot();
    if (nextId) run(nextId, 1);
  }

  G.Events = {
    run: run,
    dialogEnded: dialogEnded,
    isDone: function (id) { return !!nodesDone[id]; },
    evalCond: evalCond,
    applyEffect: applyEffect, // 供 Dialog 选项 effect 复用
    // 存档用：导出/恢复消费记录
    doneSnapshot: function () { return clone(nodesDone); },
    restoreDone: function (obj) { nodesDone = clone(obj || {}); }
  };
})(window.Game = window.Game || {});
