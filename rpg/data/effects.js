/* effects.js - 状态效果定义（6 种，战斗内外持续）
 * 字段说明：
 *  - perTurn：战斗内每回合结算（扣血量）
 *  - perStep：战斗外每逻辑步结算（扣血量/扣精神量）
 *  - atkRate：攻击力倍率（恐惧/断臂）
 *  - agiRate：行动序敏捷倍率（断腿）
 *  - moveRate：地图移动速度倍率（断腿）
 *  - skipChance：行动跳过概率（恐惧）
 *  - noSkills：禁用技能（断臂：无法使用双手/复杂技能） */
Game.EFFECTS.register([
  { "id": "bleed", "name": "流血", "icon": "血", "color": "#c84a4a",
    "perTurn": 3, "perStep": 0.2, "desc": "伤口不断渗血，每回合/持续扣血" },
  { "id": "poison", "name": "中毒", "icon": "毒", "color": "#7a9a3a",
    "perTurn": 2, "perStep": 0.1, "desc": "毒素缓慢侵蚀，持久扣血" },
  { "id": "fear", "name": "恐惧", "icon": "惧", "color": "#7a6ac8",
    "atkRate": 0.5, "skipChance": 0.2, "mindPerTurn": 2, "desc": "攻击力减半，偶尔因恐惧僵住" },
  { "id": "broken_arm", "name": "断臂", "icon": "臂", "color": "#a08060",
    "atkRate": 0.5, "noSkills": true, "desc": "手臂骨折，普攻减半且无法施展技能" },
  { "id": "broken_leg", "name": "断腿", "icon": "腿", "color": "#8a8a8a",
    "agiRate": 0.5, "moveRate": 0.5, "desc": "腿部骨折，速度与行动序减半" },
  { "id": "dark", "name": "黑暗", "icon": "暗", "color": "#4a4a5a",
    "mindPerTurn": 3, "mindPerStep": 0.15, "desc": "身处黑暗，精神持续流失" }
]);
