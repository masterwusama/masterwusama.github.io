/* =========================================================
 * 跑团桌 · 主控制器 (app.js)
 * Tab 切换 + 各模块初始化
 * ========================================================= */
(function (global) {
  'use strict';

  function initTabs() {
    var tabs = document.querySelectorAll('.dnd-tab-btn');
    var panes = document.querySelectorAll('.dnd-pane');
    tabs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        tabs.forEach(function (b) { b.classList.remove('active'); });
        panes.forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        var pane = document.getElementById('pane-' + btn.dataset.tab);
        if (pane) pane.classList.add('active');
      });
    });
  }

  function initModules() {
    var DnD = global.DnD;
    if (!DnD) return;
    if (DnD.DiceUI) DnD.DiceUI.init();
    if (DnD.CharacterUI) DnD.CharacterUI.init();
    if (DnD.RandomUI) DnD.RandomUI.init();
    if (DnD.SpellUI) DnD.SpellUI.init();
    if (DnD.MonsterUI) DnD.MonsterUI.init();
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTabs();
    initModules();
  });
})(window);
