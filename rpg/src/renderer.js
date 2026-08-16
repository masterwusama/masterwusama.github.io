/* renderer.js - Canvas 分层渲染
 * P0 程序生成 tileset（色块，无 PNG 素材）；视口裁剪只绘制可见 tile；
 * 绘制顺序：地面层 → 玩家 → 树（玩家在树下方时半透明，体现半遮挡）。
 * 调试 HUD：玩家 tile 坐标 / 摄像机偏移 / 可视 tile 范围 / fps，验证"移动后地图同步跟随"。 */
(function (G) {
  'use strict';

  var ctx = null;
  var tiles = null;
  var showGrid = false;
  var gridTogglePending = false;

  /* ---------- 程序生成 tileset ---------- */

  // 确定性伪随机（同参数永远同结果，避免每帧闪烁）
  function rand(n) {
    var v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  }

  function makeTile(paint) {
    var c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    paint(c.getContext('2d'));
    return c;
  }

  function makeTileset() {
    var T = G.MAP_TILE;
    var set = {};

    set[T.GRASS] = makeTile(function (g) {
      g.fillStyle = '#2f4d2b';
      g.fillRect(0, 0, 32, 32);
      for (var i = 0; i < 26; i++) { // 杂点草叶
        var x = Math.floor(rand(i) * 32);
        var y = Math.floor(rand(i * 7 + 3) * 32);
        g.fillStyle = (rand(i * 13) < 0.5) ? '#3a5c30' : '#26401f';
        g.fillRect(x, y, 2, 2);
      }
    });

    set[T.WALL] = makeTile(function (g) {
      g.fillStyle = '#4a4a52';
      g.fillRect(0, 0, 32, 32);
      g.fillStyle = '#3a3a40'; // 砖缝：横线 + 错开竖线
      for (var y = 0; y < 32; y += 8) g.fillRect(0, y, 32, 1);
      for (var x = 0; x < 32; x += 8) { g.fillRect(x, 0, 1, 8); g.fillRect(x + 4, 8, 1, 8); g.fillRect(x, 16, 1, 8); g.fillRect(x + 4, 24, 1, 8); }
      g.fillStyle = '#55555e'; // 顶部高光
      g.fillRect(0, 0, 32, 2);
    });

    set[T.WATER] = makeTile(function (g) {
      g.fillStyle = '#1d3a52';
      g.fillRect(0, 0, 32, 32);
      g.strokeStyle = '#2e5a7d';
      g.lineWidth = 1;
      for (var i = 0; i < 3; i++) { // 波纹横线（错开）
        var y = 6 + i * 9;
        g.beginPath();
        g.moveTo(2, y);
        g.lineTo(12, y + 2);
        g.lineTo(22, y);
        g.lineTo(30, y + 2);
        g.stroke();
      }
    });

    set[T.TREE] = makeTile(function (g) {
      g.fillStyle = '#2f4d2b'; // 草地底
      g.fillRect(0, 0, 32, 32);
      for (var i = 0; i < 18; i++) {
        var x = Math.floor(rand(i + 99) * 32);
        var y = Math.floor(rand(i + 31) * 32);
        g.fillStyle = (rand(i + 7) < 0.5) ? '#3a5c30' : '#26401f';
        g.fillRect(x, y, 2, 2);
      }
      g.fillStyle = '#5a4632'; // 树干
      g.fillRect(13, 22, 6, 10);
      g.fillStyle = '#2c4a26'; // 树冠（双层圆，超出 tile 一点形成遮挡）
      g.beginPath(); g.arc(16, 14, 12, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#37602f';
      g.beginPath(); g.arc(13, 12, 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4a7a3a'; // 高光点
      g.beginPath(); g.arc(10, 8, 3, 0, Math.PI * 2); g.fill();
    });

    return set;
  }

  /* ---------- 渲染 ---------- */

  function init(canvas) {
    ctx = canvas.getContext('2d');
    tiles = makeTileset();
  }

  // alpha ∈ [0,1)：逻辑位置到渲染位置的时间插值（固定步长 + 渲染插值）
  function render(map, camera, player, alpha) {
    var ts = map.tileSize;
    var camX = camera.getX(), camY = camera.getY();

    // 地图小于视口时居中显示
    var offX = Math.max(0, Math.floor((camera.VIEW_W - map.pixelWidth) / 2));
    var offY = Math.max(0, Math.floor((camera.VIEW_H - map.pixelHeight) / 2));

    // 视口裁剪：只遍历可见 tile 区间（大区域地图的核心，不裁剪即逐帧画全图）
    var x0 = Math.max(0, Math.floor(camX / ts));
    var y0 = Math.max(0, Math.floor(camY / ts));
    var x1 = Math.min(map.width - 1, Math.ceil((camX + camera.VIEW_W) / ts));
    var y1 = Math.min(map.height - 1, Math.ceil((camY + camera.VIEW_H) / ts));

    // 玩家渲染位置（插值）
    var ix = player.prevX + (player.x - player.prevX) * alpha;
    var iy = player.prevY + (player.y - player.prevY) * alpha;

    ctx.fillStyle = '#0a0a0d';
    ctx.fillRect(0, 0, camera.VIEW_W, camera.VIEW_H);

    // 第 1 层：非树地面
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        var t = map.tiles[ty][tx];
        if (t === G.MAP_TILE.TREE) continue;
        ctx.drawImage(tiles[t], tx * ts - camX + offX, ty * ts - camY + offY);
      }
    }

    // 第 2 层：实体（渲染位置为插值坐标）
    player.render(ctx, ix, iy);

    // 第 3 层：树（玩家中心在树底之下 → 树半透明，玩家可见）
    for (var ty2 = y0; ty2 <= y1; ty2++) {
      for (var tx2 = x0; tx2 <= x1; tx2++) {
        if (map.tiles[ty2][tx2] !== G.MAP_TILE.TREE) continue;
        var sx = tx2 * ts - camX + offX, sy = ty2 * ts - camY + offY;
        if (iy + player.h / 2 > ty2 * ts + ts - 4) { // 玩家在树"下方"（树在前景）
          ctx.globalAlpha = 0.55;
          ctx.drawImage(tiles[G.MAP_TILE.TREE], sx, sy);
          ctx.globalAlpha = 1;
        } else {
          ctx.drawImage(tiles[G.MAP_TILE.TREE], sx, sy);
        }
      }
    }

    if (showGrid) drawGrid(map, camera, offX, offY, x0, y0, x1, y1);
    drawDebug(map, player, camera, x0, y0, x1, y1, offX, offY);
    drawStick();
  }

  // F1 调试网格：画可见区 tile 边界 + 出口标记
  function drawGrid(map, camera, offX, offY, x0, y0, x1, y1) {
    var ts = map.tileSize;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = x0; x <= x1; x++) {
      ctx.moveTo(x * ts - camera.getX() + offX + 0.5, 0);
      ctx.lineTo(x * ts - camera.getX() + offX + 0.5, camera.VIEW_H);
    }
    for (var y = y0; y <= y1; y++) {
      ctx.moveTo(0, y * ts - camera.getY() + offY + 0.5);
      ctx.lineTo(camera.VIEW_W, y * ts - camera.getY() + offY + 0.5);
    }
    ctx.stroke();
    // 出口矩形标记（红色边框）
    for (var i = 0; i < map.exits.length; i++) {
      var e = map.exits[i];
      ctx.strokeStyle = 'rgba(255,80,80,0.8)';
      ctx.strokeRect(
        e.x * ts - camera.getX() + offX + 0.5,
        e.y * ts - camera.getY() + offY + 0.5,
        (e.w || 1) * ts, (e.h || 1) * ts
      );
    }
  }

  // 虚拟摇杆：触摸设备显示左下角半透明提示圈；激活时在手指处绘制摇杆
  function drawStick() {
    var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    var s = G.Input.stick();
    if (!s.active) {
      if (!isTouch) return;
      var px = 84, py = G.Camera.VIEW_H - 84;
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 40, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '11px sans-serif';
      ctx.fillText('拖动移动', px - 32, py + 58);
      return;
    }
    var R = 64;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.ox, s.oy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath(); ctx.arc(s.ox + s.dx * (R - 22), s.oy + s.dy * (R - 22), 22, 0, Math.PI * 2); ctx.fill();
  }

  // 调试 HUD：验证"移动后范围地图同步跟随"（tile 坐标 / 摄像机 / 可视范围）
  function drawDebug(map, player, camera, x0, y0, x1, y1, offX, offY) {
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(10, 10, 316, 88);
    ctx.fillStyle = '#9fd49f';
    ctx.font = '12px Consolas, "Courier New", monospace';
    var ts = map.tileSize;
    var lines = [
      'map   ' + map.id + '  ' + map.width + 'x' + map.height,
      'tile  (' + Math.floor(player.centerX() / ts) + ', ' + Math.floor(player.centerY() / ts) + ')  '
        + (offX || offY ? 'off(' + offX + ',' + offY + ')' : ''),
      'cam   (' + Math.round(camera.getX()) + ', ' + Math.round(camera.getY()) + ')',
      'view  [' + x0 + '..' + x1 + ', ' + y0 + '..' + y1 + ']  fps ' + G.core.fps
    ];
    for (var i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], 16, 26 + i * 18);
    }
    // 操作提示（触摸设备显示触摸操作）
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '12px sans-serif';
    var tip = (('ontouchstart' in window) || (navigator.maxTouchPoints > 0))
      ? '拖动屏幕移动 · 右端缺口可切图'
      : 'WASD/方向键 移动 · F1 网格 · 右端缺口可切图';
    ctx.fillText(tip, 16, camera.VIEW_H - 14);
  }

  G.Renderer = {
    init: init,
    render: render,
    toggleGrid: function () { showGrid = !showGrid; }
  };
})(window.Game = window.Game || {});
