/* items.js - 物品数据（背包/战利品/战斗道具）
 * type：use=消耗品（可战斗/背包使用）；
 * effect：数值增减 {hp|sp|hunger|mind}、cure=解除状态效果列表、remove=战斗外移除该物品 */
Game.ITEMS.register([
  { "id": "bandage", "name": "绷带", "type": "use", "effect": { "hp": 30 }, "desc": "包扎伤口，恢复少量生命" },
  { "id": "tourniquet", "name": "止血带", "type": "use", "effect": { "cure": ["bleed"], "hp": 10 }, "desc": "止血包扎，解除流血" },
  { "id": "ration", "name": "干粮", "type": "use", "effect": { "hunger": 40 }, "desc": "干硬的面饼，填饱肚子" },
  { "id": "antidote", "name": "解毒剂", "type": "use", "effect": { "cure": ["poison"] }, "desc": "苦涩的草药汁，解除中毒" },
  { "id": "liquor", "name": "烈酒", "type": "use", "effect": { "mind": 20, "cure": ["fear"] }, "desc": "辛辣的烈酒，壮胆安神" },
  { "id": "splint", "name": "夹板", "type": "use", "effect": { "cure": ["broken_arm", "broken_leg"] }, "desc": "木夹板与布条，固定断骨" },
  { "id": "energy_drink", "name": "提神药剂", "type": "use", "effect": { "sp": 12 }, "desc": "提神的药剂，恢复技能点数" },
  { "id": "rat_meat", "name": "生鼠肉", "type": "use", "effect": { "hunger": 10, "mind": -5 }, "desc": "聊胜于无……令人不适" },
  { "id": "raw_meat", "name": "生肉", "type": "use", "effect": { "hunger": 20 }, "desc": "未处理的生肉，勉强能吃" }
]);
