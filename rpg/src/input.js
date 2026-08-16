/* input.js - 键盘输入
 * 方向/WASD 移动；Z=确认；X=取消/菜单；Shift=奔跑（预留）；F1=调试网格
 * held()：长按状态；pressed()：本逻辑步内刚按下（逻辑步末由 core 清空） */
(function (G) {
  'use strict';

  var held = {};
  var justPressed = {};

  var KEYMAP = {
    37: 'left',  65: 'left',    // ← / A
    39: 'right', 68: 'right',   // → / D
    38: 'up',    87: 'up',      // ↑ / W
    40: 'down',  83: 'down',    // ↓ / S
    90: 'confirm', 13: 'confirm', // Z / Enter
    88: 'cancel', 27: 'cancel',   // X / Esc
    16: 'run',                     // Shift
    112: 'grid'                    // F1
  };

  window.addEventListener('keydown', function (e) {
    var k = KEYMAP[e.keyCode];
    if (!k) return;
    e.preventDefault(); // 阻止方向键滚动页面
    if (!held[k]) justPressed[k] = true;
    held[k] = true;
  });

  window.addEventListener('keyup', function (e) {
    var k = KEYMAP[e.keyCode];
    if (k) held[k] = false;
  });

  // 切窗口时可能丢失 keyup，导致按键"卡住"，失焦一律清空
  window.addEventListener('blur', function () {
    held = {};
    justPressed = {};
  });

  G.Input = {
    held: function (k) { return !!held[k]; },
    pressed: function (k) { return !!justPressed[k]; },
    endFrame: function () { justPressed = {}; }
  };
})(window.Game = window.Game || {});
