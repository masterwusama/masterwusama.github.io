/* enemies.js - 敌人数据（战斗属性 + 地图实体行为）
 * 战斗属性：hp/atk/def/agi/gold/skills/loot（§6.5）
 * 地图实体：color(占位色块)、sight(视野格，看到玩家追击)、patrolSpeed(巡逻速度)、chaseSpeed(追击速度)
 * 巡逻路线在地图 enemySpawns 中给出（实例），此处只定义类型属性。 */
Game.ENEMIES.register([
  {
    "id": "rat", "name": "巨鼠",
    "hp": 22, "atk": 6, "def": 1, "agi": 9, "gold": 3,
    "skills": [ { "id": "gnaw", "rate": 1.0 } ],
    "loot": [ { "item": "rat_meat", "rate": 0.6 } ],
    "color": "#8a7a60", "size": 22, "sight": 3, "patrolSpeed": 0.6, "chaseSpeed": 1.2
  },
  {
    "id": "hound", "name": "饿犬",
    "hp": 38, "atk": 10, "def": 3, "agi": 7, "gold": 8,
    "skills": [ { "id": "gnaw", "rate": 0.5 }, { "id": "rend", "rate": 0.5 } ],
    "loot": [ { "item": "raw_meat", "rate": 0.6 }, { "item": "bandage", "rate": 0.2 } ],
    "color": "#6a5a48", "size": 26, "sight": 5, "patrolSpeed": 0.9, "chaseSpeed": 1.6
  },
  {
    "id": "cultist", "name": "暗影教徒",
    "hp": 58, "atk": 13, "def": 5, "agi": 5, "gold": 20,
    "skills": [ { "id": "gnaw", "rate": 0.3 }, { "id": "dark_gaze", "rate": 0.4 }, { "id": "bone_crush", "rate": 0.3 } ],
    "loot": [ { "item": "liquor", "rate": 0.4 }, { "item": "antidote", "rate": 0.3 }, { "item": "splint", "rate": 0.2 } ],
    "color": "#3a2a3a", "size": 28, "sight": 6, "patrolSpeed": 0.5, "chaseSpeed": 1.0
  }
]);
