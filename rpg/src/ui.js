/* ui.js - Esc 菜单（M1：状态查看 + 读取存档 + 新游戏；RMMV 风 DOM 窗口）
 * 打开时切入 MENU 场景（暂停探索）；键盘上下选择 + Z 确认 + X/Esc 关闭；
 * 触摸直接点击菜单项。后续里程碑扩展物品/装备/存槽位。 */
(function (G) {
  'use strict';

  var el = null;      // 菜单根元素
  var items = [];     // 当前菜单项（DOM li）
  var idx = 0;
  var mode = 'main';  // main | items
  var built = false;

  function build() {
    if (built) return;
    built = true;
    el = document.createElement('div');
    el.style.cssText = [
      'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
      'width:340px', 'background:rgba(24,18,12,0.96)', 'border:2px solid #d8c8a8',
      'box-shadow:0 0 0 1px #000, 0 0 24px rgba(0,0,0,0.7)', 'z-index:50',
      'font:15px "Noto Serif SC", Georgia, serif', 'color:#f0e6d0', 'user-select:none'
    ].join(';');
    el.innerHTML =
      '<div style="padding:10px 16px;border-bottom:1px solid #4a3c2a;letter-spacing:4px;font-size:17px">菜单</div>' +
      '<ul id="g-ui-list" style="list-style:none;margin:0;padding:6px 0"></ul>' +
      '<div id="g-ui-status" style="padding:8px 16px 10px;border-top:1px solid #4a3c2a;color:#b8a888;font-size:13px;line-height:1.7"></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      var li = e.target.closest('li');
      if (li && li.dataset && li.dataset.action) {
        G.UI.select(parseInt(li.dataset.index, 10));
      }
    });
  }

  function menuDefs() {
    return [
      { action: 'status', label: '状态' },
      { action: 'items', label: '物品' },
      { action: 'load', label: '读取存档', enabled: G.Save.has() },
      { action: 'new', label: '新游戏' },
      { action: 'close', label: '关闭' }
    ];
  }

  function itemDefs() {
    var list = G.Inventory.usable();
    var defs = [];
    for (var i = 0; i < list.length; i++) {
      defs.push({ action: 'use:' + list[i].id, label: list[i].name + ' ×' + list[i].count + '　' + (list[i].desc || '') });
    }
    if (!defs.length) defs.push({ action: 'noop', label: '（没有可用的物品）', enabled: false });
    defs.push({ action: 'back', label: '← 返回' });
    return defs;
  }

  function refreshList() {
    var defs = mode === 'items' ? itemDefs() : menuDefs();
    var ul = el.querySelector('#g-ui-list');
    ul.innerHTML = '';
    items = [];
    for (var i = 0; i < defs.length; i++) {
      var li = document.createElement('li');
      li.dataset.action = defs[i].action;
      li.dataset.index = i;
      li.textContent = defs[i].label;
      li.style.cssText = 'padding:8px 16px;cursor:pointer';
      if (defs[i].enabled === false) li.style.color = '#6a5c48';
      ul.appendChild(li);
      items.push({ action: defs[i].action, enabled: defs[i].enabled !== false, li: li });
    }
    idx = 0;
    highlight();
  }

  function highlight() {
    for (var i = 0; i < items.length; i++) {
      items[i].li.style.background = i === idx && items[i].enabled ? 'rgba(216,200,168,0.22)' : 'transparent';
    }
  }

  function refreshStatus() {
    var box = el.querySelector('#g-ui-status');
    var s = G.Status;
    var eff = '';
    var ids = s.effectIds();
    if (ids.length) {
      var names = [];
      for (var i = 0; i < ids.length; i++) { var d = G.EFFECTS.get(ids[i]); names.push(d ? d.name : ids[i]); }
      eff = '　异常：' + names.join('/');
    }
    box.textContent = 'HP ' + s.hp + ' / SP ' + s.sp + ' / 饥饿 ' + s.hunger + ' / 精神 ' + s.mind +
      ' / 金币 ' + s.gold + '　' + s.timeText() + eff;
  }

  G.UI = {
    open: function () {
      build();
      mode = 'main';
      refreshList();
      refreshStatus();
      el.style.display = 'block';
      G.core.switchScene('menu');
    },
    close: function () {
      if (el) el.style.display = 'none';
      G.core.switchScene('explore');
    },
    isOpen: function () {
      return !!el && el.style.display === 'block';
    },

    // 执行菜单项（键盘确认 / 触摸点击共用入口）
    select: function (i) {
      var it = items[i];
      if (!it || !it.enabled) return;
      var act = it.action;
      if (act.indexOf('use:') === 0) {
        var id = act.slice(4);
        if (G.Inventory.use(id)) { G.Save.writeSnapshot(); }
        refreshList(); refreshStatus();
        return;
      }
      switch (act) {
        case 'status': refreshStatus(); break;
        case 'items': mode = 'items'; refreshList(); break;
        case 'back': mode = 'main'; refreshList(); break;
        case 'load':
          if (G.Save.apply(G.Save.read())) {
            G.UI.close();
          }
          break;
        case 'new':
          if (confirm('确定要开始新游戏吗？当前存档会被清除。')) {
            G.Save.newGame();
            G.UI.close();
          }
          break;
        case 'close': G.UI.close(); break;
      }
    },

    update: function (input) {
      if (input.pressed('up')) { idx = (idx - 1 + items.length) % items.length; highlight(); }
      if (input.pressed('down')) { idx = (idx + 1) % items.length; highlight(); }
      if (input.pressed('confirm')) G.UI.select(idx);
      if (input.pressed('cancel')) G.UI.close();
      G.Input.endFrame(); // 消费本步按键，防单键在菜单内连发
    }
  };
})(window.Game = window.Game || {});
