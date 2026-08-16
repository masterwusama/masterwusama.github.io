/* core.js - 主循环、场景管理、启动
 * requestAnimationFrame 驱动 + 固定逻辑步（50ms）+ 渲染插值；
 * 场景对象约定 scene.enter/update/render（M0 仅 EXPLORE）；
 * 出口检测 → 切图（重新加载地图 + 重置玩家落点）。 */
(function (G) {
  'use strict';

  var STEP = 50; // 固定逻辑步 ms（20 步/秒）
  var canvas = null;
  var acc = 0;
  var last = 0;
  var fpsAcc = 0;
  var fpsFrames = 0;

  var scene = {
    map: null,
    player: null,

    // 进入地图：mapId + 落点 tile 坐标（toX/toY）
    enter: function (mapId, tx, ty) {
      var raw = G.MAPS.get(mapId);
      if (!raw) {
        console.error('地图不存在：' + mapId);
        return;
      }
      this.map = new G.Map(raw);
      var ts = this.map.tileSize;
      var px = tx * ts;
      var py = ty * ts;
      if (!this.player) {
        this.player = new G.Player(px, py);
      } else {
        this.player.x = px;
        this.player.y = py;
      }
      this.player.prevX = px;
      this.player.prevY = py;
      G.Camera.follow(this.player);
      // 摄像机瞬移到目标（避免切图后从远处飘过来）
      G.Camera.update(this.map);
    },

    update: function () {
      var p = this.player;
      p.update(this.map, G.Input);

      // F1 切换调试网格
      if (G.Input.pressed('grid')) G.Renderer.toggleGrid();

      // 出口检测：中心点落入出口矩形 → 切图
      var exit = this.map.exitAt(p.centerX(), p.centerY());
      if (exit) {
        this.enter(exit.to, exit.toX, exit.toY);
        G.Input.endFrame();
        return;
      }

      G.Camera.update(this.map);
      G.Input.endFrame();
    },

    render: function (alpha) {
      G.Renderer.render(this.map, G.Camera, this.player, alpha);
    }
  };

  function update() {
    scene.update();
  }

  function renderFrame(alpha) {
    scene.render(alpha);
  }

  function loop(t) {
    requestAnimationFrame(loop);
    var now = t || 0;
    var delta = Math.min(now - last, 250); // 防切后台回来时追帧
    last = now;

    acc += delta;
    var steps = 0;
    while (acc >= STEP && steps < 5) {
      update();
      acc -= STEP;
      steps++;
    }

    // fps 统计（每 500ms 刷新）
    fpsFrames++;
    fpsAcc += delta;
    if (fpsAcc >= 500) {
      G.core.fps = Math.round(fpsFrames * 1000 / fpsAcc);
      fpsAcc = 0;
      fpsFrames = 0;
    }

    renderFrame(Math.max(0, Math.min(1, acc / STEP)));
  }

  // 窗口缩放适配：Canvas 逻辑分辨率固定 800×608（25×19 tile），CSS 等比缩放 + 黑边
  function fitCanvas() {
    var s = Math.min(window.innerWidth / 800, window.innerHeight / 608);
    canvas.style.width = Math.floor(800 * s) + 'px';
    canvas.style.height = Math.floor(608 * s) + 'px';
  }

  G.core = {
    fps: 0
  };

  G.boot = function (canvasEl) {
    canvas = canvasEl;
    G.Renderer.init(canvas);
    fitCanvas();
    window.addEventListener('resize', fitCanvas);

    scene.enter('prologue', 10, 60); // 初始落点：镇口河畔
    last = performance.now();
    requestAnimationFrame(loop);
  };
})(window.Game = window.Game || {});
