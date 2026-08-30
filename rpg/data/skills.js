/* skills.js - 技能数据（玩家技能 + 敌人技能统一注册）
 * 玩家技能消耗 SP；敌人技能在战斗里按 rate 概率选用。
 * 字段：cost(SP)、power(伤害倍率)、hits(段数)、effect(附加状态)、defDown(降防) */
Game.SKILLS.register([

  /* ---------- 玩家技能（消耗 SP） ---------- */
  {
    "id": "heavy_strike", "name": "重击", "owner": "player", "cost": 6,
    "power": 1.8, "hits": 1,
    "effect": { "status": "bleed", "chance": 0.3, "turns": 3 },
    "desc": "蓄力一击，有几率撕裂伤口使其流血"
  },
  {
    "id": "double_slash", "name": "连斩", "owner": "player", "cost": 8,
    "power": 0.8, "hits": 2, "twoHand": true,
    "desc": "快速挥出两刀，各造成部分伤害"
  },
  {
    "id": "rend_armor", "name": "破甲", "owner": "player", "cost": 5,
    "power": 1.0, "hits": 1,
    "defDown": { "amt": 3, "turns": 3 },
    "desc": "击打要害，削弱对方防御数回合"
  },

  /* ---------- 敌人技能（rate 在敌人数据中给出） ---------- */
  { "id": "gnaw", "name": "啃咬", "owner": "enemy", "cost": 0, "power": 1.0, "hits": 1 },
  {
    "id": "rend", "name": "撕咬", "owner": "enemy", "cost": 0, "power": 1.2, "hits": 1,
    "effect": { "status": "bleed", "chance": 0.5, "turns": 3 }
  },
  {
    "id": "dark_gaze", "name": "暗噬凝视", "owner": "enemy", "cost": 0, "power": 0.8, "hits": 1,
    "effect": { "status": "fear", "chance": 0.6, "turns": 4 }
  },
  {
    "id": "bone_crush", "name": "断骨重击", "owner": "enemy", "cost": 0, "power": 1.4, "hits": 1,
    "effect": { "status": "broken_leg", "chance": 0.35, "turns": 5 }
  }
]);
