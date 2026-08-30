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
  }
]);
