/* flags.js - 初始 flag 白名单（M1）
 * 所有剧本/地图引用的 flag 必须在此声明初始值（校验器强制，杜绝隐式状态）。 */
Game.FLAGS_INIT = {
  // 镇口剧情
  "has_house_key": false,    // 是否从老人处拿到房子钥匙
  "town_house_open": false   // 镇口房子大门是否打开（门 tile 可走）
};
