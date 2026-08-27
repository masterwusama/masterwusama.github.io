# stock-data — A 股/港股财务数据静态服务

基于 **GitHub Actions + GitHub Pages** 的免费静态数据服务：定时抓取 A 股与港股上市公司
财务数据，生成 JSON 文件托管在 Pages 上，供 Android 客户端直接访问。

## 工作原理

```
GitHub Actions（定时任务，每天 3 次）
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

## 注意

- **更新频率**：定时任务每天 3 次（北京 9:00 / 17:00 / 次日 1:00），适合财报、
  日线类数据；实时行情请勿依赖本服务
- **数据源**：AKShare（同花顺 / 新浪 / 东方财富公开接口），免费、无需 token，
  但接口偶尔会变动，脚本需相应维护；港股数据源为东财港股接口 + 腾讯行情，
  报表科目按 IFRS 口径（与 A 股科目名不同，脚本内已做映射归一化）
- **数据仅供个人学习研究**，商业使用请确认数据源协议
- 当前跟踪 48 只股票（分众传媒、广信股份、人福医药、东宏股份、国药股份、华域汽车、航民股份、明泰铝业、博俊科技、三角轮胎、招商南油、万华化学、宝钢股份、海螺水泥、新媒股份、紫金矿业、中材国际、海油工程、山西汾酒、长江电力、云铝股份、神火股份、塔牌集团、大秦铁路、柳工、伊利股份、玲珑轮胎、安旭生物、鲁泰A、隧道股份、中创智领、中国建筑、山东路桥、物产中大、时代出版、安徽建工、南京高科、长江传媒、山东出版、贵州轮胎、大商股份、中国民航信息网络、中海物业、保利物业、中国食品、谷歌-A、英伟达、可口可乐），覆盖全市场（5000+ 只）需改脚本分批抓取
