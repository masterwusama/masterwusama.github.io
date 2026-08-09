/* =========================================================
 * 跑团桌 · 中英术语表 (glossary.js)
 * UI 全中文；API 数据为英文，此表提供术语对照与常用怪物译名
 * ========================================================= */
(function (global) {
  'use strict';

  var DnD = global.DnD = global.DnD || {};

  var ABILITIES = {
    str: '力量', dex: '敏捷', con: '体质', int: '智力', wis: '感知', cha: '魅力'
  };
  var ABILITY_FULL = {
    str: '力量 Strength', dex: '敏捷 Dexterity', con: '体质 Constitution',
    int: '智力 Intelligence', wis: '感知 Wisdom', cha: '魅力 Charisma'
  };

  /* 技能 → 关联属性 */
  var SKILL_ABILITY = {
    athletics: 'str', acrobatics: 'dex', 'sleight-of-hand': 'dex', stealth: 'dex',
    arcana: 'int', history: 'int', investigation: 'int', nature: 'int', religion: 'int',
    'animal-handling': 'wis', insight: 'wis', medicine: 'wis', perception: 'wis', survival: 'wis',
    deception: 'cha', intimidation: 'cha', performance: 'cha', persuasion: 'cha'
  };

  var SKILLS = {
    athletics: '运动', acrobatics: '杂技', 'sleight-of-hand': '巧手', stealth: '隐匿',
    arcana: '奥秘', history: '历史', investigation: '调查', nature: '自然', religion: '宗教',
    'animal-handling': '驯兽', insight: '洞悉', medicine: '医药', perception: '察觉', survival: '求生',
    deception: '欺瞒', intimidation: '威吓', performance: '表演', persuasion: '说服'
  };

  var RACES = {
    dwarf: '矮人', elf: '精灵', halfling: '半身人', human: '人类', dragonborn: '龙裔',
    gnome: '侏儒', 'half-elf': '半精灵', 'half-orc': '半兽人', tiefling: '提夫林'
  };

  var CLASSES = {
    barbarian: '野蛮人', bard: '吟游诗人', cleric: '牧师', druid: '德鲁伊', fighter: '战士',
    monk: '武僧', paladin: '圣武士', ranger: '游侠', rogue: '游荡者', sorcerer: '术士',
    warlock: '邪术师', wizard: '法师'
  };

  /* 5e 状态 (conditions) */
  var CONDITIONS = {
    blinded: '目盲', charmed: '魅惑', deafened: '耳聋', exhaustion: '力竭',
    frightened: '恐惧', grappled: '被擒抱', incapacitated: '失能', invisible: '隐形',
    paralyzed: '麻痹', petrified: '石化', poisoned: '中毒', prone: '倒地',
    restrained: '束缚', stunned: '震慑', unconscious: '失去意识'
  };

  /* 常用怪物译名（按 index 匹配，未收录的显示英文原名） */
  var MONSTERS = {
    goblin: '哥布林', hobgoblin: '大地精', bugbear: '熊地精', 'goblin-boss': '哥布林头目',
    'orc': '兽人', 'orc-war-chief': '兽人战酋', 'orc-eye-of-gruumsh': '兽人先知',
    kobold: '狗头人', skeleton: '骷髅', zombie: '僵尸', ghoul: '食尸鬼',
    ghast: '妖鬼', wight: '尸妖', wraith: '幽魂', ghost: '幽灵', specter: '幻灵',
    'vampire': '吸血鬼', 'vampire-spawn': '吸血鬼后裔', werewolf: '狼人', 'werebear': '熊人',
    bandit: '强盗', thug: '暴徒', cultist: '邪教徒', guard: '卫兵', knight: '骑士',
    mage: '法师', priest: '祭司', assassin: '刺客', spy: '间谍', scout: '斥候',
    'giant-rat': '巨鼠', wolf: '狼', 'dire-wolf': '恐狼', bear: '熊', 'black-bear': '黑熊',
    'brown-bear': '棕熊', boar: '野猪', lion: '狮子', tiger: '老虎', elephant: '大象',
    'giant-spider': '巨蜘蛛', 'giant-constrictor-snake': '巨蟒', 'poisonous-snake': '毒蛇',
    'red-dragon': '红龙', 'blue-dragon': '蓝龙', 'green-dragon': '绿龙', 'black-dragon': '黑龙',
    'white-dragon': '白龙', 'red-dragon-wyrmling': '红龙雏龙', 'blue-dragon-wyrmling': '蓝龙雏龙',
    'green-dragon-wyrmling': '绿龙雏龙', 'black-dragon-wyrmling': '黑龙雏龙', 'white-dragon-wyrmling': '白龙雏龙',
    'hill-giant': '山丘巨人', 'stone-giant': '石巨人', 'frost-giant': '霜巨人',
    'fire-giant': '火巨人', 'cloud-giant': '云巨人', 'storm-giant': '风暴巨人',
    troll: '巨魔', ogre: '食人魔', golem: '魔像', 'clay-golem': '粘土魔像',
    'stone-golem': '石魔像', 'iron-golem': '铁魔像', mimic: '拟态怪', 'gelatinous-cube': '胶质怪',
    'ochre-jelly': '赭黄冻', 'black-pudding': '黑布丁软泥怪', mummy: '木乃伊', lich: '巫妖',
    'mind-flayer': '夺心魔', beholder: '眼魔', 'displacer-beast': '位移兽', owlbear: '枭熊',
    griffon: '狮鹫', pegasus: '飞马', unicorn: '独角兽', elemental: '元素生物',
    'air-elemental': '气元素', 'earth-elemental': '土元素', 'fire-elemental': '火元素',
    'water-elemental': '水元素', djinni: '风巨灵', efreeti: '火巨灵',
    imp: '小魔鬼', quasit: '夸塞魔', 'pit-fiend': '炼狱魔', 'barbed-devil': '倒钩魔鬼',
    'bone-devil': '骨魔', 'chain-devil': '锁链魔', 'horned-devil': '角魔',
    'ice-devil': '冰魔', 'bearded-devil': '胡须魔', 'dretch': '怯魔', 'manes': '恶魔仆役',
    'balor': '巴洛炎魔', 'marilith': '玛丽丽丝魔', 'glabrezu': '格拉布瑞祖魔',
    'vrock': '弗洛克魔', 'hezrou': '赫兹鲁魔', 'nalfeshnee': '纳尔菲斯尼魔',
    'quasit': '夸塞魔', 'succubus': '魅魔', 'incubus': '魅魔(男)', 'hell-hound': '地狱犬',
    'nightmare': '梦魇兽', 'dragon-turtle': '龙龟', 'basilisk': '石化蜥蜴',
    'chimera': '奇美拉', 'cockatrice': '鸡蛇兽', 'gorgon': '戈耳工牛',
    'hydra': '九头蛇', 'manticore': '蝎尾狮', 'minotaur': '牛头人', 'wyvern': '双足飞龙',
    'ankheg': '掘地虫', 'banshee': '女妖', 'basilisk': '石化蜥蜴', 'cyclops': '独眼巨人',
    'drow': '卓尔精灵', 'doppelganger': '易形怪', 'drider': '蛛化精灵',
    'ettin': '双头巨人', 'gargoyle': '石像鬼', 'harpy': '鹰身女妖', 'hobgoblin-warlord': '大地精督军',
    'kenku': '鸦人', 'kobold-dragon-shrine': '狗头人神龛卫', 'lamia': '拉米亚蛇妖',
    'lizardfolk': '蜥蜴人', 'manticore': '蝎尾狮', 'medusa': '美杜莎', 'merfolk': '人鱼',
    'mummy-lord': '木乃伊领主', 'naga': '娜迦', 'nothic': '诺提克怪', 'ogre-zombie': '食人魔僵尸',
    'orc-nurtured-one-of-yurtrus': '兽人疫育者', 'otyugh': '奥提格怪', 'pseudodragon': '伪龙',
    'purple-worm': '紫蠕虫', 'remorhaz': '雷默哈兹虫', 'roc': '大鹏', 'rust-monster': '锈蚀怪',
    'sahuagin': '鱼人', 'satyr': '萨提尔', 'scorpion': '巨蝎', 'shadow': '影魔',
    'shambling-mound': '蹒跚巨丘', 'shield-guardian': '盾卫魔像', 'spirit-naga': '灵娜迦',
    'sprite': '小仙灵', 'squid': '巨鱿', 'stirge': '吸血蝇', 'treant': '树人',
    'troglodyte': '穴居爬行者', 'vulture': '巨秃鹫', 'worg': '座狼', 'xorn': '索恩晶怪',
    'young-black-dragon': '年轻黑龙', 'young-blue-dragon': '年轻蓝龙', 'young-green-dragon': '年轻绿龙',
    'young-red-dragon': '年轻红龙', 'young-white-dragon': '年轻白龙'
  };

  var ARMOR_TYPES = { light: '轻甲', medium: '中甲', heavy: '重甲', shield: '盾牌' };

  /* 升级经验阈值（标准 5e 表，大部分职业一致） */
  var LEVEL_XP = [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

  /* ---------- 工具函数 ---------- */
  function findIndex(list, name) {
    /* API 的 index 是 kebab-case，名字可能带空格/大小写 */
    var n = String(name || '').trim().toLowerCase();
    return list.indexOf(n) !== -1
      ? n
      : n.replace(/\s+/g, '-');
  }

  var Glossary = {
    abilities: ABILITIES,
    abilityFull: ABILITY_FULL,
    skills: SKILLS,
    skillAbility: SKILL_ABILITY,
    races: RACES,
    classes: CLASSES,
    conditions: CONDITIONS,
    monsters: MONSTERS,
    armorTypes: ARMOR_TYPES,

    abilityMod: function (score) {
      return Math.floor((Number(score || 0) - 10) / 2);
    },
    modText: function (score) {
      var m = Glossary.abilityMod(score);
      return (m >= 0 ? '+' : '') + m;
    },
    modStr: function (m) {
      return (m >= 0 ? '+' : '') + m;
    },
    abilityName: function (index) {
      return ABILITIES[String(index || '').toLowerCase()] || index;
    },
    skillName: function (index) {
      return SKILLS[String(index || '').toLowerCase()] || index;
    },
    raceName: function (index) {
      var i = String(index || '').toLowerCase();
      return RACES[i] || (i.replace(/-/g, ' ') || index);
    },
    className: function (index) {
      var i = String(index || '').toLowerCase();
      return CLASSES[i] || (i.replace(/-/g, ' ') || index);
    },
    conditionName: function (index) {
      var i = String(index || '').toLowerCase();
      return CONDITIONS[i] || i;
    },
    monsterName: function (index) {
      var i = String(index || '').toLowerCase();
      return MONSTERS[i] || (i.replace(/-/g, ' ') || index);
    },
    armorName: function (index) {
      var i = String(index || '').toLowerCase();
      return ARMOR_TYPES[i] || i;
    },

    /* 下一级所需经验：{need, left, ready} */
    nextLevelXp: function (level, xp) {
      level = Math.min(20, Math.max(1, Number(level) || 1));
      var need = LEVEL_XP[level + 1] || 0;
      return {
        need: need,
        left: Math.max(0, need - (Number(xp) || 0)),
        ready: level < 20 && (Number(xp) || 0) >= need
      };
    }
  };

  DnD.Glossary = Glossary;
})(window);
