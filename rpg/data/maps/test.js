// 由 tools/gen_map.py 自动生成，请勿手改（如需修改请编辑脚本后重新生成）
Game.MAPS.register({
  "id": "test",
  "name": "测试场",
  "tileSize": 32,
  "width": 10,
  "height": 10,
  "legend": {".": "grass", "#": "wall", "T": "tree", "~": "water", "+": "door", "B": "bed"},
  "ground": [
    "##########",
    "#........#",
    "#.T......#",
    "#........#",
    "#........#",
    "..........",
    "#........#",
    "#........#",
    "#........#",
    "##########",
  ],
  "doors": [],
  "exits": [{"x": 9, "y": 5, "to": "prologue", "toX": 158, "toY": 60}],
  "npcSpawns": [],
  "enemySpawns": [],
  "triggers": [],
  "autostart": null
});
