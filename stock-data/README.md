# stock-data — A 股财务数据静态服务

基于 **GitHub Actions + GitHub Pages** 的免费静态数据服务：定时抓取 A 股上市公司
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

编辑 `scripts/config.py` 中的 `DEFAULT_COMPANIES` 列表：

```python
DEFAULT_COMPANIES = [
    ("600519", "贵州茅台"),
    ("000858", "五粮液"),
    # 在这里追加：("601318", "中国平安"), ...
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
  但接口偶尔会变动，脚本需相应维护
- **数据仅供个人学习研究**，商业使用请确认数据源协议
- 当前跟踪 11 只股票（分众传媒、广信股份、人福医药、东宏股份、华钰矿业、比亚迪、广深铁路、梅花生物、柳工、国药股份、宁德时代），覆盖全市场（5000+ 只）需改脚本分批抓取
