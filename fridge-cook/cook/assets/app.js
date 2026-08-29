/**
 * app.js —— 冰箱做菜 核心逻辑
 *
 * 模块划分：
 *   数据加载与归一化  / 状态管理 / 食材交互 / 匹配引擎 / 结果渲染
 *   购物清单 / 万能公式兜底 / 菜谱库视图 / 详情弹层 / 数据管理
 *
 * 匹配引擎要点：
 *   得分 = 主料命中×5 + 辅料命中×2 + 用掉食材数×1 + 紧急食材命中×3
 *   分档：能做 / 差一点（缺料可替代）/ 凑不出
 */

(function () {
  'use strict';

  var Store = window.FridgeStore;

  /* ==================== 常量 ==================== */

  var TOOL_OPTIONS = ['灶台', '电饭煲', '微波炉', '空气炸锅', '烤箱'];
  var DIFF_OPTIONS = [{ v: 0, t: '不限' }, { v: 1, t: '★ 零基础' }, { v: 2, t: '★★ 有点要求' }, { v: 3, t: '★★★ 需要技巧' }];
  var SORT_OPTIONS = [
    { v: 'fridge', t: '清冰箱优先' },
    { v: 'least', t: '缺料最少' },
    { v: 'fast', t: '最快上桌' }
  ];
  var EATEN_MAX = 5;      // 防重复：最近做过的菜数量
  var HISTORY_MAX = 10;   // 输入历史条数

  /* ==================== 全局状态 ==================== */

  var DB = { meta: null, recipes: [], alias: {}, index: {} };  // 菜谱库
  var state = Store.state();                                    // 用户状态（内部引用，修改即同步到存储）
  var sel = { tools: null, difficulty: 0, maxTime: 0, sort: 'fridge', search: '', cat: '', favOnly: false };
  var ingredientsIndex = []; // 全部食材标准名（联想用）

  /* ==================== 工具函数 ==================== */

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 食材名归一化：去空白 + 别名映射到标准名 */
  function norm(name) {
    var n = String(name || '').trim().replace(/\s+/g, '');
    if (!n) return '';
    // 支持"半根黄瓜""3个鸡蛋"这类量词前缀，提取食材名
    n = n.replace(/^(半根|一根|半个|一个|两个|三个|几根|几个|一点|少许|适量|剩|一些|1个|2个|3个|1根|2根|3根|小半个|大半个|一小把|一把)/, '');
    return DB.alias[n] || n;
  }

  function saveState(debounce) { Store.update({}, debounce); }

  /* ==================== 数据加载 ==================== */

  function buildIndex() {
    DB.index = {};
    DB.recipes.forEach(function (r) {
      DB.index[r.id] = r;
      (r.main || []).forEach(function (i) { ingredientsIndex.push(i); });
      (r.minor || []).forEach(function (i) { ingredientsIndex.push(i); });
      Object.keys(r.alt || {}).forEach(function (k) { ingredientsIndex.push(k); });
    });
    ingredientsIndex = Array.from(new Set(ingredientsIndex)).sort(function (a, b) { return a.localeCompare(b, 'zh'); });
  }

  function loadRecipes() {
    return fetch('./data/recipes.json')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        DB.meta = data.meta || {};
        DB.recipes = data.recipes || [];
        DB.alias = DB.meta.alias || {};
        buildIndex();
        renderAll();
      })
      .catch(function (e) {
        var el = document.createElement('div');
        el.className = 'fc-error';
        el.textContent = '菜谱库加载失败：' + e.message + '。请刷新重试。';
        $('fc-result').appendChild(el);
      });
  }

  /* ==================== 食材交互 ==================== */

  function toggleFridge(name, urgentOnly) {
    name = norm(name);
    if (!name) return;
    var i = state.fridge.indexOf(name);
    if (i >= 0) {
      if (urgentOnly) { return; } // 长按逻辑走 markUrgent
      state.fridge.splice(i, 1);
      var u = state.urgent.indexOf(name);
      if (u >= 0) state.urgent.splice(u, 1);
    } else {
      state.fridge.push(name);
      if (state.common.indexOf(name) < 0) state.common.push(name);
    }
    Store.update({}, 300);
    renderFridge();
    renderMatch();
  }

  /** 长按标记快过期（500ms） */
  function markUrgent(name) {
    name = norm(name);
    if (!name || state.fridge.indexOf(name) < 0) return;
    var i = state.urgent.indexOf(name);
    if (i >= 0) state.urgent.splice(i, 1);
    else state.urgent.push(name);
    Store.update({}, 300);
    renderFridge();
    renderMatch();
  }

  function pushHistory(list) {
    state.history = state.history.filter(function (h) { return h.join(',') !== list.join(','); });
    state.history.unshift(list.slice());
    state.history = state.history.slice(0, HISTORY_MAX);
    Store.update({}, 300);
  }

  function renderFridge() {
    var box = $('fc-fridge');
    box.innerHTML = '';
    if (!state.fridge.length) {
      box.innerHTML = '<span class="fc-empty-hint">冰箱空空如也，先添加食材</span>';
      return;
    }
    state.fridge.forEach(function (name) {
      var chip = document.createElement('button');
      chip.className = 'fc-chip' + (state.urgent.indexOf(name) >= 0 ? ' is-urgent' : '');
      chip.textContent = (state.urgent.indexOf(name) >= 0 ? '⭐' : '') + name;
      chip.title = '点击移除 · 长按标记快过期';
      chip.addEventListener('click', function () { toggleFridge(name); });
      var t;
      chip.addEventListener('pointerdown', function () {
        t = setTimeout(function () { markUrgent(name); chip.classList.add('is-flash'); }, 500);
      });
      chip.addEventListener('pointerup', function () { clearTimeout(t); });
      chip.addEventListener('pointerleave', function () { clearTimeout(t); });
      box.appendChild(chip);
    });

    // 常用食材（去掉已在冰箱里的）
    var common = Array.from(new Set(state.common)).filter(function (n) { return state.fridge.indexOf(n) < 0; });
    var cb = $('fc-common');
    cb.innerHTML = '';
    common.slice(0, 12).forEach(function (name) {
      var chip = document.createElement('button');
      chip.className = 'fc-chip fc-chip-light';
      chip.textContent = name;
      chip.addEventListener('click', function () { toggleFridge(name); });
      cb.appendChild(chip);
    });
  }

  /** 输入联想 */
  function renderSuggest() {
    var q = norm($('fc-input').value);
    var box = $('fc-suggest');
    if (!q || !q.length) { box.hidden = true; box.innerHTML = ''; return; }
    var hits = ingredientsIndex
      .filter(function (i) { return i.indexOf(q) >= 0 && state.fridge.indexOf(i) < 0; })
      .slice(0, 8);
    box.innerHTML = '';
    if (!hits.length) { box.hidden = true; return; }
    box.hidden = false;
    hits.forEach(function (name) {
      var item = document.createElement('button');
      item.className = 'fc-suggest-item';
      item.textContent = name;
      item.addEventListener('click', function () {
        toggleFridge(name);
        $('fc-input').value = '';
        renderSuggest();
      });
      box.appendChild(item);
    });
  }

  /* ==================== 匹配引擎 ==================== */

  /**
   * 评估单道菜。
   * 缺失食材若在 alt 中有替代品且替代品在冰箱里 → 视为命中（计入 altUsed）。
   */
  function evaluate(r, fridgeSet, urgentSet) {
    var mainMiss = [], minorMiss = [], altUsed = [];
    function hit(name, missingList) {
      if (fridgeSet.has(name)) return true;
      var alts = (r.alt || {})[name] || [];
      for (var i = 0; i < alts.length; i++) {
        if (fridgeSet.has(alts[i])) { altUsed.push(name + '→' + alts[i]); return true; }
      }
      missingList.push(name);
      return false;
    }
    (r.main || []).forEach(function (i) { hit(i, mainMiss); });
    (r.minor || []).forEach(function (i) { hit(i, minorMiss); });

    var used = [];
    state.fridge.forEach(function (f) {
      if ((r.main || []).indexOf(f) >= 0 || (r.minor || []).indexOf(f) >= 0) used.push(f);
    });
    var urgentUsed = used.filter(function (f) { return urgentSet.has(f); });

    // 分档：
    // 能做：主料全命中，辅料缺 ≤1
    // 差一点：主料缺 ≤1 且缺的主料可用替代，或辅料缺 2
    // 凑不出：其余
    var tier;
    if (mainMiss.length === 0 && minorMiss.length <= 1) tier = 1;
    else if ((mainMiss.length === 0 && minorMiss.length === 2) ||
             (mainMiss.length === 1 && minorMiss.length <= 2)) tier = 2;
    else tier = 3;

    var score = (r.main.length - mainMiss.length) * 5
      + (r.minor.length - minorMiss.length) * 2
      + used.length
      + urgentUsed.length * 3;

    return {
      r: r, tier: tier, score: score,
      mainMiss: mainMiss, minorMiss: minorMiss,
      used: used, urgentUsed: urgentUsed, altUsed: altUsed
    };
  }

  /** 对全部菜谱匹配并排序 */
  function matchAll() {
    var fridgeSet = new Set(state.fridge);
    var urgentSet = new Set(state.urgent);
    var rows = [];
    DB.recipes.forEach(function (r) {
      // 工具过滤
      if (sel.tools && r.tools && r.tools.indexOf(sel.tools) < 0) return;
      // 难度过滤
      if (sel.difficulty && (r.difficulty || 1) > sel.difficulty) return;
      // 时间过滤
      if (sel.maxTime && (r.time_min || 99) > sel.maxTime) return;

      var ev = evaluate(r, fridgeSet, urgentSet);
      if (ev.tier === 3) return; // 凑不出的不进主列表
      // 交集门槛：与冰箱食材毫无交集（含替代命中）的菜不推荐，
      // 避免"输入土豆却推荐糖拌番茄"这类噪音
      if (!ev.used.length && !ev.altUsed.length) return;
      rows.push(ev);
    });

    var eatenIdx = {};
    state.eaten.forEach(function (id) { eatenIdx[id] = 1; });

    // 排序
    var cmp;
    if (sel.sort === 'fridge') cmp = function (a, b) { return b.score - a.score || a.r.time_min - b.r.time_min; };
    else if (sel.sort === 'least') cmp = function (a, b) {
      return (a.mainMiss.length + a.minorMiss.length) - (b.mainMiss.length + b.minorMiss.length)
        || b.score - a.score;
    };
    else cmp = function (a, b) { return a.r.time_min - b.r.time_min || b.score - a.score; };

    rows.sort(cmp);
    // 最近做过的后置（不硬删，标注"最近做过"）
    rows.sort(function (a, b) {
      return (eatenIdx[a.r.id] ? 1 : 0) - (eatenIdx[b.r.id] ? 1 : 0);
    });
    return { rows: rows.slice(0, 20), eatenIdx: eatenIdx };
  }

  /* ==================== 万能公式兜底 ==================== */

  /** 冰箱里凑不出一顿正经饭时，按食材组合给通用做法 */
  function fallbackRecipes() {
    var has = function (x) { return state.fridge.indexOf(x) >= 0; };
    var veg = state.fridge.filter(function (f) {
      return ['菜', '瓜', '椒', '菇', '豆', '笋', '茄', '葱', '蒜'].some(function (k) { return f.indexOf(k) >= 0; });
    });
    var out = [];
    if (has('鸡蛋') && veg.length) {
      out.push(makeFake({
        id: 'fb-veg-egg', name: veg[0] + '炒蛋', emoji: '🥚', time_min: 10, difficulty: 1, tools: ['灶台'],
        main: ['鸡蛋', veg[0]], minor: ['盐'], method: [
          '鸡蛋打散加少许盐，' + veg[0] + '切片或切丝',
          '热锅倒油，先下' + veg[0] + '中火炒到断生（颜色变鲜亮）',
          '倒入蛋液，等蛋液稍微凝固再翻动，炒到鸡蛋全熟',
          '加盐调味出锅'
        ], fail_points: ['蛋液倒下去别急着翻，等凝固再翻才不会散'], note: '万能公式：任何蔬菜都能炒蛋'
      }));
    }
    if (state.fridge.filter(function (f) { return ['猪肉', '牛肉', '鸡腿肉', '五花肉', '肉末', '培根', '香肠'].indexOf(f) >= 0; }).length && veg.length) {
      var meat = state.fridge.find(function (f) { return ['猪肉', '牛肉', '鸡腿肉', '五花肉', '肉末', '培根', '香肠'].indexOf(f) >= 0; });
      out.push(makeFake({
        id: 'fb-veg-meat', name: meat + '炒' + veg[0], emoji: '🍖', time_min: 20, difficulty: 2, tools: ['灶台'],
        main: [meat, veg[0]], minor: ['生抽'], method: [
          meat + '切片，' + veg[0] + '切好备用',
          '热锅倒油，下肉片中火炒到变色',
          '下' + veg[0] + '一起炒，加生抽调味',
          '炒到' + veg[0] + '断生即可出锅'
        ], fail_points: ['肉先炒熟盛出再炒菜，最后合炒，肉才不会老'], note: '万能公式：任何肉 + 任何菜都可以炒'
      }));
    }
    if (has('剩米饭')) {
      out.push(makeFake({
        id: 'fb-fried-rice', name: '蛋炒饭（剩饭处理）', emoji: '🍚', time_min: 10, difficulty: 1, tools: ['灶台'],
        main: ['剩米饭', '鸡蛋'], minor: ['葱花'], method: [
          '剩米饭提前用勺子打散（结块的炒出来不好吃）',
          '鸡蛋打散，热锅多倒点油，下蛋液炒到半凝固',
          '下米饭大火翻炒，用锅铲把饭压散',
          '加盐、可选加生抽，炒到米饭粒粒分明出锅'
        ], fail_points: ['米饭要打散再下锅', '全程大火，火小了容易粘锅'], note: '剩米饭的最佳归宿'
      }));
    }
    if (out.length === 0 && state.fridge.length) {
      out.push(makeFake({
        id: 'fb-mix-soup', name: '冰箱大杂烩汤', emoji: '🥣', time_min: 30, difficulty: 1, tools: ['灶台'],
        main: state.fridge.slice(0, 3), minor: ['盐'], method: [
          '所有食材洗净切块，耐煮的先下锅',
          '加水没过食材，大火烧开转中小火炖 20 分钟',
          '加盐调味，尝尝味道，出锅'
        ], fail_points: ['什么都往里放就行，汤是容错率最高的做法'], note: '实在没思路时的一锅端'
      }));
    }
    return out;
  }

  function makeFake(r) {
    r._fake = true;
    return r;
  }

  /* ==================== 结果渲染 ==================== */

  function renderMatch() {
    var out = $('fc-result');
    out.innerHTML = '';
    var head = $('fc-result-head');

    if (!state.fridge.length) {
      head.hidden = true;
      $('fc-shopping').hidden = true;
      out.innerHTML = '<div class="fc-empty">先在冰箱里添加食材，我来告诉你今天能做啥</div>';
      return;
    }

    var m = matchAll();
    var rows = m.rows;
    var fallback = [];

    // 购物清单汇总（tier1 + tier2 的缺失食材）
    var shopMap = {};
    rows.forEach(function (ev) {
      if (ev.tier > 2) return;
      ev.mainMiss.concat(ev.minorMiss).forEach(function (i) { shopMap[i] = 1; });
    });

    // 全都不行时展示万能公式
    if (!rows.filter(function (r) { return r.tier === 1; }).length) {
      fallback = fallbackRecipes();
    }

    head.hidden = false;
    $('fc-result-count').textContent = '共 ' + rows.length + ' 道可行 · 食材 ' + state.fridge.length + ' 样';

    rows.forEach(function (ev) {
      out.appendChild(renderResultCard(ev, m.eatenIdx));
    });
    if (fallback.length) {
      var fbTitle = document.createElement('div');
      fbTitle.className = 'fc-fb-title';
      fbTitle.textContent = '直接照这个做（通用方案）';
      out.appendChild(fbTitle);
      fallback.forEach(function (r) { out.appendChild(renderResultCard({ r: r, tier: 1, used: r.main.slice(), mainMiss: [], minorMiss: [], altUsed: [], urgentUsed: [] }, {})); });
    }
    if (!rows.length && !fallback.length) {
      out.innerHTML = '<div class="fc-empty">这些食材凑不出一顿正经饭，建议：点外卖 / 补买点主食（米、面、鸡蛋）</div>';
    }

    renderShopping(shopMap);
  }

  function renderResultCard(ev, eatenIdx) {
    var r = ev.r;
    var tierTag = { 1: ['能做', 'fc-tag-ok'], 2: ['差一点', 'fc-tag-so'] }[ev.tier] || ['凑不出', 'fc-tag-no'];
    var card = document.createElement('div');
    card.className = 'fc-recipe';
    card.dataset.id = r.id;

    var usedHtml = ev.used.map(function (u) {
      return '<span class="fc-ing fc-ing-used">' + esc(u) + '</span>';
    }).join('');
    var missHtml = (ev.mainMiss || []).concat(ev.minorMiss || []).map(function (u) {
      return '<span class="fc-ing fc-ing-miss">缺 ' + esc(u) + '</span>';
    }).join('');
    var altHtml = (ev.altUsed || []).map(function (a) {
      return '<span class="fc-ing fc-ing-alt">' + esc(a) + '</span>';
    }).join('');
    var eatenTag = eatenIdx && eatenIdx[r.id] ? '<span class="fc-eaten-tag">最近做过</span>' : '';
    var urgentUsed = ev.urgentUsed && ev.urgentUsed.length
      ? '<div class="fc-urgent-line">⭐ 帮你消耗快过期的：' + ev.urgentUsed.map(esc).join('、') + '</div>' : '';

    card.innerHTML =
      '<div class="fc-recipe-head">' +
        '<span class="fc-recipe-emoji">' + esc(r.emoji || '🍽️') + '</span>' +
        '<div class="fc-recipe-main">' +
          '<div class="fc-recipe-name">' + esc(r.name) + eatenTag + '</div>' +
          '<div class="fc-recipe-meta">' +
            '<span class="fc-tag ' + tierTag[1] + '">' + tierTag[0] + '</span>' +
            '<span>' + (r.time_min || '?') + ' 分钟</span>' +
            '<span>' + '★'.repeat(r.difficulty || 1) + '</span>' +
            '<span>' + (r.tools || []).join('/') + '</span>' +
          '</div>' +
        '</div>' +
        '<button class="fc-star' + (state.favorites.indexOf(r.id) >= 0 ? ' is-on' : '') + '" data-act="fav" title="收藏">☆</button>' +
      '</div>' +
      '<div class="fc-recipe-ing">' + usedHtml + missHtml + altHtml + '</div>' +
      urgentUsed +
      '<button class="fc-link-btn" data-act="detail">做法与食材详情</button>';

    card.addEventListener('click', function (e) {
      var act = e.target.dataset && e.target.dataset.act;
      if (act === 'fav') { toggleFav(r.id); return; }
      if (act === 'detail') { openDetail(r.id, ev); return; }
      openDetail(r.id, ev);
    });
    return card;
  }

  function renderShopping(shopMap) {
    var box = $('fc-shopping');
    var items = Object.keys(shopMap).filter(function (k) { return state.fridge.indexOf(k) < 0; });
    var list = $('fc-shopping-list');
    list.innerHTML = items.length ? items.map(function (i) {
      return '<span class="fc-shop-item">' + esc(i) + '</span>';
    }).join('') : '<span class="fc-empty-hint">现有食材都能搞定，不用买！</span>';
    box.hidden = items.length === 0;
    $('fc-copy-list').dataset.list = items.join('、');
  }

  /* ==================== 收藏与吃过 ==================== */

  function toggleFav(id) {
    var i = state.favorites.indexOf(id);
    if (i >= 0) state.favorites.splice(i, 1);
    else state.favorites.push(id);
    Store.update({}, 300);
    renderMatch();
    renderLibrary();
  }

  function markEaten(id) {
    state.eaten = state.eaten.filter(function (x) { return x !== id; });
    state.eaten.unshift(id);
    state.eaten = state.eaten.slice(0, EATEN_MAX);
    Store.update({}, 300);
    renderMatch();
  }

  /* ==================== 菜谱库视图 ==================== */

  function renderCats() {
    var cats = Array.from(new Set(DB.recipes.map(function (r) { return r.cat || '其他'; })));
    var box = $('fc-cat-filter');
    box.innerHTML = '';
    var all = document.createElement('button');
    all.className = 'fc-cat' + (!sel.cat ? ' is-active' : '');
    all.textContent = '全部';
    all.addEventListener('click', function () { sel.cat = ''; renderCats(); renderLibrary(); });
    box.appendChild(all);
    cats.forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'fc-cat' + (sel.cat === c ? ' is-active' : '');
      b.textContent = c;
      b.addEventListener('click', function () { sel.cat = c; renderCats(); renderLibrary(); });
      box.appendChild(b);
    });
  }

  function renderLibrary() {
    var q = norm(sel.search);
    var list = DB.recipes.filter(function (r) {
      if (sel.favOnly && state.favorites.indexOf(r.id) < 0) return false;
      if (sel.cat && r.cat !== sel.cat) return false;
      if (q) {
        var hit = (r.name || '').indexOf(q) >= 0
          || (r.main || []).some(function (i) { return i.indexOf(q) >= 0; })
          || (r.tags || []).some(function (t) { return t.indexOf(q) >= 0; });
        if (!hit) return false;
      }
      return true;
    });
    var box = $('fc-library');
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<div class="fc-empty">' + (sel.favOnly ? '还没有收藏的菜谱，点卡片右上角 ☆ 收藏喜欢的菜' : '没有找到相关菜谱') + '</div>';
      return;
    }
    list.forEach(function (r) {
      var card = document.createElement('div');
      card.className = 'fc-recipe fc-recipe-lib';
      card.innerHTML =
        '<div class="fc-recipe-head">' +
          '<span class="fc-recipe-emoji">' + esc(r.emoji || '🍽️') + '</span>' +
          '<div class="fc-recipe-main">' +
            '<div class="fc-recipe-name">' + esc(r.name) + '</div>' +
            '<div class="fc-recipe-meta">' +
              '<span class="fc-tag fc-tag-cat">' + esc(r.cat || '其他') + '</span>' +
              '<span>' + (r.time_min || '?') + ' 分钟</span>' +
              '<span>' + '★'.repeat(r.difficulty || 1) + '</span>' +
            '</div>' +
          '</div>' +
          '<button class="fc-star' + (state.favorites.indexOf(r.id) >= 0 ? ' is-on' : '') + '" data-act="fav">☆</button>' +
        '</div>' +
        '<div class="fc-lib-ing">' + r.main.concat(r.minor || []).map(function (i) {
          return '<span class="fc-ing fc-ing-used">' + esc(i) + '</span>';
        }).join('') + '</div>' +
        '<button class="fc-link-btn" data-act="detail">查看做法</button>';
      card.addEventListener('click', function (e) {
        var act = e.target.dataset && e.target.dataset.act;
        if (act === 'fav') { toggleFav(r.id); return; }
        openDetail(r.id);
      });
      box.appendChild(card);
    });
  }

  /* ==================== 详情弹层 ==================== */

  function openDetail(id, ev) {
    var r = DB.index[id];
    if (!r) return;
    var miss = ev ? ev.mainMiss.concat(ev.minorMiss) : [];
    var detail = $('fc-detail');
    var stepsHtml = r.method.map(function (s, i) {
      return '<div class="fc-step"><span class="fc-step-no">' + (i + 1) + '</span><span>' + esc(s) + '</span></div>';
    }).join('');
    var failHtml = (r.fail_points || []).map(function (f) {
      return '<div class="fc-fail">⚠️ ' + esc(f) + '</div>';
    }).join('');
    var altHtml = r.alt ? Object.keys(r.alt).map(function (k) {
      return '<div class="fc-alt">缺 ' + esc(k) + ' 可用：' + esc(r.alt[k].join(' / ')) + '</div>';
    }).join('') : '';
    var noteHtml = r.note ? '<div class="fc-note">💡 ' + esc(r.note) + '</div>' : '';
    var missHtml = miss.length ? '<div class="fc-miss-line">还缺：' + miss.map(function (m) {
      return '<span class="fc-ing fc-ing-miss">' + esc(m) + '</span>';
    }).join('') + '</div>' : '<div class="fc-miss-line fc-miss-none">✅ 食材齐活，直接开做</div>';

    detail.innerHTML =
      '<div class="fc-detail-head">' +
        '<span class="fc-recipe-emoji">' + esc(r.emoji || '🍽️') + '</span>' +
        '<div><div class="fc-detail-name">' + esc(r.name) + '</div>' +
        '<div class="fc-recipe-meta"><span>' + (r.time_min || '?') + ' 分钟</span><span>' + '★'.repeat(r.difficulty || 1) + '</span><span>' + (r.tools || []).join('/') + '</span></div></div>' +
        '<button class="fc-close" aria-label="关闭">✕</button>' +
      '</div>' +
      '<div class="fc-detail-ing">' + r.main.concat(r.minor || []).map(function (i) {
        return '<span class="fc-ing fc-ing-used">' + esc(i) + '</span>';
      }).join('') + '</div>' +
      missHtml + altHtml +
      '<div class="fc-detail-sec">做法</div>' + stepsHtml + failHtml + noteHtml +
      '<div class="fc-detail-actions">' +
        '<button class="fc-btn fc-btn-primary" data-act="eaten">今天做这个</button>' +
        '<button class="fc-btn fc-btn-ghost" data-act="fav2">' + (state.favorites.indexOf(id) >= 0 ? '取消收藏' : '收藏') + '</button>' +
      '</div>';

    $('fc-detail-mask').hidden = false;
    detail.querySelector('.fc-close').addEventListener('click', closeDetail);
    detail.querySelector('[data-act="eaten"]').addEventListener('click', function () { markEaten(id); closeDetail(); });
    detail.querySelector('[data-act="fav2"]').addEventListener('click', function () { toggleFav(id); closeDetail(); });
  }

  function closeDetail() { $('fc-detail-mask').hidden = true; }

  /* ==================== 数据管理 ==================== */

  function exportBackup() {
    var blob = new Blob([Store.exportJson()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fridge-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      if (Store.importJson(reader.result)) {
        state = Store.state();
        renderFridge();
        renderMatch();
        alert('导入成功');
      } else {
        alert('导入失败：文件格式不正确');
      }
    };
    reader.readAsText(file);
  }

  /** URL 参数快速载入：?fridge=土豆,鸡蛋 */
  function applyUrlParams() {
    var p = new URLSearchParams(window.location.search);
    var list = p.get('fridge');
    if (list) {
      list.split(',').forEach(function (n) { toggleFridge(n); });
      history.replaceState(null, '', window.location.pathname);
    }
  }

  /* ==================== 筛选渲染 ==================== */

  function renderFilters() {
    // 工具
    var tb = $('fc-tools');
    tb.innerHTML = '';
    TOOL_OPTIONS.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'fc-fopt' + (sel.tools === t ? ' is-active' : '');
      b.textContent = t;
      b.addEventListener('click', function () { sel.tools = sel.tools === t ? null : t; renderFilters(); renderMatch(); });
      tb.appendChild(b);
    });
    // 难度
    var db = $('fc-difficulty');
    db.innerHTML = '';
    DIFF_OPTIONS.forEach(function (d) {
      var b = document.createElement('button');
      b.className = 'fc-fopt' + (sel.difficulty === d.v ? ' is-active' : '');
      b.textContent = d.t;
      b.addEventListener('click', function () { sel.difficulty = d.v; renderFilters(); renderMatch(); });
      db.appendChild(b);
    });
    // 排序
    var sb = $('fc-sort');
    sb.innerHTML = '';
    SORT_OPTIONS.forEach(function (s) {
      var b = document.createElement('button');
      b.className = 'fc-fopt' + (sel.sort === s.v ? ' is-active' : '');
      b.textContent = s.t;
      b.addEventListener('click', function () { sel.sort = s.v; state.prefs = Object.assign({}, state.prefs, { sort: s.v }); Store.update({}, 300); renderFilters(); renderMatch(); });
      sb.appendChild(b);
    });
  }

  /* ==================== 视图切换 ==================== */

  function switchView(view) {
    document.querySelectorAll('.fc-tab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.view === view);
    });
    $('fc-view-cook').hidden = view !== 'cook';
    $('fc-view-library').hidden = view !== 'library';
    if (view === 'library') { renderCats(); renderLibrary(); }
  }

  /* ==================== 事件绑定 ==================== */

  function bindEvents() {
    document.querySelectorAll('.fc-tab').forEach(function (t) {
      t.addEventListener('click', function () { switchView(t.dataset.view); });
    });

    $('fc-input-add').addEventListener('click', function () {
      var v = $('fc-input').value;
      if (!v) return;
      toggleFridge(v);
      pushHistory([norm(v)]);
      $('fc-input').value = '';
      renderSuggest();
    });
    $('fc-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var v = this.value;
        if (!v) return;
        toggleFridge(v);
        pushHistory([norm(v)]);
        this.value = '';
        renderSuggest();
      }
    });
    $('fc-input').addEventListener('input', renderSuggest);

    $('fc-clear-fridge').addEventListener('click', function () {
      state.fridge = [];
      state.urgent = [];
      Store.update({}, 300);
      renderFridge();
      renderMatch();
    });

    $('fc-copy-list').addEventListener('click', function () {
      var list = this.dataset.list || '';
      if (!list) return;
      navigator.clipboard.writeText(list).then(function () { alert('购物清单已复制：' + list); });
    });

    $('fc-search').addEventListener('input', function () {
      sel.search = this.value;
      renderLibrary();
    });

    $('fc-fav-only').addEventListener('click', function () {
      sel.favOnly = !sel.favOnly;
      this.classList.toggle('is-active', sel.favOnly);
      this.textContent = sel.favOnly ? '★ 只看收藏' : '☆ 只看收藏';
      renderLibrary();
    });

    $('fc-export').addEventListener('click', exportBackup);
    $('fc-import').addEventListener('click', function () { $('fc-import-file').click(); });
    $('fc-import-file').addEventListener('change', function () {
      if (this.files && this.files[0]) importBackup(this.files[0]);
      this.value = '';
    });
    $('fc-reset').addEventListener('click', function () {
      if (confirm('确定清空本机的冰箱清单和所有设置吗？')) {
        Store.reset();
        state = Store.state();
        renderFridge();
        renderMatch();
      }
    });

    $('fc-detail-mask').addEventListener('click', function (e) {
      if (e.target === this) closeDetail();
    });
  }

  /* ==================== 启动 ==================== */

  function renderAll() {
    renderFilters();
    renderFridge();
    renderMatch();
    applyUrlParams();
  }

  bindEvents();
  loadRecipes();
})();
