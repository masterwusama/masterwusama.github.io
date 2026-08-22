# -*- coding: utf-8 -*-
"""
农化制品价格跟踪 — 数据抓取脚本（仅标准库，供 GitHub Actions 定时运行）

数据源（均已实测可直抓）：
  1. 生意社"商品报价动态"（www.100ppi.com/news/detail-*.html）
     - 从种子文章找该品种的栏目页（list-14--{id}-N.html），翻页收集全部历史文章
     - 正文格式：`{品种} {规格} {交易商} {品牌} {产地} {价格}元/吨`
  2. 3456.tv（火爆农资招商网）行情文章（2022~2025 已停更，仅用于历史回填）
     - 正文格式：`多菌灵原药市场供货稳定，报价3.45万元/吨`

输出：data/products.json（增量合并，按品种、日期去重）
"""
import json
import os
import re
import sys
import time
import urllib.request
import urllib.parse
import ssl

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(BASE_DIR, 'data', 'products.json')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
SLEEP = 0.4
RETRY = 3

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# ---------------- 品种配置 ----------------
# sunsirs_seed: 该品种任意一篇报价动态文章（用于定位栏目页）
# 3456tv 回填：从 3456.tv 行情文章中按名字解析历史价格
PRODUCTS = [
    {
        'id': 'carbendazim', 'name': '多菌灵', 'category': '杀菌剂', 'spec': '99%',
        'sunsirs_seed': 'https://www.100ppi.com/news/detail-20260821-6102168.html',
    },
    {
        'id': 'diuron', 'name': '敌草隆', 'category': '除草剂', 'spec': '97%',
        'sunsirs_seed': 'https://www.100ppi.com/news/detail-20260804-6022152.html',
    },
    {
        'id': 'glyphosate', 'name': '草甘膦', 'category': '除草剂', 'spec': '95%原药',
        'sunsirs_seed': 'https://www.100ppi.com/news/detail-20210730-1866835.html',
    },
    {
        'id': 'thiophanate-methyl', 'name': '甲基硫菌灵', 'category': '杀菌剂', 'spec': '98%',
        'sunsirs_seed': None,  # 生意社无此品种报价动态，仅 3456.tv 回填
    },
    {
        'id': 'o-phenylenediamine', 'name': '邻苯二胺', 'category': '中间体', 'spec': '优等品',
        'sunsirs_seed': 'https://www.100ppi.com/news/detail-20260818-6084138.html',
    },
    {
        'id': 'p-nitrochlorobenzene', 'name': '对硝基氯化苯', 'category': '中间体', 'spec': '99%',
        'sunsirs_seed': 'https://www.100ppi.com/news/detail-20260708-5891252.html',
    },
]

# 3456.tv 行情文章四类列表页（聚合页 /jiage/nongyao/ 里能提取到的文章链接已含分类目录）
T3456_PAGES = [
    'http://www.3456.tv/jiage/nongyao/',
]


def fetch(url, encoding=None, referer=None):
    """抓取网页（重试 + UA + 可选 Referer），返回解码后的文本"""
    last_err = None
    for i in range(RETRY):
        try:
            headers = {'User-Agent': UA}
            if referer:
                headers['Referer'] = referer
            req = urllib.request.Request(url, headers=headers)
            resp = urllib.request.urlopen(req, timeout=20, context=ctx)
            raw = resp.read()
            if encoding is None:
                # 依页面内容猜测编码
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
        # 该页没有新链接或已达最大页数上限则停止
        if len(urls) == before:
            break
        if page >= 20:
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
            continue  # 无交易商的裸报价（如仅列规格）跳过
        results.append({'date': date, 'price': price, 'note': comps[-1].group(1)})
    return results


def fetch_sunsirs(product):
    """抓取某品种在生意社的全部历史报价"""
    seed = product['sunsirs_seed']
    if not seed:
        return []
    urls = sunsirs_list_urls(seed)
    prices = []
    for u in sorted(urls):
        try:
            html = fetch(u, referer='https://www.100ppi.com/')
            prices.extend(parse_sunsirs_detail(html))
            time.sleep(SLEEP)
        except Exception as e:  # noqa: BLE001
            print('  [warn] %s 抓取失败 %s: %r' % (product['name'], u, e))
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
        # 聚合页里的行情文章链接（含四类：杀菌剂/除草剂/杀虫剂/中间体）
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
                prices_by_name[name].append(
                    {'date': date, 'price': price, 'source': '3456tv', 'note': ''})
            time.sleep(SLEEP)
        except Exception as e:  # noqa: BLE001
            print('  [warn] 3456 文章抓取失败 %s: %r' % (u, e))
    return prices_by_name


# ---------------- 合并与输出 ----------------

def merge_prices(existing, fresh):
    """合并多条报价为时间序列

    生意社同一文章含多家交易商报价（规格/渠道差异，价格可差数倍）；
    直接取平均或覆盖会产生剧烈抖动。策略：
    1. 生意社数据按交易商分组，取样本最多的交易商作为主序列（同一渠道的
       报价变化才反映真实趋势），同一天多条再取中位数；
    2. 3456.tv 等历史源用于填补主序列缺失的日期段（时间基本不重叠）。
    """
    def median_by_date(items):
        by_date = {}
        for p in items:
            by_date.setdefault(p['date'], []).append(p['price'])
        out = []
        for date in sorted(by_date):
            vals = sorted(by_date[date])
            out.append({
                'date': date,
                'price': vals[len(vals) // 2],
                'source': items[0]['source'],
                'note': items[0].get('note', ''),
            })
        return out

    all_p = (existing or []) + fresh
    sunsirs = [p for p in all_p if p.get('source') == 'sunsirs']
    legacy = [p for p in all_p if p.get('source') != 'sunsirs']

    main_series = []
    if sunsirs:
        groups = {}
        for p in sunsirs:
            groups.setdefault(p.get('note') or '', []).append(p)
        main = max(groups.values(), key=len)
        main_series = median_by_date(main)
    legacy_series = median_by_date(legacy)

    by_date = {p['date']: p for p in legacy_series}
    for p in main_series:
        by_date[p['date']] = p  # 主序列优先
    return sorted(by_date.values(), key=lambda x: x['date'])


def main():
    # 读现有数据
    old = {}
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, encoding='utf-8') as f:
            old_data = json.load(f)
        for p in old_data.get('products', []):
            old[p['id']] = p

    all_3456 = fetch_3456([p['name'] for p in PRODUCTS])

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

        old_prices = old.get(pid, {}).get('prices', [])
        merged = merge_prices(old_prices, fresh)
        result_products.append({
            'id': pid,
            'name': p['name'],
            'category': p['category'],
            'spec': p.get('spec', ''),
            'unit': '元/吨',
            'prices': merged,
        })

    # 排序：杀菌剂/除草剂/中间体
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
