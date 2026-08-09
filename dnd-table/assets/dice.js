/* =========================================================
 * 跑团桌 · 掷骰引擎 (dice.js)
 * 表达式语法: [数量]d[面数][k保留最大N个]，多个以 + / - 连接
 * 支持: 2d6+3 | 4d6k3 | d20 | d20+1d4+5
 * ========================================================= */
(function (global) {
  'use strict';

  var DnD = global.DnD = global.DnD || {};
  var HISTORY_KEY = 'dnd_dice_history';
  var HISTORY_MAX = 20;

  function rollDie(faces) {
    return Math.floor(Math.random() * faces) + 1;
  }

  /* ---------- 表达式解析 ---------- */
  var TOKEN_RE = /[+-]?\d*d\d*(?:k\d+)?|[+-]?\d+/g;

  function parseExpr(expr) {
    expr = String(expr || '').replace(/\s+/g, '').toLowerCase();
    if (!expr) return { error: '表达式为空' };
    var tokens = expr.match(TOKEN_RE) || [];
    var leftover = expr.replace(TOKEN_RE, '');
    if (leftover) return { error: '无法识别的字符: ' + leftover };
    var parts = [];
    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      var sign = tk.charAt(0) === '-' ? -1 : 1;
      var body = tk.replace(/^[+-]/, '');
      var m = body.match(/^(\d*)d(\d+)(?:k(\d+))?$/);
      if (m) {
        var count = m[1] ? parseInt(m[1], 10) : 1;
        var faces = parseInt(m[2], 10);
        var keep = m[3] ? parseInt(m[3], 10) : count;
        if (count < 1 || count > 100) return { error: '骰子数量无效: ' + tk };
        if (faces < 2 || faces > 1000) return { error: '骰子面数无效: ' + tk };
        if (keep < 1 || keep > count) return { error: '保留数无效: ' + tk };
        parts.push({ type: 'dice', count: count, faces: faces, keep: keep, sign: sign });
      } else if (/^\d+$/.test(body)) {
        parts.push({ type: 'mod', value: parseInt(body, 10) * sign });
      } else {
        return { error: '无法识别: ' + tk };
      }
    }
    return { parts: parts };
  }

  /* ---------- 执行掷骰 ----------
   * opts: { advantage:bool, disadvantage:bool, crit:bool }
   * 返回: { ok, total, groups:[{faces,count,keep,rolls,raw?,kept,dropped,sum}], mods }
   */
  function rollExpr(expr, opts) {
    opts = opts || {};
    var parsed = parseExpr(expr);
    if (parsed.error) return { error: parsed.error };

    var groups = [], mods = 0, advHandled = false;

    for (var i = 0; i < parsed.parts.length; i++) {
      var p = parsed.parts[i];
      if (p.type === 'mod') { mods += p.value; continue; }

      var count = opts.crit ? p.count * 2 : p.count;
      var rolls = [];

      if (p.faces === 20 && !advHandled && (opts.advantage || opts.disadvantage)) {
        advHandled = true;
        var raw = [];
        for (var j = 0; j < p.count; j++) {
          var a = rollDie(20), b = rollDie(20);
          raw.push(a, b);
          rolls.push(opts.advantage ? Math.max(a, b) : Math.min(a, b));
        }
        var sorted = rolls.slice().sort(function (x, y) { return y - x; });
        var kept = sorted.slice(0, p.keep);
        var dropped = sorted.slice(p.keep);
        groups.push({
          faces: 20, count: p.count, keep: p.keep, rolls: rolls,
          raw: raw, adv: opts.advantage ? 'adv' : 'dis',
          kept: kept, dropped: dropped,
          sum: kept.reduce(function (s, v) { return s + v; }, 0) * p.sign
        });
      } else {
        for (var k = 0; k < count; k++) rolls.push(rollDie(p.faces));
        var sorted2 = rolls.slice().sort(function (x, y) { return y - x; });
        var kept2 = sorted2.slice(0, p.keep);
        var dropped2 = sorted2.slice(p.keep);
        groups.push({
          faces: p.faces, count: count, keep: p.keep, rolls: rolls,
          kept: kept2, dropped: dropped2,
          sum: kept2.reduce(function (s, v) { return s + v; }, 0) * p.sign
        });
      }
    }

    var total = mods;
    for (var g = 0; g < groups.length; g++) total += groups[g].sum;

    return { ok: true, total: total, groups: groups, mods: mods };
  }

  /* ---------- 历史记录 ---------- */
  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function pushHistory(entry) {
    var list = loadHistory();
    list.unshift(entry);
    if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) {}
    return list;
  }

  function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
  }

  /* ---------- 结果摘要文本 ---------- */
  function summarize(result) {
    var parts = [];
    result.groups.forEach(function (g) {
      parts.push(g.kept.join('+') + (g.dropped.length ? ' (弃' + g.dropped.join(',') + ')' : ''));
    });
    if (result.mods) parts.push((result.mods > 0 ? '+' : '') + result.mods);
    return parts.join(' ');
  }

  /* =========================================================
   * UI 层 (DiceUI)
   * ========================================================= */
  var DiceUI = {};

  var FACES = [
    { faces: 4, label: 'd4' }, { faces: 6, label: 'd6' },
    { faces: 8, label: 'd8' }, { faces: 10, label: 'd10' },
    { faces: 12, label: 'd12' }, { faces: 20, label: 'd20' },
    { faces: 100, label: 'd100' }
  ];

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /* 数字滚动动画 */
  function animateNum(el, finalText) {
    var frames = 10, i = 0;
    var timer = setInterval(function () {
      if (i < frames) {
        el.textContent = String(Math.floor(Math.random() * 99) + 1);
        i++;
      } else {
        clearInterval(timer);
        el.textContent = finalText;
      }
    }, 50);
  }

  /* 渲染掷骰结果到容器 */
  function renderResult(container, result, label) {
    container.innerHTML = '';
    if (result.error) {
      var errEl = document.createElement('p');
      errEl.className = 'dice-error';
      errEl.textContent = result.error;
      container.appendChild(errEl);
      return;
    }
    var card = document.createElement('div');
    card.className = 'dnd-card dice-result-card';

    var head = document.createElement('div');
    head.className = 'dice-result-head';
    head.innerHTML = '<span class="dice-result-label">' + esc(label) + '</span>';
    card.appendChild(head);

    result.groups.forEach(function (g) {
      var row = document.createElement('div');
      row.className = 'dice-group';
      var chipHtml = '<span class="dice-chip dice-chip-faces">d' + g.faces + '</span>';
      g.kept.forEach(function (v) {
        chipHtml += '<span class="dice-chip">' + v + '</span>';
      });
      g.dropped.forEach(function (v) {
        chipHtml += '<span class="dice-chip dice-chip-drop">' + v + '</span>';
      });
      if (g.adv) {
        chipHtml += '<span class="dice-adv-tag">' + (g.adv === 'adv' ? '优势' : '劣势') + '</span>';
      }
      chipHtml += '<span class="dice-group-sum">' + (g.sum >= 0 ? '+' : '') + g.sum + '</span>';
      row.innerHTML = chipHtml;
      card.appendChild(row);

      if (g.raw) {
        var rawRow = document.createElement('div');
        rawRow.className = 'dice-raw';
        var rawHtml = '';
        for (var i = 0; i < g.raw.length; i += 2) {
          rawHtml += '<span class="dice-chip dice-chip-raw">' + g.raw[i] + ' / ' + g.raw[i + 1] + '</span>';
        }
        rawRow.innerHTML = rawHtml;
        card.appendChild(rawRow);
      }
    });

    if (result.mods) {
      var modRow = document.createElement('div');
      modRow.className = 'dice-group';
      modRow.innerHTML = '<span class="dice-chip dice-chip-faces">修正</span>'
        + '<span class="dice-chip">' + (result.mods > 0 ? '+' : '') + result.mods + '</span>'
        + '<span class="dice-group-sum">' + (result.mods > 0 ? '+' : '') + result.mods + '</span>';
      card.appendChild(modRow);
    }

    var totalEl = document.createElement('div');
    totalEl.className = 'dice-total';
    totalEl.innerHTML = '<span class="dice-total-label">结果</span>'
      + '<span class="dice-total-num">' + result.total + '</span>';
    card.appendChild(totalEl);
    animateNum(totalEl.querySelector('.dice-total-num'), String(result.total));

    container.appendChild(card);
  }

  /* 记录历史并刷新列表 */
  function addHistory(label, result) {
    if (!result.ok) return;
    var entry = { t: Date.now(), label: label, total: result.total, detail: summarize(result) };
    renderHistory(pushHistory(entry));
  }

  function renderHistory(list) {
    var ul = document.getElementById('dice-history');
    if (!ul) return;
    ul.innerHTML = '';
    if (!list.length) {
      ul.innerHTML = '<li class="dice-history-empty">暂无记录</li>';
      return;
    }
    list.forEach(function (h) {
      var li = document.createElement('li');
      var time = new Date(h.t);
      var hh = String(time.getHours()).padStart(2, '0');
      var mm = String(time.getMinutes()).padStart(2, '0');
      li.innerHTML = '<span class="dice-history-time">' + hh + ':' + mm + '</span>'
        + '<span class="dice-history-label">' + esc(h.label) + '</span>'
        + '<span class="dice-history-detail">' + esc(h.detail) + '</span>'
        + '<span class="dice-history-total">' + h.total + '</span>';
      ul.appendChild(li);
    });
  }

  function init() {
    var exprInput = document.getElementById('dice-expr');

    /* 骰子面板 */
    var panel = document.getElementById('dice-panel');
    FACES.forEach(function (f) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dice-btn' + (f.faces === 20 ? ' dice-btn-d20' : '');
      btn.innerHTML = '<span class="dice-btn-label">' + f.label + '</span>';
      btn.title = '掷 d' + f.faces;
      btn.addEventListener('click', function () {
        rollWith('d' + f.faces, {}, 'dice-roll-result');
      });
      panel.appendChild(btn);
    });

    function rollWith(expr, opts, resultId) {
      var result = rollExpr(expr, opts);
      var label = expr
        + (opts.crit ? ' 暴击' : opts.advantage ? ' 优势' : opts.disadvantage ? ' 劣势' : '');
      renderResult(document.getElementById(resultId), result, label);
      addHistory(label, result);
    }

    /* 表达式掷骰 */
    var rollBtn = document.getElementById('dice-roll-btn');
    function rollExprInput() {
      rollWith(exprInput.value.trim() || 'd20', {}, 'expr-result');
    }
    rollBtn.addEventListener('click', rollExprInput);
    exprInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') rollExprInput();
    });

    /* 优势 / 劣势 / 暴击 */
    document.getElementById('dice-adv').addEventListener('click', function () {
      rollWith(exprInput.value.trim() || 'd20', { advantage: true }, 'expr-result');
    });
    document.getElementById('dice-dis').addEventListener('click', function () {
      rollWith(exprInput.value.trim() || 'd20', { disadvantage: true }, 'expr-result');
    });
    document.getElementById('dice-crit').addEventListener('click', function () {
      rollWith(exprInput.value.trim() || 'd20', { crit: true }, 'expr-result');
    });

    /* 历史 */
    document.getElementById('dice-clear-history').addEventListener('click', function () {
      clearHistory();
      renderHistory([]);
    });
    renderHistory(loadHistory());
  }

  DnD.Dice = {
    rollDie: rollDie,
    parseExpr: parseExpr,
    rollExpr: rollExpr
  };
  DnD.DiceUI = { init: init };
})(window);
