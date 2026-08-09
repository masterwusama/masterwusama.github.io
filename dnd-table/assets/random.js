/* =========================================================
 * 跑团桌 · 随机表模块 (random.js)
 * NPC 生成器 / 地形随机遭遇表 / d100 战利品表
 * ========================================================= */
(function (global) {
  'use strict';

  var DnD = global.DnD = global.DnD || {};
  var G = DnD.Glossary;

  /* ---------- NPC 名字表（按种族） ---------- */
  var RACE_NAMES = {
    dwarf: {
      male: ['杜林', '托林', '巴林', '格罗因', '奥因', '布伦', '桑德林'],
      female: ['希尔德', '布里纳', '格尔达', '罗莎', '芙蕾雅', '伊尔达'],
      clan: ['铁锤', '石须', '深掘', '铜盾', '熔炉']
    },
    elf: {
      male: ['埃尔隆', '莱戈拉', '费恩', '西利安', '阿瑞安', '盖兰'],
      female: ['阿尔玟', '露西安', '伊尔玟', '凯兰', '米瑞尔', '艾琳诺'],
      clan: ['星语', '林歌', '银月', '风行者', '晨露']
    },
    halfling: {
      male: ['弗罗多', '皮平', '梅里', '桑乔', '马洛', '本诺'],
      female: ['罗丝', '黛拉', '米娜', '莉莉', '霍莉'],
      clan: ['巴金斯', '山雀', '水桶', '快脚']
    },
    human: {
      male: ['艾德', '威尔', '康纳', '奥利弗', '马库斯', '托马斯'],
      female: ['艾拉', '艾玛', '莉娜', '莎拉', '克洛伊'],
      clan: ['霍克', '里弗斯', '布莱克', '斯通']
    },
    dragonborn: {
      male: ['阿杜', '巴鲁', '克拉什', '德拉戈', '法尔', '格鲁姆'],
      female: ['阿卡', '布里萨', '克莱', '德拉', '埃丝特拉', '法尔卡'],
      clan: ['火焰', '寒霜', '雷暴', '毒牙', '金星']
    },
    gnome: {
      male: ['阿洛', '宾博', '克拉克', '多比', '福斯克', '格林'],
      female: ['贝拉', '卡拉', '黛西', '艾尔西', '菲比', '金妮'],
      clan: ['齿轮', '钟表', '火花', '弹簧']
    },
    'half-elf': {
      male: ['凯尔', '特里斯坦', '伊桑', '罗兰', '艾德林'],
      female: ['凯莉', '艾拉诺', '塞琳娜', '艾丽西亚'],
      clan: ['月影', '晨星', '暮色']
    },
    'half-orc': {
      male: ['戈尔', '布洛克', '扎格', '克鲁姆', '格拉克'],
      female: ['格拉', '奥加', '乌尔萨', '泽拉'],
      clan: ['血斧', '碎颅', '铁皮']
    },
    tiefling: {
      male: ['达蒙', '阿兹瑞尔', '玛洛克', '赞达尔', '奥里安'],
      female: ['莉莉丝', '娜梅莉亚', '菲德拉', '泽菲拉'],
      clan: ['暗火', '血誓', '影缚']
    }
  };

  var RACE_KEYS = Object.keys(RACE_NAMES);

  var NPC_JOBS = ['铁匠', '酒馆老板', '商人', '卫兵队长', '牧师', '盗贼', '猎人',
    '学者', '药剂师', '吟游诗人', '农民', '厨师', '裁缝', '木匠', '船夫', '赏金猎人'];

  /* 5e 背景风格的四要素表 */
  var NPC_TRAITS = ['说话轻声细语，从不直视他人', '总在不合时宜的时候开玩笑', '对任何人都保持礼貌和尊重',
    '睡觉时会说梦话，内容涉及可怕秘密', '吃饭时狼吞虎咽，举止粗鲁', '迷信至极，随身携带护身符',
    '健谈，喜欢讲冗长的人生故事', '对金钱精打细算，讨价还价毫不退让', '走路从不发出声音，习惯性躲进阴影',
    '对动物比对人类更亲近', '会记住每一个冒犯过他的人', '用第三人称称呼自己'];
  var NPC_IDEALS = ['尊重：尊重他人是生存之道', '仁慈：强者应当保护弱者', '自由：任何人都不能被奴役',
    '诚实：谎言会腐蚀灵魂', '财富：金钱是万物的度量', '荣誉：承诺必须兑现',
    '知识：真相值得一切代价', '家族：血脉高于一切'];
  var NPC_BONDS = ['欠了债主一大笔钱，必须偿还', '在寻找失散的亲人', '为已故的挚友完成遗愿',
    '守护着祖传的秘密宝物', '向摧毁家乡的仇敌复仇', '答应过导师要保护某个村庄',
    '被某个组织盯上，随时准备逃亡', '深爱着镇上某个人，但不敢表白'];
  var NPC_FLAWS = ['嗜赌成性，输红了眼就不管不顾', '对酒毫无抵抗力', '极度虚荣，受不了被人无视',
    '胆小如鼠，遇到危险先跑', '控制不住脾气，容易动手', '撒谎成性，连自己都骗',
    '贪得无厌，见财起意', '记仇，报复心极强'];

  /* ---------- 随机遭遇表（按地形，d100 区间） ---------- */
  var ENCOUNTERS = {
    forest: [
      { lo: 1, hi: 15, text: '一群哥布林在路旁设伏（Goblin ×3-4）', en: 'goblin' },
      { lo: 16, hi: 30, text: '一头熊在树丛中翻找蜂巢（Bear）', en: 'brown-bear' },
      { lo: 31, hi: 45, text: '迷路的商队，货物被泥石流掩埋，求助玩家护送', en: '' },
      { lo: 46, hi: 60, text: '狼群嚎叫逼近，夜间跟随队伍（Wolf ×2-6）', en: 'wolf' },
      { lo: 61, hi: 75, text: '发现废弃的猎屋，屋内残留战斗痕迹与一只宝箱', en: '' },
      { lo: 76, hi: 90, text: '树人拦路，要求回答谜语或献上贡品（Treant）', en: 'treant' },
      { lo: 91, hi: 100, text: '枭熊袭击营地（Owlbear）', en: 'owlbear' }
    ],
    dungeon: [
      { lo: 1, hi: 20, text: '骷髅从墓穴中爬出（Skeleton ×2-4）', en: 'skeleton' },
      { lo: 21, hi: 40, text: '僵尸缓慢逼近，走廊尽头传来呻吟（Zombie ×2-3）', en: 'zombie' },
      { lo: 41, hi: 55, text: '触发陷阱：落石/毒针/喷火，需敏捷豁免', en: '' },
      { lo: 56, hi: 70, text: '食尸鬼从天花板扑下（Ghoul ×2）', en: 'ghoul' },
      { lo: 71, hi: 85, text: '发现一间密室：祭坛、干涸血迹与一本被撕毁的日志', en: '' },
      { lo: 86, hi: 100, text: '幽魂现身索命（Wraith）', en: 'wraith' }
    ],
    city: [
      { lo: 1, hi: 20, text: '地痞流氓勒索过路行人（Thug ×2）', en: 'thug' },
      { lo: 21, hi: 40, text: '城门口排起长队，卫兵严查可疑物品（Guard）', en: 'guard' },
      { lo: 41, hi: 55, text: '小偷偷走了玩家钱袋，正在人群中逃窜（Spy）', en: 'spy' },
      { lo: 56, hi: 70, text: '有人在酒馆散布邪教传言，信众聚集（Cultist ×3）', en: 'cultist' },
      { lo: 71, hi: 85, text: '巷口发生械斗，两伙佣兵火并，波及路人', en: '' },
      { lo: 86, hi: 100, text: '卫兵队长请求协助追捕逃犯（Knight）', en: 'knight' }
    ],
    mountain: [
      { lo: 1, hi: 20, text: '落石堵塞山路，需要攀爬或绕行', en: '' },
      { lo: 21, hi: 40, text: '食人魔占据隘口收费（Ogre）', en: 'ogre' },
      { lo: 41, hi: 60, text: '狮鹫在高处盘旋，似乎守护着某处巢穴（Griffon）', en: 'griffon' },
      { lo: 61, hi: 80, text: '石巨人在山坡上掷石取乐（Stone Giant）', en: 'stone-giant' },
      { lo: 81, hi: 100, text: '雷暴突至，山洪倾泻而下，需要躲避', en: '' }
    ],
    swamp: [
      { lo: 1, hi: 25, text: '沼泽毒雾弥漫，需体质豁免否则中毒', en: '' },
      { lo: 26, hi: 50, text: '巨蚊与吸血蝇群袭扰（Stirge ×3-5）', en: 'stirge' },
      { lo: 51, hi: 75, text: '食人魔僵尸从泥潭中站起（Ogre Zombie）', en: 'ogre-zombie' },
      { lo: 76, hi: 100, text: '蜥蜴人巡逻队发现入侵者（Lizardfolk ×3）', en: 'lizardfolk' }
    ],
    coast: [
      { lo: 1, hi: 25, text: '搁浅的沉船残骸，可能有补给或宝物', en: '' },
      { lo: 26, hi: 50, text: '海贼船靠岸劫掠（Bandit ×4）', en: 'bandit' },
      { lo: 51, hi: 75, text: '人鱼在礁石上呼救，周围有鲨鱼出没（Merfolk）', en: 'merfolk' },
      { lo: 76, hi: 100, text: '海妖之歌响起，船员意志豁免（Harpy）', en: 'harpy' }
    ],
    desert: [
      { lo: 1, hi: 25, text: '沙暴将至，寻找掩体否则迷失方向', en: '' },
      { lo: 26, hi: 50, text: '蝎尾狮从沙丘后跃出（Manticore）', en: 'manticore' },
      { lo: 51, hi: 75, text: '古代遗迹的机关被触发的守卫苏醒（Gargoyle ×2）', en: 'gargoyle' },
      { lo: 76, hi: 100, text: '被埋葬的巨虫破沙而出（Purple Worm）——快跑！', en: 'purple-worm' }
    ]
  };

  var TERRAIN_KEYS = Object.keys(ENCOUNTERS);
  var TERRAIN_CN = { forest: '森林', dungeon: '地牢', city: '城市', mountain: '山地', swamp: '沼泽', coast: '海岸', desert: '沙漠' };

  /* ---------- d100 战利品表 ---------- */
  var LOOT = [
    { lo: 1, hi: 12, name: '破旧钱袋', detail: '3d20 铜币 + 1d6 银币，缝在夹层里的生锈铁钥匙（可开某扇门）' },
    { lo: 13, hi: 30, name: '冒险者遗物', detail: '1d4 瓶治疗药水 + 破旧的探险日志（记载了附近一处地点）' },
    { lo: 31, hi: 50, name: '杂货与补给', detail: '2d6 金币 + 1d4 普通药剂（抗毒/抗火）+ 一副绳索抓钩' },
    { lo: 51, hi: 70, name: '珍贵首饰', detail: '2d10 金币 + 1d4 件珠宝（各值 2d10 金币）+ 一瓶法力回复药水' },
    { lo: 71, hi: 85, name: '魔法卷轴', detail: '3d10 金币 + 1d2 张法术卷轴（1-2 环随机法术）+ 一枚护符（抵抗一次伤害）' },
    { lo: 86, hi: 95, name: '稀有魔法物品', detail: '5d10 金币 + 1d4 瓶强力药水（巨人力量/飞行）+ 一件魔法武器（+1）' },
    { lo: 96, hi: 100, name: '传奇宝藏', detail: '宝箱内：2d100 金币 + 魔法护甲（+1）+ 一件极稀有物品（如烈焰权杖）——但宝箱被诅咒，开锁需过 DC 20 调查' }
  ];

  /* ---------- 掷表工具 ---------- */
  function rollTable(table, roll) {
    for (var i = 0; i < table.length; i++) {
      if (roll >= table[i].lo && roll <= table[i].hi) return table[i];
    }
    return table[table.length - 1];
  }
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function generateNPC(raceKey, job) {
    var rk = raceKey && RACE_NAMES[raceKey] ? raceKey : pick(RACE_KEYS);
    var table = RACE_NAMES[rk];
    var gender = Math.random() < 0.5 ? '男' : '女';
    var first = pick(gender === '男' ? table.male : table.female);
    var clan = pick(table.clan);
    var cl = pick(Object.keys(G.classes));
    return {
      name: first + '·' + clan,
      gender: gender,
      race: G.raceName(rk) + ' (' + rk + ')',
      job: job && job !== 'random' ? job : pick(NPC_JOBS),
      cls: G.className(cl),
      trait: pick(NPC_TRAITS),
      ideal: pick(NPC_IDEALS),
      bond: pick(NPC_BONDS),
      flaw: pick(NPC_FLAWS)
    };
  }

  /* =========================================================
   * UI
   * ========================================================= */
  var RandomUI = {};
  var root;
  var randMode = 'npc';

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function render() {
    if (!root) return;
    root.innerHTML = '';
    var card = el('div', 'dnd-card');

    var tabs = el('div', 'cb-add-tabs');
    [['npc', 'NPC 生成器'], ['encounter', '随机遭遇'], ['loot', '战利品']].forEach(function (m) {
      var b = el('button', 'dnd-btn dnd-btn-sm' + (randMode === m[0] ? ' active' : ''), m[1]);
      b.addEventListener('click', function () { randMode = m[0]; render(); });
      tabs.appendChild(b);
    });
    card.appendChild(tabs);

    var body = el('div', 'rand-body');
    if (randMode === 'npc') renderNPC(body);
    else if (randMode === 'encounter') renderEncounter(body);
    else renderLoot(body);
    card.appendChild(body);
    root.appendChild(card);
  }

  /* ---------- NPC 生成器 ---------- */
  function renderNPC(body) {
    var opts = el('div', 'dnd-field-row');
    var raceSel = el('select', 'dnd-input');
    raceSel.appendChild(el('option', null, '随机种族'));
    RACE_KEYS.forEach(function (k) {
      var o = el('option', null, G.raceName(k));
      o.value = k;
      raceSel.appendChild(o);
    });
    opts.appendChild(raceSel);

    var jobSel = el('select', 'dnd-input');
    jobSel.appendChild(el('option', null, '随机职业'));
    NPC_JOBS.forEach(function (j) {
      var o = el('option', null, j);
      o.value = j;
      jobSel.appendChild(o);
    });
    opts.appendChild(jobSel);
    body.appendChild(opts);

    var btn = el('button', 'dnd-btn dnd-btn-gold', '生成 NPC');
    body.appendChild(btn);

    var out = el('div', 'npc-out');
    body.appendChild(out);

    function doGen() {
      var npc = generateNPC(raceSel.value, jobSel.value);
      out.innerHTML = '';
      var card = el('div', 'dnd-card npc-card');
      card.innerHTML = '<div class="npc-name">' + esc(npc.name) + '</div>'
        + '<div class="npc-sub">' + npc.gender + ' · ' + esc(npc.race) + ' · ' + esc(npc.job) + ' · 潜在职业 ' + esc(npc.cls) + '</div>'
        + '<div class="npc-line"><span class="npc-tag">性格</span>' + esc(npc.trait) + '</div>'
        + '<div class="npc-line"><span class="npc-tag">理想</span>' + esc(npc.ideal) + '</div>'
        + '<div class="npc-line"><span class="npc-tag">羁绊</span>' + esc(npc.bond) + '</div>'
        + '<div class="npc-line"><span class="npc-tag">缺陷</span>' + esc(npc.flaw) + '</div>';
      out.appendChild(card);
    }
    btn.addEventListener('click', doGen);
    raceSel.addEventListener('change', doGen);
    jobSel.addEventListener('change', doGen);
    doGen();
  }

  /* ---------- 随机遭遇 ---------- */
  function renderEncounter(body) {
    var opts = el('div', 'dnd-field-row');
    var terSel = el('select', 'dnd-input');
    TERRAIN_KEYS.forEach(function (k) {
      terSel.appendChild(el('option', null, TERRAIN_CN[k]));
      terSel.lastChild.value = k;
    });
    opts.appendChild(terSel);
    var btn = el('button', 'dnd-btn dnd-btn-gold', '掷遭遇 d100');
    opts.appendChild(btn);
    body.appendChild(opts);

    var out = el('div', 'enc-out');
    body.appendChild(out);

    function doRoll() {
      var roll = DnD.Dice.rollDie(100);
      var hit = rollTable(ENCOUNTERS[terSel.value], roll);
      out.innerHTML = '';
      var card = el('div', 'dnd-card enc-card');
      card.innerHTML = '<div class="enc-roll">' + TERRAIN_CN[terSel.value] + ' · d100 = <b>' + roll + '</b></div>'
        + '<div class="enc-text">' + esc(hit.text) + '</div>'
        + (hit.en ? '<div class="enc-hint">怪物：' + esc(hit.en) + '</div>' : '');
      out.appendChild(card);
    }
    btn.addEventListener('click', doRoll);
    doRoll();
  }

  /* ---------- 战利品 ---------- */
  function renderLoot(body) {
    var btn = el('button', 'dnd-btn dnd-btn-gold', '掷战利品 d100');
    body.appendChild(btn);
    var out = el('div', 'loot-out');
    body.appendChild(out);

    function doRoll() {
      var roll = DnD.Dice.rollDie(100);
      var hit = rollTable(LOOT, roll);
      out.innerHTML = '';
      var card = el('div', 'dnd-card loot-card');
      card.innerHTML = '<div class="loot-roll">d100 = <b>' + roll + '</b></div>'
        + '<div class="loot-name">' + esc(hit.name) + '</div>'
        + '<div class="loot-detail">' + esc(hit.detail) + '</div>';
      out.appendChild(card);
    }
    btn.addEventListener('click', doRoll);
    doRoll();
  }

  function init() {
    root = document.getElementById('random-root');
    if (!root) return;
    root.innerHTML = '';
    render();
  }

  DnD.Random = { generateNPC: generateNPC };
  DnD.RandomUI = { init: init };
})(window);
