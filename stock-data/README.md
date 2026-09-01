# stock-data — A 股/港股财务数据静态服务

基于 **GitHub Actions + GitHub Pages** 的免费静态数据服务：定时抓取 A 股与港股上市公司
财务数据，生成 JSON 文件托管在 Pages 上，供 Android 客户端直接访问。

## 工作原理

```
GitHub Actions（定时任务，每天 2 次，双时段兜底）
   └─ Python + AKShare 抓取 → 生成 JSON → 自动 commit 回 master
                        ↓
        GitHub Pages 发布（仓库已启用 Pages 从 master 构建）
                        ↓
        https://masterwusama.github.io/stock-data/data/index.json
                        ↑
        Android App 直接 GET 即可
```

## 数据 URL

| 内容 | URL |
|------|-----|
| 公司索引 | `https://masterwusama.github.io/stock-data/data/index.json` |
| 单家公司 | `https://masterwusama.github.io/stock-data/data/companies/{代码}.json` |
| 单家公司（示例：分众传媒） | `https://masterwusama.github.io/stock-data/data/companies/002027.json` |

## 单家公司 JSON 结构

```jsonc
{
  "code": "600519",            // 股票代码
  "name": "贵州茅台",           // 名称
  "updated_at": "2026-08-08T17:42:00+08:00",
  "info": { ... },              // 基本信息（行业等，尽力而为）
  "indicators": [ ... ],        // 财务指标，最近 21 个报告期（约 5 年；含 *_单季 字段）
  "income": [ ... ],            // 利润表，最近 20 期（约 5 年，新浪源，全字段）
  "balance": [ ... ],           // 资产负债表
  "cashflow": [ ... ],          // 现金流量表
  "snapshot": { ... },          // 最新估值快照（价格/PE/PB/市值）
  "dividends": [ ... ],         // 分红历史（全量）
  "reports": [ ... ],           // 定期报告列表（含官方 PDF 直链）
  "errors": null                // 本次抓取部分失败项（null 表示全部成功)
}
```

### 估值快照（`snapshot`）字段

来自腾讯行情接口，每次更新时抓取一次最新值：

| 字段 | 说明 |
|------|------|
| `price` | 最新价（元） |
| `change_pct` | 涨跌幅（小数，0.0072 = 0.72%） |
| `pe_ttm` | 市盈率（TTM） |
| `pb` | 市净率 |
| `market_cap` | 总市值（元） |
| `float_market_cap` | 流通市值（元） |
| `turnover_rate` | 换手率（小数） |
| `time` | 行情时间（ISO 8601） |

> 无日线/K 线数据：App 如需展示股价走势，可用 `price` 做估值计算，
> 走势图需另接行情 API（或由客户端直接调腾讯/新浪实时接口）。

> 港股（`market: "HK"`）：`pe_ttm/pb/market_cap` 来自东财港股接口，
> `market_cap` 等金额为**港元**；`price/change_pct` 来自腾讯行情 hk 代码。
> 港股无换手率与流通市值精确值（`turnover_rate` 为 null）。

### 分红历史（`dividends`）字段

来自巨潮资讯，全量历史（每家公司 10~30 条）：

| 字段 | 说明 |
|------|------|
| `year` | 分红对应的报告期，如 `2025年报` |
| `type` | 分红类型（年度分红/中期分红等） |
| `announce_date` / `record_date` / `ex_date` / `pay_date` | 公告日/股权登记日/除权日/派息日 |
| `bonus_per_10` | 每 10 股派息（元），如 1.9 = 每 10 股派 1.9 元 |
| `transfer_per_10` | 每 10 股转增股数 |
| `description` | 分红方案说明，如 `10派1.9元(含税)` |

> 股息率 = `bonus_per_10 / 10 / price`，App 端可用 snapshot 的价格实时计算。

### 定期报告（`reports`）字段

`reports` 来自巨潮资讯（证监会指定披露平台），每条包含：

| 字段 | 说明 |
|------|------|
| `title` | 公告标题，如 `2025年年度报告` |
| `category` | 类别：`年报` / `半年报` / `一季报` / `三季报` |
| `date` | 披露日期 |
| `pdf_url` | **官方 PDF 直链**，App 可直接打开/下载 |
| `detail_url` | 巨潮公告详情页（备用） |

覆盖最近 3 年的定期报告（年报/半年报/一季报/三季报，共 12 条左右），
按日期倒序；“摘要”类公告已过滤。

> 港股无巨潮定期报告 PDF 与审计信息（`reports` 为空数组、`info` 为空 dict）。
> 港股财年末已由东财统一映射为 `12-31` 报告期，与 A 股评分逻辑完全兼容。

### 数值单位约定（重要）

`indicators` 中的字段统一解析为标准数值，App 端无需再处理单位：

| 原始值 | 解析后 | 说明 |
|--------|--------|------|
| `"272.43亿"` | `27243000000.0` | 金额一律为 **元** |
| `"1.47%"` | `0.0147` | 比率一律为 **小数**（0.0147 = 1.47%） |
| `"--"` / `"False"` | `null` | 缺失值 |

常见指标字段（`indicators`）：`净利润`、`营业总收入`、`基本每股收益`、
`每股净资产`、`销售毛利率`、`销售净利率`、`净资产收益率`、`流动比率`、
`速动比率`、`资产负债率`、`每股经营现金流` 等（同花顺财务摘要口径）。

## 如何添加/删除公司

编辑 `scripts/config.py` 中的 `DEFAULT_COMPANIES` 列表（元组格式为
`(代码, 名称, 市场)`，市场 `A`=A 股、`HK`=港股、`US`=美股）：

```python
DEFAULT_COMPANIES = [
    ("600519", "贵州茅台", "A"),
    ("000858", "五粮液", "A"),
    ("00700", "腾讯控股", "HK"),
    # 在这里追加：("601318", "中国平安", "A"), ...
]
```

推送到 GitHub 后，手动触发 workflow（Actions 页面 → Run workflow）即可更新。

## 本地调试

```bash
pip install -r scripts/requirements.txt

# 抓取全部公司
python scripts/fetch_data.py

# 只抓前 2 家（快速测试）
python scripts/fetch_data.py --limit 2
```

数据输出到 `data/` 目录。

## 公司事件 / 股东结构数据（一次性 Wind 抓取，不随每日更新）

价值分析详情页的 **⑥ 造假风险 / ⑦ 管理水平** 提供“基础财报分 ↔ Wind 事件增强分”切换，
并新增 **⑨ 公司事件与股东结构** 模块。事件信号来自万得（Wind）付费数据，
由 `scripts/fetch_events.py` **本地手动跑一次**生成，**不接入每日 Actions 定时更新**（避免持续消耗 Wind 配额）。

- **仅覆盖 A 股**：无事件数据的公司（港美股/未抓取）在“Wind 事件增强分”档下造假/管理两列不给分显示 `-`，基础档正常显示；详情页隐藏 ⑨ 模块。
- **存储隔离**：产物写入 `data/events/`，独立于每日 `data/*` 的自动提交，互不干扰。
  - `data/events/<code>.json`：单家原始明细（增减持/并购/违规/诉讼/ST + 前十大/机构/实控人/解禁）
  - `data/events/index.json`：列表覆盖层 `{updated_at, byCode:{code:{fraudDelta, mgmtDelta, flags, ...}}}`
- **评分内核不变**：事件信号在 `fetch_events.py` 内算成静态 `delta`，前端只做 `clamp(基础分 + delta, 0, 100)`，不改动财报评分逻辑。
- **并购桶清洗**：Wind 对“并购重组”问句偶发路由塌缩会把全市场无关事件整表灌入，抓取时已过
  `clean_ma_rows`（仅保留本公司代码/简称出现在并购各方的行，并合并同事件出让/竞买方展开行）；
  存量明细重清洗：对每家 `data/events/<code>.json` 的 `events.ma` 套用 `clean_ma_rows(recs, name, windcode)`
  回写后，再 `--recompute` 重建覆盖层（均离线，不耗积分）。
- **股东表透视重建**：Wind 股东类表（`holders.institutions/top10/top10_float`）偶发返回“最新期名次 i ×
  上期名次 j”的交叉展开行（名次重复、“较上期变动”是错配差值，如 -3 亿股），且 MAX_ROWS=20 截断后
  最新期只能恢复到前几家；抓取/计算两层均由 `reconstruct_holder_rows` 透视回每家一行（上期值按同名回接、
  变动重算，幂等）；“机构增持”信号改比较两期“持股比例合计”常量列；前端 `pickVal` 精确匹配优先，
  防单家比例列被子串抢到“…合计”列。存量已离线重建（2026-08-30）。

```bash
# 依赖 wind-mcp-skill（Node CLI），需有效 Wind token；token 有限时按 --codes 精抓
python scripts/fetch_events.py                      # 抓取全部 A 股（消耗配额）
python scripts/fetch_events.py --codes 002027,601899  # 只抓指定代码（增量）
python scripts/fetch_events.py --recompute           # 离线用已存 JSON 重算 delta/index.json（不耗 Wind）
```

> 当前已抓取 21 家 A 股事件数据；后续 token 恢复可用 `--codes` 增量补齐，无需重抓已有。
>
> 已抓的 12 家（2026-08 批）+ 长江传媒 600757 / 鲁泰A 000726 / 北大荒 600598 / 山西汾酒 600809 /
> 海容冷链 603187 / 云铝股份 000807（2026-09-01）+ 江苏国泰 002091 / 中创智领 601717 /
> 盐湖股份 000792（2026-09-01）。其余公司按要求**不抓 Wind 事件数据**：详情页 ⑥/⑦ 的
> “Wind 事件增强分”档两列显示 `-`、⑨ 模块隐藏，基础财报档正常评分与展示。

## 每日更新与自查

模拟持仓与股票数据由 GitHub Actions 定时抓取，**默认周一至周六每天 2 个时段**触发
（北京 16:00 主 + 22:00 兜底）。若某天页面数据未刷新（详情页/持仓 `as_of` 或 `data/index.json`
的 `updated_at` 未推进到当日），按以下流程排查：

1. **先看 Actions 运行记录**（判别是超时还是 cron 未触发）：

   ```bash
   curl -s "https://api.github.com/repos/masterwusama/masterwusama.github.io/actions/workflows/stock-data-update.yml/runs?per_page=6"
   # 看每条 created_at / status / conclusion
   ```

   - 当天**没有记录** → cron 调度延迟/漏触发（GitHub 侧调度问题，非代码问题）；
   - 当天有记录但 `conclusion=cancelled` 且起止时间卡满 timeout → 抓取超时被掐；
   - `conclusion=success` 但仍未更新 → 数据无变更（正常，可忽略）。

2. **本地手动补跑**（脚本幂等，按交易日跳重，可放心重跑）：

   ```bash
   cd stock-data/scripts
   python fetch_data.py        # 重抓最新财务/行情数据（可选，价格旧时再抓）
   python portfolio_engine.py  # 基于最新数据做当日调仓，推进 as_of
   ```

   之后 `git add stock-data/data stock-data/portfolio/data && git commit && git push`
   （手动补跑不消耗 Wind 积分，仅用免费东财/同花顺接口）。

> 提示：cron 双时段只是降低漏触发概率，GitHub Actions 的 schedule 调度高峰期仍可能延迟
> 或偶发漏跑，若页面长期未更新优先按本节流程自查+手动补跑。

## 注意

- **更新频率**：定时任务每天 2 次，双时段兜底（北京 16:00 主 + 22:00 兜底，周一至周六），
  适合财报、日线类数据；实时行情请勿依赖本服务
- **数据源**：AKShare（同花顺 / 新浪 / 东方财富公开接口），免费、无需 token，
  但接口偶尔会变动，脚本需相应维护；港股数据源为东财港股接口 + 腾讯行情，
  报表科目按 IFRS 口径（与 A 股科目名不同，脚本内已做映射归一化）
- **数据仅供个人学习研究**，商业使用请确认数据源协议
- 当前跟踪 48 只股票，**名单以 `scripts/config.py` 的 `DEFAULT_COMPANIES` 为准**（2026-08-30 清洗掉 22 只不触发任何流派买点的标的；2026-08-31 新增海螺水泥 600585、东航物流 601156、上港集团 600018、长江传媒 600757、北大荒 600598，删除科前生物 688526、可口可乐 KO；2026-09-01 删除吉林敖东 000623、南京高科 600064、海螺水泥 600585、广深铁路 601333、上汽集团 600104、山东出版 601019、宝钢股份 600019、韵达股份 002120、富奥股份 000030、铜陵有色 000630、上港集团 600018、皖能电力 000543、建投能源 000600，新增盐湖股份 000792、浙农股份 002758、史丹利 002588、北京人力 600861、海油发展 600968、通宝能源 600780、长虹华意 000404），覆盖全市场（5000+ 只）需改脚本分批抓取；
  全市场选股用 scripts/screen_stocks.py（管理/造假/流派买点筛选，带本地缓存）
