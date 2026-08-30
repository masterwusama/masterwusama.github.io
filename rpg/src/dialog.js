/* dialog.js - 对话窗口（RMMV 风 canvas 绘制）
 * 打字机逐字显示（按 Z/触摸空白处快进）；选项列表：方向键+Z 选择，触摸直接点选；
 * need 不满足的选项置灰不可选；选择后应用 effect 并按 goto 继续节点链。 */
(function (G) {
  'use strict';

  var W = 720, H = 152;          // 窗口尺寸
  var PAD = 14;                  // 内边距
  var LINE_H = 24;               // 文本行高
  var OPT_H = 26;                // 选项行高
  var CHARS_PER_STEP = 2;        // 每个逻辑步推进字符数（打字机速度）

  var D = {
    node: null,
    texts: [],
    ti: 0,          // 当前文本段索引
    chars: 0,       // 当前段已显示字符数
    state: 'typing', // typing | choices | done
    choiceIdx: 0,
    _step: 0
  };

  function ox() { return (G.Renderer.viewW() - W) / 2; }
  function oy() { return G.Renderer.viewH() - H - 18; }

  D.start = function (node) {
    D.node = node;
    D.texts = node.text || [];
    D.ti = 0;
    D.chars = 0;
    D.state = 'typing';
    D.choiceIdx = 0;
    D._step = 0;
    G.core.switchScene('dialog');
  };

  D.visibleChoices = function () {
    var list = D.node.choices || [];
    return list.filter(function (c) {
      return !c.need || G.Events.evalCond(c.need);
    });
  };

  D.choosing = function () {
    return D.node && (D.node.choices && D.node.choices.length > 0) && D.state === 'choices';
  };

  // 选项在窗口内的行位置（供触摸命中检测）
  D.choiceRect = function (i) {
    var list = D.visibleChoices();
    var y = oy() + H - PAD - (list.length - i) * OPT_H;
    return { x: ox() + PAD, y: y, w: W - PAD * 2, h: OPT_H };
  };

  function advanceText() {
    D.chars++;
  }

  function showAll() {
    D.chars = D.texts[D.ti].length;
  }

  // 当前段打字完毕 → 进入下一段/选项
  function nextSegment() {
    if (D.ti < D.texts.length - 1) {
      D.ti++;
      D.chars = 0;
      D.state = 'typing';
    } else if (D.node.choices && D.node.choices.length > 0) {
      D.state = 'choices';
    } else {
      D.state = 'done';
    }
  }

  function confirmChoice(idx) {
    var list = D.visibleChoices();
    var choice = list[idx];
    if (!choice) return;
    G.Events.applyEffect(choice.effect);
    var node = D.node;
    var nextId = choice.goto;
    D.node = null;
    G.Events.dialogEnded(node, nextId); // 结束当前节点 → 继续链（下一个 dialog 会再次 start）
    if (!nextId) G.core.switchScene('explore');
  }

  D.update = function (input) {
    if (D.state === 'typing') {
      D._step++;
      if (D._step % 2 === 0) advanceText();
      if (D.chars >= (D.texts[D.ti] || '').length) nextSegment();
      if (input.pressed('confirm') || input.tap()) showAll(); // 快进：显示全文
    } else if (D.state === 'choices') {
      var list = D.visibleChoices();
      if (input.pressed('up')) { D.choiceIdx = (D.choiceIdx - 1 + list.length) % list.length; }
      if (input.pressed('down')) { D.choiceIdx = (D.choiceIdx + 1) % list.length; }
      if (input.pressed('confirm')) { confirmChoice(D.choiceIdx); }
      else if (input.pressed('cancel')) { confirmChoice(list.length - 1); } // X = 选最后一项（离开）
      else {
        var tap = input.tap();
        if (tap) {
          var hit = -1;
          for (var i = 0; i < list.length; i++) {
            var r = D.choiceRect(i);
            if (tap.x >= r.x && tap.x < r.x + r.w && tap.y >= r.y && tap.y < r.y + r.h) hit = i;
          }
          if (hit >= 0) confirmChoice(hit);
          else nextSegment(); // 点空白 → 跳过/继续
        }
      }
    } else if (D.state === 'done') {
      // 无选项的纯文本段，Z/触摸继续（回到探索）
      if (input.pressed('confirm') || input.tap()) {
        var node = D.node;
        D.node = null;
        G.Events.dialogEnded(node, null);
        G.core.switchScene('explore');
      }
    }
    G.Input.endFrame(); // 消费本步按键，防单键在对话内链式触发（所有分支统一出口）
  };

  D.render = function (ctx) {
    if (!D.node) return;
    var x = ox(), y = oy();

    ctx.fillStyle = 'rgba(24, 18, 12, 0.94)';
    ctx.fillRect(x, y, W, H);
    ctx.strokeStyle = '#d8c8a8';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1, y + 1, W - 2, H - 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.strokeRect(x + 5, y + 5, W - 10, H - 10);

    ctx.fillStyle = '#f0e6d0';
    ctx.font = '16px "Noto Serif SC", Georgia, serif';
    ctx.textBaseline = 'top';

    if (D.state === 'typing' || D.state === 'done') {
      var full = D.texts[D.ti] || '';
      var shown = D.state === 'done' ? full : full.slice(0, D.chars);
      // 按行截断绘制（窗口内最多 4 行）
      var words = shown;
      var lines = [];
      while (words.length > 0 && lines.length < 4) {
        var cut = words.length;
        while (cut > 0 && ctx.measureText(words.slice(0, cut)).width > W - PAD * 2 - 10) cut--;
        lines.push(words.slice(0, cut));
        words = words.slice(cut);
      }
      for (var i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x + PAD, y + PAD + i * LINE_H);
      }
      // 打字中显示闪烁光标
      if (D.state === 'typing' && (D._step >> 3) % 2 === 0) {
        ctx.fillRect(x + PAD + ctx.measureText(lines.join('')).width + 2, y + PAD + (lines.length - 1) * LINE_H + 2, 2, 16);
      }
      return;
    }

    // choices：文本区 3 行 + 选项区
    var textLines = [];
    for (var t = 0; t <= D.ti; t++) {
      var seg = D.texts[t];
      while (seg.length > 0 && textLines.length < 3) {
        var c = seg.length;
        while (c > 0 && ctx.measureText(seg.slice(0, c)).width > W - PAD * 2 - 10) c--;
        textLines.push(seg.slice(0, c));
        seg = seg.slice(c);
      }
    }
    for (var li = 0; li < textLines.length; li++) {
      ctx.fillText(textLines[li], x + PAD, y + PAD + li * LINE_H);
    }

    var list = D.visibleChoices();
    for (var ci = 0; ci < list.length; ci++) {
      var r = D.choiceRect(ci);
      if (ci === D.choiceIdx) {
        ctx.fillStyle = 'rgba(216, 200, 168, 0.22)';
        ctx.fillRect(r.x - 6, r.y - 2, r.w + 12, OPT_H);
        ctx.fillStyle = '#ffe9c0';
      } else {
        ctx.fillStyle = '#c8b898';
      }
      ctx.fillText('· ' + list[ci].text, r.x + 4, r.y + 6);
    }
  };

  G.Dialog = D;
})(window.Game = window.Game || {});
