/* input.js - 键盘 + 触摸输入
 * 键盘：方向/WASD 移动；Z=确认；X=取消/菜单；Shift=奔跑（预留）；F1=调试网格
 * 触摸：动态虚拟摇杆（按下处出现，拖动控制方向）；
 *       对话/菜单等场景摇杆禁用（setStickDisabled），改为 tap 点击（dialog 选项命中检测） */
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

  // 虚拟摇杆（动态：出现在手指按下位置，全屏可触）
  var STICK_R = 64;     // 摇杆最大半径（canvas 逻辑像素）
  var DEADZONE = 0.25;  // 方向死区，避免误触
  var stick = { active: false, ox: 0, oy: 0, dx: 0, dy: 0, touchId: null };

  // 点击模式（dialog/menu 用）：短按 → tap 队列
  var stickDisabled = false;
  var press = null;         // {x, y, t} 按下起点（点击模式）
  var tapQueue = [];
  var TAP_DIST = 12;        // 位移阈值（逻辑像素）
  var TAP_TIME = 350;       // 时长阈值（ms）

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
    stick.active = false;
    stick.dx = 0;
    stick.dy = 0;
    press = null;
  });

  // client 坐标 → canvas 逻辑坐标（考虑 CSS 缩放）
  function canvasPos(canvas, clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function resetStick() {
    stick.active = false;
    stick.dx = 0;
    stick.dy = 0;
    stick.touchId = null;
  }

  G.Input = {
    // 由 core.boot 调用，绑定触摸事件（M0 全屏区域即摇杆区）
    bindTouch: function (canvas) {
      canvas.addEventListener('touchstart', function (e) {
        if (stick.active) return; // 只跟第一个手指
        e.preventDefault();
        var t = e.changedTouches[0];
        var p = canvasPos(canvas, t.clientX, t.clientY);
        if (stickDisabled) {
          press = { x: p.x, y: p.y, t: Date.now() };
          return;
        }
        stick.active = true;
        stick.touchId = t.identifier;
        stick.ox = p.x;
        stick.oy = p.y;
        stick.dx = 0;
        stick.dy = 0;
      }, { passive: false });

      canvas.addEventListener('touchmove', function (e) {
        if (stickDisabled || !stick.active) return;
        e.preventDefault();
        for (var i = 0; i < e.changedTouches.length; i++) {
          var t = e.changedTouches[i];
          if (t.identifier !== stick.touchId) continue;
          var p = canvasPos(canvas, t.clientX, t.clientY);
          var dx = p.x - stick.ox, dy = p.y - stick.oy;
          var len = Math.sqrt(dx * dx + dy * dy);
          if (len > STICK_R) { dx = dx / len * STICK_R; dy = dy / len * STICK_R; }
          stick.dx = dx / STICK_R;
          stick.dy = dy / STICK_R;
        }
      }, { passive: false });

      var end = function (e) {
        e.preventDefault();
        if (stickDisabled) {
          // 点击模式：短按且未拖动 → 记录 tap（供 dialog 选项/继续）
          if (press) {
            var t = e.changedTouches[0];
            var p = canvasPos(canvas, t.clientX, t.clientY);
            var dist = Math.abs(p.x - press.x) + Math.abs(p.y - press.y);
            if (dist < TAP_DIST && Date.now() - press.t < TAP_TIME) {
              tapQueue.push({ x: p.x, y: p.y });
            }
            press = null;
          }
          return;
        }
        if (!stick.active) return;
        for (var i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === stick.touchId) resetStick();
        }
      };
      canvas.addEventListener('touchend', end, { passive: false });
      canvas.addEventListener('touchcancel', end, { passive: false });
    },

    held: function (k) {
      if (held[k]) return true;
      if (stick.active) { // 摇杆方向 → 方向键（带死区）
        if (k === 'left') return stick.dx < -DEADZONE;
        if (k === 'right') return stick.dx > DEADZONE;
        if (k === 'up') return stick.dy < -DEADZONE;
        if (k === 'down') return stick.dy > DEADZONE;
      }
      return false;
    },

    pressed: function (k) { return !!justPressed[k]; },

    // 摇杆状态（供 renderer 绘制虚拟摇杆）
    stick: function () { return stick; },

    // 点击模式开关（core 场景切换时调用：explore 用摇杆，dialog/menu 用点击）
    setStickDisabled: function (v) {
      stickDisabled = !!v;
      if (stickDisabled) {
        resetStick();
        press = null;
      }
    },

    // 取走一个未消费的 tap（无则 null）；tap 在场景内消费
    tap: function () {
      return tapQueue.shift() || null;
    },

    clearTouch: function () {
      resetStick();
      press = null;
    },

    endFrame: function () { justPressed = {}; }
  };
})(window.Game = window.Game || {});
