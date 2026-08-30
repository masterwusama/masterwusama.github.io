/* story/town.js - 镇口区域剧本节点（M1 示例：对话→钥匙→开门→休息存档）
 * 节点 schema 见 rpg/docs/DESIGN.md §5：id 唯一；cond 进入条件；
 * choices[].need 选项前置；choices[].effect 选择时写入；choices[].goto 跳转（null 结束）。
 * effect 支持：{flag,val} / {hp|hunger|mind: n}（数值增减）/ {action:"save"} / {time: hours} */
Game.NODES.register([

  // ---------- 门口老人（interact）----------
  {
    id: "town_oldman",
    type: "dialog",
    once: true,
    text: [
      "一个老人坐在屋前的石头上，眯着眼打量你。",
      "「年轻人，你也是来镇上找人的？……这地方不太平。」",
      "他从怀里摸出一把生锈的钥匙，塞进你手里。",
      "「北边那间屋子，兴许用得着。拿着吧。」"
    ],
    choices: [
      { "text": "谢谢。", "effect": { "flag": "has_house_key", "val": true }, "goto": "town_oldman_2" },
      { "text": "离开", "goto": null }
    ]
  },
  {
    id: "town_oldman_2",
    type: "dialog",
    text: [
      "老人摆摆手，不再说话，目光重新落回雾气弥漫的河面。"
    ],
    choices: [
      { "text": "离开", "goto": null }
    ]
  },

  // ---------- 锁着的房子门（interact）----------
  {
    id: "town_house_door",
    type: "dialog",
    cond: { "flag": "town_house_open", "op": "==", "val": false },
    text: [
      "门锁得死死的，钥匙孔里结着蛛网。"
    ],
    choices: [
      { "text": "用钥匙开门", "need": { "flag": "has_house_key", "op": "==", "val": true }, "effect": { "flag": "town_house_open", "val": true }, "goto": "town_house_door_open" },
      { "text": "再试试", "goto": null },
      { "text": "离开", "goto": null }
    ]
  },
  {
    id: "town_house_door_open",
    type: "dialog",
    text: [
      "「咔哒。」锁芯转动，门缓缓滑开。",
      "你侧身走进屋子。屋里昏暗，弥漫着陈旧的木头气味。"
    ],
    choices: [
      { "text": "进屋", "goto": null }
    ]
  },

  // ---------- 床：休息 + 存档点（interact）----------
  {
    id: "town_bed",
    type: "dialog",
    text: [
      "一张旧床，铺着干净的褥子，床头的柜子上积了一层薄灰。"
    ],
    choices: [
      { "text": "躺下休息（存档）", "effect": { "hp": 50, "hunger": 30, "mind": 20, "time": 8, "action": "save" }, "goto": "town_bed_wake" },
      { "text": "离开", "goto": null }
    ]
  },
  {
    id: "town_bed_wake",
    type: "dialog",
    text: [
      "你睡了一觉。醒来时天光微亮，身上松快了些。",
      "（进度已保存）"
    ],
    choices: [
      { "text": "起床", "goto": null }
    ]
  },

  // ---------- 河边低语（enter 触发器，演示区域触发）----------
  {
    id: "town_river_whisper",
    type: "dialog",
    once: true,
    text: [
      "河面上浮着雾气，隐约传来细碎的低语声，像有什么东西在水下说话。",
      "你加快脚步，离开了河边。"
    ],
    choices: [
      { "text": "继续赶路", "goto": null }
    ]
  },

  // ===================== M2 战斗节点（明雷敌人接触触发）=====================
  // battle 节点：enemies=敌人类型数组；win/lose=战后分支节点（lose 走濒死，§6.4）
  {
    id: "battle_rat",
    type: "battle",
    enemies: ["rat"],
    win: "battle_rat_win",
    lose: "near_death_wake"
  },
  {
    id: "battle_rat_win",
    type: "dialog",
    text: [
      "巨鼠瘫软在地，不动了。",
      "你喘着粗气，环顾四周——镇上的危险，远不止这一只。"
    ],
    choices: [ { "text": "继续", "goto": null } ]
  },

  {
    id: "battle_hound",
    type: "battle",
    enemies: ["hound"],
    win: "battle_hound_win",
    lose: "near_death_wake"
  },
  {
    id: "battle_hound_win",
    type: "dialog",
    text: [
      "饿犬呜咽一声，再爬不起来。",
      "它的肋骨根根分明——这镇上饿死的不仅是人。"
    ],
    choices: [ { "text": "继续", "goto": null } ]
  },

  {
    id: "battle_cultist",
    type: "battle",
    enemies: ["cultist"],
    win: "battle_cultist_win",
    lose: "near_death_wake"
  },
  {
    id: "battle_cultist_win",
    type: "dialog",
    text: [
      "黑袍倒地，兜帽下是一张苍白而平静的人脸，仿佛在笑。",
      "「……你也会成为祂的一部分。」"
    ],
    choices: [ { "text": "离开", "goto": null } ]
  },

  // 濒死唤醒（战败/生存耗尽共用）：由 core 传送回存档点并施加惩罚后触发
  {
    id: "near_death_wake",
    type: "dialog",
    text: [
      "黑暗吞噬了你……",
      "再睁眼时，你躺在熟悉的地方，浑身剧痛，身上的许多东西都不见了。",
      "（濒死：状态恶化、物品散落，被送回存档点）"
    ],
    choices: [ { "text": "挣扎着起身", "goto": null } ]
  }
]);
