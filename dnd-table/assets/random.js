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

  /* NPC 附加细节：年龄 / 外貌 / 口癖 / 秘密 */
  var NPC_AGES = ['少年', '青年', '中年', '老年'];
  var NPC_LOOKS = [
    '左眼有一道旧伤疤',
    '一头乱蓬蓬的火红头发',
    '牙齿泛黄，笑起来缺了一颗',
    '身材矮壮，手臂布满老茧',
    '脸上画着褪色的部落图腾',
    '斗篷下藏着鼓鼓囊囊的钱袋',
    '右臂是铁制的义肢',
    '瞳孔颜色异于常人（琥珀色）',
    '身上总带着一股草药味',
    '指甲缝里永远洗不干净'
  ];
  var NPC_VOICES = [
    '说话爱引用谚语',
    '每句话结尾都带「是吧？」',
    '压低声音说话，像在分享秘密',
    '语速极快，别人很难插上话',
    '带着浓重的口音，偶尔蹦出方言',
    '说到激动处会手舞足蹈',
    '几乎从不主动开口',
    '说话时习惯性地后退半步'
  ];
  var NPC_SECRETS = [
    '曾是一名逃兵，家乡已不认他',
    '暗地里信奉一位被禁的神祇',
    '偷走了雇主的一件宝物，至今未被发现',
    '与当地盗贼公会有私下往来',
    '其实是某个贵族的私生子',
    '见过不该见的东西，被下过封口咒',
    '在旧战场上捡到过一枚有魔力的戒指',
    '每晚都会去同一个坟头祭拜'
  ];

  /* ---------- 随机遭遇表（按地形，d100 区间） ----------
   * combat: 怪物 + 随机数量 + 随机行为修饰
   * event:  事件细节每次随机取一条 */
  var ENC_FLAVOR = [
    '正在觅食，还没注意到队伍',
    '在附近游荡，距离 30 米左右',
    '正在搬运什么东西，脚步沉重',
    '似乎刚经历一场战斗，状态不佳（HP 减半）',
    '警惕地盯着队伍的方向，缓缓靠近',
    '在远处巡逻，暂时没有发现',
    '正与另一伙生物对峙，无暇他顾',
    '在篝火旁休息，武器放在够不着的地方',
    '被驯兽人驱赶着，暴躁易怒',
    '在翻找一堆杂物，似乎丢了什么',
    '朝队伍走来，没有敌意（或许）',
    '听到动静后停下脚步，侧耳倾听'
  ];
  var ENCOUNTERS = {
    forest: [
      { lo: 1, hi: 15, kind: 'combat', cn: '哥布林', en: 'goblin', n: [3, 4] },
      { lo: 16, hi: 30, kind: 'combat', cn: '棕熊', en: 'brown-bear', n: [1, 2] },
      { lo: 31, hi: 45, kind: 'event', scene: [
        '迷路的商队：货物被泥石流掩埋，求助玩家护送',
        '迷路的商队：遭到劫掠，只剩一个重伤的随从',
        '迷路的商队：多日没吃东西，愿意用货物换食物与指引',
        '迷路的商队：商人自称运送「药材」，但箱子上有干涸的血迹'
      ] },
      { lo: 46, hi: 60, kind: 'combat', cn: '狼群', en: 'wolf', n: [2, 6] },
      { lo: 61, hi: 75, kind: 'event', scene: [
        '废弃猎屋：屋内残留战斗痕迹与一只上锁的宝箱',
        '废弃猎屋：壁炉余烬尚温，屋主刚离开不久',
        '废弃猎屋：地板下藏着旧账本，记录了一笔可疑交易',
        '废弃猎屋：墙上刻着发光的符文，散发着微弱魔力'
      ] },
      { lo: 76, hi: 90, kind: 'combat', cn: '树人', en: 'treant', n: [1, 1] },
      { lo: 91, hi: 100, kind: 'combat', cn: '枭熊', en: 'owlbear', n: [1, 1] }
    ],
    dungeon: [
      { lo: 1, hi: 20, kind: 'combat', cn: '骷髅', en: 'skeleton', n: [2, 4] },
      { lo: 21, hi: 40, kind: 'combat', cn: '僵尸', en: 'zombie', n: [2, 3] },
      { lo: 41, hi: 55, kind: 'event', scene: [
        '触发陷阱：落石倾泻而下，需敏捷豁免',
        '触发陷阱：毒针从墙壁射出，需敏捷豁免',
        '触发陷阱：喷火装置被踩中，需敏捷豁免',
        '触发陷阱：地板塌陷，脚下是 3 米深的坑'
      ] },
      { lo: 56, hi: 70, kind: 'combat', cn: '食尸鬼', en: 'ghoul', n: [2, 2] },
      { lo: 71, hi: 85, kind: 'event', scene: [
        '密室：中央是祭坛，地面有干涸的血迹',
        '密室：一本被撕毁的日志，最后几页写满诅咒',
        '密室：一具盘坐的骸骨，怀里抱着一只铜盒',
        '密室：墙角的暗门通往更深处的通道'
      ] },
      { lo: 86, hi: 100, kind: 'combat', cn: '幽魂', en: 'wraith', n: [1, 1] }
    ],
    city: [
      { lo: 1, hi: 20, kind: 'combat', cn: '地痞流氓', en: 'thug', n: [2, 3] },
      { lo: 21, hi: 40, kind: 'event', scene: [
        '城门口排起长队，卫兵严查可疑物品',
        '城门新贴了通缉令，画像看起来很像队伍里的某人',
        '城门口有人兜售「真品」圣物，价格可疑',
        '守门卫兵认出了队伍里的逃犯，气氛紧张'
      ] },
      { lo: 41, hi: 55, kind: 'combat', cn: '盗贼', en: 'spy', n: [1, 2] },
      { lo: 56, hi: 70, kind: 'event', scene: [
        '酒馆里有人在散布邪教传言，信众正在聚集',
        '酒馆里两个醉汉在赌桌上大打出手，众人围观',
        '酒馆老板悄悄打听队伍来历，眼神闪烁',
        '酒馆二楼传来打斗声，有人从窗户摔出来'
      ] },
      { lo: 71, hi: 85, kind: 'event', scene: [
        '巷口械斗：两伙佣兵火并，波及路人',
        '巷口械斗：一伙佣兵在追打另一伙，场面混乱',
        '巷口械斗刚结束，赢家正在勒索输家',
        '巷口械斗惊动卫兵，需要玩家帮忙指认'
      ] },
      { lo: 86, hi: 100, kind: 'event', scene: [
        '卫兵队长请求协助追捕逃犯，许诺报酬',
        '卫兵队长认出队伍里有通缉犯，准备呼叫支援',
        '卫兵队长邀请队伍参与今晚的巡逻',
        '卫兵队长正在盘问一名可疑的盗贼'
      ] }
    ],
    mountain: [
      { lo: 1, hi: 20, kind: 'event', scene: [
        '落石堵塞山路，需要攀爬或绕行',
        '前方塌方，露出一个幽深的洞穴入口',
        '山体滑坡冲毁栈道，需要另寻他路',
        '巨石滚落惊起一群乌鸦，叫声在峡谷中回荡'
      ] },
      { lo: 21, hi: 40, kind: 'combat', cn: '食人魔', en: 'ogre', n: [1, 2] },
      { lo: 41, hi: 60, kind: 'combat', cn: '狮鹫', en: 'griffon', n: [1, 1] },
      { lo: 61, hi: 80, kind: 'combat', cn: '石巨人', en: 'stone-giant', n: [1, 1] },
      { lo: 81, hi: 100, kind: 'event', scene: [
        '雷暴突至，山洪倾泻而下，需要寻找高地',
        '冰雹砸落，需要寻找掩体躲避',
        '雷暴中，前方山路被闪电劈中燃起火焰',
        '暴雨冲垮了宿营地，所有物品都被淋透'
      ] }
    ],
    swamp: [
      { lo: 1, hi: 25, kind: 'event', scene: [
        '沼泽毒雾弥漫，需体质豁免否则中毒',
        '雾气中传来低语声，似乎有人被困在深处',
        '毒雾短暂散去，露出一条岔路和半截路标',
        '雾中飘着淡绿色磷光，顺着光走可能有收获'
      ] },
      { lo: 26, hi: 50, kind: 'combat', cn: '巨蚊群', en: 'stirge', n: [3, 5] },
      { lo: 51, hi: 75, kind: 'combat', cn: '食人魔僵尸', en: 'ogre-zombie', n: [1, 2] },
      { lo: 76, hi: 100, kind: 'combat', cn: '蜥蜴人巡逻队', en: 'lizardfolk', n: [3, 4] }
    ],
    coast: [
      { lo: 1, hi: 25, kind: 'event', scene: [
        '搁浅的沉船残骸，可能有补给或宝物',
        '船骸上有人呼救，被困在倾斜的船舱里',
        '船骸中传出翻找声——有人正在打捞',
        '船身倾斜，随时可能滑入深海，时间不多'
      ] },
      { lo: 26, hi: 50, kind: 'combat', cn: '海贼', en: 'bandit', n: [4, 5] },
      { lo: 51, hi: 75, kind: 'event', scene: [
        '人鱼在礁石上呼救，周围有鲨鱼出没',
        '礁石上坐着人鱼，低声哼唱着陌生的歌谣',
        '潮水中困住一条人鱼，她请求帮忙解开渔网',
        '人鱼警告：今晚这片海域会有风暴'
      ] },
      { lo: 76, hi: 100, kind: 'combat', cn: '鹰身女妖', en: 'harpy', n: [2, 2] }
    ],
    desert: [
      { lo: 1, hi: 25, kind: 'event', scene: [
        '沙暴将至，寻找掩体否则迷失方向',
        '远方升起沙尘柱，可能有人在战斗',
        '风暴中隐约可见一座废弃的驿站',
        '沙暴过后，地面露出半截刻字的石碑'
      ] },
      { lo: 26, hi: 50, kind: 'combat', cn: '蝎尾狮', en: 'manticore', n: [1, 1] },
      { lo: 51, hi: 75, kind: 'combat', cn: '石像鬼', en: 'gargoyle', n: [2, 3] },
      { lo: 76, hi: 100, kind: 'combat', cn: '紫虫', en: 'purple-worm', n: [1, 1] }
    ]
  };

  var TERRAIN_KEYS = Object.keys(ENCOUNTERS);
  var TERRAIN_CN = { forest: '森林', dungeon: '地牢', city: '城市', mountain: '山地', swamp: '沼泽', coast: '海岸', desert: '沙漠' };

  /* ---------- d100 战利品表（detail 为函数，每次掷出结果都不同） ---------- */
  var RARITY_CN = {
    Common: '普通', Uncommon: '非普通', Rare: '稀有', 'Very Rare': '极稀有',
    Legendary: '传说', Artifact: '神器', Varies: '视物品而定'
  };
  /* 从 362 件真实魔法物品元数据中按「稀有度权重」抽取：越稀有概率越低 */
  function magicWeighted(weights) {
    var M = DnD.MagicMeta || {};
    var keys = Object.keys(M);
    var map = [];
    var total = 0;
    Object.keys(weights).forEach(function (r) {
      keys.forEach(function (k) {
        if (M[k].r === r) { map.push({ k: k, w: weights[r] }); total += weights[r]; }
      });
    });
    if (!map.length) return { name: G.magicItemName(pick(keys)), rarity: '' };
    var roll = Math.random() * total;
    for (var i = 0; i < map.length; i++) {
      roll -= map[i].w;
      if (roll <= 0) return { name: G.magicItemName(map[i].k), rarity: M[map[i].k].r };
    }
    var last = map[map.length - 1];
    return { name: G.magicItemName(last.k), rarity: M[last.k].r };
  }
  var SCROLL_SPELLS = ['燃烧之手', '魔法飞弹', '护盾术', '疗伤术', '侦测魔法', '妖精之火', '油腻术', '雷鸣波', '迷雾步', '灼热射线', '黑暗术', '隐形术', '镜影术', '浮空术', '蛛行术', '灼热金属'];
  var JEWELS = ['金戒指', '银项链', '宝石吊坠', '蛋白石胸针', '镀金酒杯', '珍珠手链', '祖母绿耳环', '象牙雕像'];
  var LOOT = [
    { lo: 1, hi: 12, name: '破旧钱袋', detail: function () {
      return { text: '3d20 铜币 + 1d6 银币，' + pick([
        '夹层里缝着一把生锈铁钥匙（可开某扇门）',
        '还有一张皱巴巴的旧悬赏令',
        '袋底压着半块发霉的干粮'
      ]) };
    } },
    { lo: 13, hi: 30, name: '冒险者遗物', detail: function () {
      return { text: '1d4 瓶治疗药水 + ' + pick([
        '一本破旧的探险日志（记载了附近一处地点）',
        '一封未寄出的家书和一枚刻名的铜币',
        '一把精致的匕首（魔法武器，+1d6 伤害）'
      ]) };
    } },
    { lo: 31, hi: 50, name: '杂货与补给', detail: function () {
      return { text: '2d6 金币 + 1d4 瓶' + pick(['抗毒药剂', '抗火药剂', '治疗药水'])
        + ' + ' + pick(['一副绳索抓钩', '一盏不灭油灯', '10 天份干粮']) };
    } },
    { lo: 51, hi: 70, name: '珍贵首饰', detail: function () {
      return { text: '2d10 金币 + 1d4 件' + pick(JEWELS) + '（各值 2d10 金币）'
        + ' + 一瓶' + pick(['法力回复药水', '治疗药水']) };
    } },
    { lo: 71, hi: 85, name: '魔法卷轴', detail: function () {
      return { text: '3d10 金币 + 1d' + (Math.random() < 0.5 ? '2' : '3') + ' 张法术卷轴（'
        + pick(SCROLL_SPELLS) + '等）+ 一枚' + pick(['护符（抵抗一次伤害）', '幸运石（豁免检定 +1）']) };
    } },
    /* 高稀有度档：档内也按权重分布，不是每把都出 Rare */
    { lo: 86, hi: 95, name: '稀有魔法物品', detail: function () {
      return {
        text: '5d10 金币 + 1d4 瓶' + pick(['巨人力量药水', '飞行药水', '隐身药水', '治疗药水']),
        items: [magicWeighted({ Uncommon: 45, Rare: 22, 'Very Rare': 6, Legendary: 1 })]
      };
    } },
    { lo: 96, hi: 100, name: '传奇宝藏', detail: function () {
      var items = [magicWeighted({ Rare: 30, 'Very Rare': 12, Legendary: 4, Artifact: 1 })];
      if (Math.random() < 0.6) items.push(magicWeighted({ Uncommon: 35, Rare: 12, 'Very Rare': 4 }));
      return {
        text: '宝箱内：2d100 金币' + (Math.random() < 0.35
          ? '——但宝箱被诅咒，开锁需过 DC 20 调查'
          : '，运气不错，宝箱没有上锁'),
        items: items
      };
    } }
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
      age: pick(NPC_AGES),
      job: job && job !== 'random' ? job : pick(NPC_JOBS),
      cls: G.className(cl),
      look: pick(NPC_LOOKS),
      voice: pick(NPC_VOICES),
      trait: pick(NPC_TRAITS),
      ideal: pick(NPC_IDEALS),
      bond: pick(NPC_BONDS),
      flaw: pick(NPC_FLAWS),
      secret: pick(NPC_SECRETS)
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
        + '<div class="npc-sub">' + npc.gender + ' · ' + esc(npc.race) + ' · ' + npc.age + ' · ' + esc(npc.job) + ' · 潜在职业 ' + esc(npc.cls) + '</div>'
        + '<div class="npc-line"><span class="npc-tag">外貌</span>' + esc(npc.look) + '</div>'
        + '<div class="npc-line"><span class="npc-tag">性格</span>' + esc(npc.trait) + '</div>'
        + '<div class="npc-line"><span class="npc-tag">口癖</span>' + esc(npc.voice) + '</div>'
        + '<div class="npc-line"><span class="npc-tag">理想</span>' + esc(npc.ideal) + '</div>'
        + '<div class="npc-line"><span class="npc-tag">羁绊</span>' + esc(npc.bond) + '</div>'
        + '<div class="npc-line"><span class="npc-tag">缺陷</span>' + esc(npc.flaw) + '</div>'
        + '<div class="npc-line npc-secret"><span class="npc-tag">秘密</span>' + esc(npc.secret) + '</div>';
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
      if (hit.kind === 'combat') {
        var qty = hit.n[0] + Math.floor(Math.random() * (hit.n[1] - hit.n[0] + 1));
        card.innerHTML = '<div class="enc-roll">' + TERRAIN_CN[terSel.value] + ' · d100 = <b>' + roll + '</b></div>'
          + '<div class="enc-name">' + esc(hit.cn) + ' ×<b>' + qty + '</b></div>'
          + '<div class="enc-text">' + esc(pick(ENC_FLAVOR)) + '</div>'
          + (hit.en ? '<div class="enc-hint">怪物：' + esc(hit.en) + '</div>' : '');
      } else {
        card.innerHTML = '<div class="enc-roll">' + TERRAIN_CN[terSel.value] + ' · d100 = <b>' + roll + '</b></div>'
          + '<div class="enc-text">' + esc(pick(hit.scene)) + '</div>';
      }
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
      var res = hit.detail();
      out.innerHTML = '';
      var card = el('div', 'dnd-card loot-card');
      var html = '<div class="loot-roll">d100 = <b>' + roll + '</b></div>'
        + '<div class="loot-name">' + esc(hit.name) + '</div>'
        + '<div class="loot-detail">' + esc(res.text) + '</div>';
      if (res.items && res.items.length) {
        html += '<div class="loot-items">' + res.items.map(function (it) {
          return '<span class="loot-item' + (it.rarity ? ' r-' + it.rarity.toLowerCase().replace(/\s+/g, '-') : '') + '">'
            + esc(it.name) + (it.rarity ? '<i>' + esc(RARITY_CN[it.rarity] || it.rarity) + '</i>' : '') + '</span>';
        }).join('') + '</div>';
      }
      card.innerHTML = html;
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
