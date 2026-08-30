/* core.js - 主循环、场景状态机、启动
 * requestAnimationFrame 驱动 + 固定逻辑步（50ms）+ 渲染插值；
 * 场景：explore（探索）/ dialog（对话）/ menu（菜单），switchScene 切换并清理触摸输入；
 * 出口检测 → 切图（重新加载地图 + 重置玩家落点 + 写临时快照）；
 * 交互：Z 对面向 tile 触发 NPC / interact 触发器；中心点进入 enter 触发器区域触发。 */
(function (G) {
  'use strict';

  var STEP = 50; // 固定逻辑步 ms（20 步/秒）
  var canvas = null;
  var acc = 0;
  var last = 0;
  var fpsAcc = 0;
  var fpsFrames = 0;

  var current = 'explore';
  var scene = {
    map: null,
    player: null,
    npcs: [],
    mapId: 'prologue',
    tileX: 10,
    tileY: 60
  };

  // 进入地图：mapId + 落点 tile 坐标（toX/toY）
  function enterMap(mapId, tx, ty) {
    var raw = G.MAPS.get(mapId);
    if (!raw) {
      console.error('地图不存在：' + mapId);
      return;
    }
    scene.map = new G.Map(raw);
    scene.mapId = mapId;
    scene.tileX = tx;
    scene.tileY = ty;
    var ts = scene.map.tileSize;
    var px = tx * ts;
    var py = ty * ts;
    if (!scene.player) {
      scene.player = new G.Player(px, py);
    } else {
      scene.player.x = px;
      scene.player.y = py;
    }
    scene.player.prevX = px;
    scene.player.prevY = py;
    // NPC 生成（每图一份实例）
    scene.npcs = [];
    for (var i = 0; i < scene.map.npcSpawns.length; i++) {
      scene.npcs.push(new G.NPC(scene.map.npcSpawns[i]));
    }
    G.Camera.follow(scene.player);
    G.Camera.update(scene.map);
    G.Save.writeSnapshot(); // 临时快照：刷新自动恢复，防丢进度
    // 地图 autostart 剧情
    if (scene.map.autostart && !G.Events.isDone(scene.map.autostart)) {
      G.Events.run(scene.map.autostart);
    }
  }

  // 交互检测：玩家面向 tile 上的 NPC / interact 触发器（Z 键触发）
  function tryInteract() {
    var ft = scene.player.facingTile(scene.map);
    for (var i = 0; i < scene.npcs.length; i++) {
      if (scene.npcs[i].coverTile(ft.x, ft.y)) {
        G.Events.run(scene.npcs[i].trigger);
        return;
      }
    }
    var trig = scene.map.triggers;
    for (var j = 0; j < trig.length; j++) {
      var t = trig[j];
      if (t.type !== 'interact') continue;
      if (ft.x >= t.x && ft.x < t.x + (t.w || 1) && ft.y >= t.y && ft.y < t.y + (t.h || 1)) {
        G.Events.run(t.node);
        return;
      }
    }
  }

  // 区域触发检测：玩家中心点落入 enter 触发器矩形
  function checkEnterTriggers() {
    var p = scene.player;
    var tx = Math.floor(p.centerX() / scene.map.tileSize);
    var ty = Math.floor(p.centerY() / scene.map.tileSize);
    var trig = scene.map.triggers;
    for (var i = 0; i < trig.length; i++) {
      var t = trig[i];
      if (t.type !== 'enter') continue;
      if (t.once && G.Events.isDone(t.node)) continue;
      if (tx >= t.x && tx < t.x + (t.w || 1) && ty >= t.y && ty < t.y + (t.h || 1)) {
        G.Events.run(t.node);
        return; // 每次只触发一个
      }
    }
  }

  var scenes = {
    explore: {
      enter: function () { G.Input.setStickDisabled(false); },
      update: function () {
        var p = scene.player;
        p.update(scene.map, G.Input);

        // F1 切换调试网格
        if (G.Input.pressed('grid')) G.Renderer.toggleGrid();
        // X/Esc 打开菜单
        if (G.Input.pressed('cancel')) {
          G.UI.open();
          G.Input.endFrame();
          return;
        }
        // Z 交互（面向 tile 的 NPC / 触发器）
        if (G.Input.pressed('confirm')) tryInteract();

        // 出口检测：中心点落入出口矩形 → 切图
        var exit = scene.map.exitAt(p.centerX(), p.centerY());
        if (exit) {
          enterMap(exit.to, exit.toX, exit.toY);
          G.Input.endFrame();
          return;
        }

        checkEnterTriggers();
        G.Status.update(); // 生存状态衰减 + 时钟推进
        G.Camera.update(scene.map);
        G.Input.endFrame(); // 清空本步按键（否则 pressed 永真，单键无限触发）
      },
      render: function (alpha) {
        G.Renderer.render(scene.map, G.Camera, scene.player, scene.npcs, alpha, true);
      }
    },

    dialog: {
      enter: function () { G.Input.setStickDisabled(true); },
      update: function () {
        G.Dialog.update(G.Input);
      },
      render: function (alpha) {
        G.Renderer.render(scene.map, G.Camera, scene.player, scene.npcs, alpha, false);
        G.Dialog.render(G.Renderer.ctx());
      }
    },

    menu: {
      enter: function () { G.Input.setStickDisabled(true); },
      update: function () {
        G.UI.update(G.Input);
      },
      render: function (alpha) {
        G.Renderer.render(scene.map, G.Camera, scene.player, scene.npcs, alpha, false);
      }
    }
  };

  function update() {
    scenes[current].update();
  }

  function renderFrame(alpha) {
    scenes[current].render(alpha);
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

  // 场景切换：先清理触摸输入（防对话打开瞬间摇杆残留）
  function switchScene(name) {
    if (!scenes[name]) {
      console.error('场景不存在：' + name);
      return;
    }
    if (current === name) return;
    current = name;
    G.Input.clearTouch();
    scenes[name].enter();
  }

  G.core = {
    fps: 0,
    sceneName: function () { return current; },
    enterMap: enterMap,
    switchScene: switchScene,
    // 存档收集用：当前地图/玩家 tile 坐标
    current: function () {
      return { mapId: scene.mapId, tileX: scene.tileX, tileY: scene.tileY };
    }
  };

  G.boot = function (canvasEl) {
    canvas = canvasEl;
    G.Renderer.init(canvas);
    G.Input.bindTouch(canvas);
    fitCanvas();
    window.addEventListener('resize', fitCanvas);
    // 手机横竖屏旋转：等旋转动画结束后重新适配
    window.addEventListener('orientationchange', function () {
      setTimeout(fitCanvas, 120);
    });

    G.Flags.init();
    // 优先恢复临时快照（刷新/掉线防丢进度）；无快照则从起点开始
    var snap = G.Save.readSnapshot();
    if (!snap || !G.Save.apply(snap)) {
      enterMap('prologue', 10, 60); // 初始落点：镇口河畔
    }
    last = performance.now();
    requestAnimationFrame(loop);
  };
})(window.Game = window.Game || {});
