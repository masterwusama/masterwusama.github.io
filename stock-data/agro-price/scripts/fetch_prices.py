# -*- coding: utf-8 -*-
"""
农化制品价格跟踪 — 数据抓取脚本（仅标准库，供 GitHub Actions 定时运行）

数据源（均已实测可直抓）：
  1. 中农立华原药价格指数（www.sino-agri-sal.com）——原药主序列
     - 列表页 pnlist.php?cid=28&page=N（原药价格指数周报，2023.07 起含品种报价）
       pnlist.php?cid=29&page=N（原药市场行情周报，2023.12~2026.07 持续更新）
     - 正文格式：`多菌灵原药报价3.6万元/吨`、`95%含量报2.7万元/吨`（草甘膦特殊）
  2. 生意社（www.100ppi.com）——中间体主序列 + 原药历史填充
     - news/detail-*.html 报价动态文章（多交易商报价，按交易商分组取主序列）
     - mprice/plist-1-{商品ID}-{页}.html 最新报价表格（含报价类型：市场价/出厂价）
  3. 3456.tv（火爆农资招商网）行情文章（2022~2025 已停更，仅用于历史回填）

输出：data/products.json（增量合并，按品种、日期去重）
"""
import json
import os
import re
import sys
import time
import urllib.request
import ssl
from collections import Counter

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(BASE_DIR, 'data', 'products.json')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
SLEEP = 0.4
RETRY = 3

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# ---------------- 品种配置 ----------------
# primary: 主序列来源
#   sino-agri : 中农立华周度序列（原药）
#   sunsirs   : 生意社按交易商分组取样本最多组（中间体）
# sunsirs_seed: 生意社任意一篇报价动态文章（用于定位栏目页）
# mprice_ids : 生意社报价中心商品 ID（plist-1-{id}-1.html）
PRODUCTS = [
    {
        'id': 'carbendazim', 'name': '多菌灵', 'category': '杀菌剂', 'spec': '原药',
        'primary': 'sino-agri',
        'sunsirs_seed': 'https://www.100ppi.com/news/detail-20260821-6102168.html',
    },
    {
        'id': 'thiophanate-methyl', 'name': '甲基硫菌灵', 'category': '杀菌剂', 'spec': '原药',
        'primary': 'sino-agri',
        'sunsirs_seed': None,
    },
    {
        'id': 'diuron', 'name': '敌草隆', 'category': '除草剂', 'spec': '原药',
        # 中农立华周报不常报敌草隆（稀疏且口径不同），只用生意社连续报价
        'primary': 'sunsirs',
        'exclude_sources': ['sino-agri'],
        'sunsirs_seed': 'https://www.100ppi.com/news/detail-20260804-6022152.html',
    },
    {
        'id': 'glyphosate', 'name': '草甘膦', 'category': '除草剂', 'spec': '95%原药',
        'primary': 'sino-agri',
        'sunsirs_seed': 'https://www.100ppi.com/news/detail-20210730-1866835.html',
    },
    {
        'id': 'o-phenylenediamine', 'name': '邻苯二胺', 'category': '中间体', 'spec': '优等品',
        'primary': 'sunsirs',
        'sunsirs_seed': 'https://www.100ppi.com/news/detail-20260818-6084138.html',
        'mprice_ids': [(1922, '邻苯二胺')],
    },
    {
        'id': 'p-nitrochlorobenzene', 'name': '对硝基氯化苯', 'category': '中间体', 'spec': '99%',
        'primary': 'sunsirs',
        'sunsirs_seed': 'https://www.100ppi.com/news/detail-20260708-5891252.html',
        # (商品ID, 页面显示名)：2345"对硝基氯苯"、1535"对硝基氯化苯"、
        # 2364"对氯硝基苯"（同一化合物 CAS 100-00-5 的别名命名）
        'mprice_ids': [(2345, '对硝基氯苯'), (1535, '对硝基氯化苯'), (2364, '对氯硝基苯')],
        # 多交易商报价全部按日取中位数合并（默认只取样本最多的单一交易商）
        'merge_all_traders': True,
    },
]

# 中农立华列表页：cid=(28 原药价格指数, 29 原药市场行情)，每页 30 篇
# 品种报价自 2023 年中起才出现在正文：cid=28 仅第 1 页（2023.01~2023.11）、
# cid=29 前 4 页（2023.12~2026.07）
SINO_AGRI_PAGES = [(28, 1), (29, 4)]

# 生意社 detail 栏目翻页上限（增量模式：历史数据保留在仓库内 products.json 中）
SUNSIRS_MAX_PAGES = 5

# 3456.tv 行情文章聚合页
T3456_PAGES = ['http://www.3456.tv/jiage/nongyao/']


def fetch(url, encoding=None, referer=None):
    """抓取网页（重试 + UA + 可选 Referer），返回解码后的文本"""
    last_err = None
    for i in range(RETRY):
        try:
            headers = {'User-Agent': UA}
            if referer:
                headers['Referer'] = referer
            req = urllib.request.Request(url, headers=headers)
            resp = urllib.request.urlopen(req, timeout=25, context=ctx)
            raw = resp.read()
            if encoding is None:
                for enc in ('utf-8', 'gbk'):
                    try:
                        return raw.decode(enc)
                    except (UnicodeDecodeError, LookupError):
                        continue
                return raw.decode('utf-8', 'ignore')
            return raw.decode(encoding, 'ignore')
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(SLEEP * (i + 2))
    raise RuntimeError('fetch failed: %s (%r)' % (url, last_err))


def strip_html(html):
    """去脚本/样式/标签，压缩空白"""
    t = re.sub(r'<script[\s\S]*?</script>', '', html)
    t = re.sub(r'<style[\s\S]*?</style>', '', t)
    t = re.sub(r'<[^>]+>', ' ', t)
    t = t.replace('&nbsp;', ' ').replace('&lt;', '<').replace('&gt;', '>')
    return re.sub(r'\s+', ' ', t)


# ---------------- 中农立华解析 ----------------

# 正文中出现的非其他品种的"XX原药"：甘氨酸路线原药是草甘膦的工艺名
SKIP_AGRO_NAMES = {'甘氨酸路线原药'}


def other_agro(between, name):
    """between 段内是否出现其他品种的 XX原药（防跨品种误匹配）"""
    for o in re.findall(r'[\u4e00-\u9fa5]{2,6}原药', between):
        if o != name + '原药' and o not in SKIP_AGRO_NAMES:
            return True
    return False


def sino_agri_links(cid, max_page):
    """抓列表页全部文章 URL（pnshow.php?cid=..&id=..）"""
    urls = set()
    for page in range(1, max_page + 1):
        u = 'https://www.sino-agri-sal.com/pnlist.php?cid=%d&page=%d' % (cid, page)
        html = fetch(u, referer='https://www.sino-agri-sal.com/listyyzs.php')
        found = set(re.findall(r'pnshow\.php\?cid=%d&id=\d+' % cid, html))
        if not found:
            break
        urls |= {'https://www.sino-agri-sal.com/%s' % x for x in found}
        time.sleep(SLEEP)
    return urls


def parse_sino_agri_article(html, names):
    """解析一篇中农立华周报：返回 {品种名: 价格(元/吨)}

    正文格式（2023 年中起）：
      `多菌灵原药报价3.6万元/吨；甲基硫菌灵原药报价3.2万元/吨`
      `草甘膦原药成本端支撑仍在，工厂价格坚挺，95%含量报2.7万元/吨，97%含量报2.8万元/吨`
    草甘膦取 95% 含量（主流规格）；品种名与报价之间可能隔着行情描述，
    但不得出现其他品种的"XX原药"（防跨品种误匹配，如"草铵膦原药"；
    "甘氨酸路线原药"是草甘膦工艺名，不视为其他品种）。
    报价动词变体（长模式在前）：`报价在4万元/吨` `价格报至8.8万元/吨`
    `价格报到4万元/吨` `市场报价 2.52万元/吨` `报到2.5万元/吨`
    """
    txt = strip_html(html)
    verb = r'(?:价格报至|价格报到|价格报|报价在|报价|报到|报至|报)'
    result = {}
    for name in names:
        if name == '草甘膦':
            m = re.search(re.escape(name) + r'原药(.{0,200}?)95%含量报\s*([\d.]+)\s*万元/吨', txt)
            if m and not other_agro(m.group(1), name):
                result[name] = float(m.group(2)) * 10000
                continue
        pat = re.compile(re.escape(name) + r'原药(.{0,200}?)' + verb + r'\s*([\d.]+)\s*万元/吨')
        for mm in pat.finditer(txt):
            if not other_agro(mm.group(1), name):
                result[name] = float(mm.group(2)) * 10000
                break
    return result


def sino_agri_article_date(html):
    """文章日期：标题内 YYYYMMDD（数据日）优先，否则发布时间"""
    m = re.search(r'(20\d{6})', html)
    if m:
        ymd = m.group(1)
        return '%s-%s-%s' % (ymd[0:4], ymd[4:6], ymd[6:8])
    m = re.search(r'发布时间[：:]?\s*(\d{4})-(\d{2})-(\d{2})', strip_html(html))
    if m:
        return '%s-%s-%s' % m.groups()
    return None


def fetch_sino_agri(product_names):
    """抓中农立华全部周报，返回 {品种名: [{date, price, source, note}...]}"""
    by_name = {n: [] for n in product_names}
    urls = set()
    for cid, max_page in SINO_AGRI_PAGES:
        try:
            urls |= sino_agri_links(cid, max_page)
        except Exception as e:  # noqa: BLE001
            print('  [warn] 中农立华 cid=%d 列表抓取失败: %r' % (cid, e))
    for u in sorted(urls):
        try:
            html = fetch(u, referer='https://www.sino-agri-sal.com/pnlist.php')
            date = sino_agri_article_date(html)
            r = parse_sino_agri_article(html, product_names)
            for name, price in r.items():
                by_name[name].append(
                    {'date': date, 'price': price, 'source': 'sino-agri', 'note': '中农立华'})
            time.sleep(SLEEP)
        except Exception as e:  # noqa: BLE001
            print('  [warn] 中农立华文章失败 %s: %r' % (u, e))
    return by_name


# ---------------- 生意社解析 ----------------

def sunsirs_list_urls(seed):
    """从种子 detail 页提取该品种栏目页，翻页收集全部 detail 文章 URL"""
    html = fetch(seed, referer='https://www.100ppi.com/')
    m = re.search(r'https://www\.100ppi\.com/news/list-14--\d+-1\.html', html)
    if not m:
        raise RuntimeError('seed 页未找到栏目链接: %s' % seed)
    list_url = m.group(0)
    urls, page = set(), 1
    while True:
        page_url = re.sub(r'-1\.html$', '-%d.html' % page, list_url)
        ph = fetch(page_url, referer='https://www.100ppi.com/')
        found = set(re.findall(r'https://www\.100ppi\.com/news/detail-\d{8}-\d+\.html', ph))
        if not found:
            break
        before = len(urls)
        urls |= found
        if len(urls) == before:
            break
        if page >= SUNSIRS_MAX_PAGES:
            break
        page += 1
        time.sleep(SLEEP)
    return urls


def parse_sunsirs_detail(html):
    """解析一篇报价动态：日期 + 全部报价行

    一篇正文含多家交易商报价，公司名与价格之间隔着品牌/产地描述，如：
    `邻苯二胺 优等品 苏州市森菲达化工有限公司 国产 江苏省/苏州市 36000元/吨
     南通众合化工新材料有限公司 国产 江苏省/南通市 32000元/吨`
    策略：先找全部 `数字元/吨`，再向前回溯最近的交易商名作为 note。
    返回 [{date, price, note(交易商)} ...]，无交易商的裸报价跳过。
    """
    date_m = re.search(r'[（(](\d{4})-(\d{2})-(\d{2})[）)]', html)
    if not date_m:
        return []
    date = '%s-%s-%s' % date_m.groups()
    txt = strip_html(html)
    idx = txt.find('最新报价')
    if idx < 0:
        return []
    seg = txt[idx:idx + 2000]
    results = []
    comp_pat = re.compile(r'([\u4e00-\u9fa5（）()]{3,30}(?:有限公司|化工))')
    price_pat = re.compile(r'(\d+(?:\.\d+)?)\s*元/(吨|公斤)')
    for m in price_pat.finditer(seg):
        price = float(m.group(1))
        if m.group(2) == '公斤':
            price *= 1000
        comps = list(comp_pat.finditer(seg[:m.start()]))
        if not comps:
            continue
        results.append({'date': date, 'price': price, 'note': comps[-1].group(1)})
    return results


def parse_sunsirs_mprice(html, names):
    """解析报价中心表格（plist-1-{id}-{page}.html）

    行格式：`邻苯二胺 纯度99.9%以上 国产 10900元/吨 市场价 山东省/济南市 山东君烽新材料有限公司 VIP 2026-08-22`
    只取"市场价"类型（与出厂价区分，可比性强）；`元/千克` 换算为元/吨。
    返回 [{date, price, note(交易商)} ...]
    """
    txt = strip_html(html)
    results = []
    name_pat = '|'.join(re.escape(n) for n in names)
    # 价格 → 报价类型 → 交易商（回溯）
    price_pat = re.compile(r'(\d+(?:\.\d+)?)\s*元/(吨|千克)\s*(市场价|出厂价)\s+(\S+?)\s+([\u4e00-\u9fa5（）()]{3,30}?(?:有限公司|化工))')
    for m in price_pat.finditer(txt):
        # 该行属于目标品种：价格前 80 字内必须出现品种名，且不跨到别的品种
        head = txt[max(0, m.start() - 80):m.start()]
        nm = re.search(r'(%s)' % name_pat, head)
        if not nm:
            continue
        price = float(m.group(1))
        if m.group(2) == '千克':
            price *= 1000
        # 日期：交易商后 30 字内
        tail = txt[m.end():m.end() + 60]
        dm = re.search(r'(\d{4}-\d{2}-\d{2})', tail)
        date = dm.group(1) if dm else None
        if not date:
            continue
        results.append({'date': date, 'price': price, 'note': m.group(5)})
    return results


def filter_outlier_traders(rows):
    """剔除价格口径系统性偏离的交易商（离群价混入其他规格）

    以该商品全量价格中位数为基准，某交易商自身价格中位数偏差超过 25%
    且样本 >= 3 条时视为混入其他规格（如对硝基氯苯页面混入高纯规格
    14000 元/吨 vs 主流 8800），整组剔除。
    """
    if len(rows) < 3:
        return rows
    med = sorted(r['price'] for r in rows)[len(rows) // 2]
    if not med:
        return rows
    groups = {}
    for r in rows:
        groups.setdefault(r.get('note') or '', []).append(r)
    keep = []
    for grp in groups.values():
        gmed = sorted(r['price'] for r in grp)[len(grp) // 2]
        if len(grp) >= 3 and abs(gmed - med) / med > 0.25:
            continue
        keep.extend(grp)
    return keep


def fetch_sunsirs(product):
    """抓某品种在生意社的全部历史报价（detail 文章 + mprice 最新表格）"""
    prices = []
    seed = product.get('sunsirs_seed')
    if seed:
        try:
            urls = sunsirs_list_urls(seed)
            for u in sorted(urls):
                try:
                    html = fetch(u, referer='https://www.100ppi.com/')
                    prices.extend(parse_sunsirs_detail(html))
                    time.sleep(SLEEP)
                except Exception as e:  # noqa: BLE001
                    print('  [warn] %s 抓取失败 %s: %r' % (product['name'], u, e))
        except Exception as e:  # noqa: BLE001
            print('  [warn] %s 栏目定位失败: %r' % (product['name'], e))
    mprice_rows = []
    for pid, mname in product.get('mprice_ids', []):
        # 翻 5 页：部分商品历史 > 3 页（如对硝基氯苯 2345 有 4 页 110 行）
        for page in range(1, 6):
            try:
                u = 'https://www.100ppi.com/mprice/plist-1-%d-%d.html' % (pid, page)
                html = fetch(u, referer='https://www.100ppi.com/mprice/')
                rows = parse_sunsirs_mprice(html, [mname])
                if not rows:
                    break
                mprice_rows.extend(rows)
                time.sleep(SLEEP)
            except Exception as e:  # noqa: BLE001
                print('  [warn] %s mprice 抓取失败: %r' % (product['name'], e))
                break
    # 离群交易商过滤：避免混入其他规格的报价污染按日聚合中位数
    mprice_rows = filter_outlier_traders(mprice_rows)
    prices += mprice_rows
    for p in prices:
        p['source'] = 'sunsirs'
    return prices


# ---------------- 3456.tv 解析 ----------------

def parse_3456_article(html, product_names):
    """解析行情文章：`多菌灵原药...报价3.45万元/吨`，返回 {name: 价格(元/吨)}"""
    txt = strip_html(html)
    result = {}
    for name in product_names:
        pat = re.compile(
            re.escape(name) + r'[^。；]*?(?:报价|报到|价格)\s*([\d.]+)\s*(万元/吨|元/吨)')
        m = pat.search(txt)
        if m:
            price = float(m.group(1))
            if m.group(2) == '万元/吨':
                price *= 10000
            result[name] = price
    return result


def fetch_3456(product_names):
    """抓 3456.tv 行情文章回填历史价格"""
    prices_by_name = {n: [] for n in product_names}
    article_links = set()
    for page in T3456_PAGES:
        html = fetch(page, encoding='gbk')
        for m in re.finditer(
                r'href="(http://www\.3456\.tv/jiage/(?:shajunji|chucaoji|shachongji|nongyaoyuanyao)/\d+\.html)"',
                html):
            article_links.add(m.group(1))
    for u in sorted(article_links):
        try:
            html = fetch(u, encoding='gbk')
            r = parse_3456_article(html, product_names)
            date_m = re.search(r'(\d{4})[年-](\d{1,2})[月-](\d{1,2})', html)
            date = None
            if date_m:
                y, mo, d = (int(x) for x in date_m.groups())
                date = '%04d-%02d-%02d' % (y, mo, d)
            for name, price in r.items():
                if date and date > '2025-12-31':
                    continue  # 3456.tv 行情栏目 2025 年已停更，晚于此的日期为页面误提取
                prices_by_name[name].append(
                    {'date': date, 'price': price, 'source': '3456tv', 'note': ''})
            time.sleep(SLEEP)
        except Exception as e:  # noqa: BLE001
            print('  [warn] 3456 文章抓取失败 %s: %r' % (u, e))
    return prices_by_name


# ---------------- 合并与输出 ----------------

def median_by_date(items):
    by_date = {}
    for p in items:
        by_date.setdefault(p['date'], []).append(p)
    out = []
    for date in sorted(by_date):
        day_items = by_date[date]
        vals = sorted(x['price'] for x in day_items)
        # 偶数样本取平均（上中位数会把稀疏日少数高价拉成突变尖峰）
        n = len(vals)
        if n % 2 == 0:
            med = (vals[n // 2 - 1] + vals[n // 2]) / 2.0
        else:
            med = vals[n // 2]
        # source/note 取当日样本最多的（防混合源时元数据污染）
        src = Counter(x.get('source') for x in day_items).most_common(1)[0][0]
        nt = Counter(x.get('note', '') for x in day_items).most_common(1)[0][0]
        out.append({'date': date, 'price': med, 'source': src, 'note': nt})
    return out


def merge_prices(existing, fresh, primary, exclude_sources=(), merge_all_traders=False):
    """合并多条报价为时间序列

    primary 决定主序列来源：
      'sino-agri': 中农立华周度指数（每周全量重抓全部历史文章，直接以本轮 fresh
                   作主序列，旧文件中的同源数据视为历史版本不再合并，避免旧解析
                   bug 产生的错误值残留）；其余源只填主序列时间范围之外。
      'sunsirs'  : 生意社按交易商分组取样本最多的交易商作主序列（增量抓取，
                   existing+fresh 累积），同一天多条再取中位数；其余源只填主序列
                   时间范围之外。merge_all_traders=True 时不做交易商分组，全部
                   报价按日取中位数（多交易商口径差异小于离群阈值时更稳健）。
    其他源（3456.tv 等）仅在主序列时间范围外做历史/近期补充，避免不同口径
    来源在同一时间段交错造成假突变。3456.tv 行情 2025 年已停更，晚于
    2025-12-31 的日期为页面误提取，一律剔除。exclude_sources 中的源直接弃用
    （如敌草隆的中农立华数据稀疏且口径不同）。
    """
    all_p = (existing or []) + (fresh or [])
    main_src = 'sino-agri' if primary == 'sino-agri' else 'sunsirs'
    if primary == 'sino-agri':
        main_items = [p for p in (fresh or []) if p.get('source') == main_src]
    else:
        # 主序列以本轮 fresh 为准（防旧聚合值重复参与聚合），
        # existing 只补 fresh 未覆盖的更早历史（增量翻页限页时靠旧文件积累）
        fresh_items = [p for p in (fresh or []) if p.get('source') == main_src]
        if fresh_items:
            lo = min(p['date'] for p in fresh_items)
            existing_main = [p for p in (existing or [])
                             if p.get('source') == main_src and p.get('date', '') < lo]
            main_items = fresh_items + existing_main
        else:
            main_items = [p for p in all_p if p.get('source') == main_src]
    legacy = [p for p in all_p
              if p.get('source') != main_src and p.get('source') not in exclude_sources
              and not (p.get('source') == '3456tv' and p.get('date', '') > '2025-12-31')]

    main_series = []
    if main_items:
        if primary == 'sino-agri':
            main_series = median_by_date(main_items)
        elif merge_all_traders:
            main_series = median_by_date(main_items)
        else:
            groups = {}
            for p in main_items:
                groups.setdefault(p.get('note') or '', []).append(p)
            main = max(groups.values(), key=len)
            main_series = median_by_date(main)

    # 其他源只填主序列时间范围之外的日期段
    if main_series:
        lo, hi = main_series[0]['date'], main_series[-1]['date']
        legacy = [p for p in legacy if p['date'] < lo or p['date'] > hi]
    legacy_series = median_by_date(legacy)

    by_date = {p['date']: p for p in legacy_series}
    for p in main_series:
        by_date[p['date']] = p  # 主序列优先
    return sorted(by_date.values(), key=lambda x: x['date'])


def main():
    old = {}
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, encoding='utf-8') as f:
            old_data = json.load(f)
        for p in old_data.get('products', []):
            old[p['id']] = p

    names = [p['name'] for p in PRODUCTS]
    all_sino = fetch_sino_agri(names)
    all_3456 = fetch_3456(names)

    result_products = []
    for p in PRODUCTS:
        pid = p['id']
        print('== 抓取 %s (%s)' % (p['name'], p['category']))
        fresh = []
        try:
            fresh += fetch_sunsirs(p)
            print('   生意社: %d 条' % len(fresh))
        except Exception as e:  # noqa: BLE001
            print('   生意社失败: %r' % e)
        h = all_3456.get(p['name'], [])
        print('   3456.tv: %d 条' % len(h))
        fresh += h
        if p['primary'] == 'sino-agri':
            s = all_sino.get(p['name'], [])
            print('   中农立华: %d 条' % len(s))
            fresh += s

        old_prices = old.get(pid, {}).get('prices', [])
        merged = merge_prices(old_prices, fresh, p['primary'], p.get('exclude_sources', ()),
                              p.get('merge_all_traders', False))
        result_products.append({
            'id': pid,
            'name': p['name'],
            'category': p['category'],
            'spec': p.get('spec', ''),
            'unit': '元/吨',
            'prices': merged,
        })

    cat_order = {'杀菌剂': 0, '除草剂': 1, '中间体': 2}
    result_products.sort(key=lambda x: (cat_order.get(x['category'], 9), x['name']))

    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='seconds')
    data = {'updated_at': now, 'products': result_products}

    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    total = sum(len(p['prices']) for p in result_products)
    print('已写入 %s（共 %d 条价格记录）' % (DATA_FILE, total))


if __name__ == '__main__':
    sys.exit(main())
