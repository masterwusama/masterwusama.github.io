# auto_screen.py 使用教程

本地自动化抓取筛选器：把 [价值分析网页](https://masterwusama.github.io/stock-data/) 列表页的**全部筛选条件**做成了命令行参数，并额外支持**全市场扫描**。所有评分与买点/卖点算法直接复用网站同源代码（`scoring.py`），输出与网页所见完全一致。

脚本位置：`stock-data/scripts/auto_screen.py`，在 `stock-data` 目录下运行。

## 1. 快速上手

```powershell
cd e:\github\masterwusama.github.io\stock-data

# ① 和网页勾「造假≤30 + 管理≥55 + 施洛斯买点」完全等价
python scripts\auto_screen.py --fraud-max 30 --mgmt-min 55 --buy schloss

# ② 全市场扫描（不限跟踪列表），找符合巴菲特买点的破净附近公司
python scripts\auto_screen.py --source market --buy buffett --top 20

# ③ 秒级报告：不联网，仅用已有精算缓存
python scripts\auto_screen.py --source market --cache-only --buy schloss --fraud-max 30 --mgmt-min 55
```

## 2. 网页筛选条件 → 参数对照表

| 网页筛选面板 | 脚本参数 | 说明 |
|---|---|---|
| 造假风险 ≤ N | `--fraud-max 30` | 0~100 整数，越高越可疑 |
| 管理能力 ≥ N | `--mgmt-min 55` | 0~100 整数，越高越好 |
| 买点复选框（多选=同时满足） | `--buy schloss` / `--buy gdef,schloss` | 流派可写英文（`grahamAgg` `grahamDef` `schloss` `buffett`）、缩写（`gagg` `gdef` `buf`）或中文（`格进取` `格防御` `施洛斯` `巴菲特`） |
| 打折促销 % | `--discount 80` | 仅配合 `--buy`：要求现价 ≤ 买价×N%。80=再打8折才买，120=距买点 20% 以内即放行；默认 100 |
| 卖点复选框（多选=同时满足） | `--sell buffett` | 现价须**同时** ≥ 保守卖价与公允卖价，任一缺失即排除 |
| 搜索框 | `--keyword 轮胎` | 名称/代码模糊匹配 |
| 市场 Tab | `--market A,HK,US` | 默认全部；逗号分隔，可写 `A股` `港股` `美股` |

网页没有、脚本额外的条件（放在筛选面板之外）：

| 参数 | 说明 |
|---|---|
| `--cycle-max 40` | 周期位置评分 ≤ N（越低越接近周期底部）；**非周期性公司无此分数，会被排除** |
| `--pb-min` / `--pb-max` | 仅 market 源预筛：PB 区间（默认 0.01~1.40，覆盖施洛斯买点数学上限） |
| `--mcap-min` | 仅 market 源预筛：总市值下限（元，默认 30 亿） |

## 3. 两种数据源

### `--source tracked`（默认，与网页一致）

只筛**已跟踪列表**（`data/index.json`，目前 68 家），零网络请求、秒级出结果。

- 加 `--refresh`：先跑 `fetch_data.py` 全量更新跟踪数据再筛（**耗时约数小时**，平时无需——GitHub Actions 每个交易日已在自动抓取）。

### `--source market`（全市场扫描）

在沪深两表中预筛（非 ST/退市/次新、PB/PE/市值区间、排除已跟踪），对池内股票逐只联网精算四流派评分与买卖点。

- **缓存断点续跑**：精算结果写入 `scripts/_screen_cache.json`（与 `screen_stocks.py` 共用），已算过的不重复抓；一次跑不完（受 `--max-attempts` 限制，约 10~15 秒/只）**下次原命令直接续跑**，随扫随存。
- `--cache-only`：完全不联网，用缓存现价直接出报告——行情下杀后想第一时间知道谁新命中买点，就用这个，秒级。
- 注意：现价来自缓存抓取时刻（或最近一次扫描时刻），隔多日后价格有漂移；要最新价就重跑一次不带 `--cache-only`（已缓存的只复算行情部分）。
- 全市场源仅覆盖沪深 A 股；港股/美股筛选请用 tracked 源。

## 4. 条件语义细则（与网页 `passFilter` 逐条对齐）

- 各条件之间取**交集**；某公司依赖的评分/参考价/现价缺失时**自动排除**（不会误放行）。
- 买点命中：`现价 ≤ 买价 × discount%`；多流派同选需全部满足。
- 卖点命中：`现价 ≥ 保守卖价 且 ≥ 公允卖价`（券商类 sellCons 常为 null，会被排除，属预期）。
- `--discount`、`--fraud-max` 等越界值自动钳制到合法区间（与网页输入框行为一致）。

## 5. 排序与输出

- `--sort`：`disc`（买点折扣最深在前，选了 `--buy` 时默认）｜`mgmt`（默认）｜`fraud`｜`price`｜`score:<流派>`。
- `--top N`：控制台显示前 N 名，默认 50，`0` = 全部。
- 每次运行都会把**完整明细**（含全部评分、买卖参考价、折扣、命中流派）写入 `scripts/_auto_screen_result.json`，可用 `--out` 改路径；控制台只做速览。

控制台每行含义：

```
  1. 601163 三角轮胎 [A] 橡胶和塑料制品业 现价 12.48 造假 11.1 管理 67.7 周期 -
     评分 67/100/97/61（进取/防御/施洛斯/巴菲特）  买点: 施洛斯 14.39(-13.3%)
```

- `周期 -`：非周期性行业，不参评（用 `--cycle-max` 会被排除）；
- `14.39(-13.3%)`：施洛斯买点 14.39 元，现价较买点**低 13.3%**（折价越深越便宜）。

## 6. 常用配方

```powershell
# 施洛斯原教旨：质量过硬 + 已入买点，按折价深度排
python scripts\auto_screen.py --fraud-max 30 --mgmt-min 55 --buy schloss

# 买点左侧埋伏：距买点 20% 以内的防御股，全市场找
python scripts\auto_screen.py --source market --buy gdef --discount 120 --fraud-max 20 --mgmt-min 60

# 跟踪列表里谁已到卖出区（巴菲特口径双卖价齐破）
python scripts\auto_screen.py --sell buffett

# 周期底部 + 低造假 + 防御买入价 9 折以下
python scripts\auto_screen.py --cycle-max 40 --fraud-max 30 --buy gdef --discount 90

# 只看某一家的当前全貌
python scripts\auto_screen.py --keyword 汾酒 --top 0
```

## 7. 常见问题

| 现象 | 原因与处理 |
|---|---|
| market 扫描中途断网/中断 | 无需处理，缓存逐只落盘，重跑原命令自动续 |
| `--sell` 在旧缓存上结果偏少 | 旧缓存条目缺卖出价字段，带 `--sell` 运行时会自动重扫这些股票（消耗 attempts）；只想快速出结果可先跑一次让它补齐缓存 |
| 命中 0 但感觉不该为空 | 施洛斯买点要求现价打到净资产七折附近再扣风险分，市场不出现极端低价时命中为 0 是常态（2026-08 全市场 571 只破净池验证过，确为零命中） |
| PowerShell 输出中文乱码 | 用管道/重定向到文件时 PowerShell 会转码；直接看终端输出，或 `python scripts\auto_screen.py ... > out.txt` 后以 UTF-8 打开 |
| 想改回用旧脚本 | `screen_stocks.py` 仍可用，两者共用同一份缓存；`auto_screen.py` 是其超集（多了卖点/周期/关键词/市场条件与跟踪源模式） |
