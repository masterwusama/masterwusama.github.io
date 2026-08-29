# -*- coding: utf-8 -*-
"""
物价查询（杭州主要农产品）— 数据抓取脚本（仅标准库，供 GitHub Actions 定时运行）

数据源（均已实测可直抓）：
  1. 商务部商务预报「百家日报」——每日更新
     - 页面 /cif/seach.fhtml?commdityid={ID}，服务端直出表格
       行格式：<tr> <td>浙江省</td> <td>市场名</td> <td>当日价格</td> ...
     - 取浙江省各市场报价中位数（无浙江市场时回退全部市场中位数）
     - 单位：元/公斤（批发）
  2. 杭州市商务局「生活必需品市场运行情况」周报（经浙江商务预报子站发布）——周更
     - 列表：浙江子站首页 /site/html/zhejiangsheng/index.html 直出文章链接
     - 正文格式：`猪全精肉31.44元/公斤，下跌0.51%`
     - 真实杭州数据，含猪肉部位（全精肉/后腿肉/大排/夹心肉/肋条肉/子排/肋排）、
       17~28 个蔬菜品种、鸡蛋鸭蛋、水产、水果等
     - 单位：元/公斤（元/500克 自动 ×2）

说明：两源口径不同（百家日报=浙江批发市场，周报=杭州市监测），
同名单品也分源存储（id 前缀 cif- / hz-），前端分别展示，不做混合。
数据自 2026-08-30 起采集，不回填历史；滚动保留最近 365 天。

输出：data/prices.json（增量合并，按 (id, date) 去重）
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import ssl
from datetime import datetime, timezone, timedelta

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(BASE_DIR, 'data', 'prices.json')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
SLEEP = 0.35
RETRY = 3
KEEP_DAYS = 365

CIF_BASE = 'https://cif.mofcom.gov.cn'
ZJ_HOME = CIF_BASE + '/site/html/zhejiangsheng/index.html'

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

TZ8 = timezone(timedelta(hours=8))

# ---------------- 品种配置 ----------------

# 百家日报品种（每日，浙江省市场中位数）
BAIJIA_PRODUCTS = [
    # id, name, commdityid, category
    ('pork-fresh', '鲜猪肉', '130010', '肉类'),
    ('pork-rump', '后臀尖', '130014', '肉类'),
    ('pork-carcass', '白条肉', '130011', '肉类'),
    ('beef-fresh', '鲜牛肉', '130020', '肉类'),
    ('beef-shank', '牛腿肉', '130025', '肉类'),
    ('beef-carcass', '白条牛', '130021', '肉类'),
    ('mutton-shank', '羊腿肉', '130035', '肉类'),
    ('mutton-carcass', '白条羊', '130031', '肉类'),
    ('chicken', '白条鸡', '280020', '肉类'),
    ('duck', '白条鸭', '280050', '肉类'),
    ('egg', '鲜鸡蛋', '150010', '农副产品'),
    ('rice-japonica', '粳米', '210010', '农副产品'),
    ('rice-indica', '籼米', '210020', '农副产品'),
    ('flour', '面粉', '210030', '农副产品'),
    ('oil-soy', '豆油', '220010', '农副产品'),
    ('oil-peanut', '花生油', '220020', '农副产品'),
    ('oil-rapeseed', '菜籽油', '220030', '农副产品'),
    ('oil-blend', '调和油', '220050', '农副产品'),
    ('veg-youcai', '油菜', '170020', '蔬菜'),
    ('veg-celery', '芹菜', '170040', '蔬菜'),
    ('veg-lettuce', '生菜', '170050', '蔬菜'),
    ('veg-chive', '韭菜', '170480', '蔬菜'),
    ('veg-onion', '洋葱', '170090', '蔬菜'),
    ('veg-cabbage-big', '大白菜', '170060', '蔬菜'),
    ('veg-cabbage-round', '圆白菜', '170010', '蔬菜'),
    ('veg-radish-white', '白萝卜', '170070', '蔬菜'),
    ('veg-scallion', '大葱', '170250', '蔬菜'),
    ('veg-carrot', '胡萝卜', '170260', '蔬菜'),
    ('veg-potato', '土豆', '170080', '蔬菜'),
    ('veg-lotus', '莲藕', '170270', '蔬菜'),
    ('veg-woju', '莴笋', '170280', '蔬菜'),
    ('veg-sprout', '绿豆芽', '170290', '蔬菜'),
    ('veg-garlic', '蒜头', '170100', '蔬菜'),
    ('veg-tomato', '西红柿', '170120', '蔬菜'),
    ('veg-ginger', '生姜', '170110', '蔬菜'),
    ('veg-eggplant', '茄子', '170140', '蔬菜'),
    ('veg-pepper-hot', '尖椒', '170150', '蔬菜'),
    ('veg-pepper', '青椒', '170160', '蔬菜'),
    ('veg-cucumber', '黄瓜', '170130', '蔬菜'),
    ('veg-waxgourd', '冬瓜', '170180', '蔬菜'),
    ('veg-bittermelon', '苦瓜', '170200', '蔬菜'),
    ('veg-zucchini', '西葫芦', '170330', '蔬菜'),
    ('veg-broccoli', '西兰花', '170340', '蔬菜'),
]

# 杭州周报正文中的分类段落关键字（就近向上匹配）
SECTION_KEYWORDS = [
    ('猪肉', '肉类'), ('牛肉', '肉类'), ('羊肉', '肉类'), ('禽肉', '肉类'),
    ('蔬菜', '蔬菜'), ('水果', '水果'), ('水产', '水产'),
    ('鸡蛋', '农副产品'), ('禽蛋', '农副产品'), ('鸭蛋', '农副产品'),
    ('粮食', '农副产品'), ('食用油', '农副产品'), ('桶装', '农副产品'),
]


# ---------------- 抓取 ----------------

def http_get(url, data=None):
    """抓取网页：urllib 优先，SSL 握手失败时回退 curl（重试 + UA），返回文本"""
    last_err = None
    for i in range(RETRY):
        try:
            headers = {'User-Agent': UA,
                       'Referer': CIF_BASE + '/',
                       'Accept': 'text/html,application/xhtml+xml'}
            body = data.encode('utf-8') if data else None
            if data:
                headers['Content-Type'] = 'application/x-www-form-urlencoded'
            req = urllib.request.Request(url, data=body, headers=headers)
            resp = urllib.request.urlopen(req, timeout=30, context=ctx)
            raw = resp.read()
            return _decode(raw)
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(SLEEP * (i + 1))
    # 回退通道：curl（部分环境 urllib SSL 密码套件握手失败）
    curl = shutil.which('curl') or shutil.which('curl.exe')
    if curl:
        cmd = [curl, '-sk', '-L', '--max-time', '30', '-A', UA,
               '-e', CIF_BASE + '/']
        if data:
            cmd += ['-X', 'POST', '--data', data]
        cmd.append(url)
        for i in range(RETRY):
            try:
                r = subprocess.run(cmd, capture_output=True, timeout=45)
                if r.stdout:
                    return _decode(r.stdout)
                last_err = RuntimeError('curl empty: rc=%d %s'
                                        % (r.returncode, r.stderr[:200]))
            except Exception as e:  # noqa: BLE001
                last_err = e
            time.sleep(SLEEP * (i + 1))
    raise RuntimeError('fetch failed: %s (%r)' % (url, last_err))


def _decode(raw):
    for enc in ('utf-8', 'gbk'):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode('utf-8', 'ignore')


def strip_html(html):
    t = re.sub(r'<script[\s\S]*?</script>', '', html)
    t = re.sub(r'<style[\s\S]*?</style>', '', t)
    t = re.sub(r'<[^>]+>', ' ', t)
    return re.sub(r'\s+', ' ', t.replace('&nbsp;', ' '))


def median(vals):
    vals = sorted(vals)
    n = len(vals)
    if not n:
        return None
    if n % 2 == 0:
        return (vals[n // 2 - 1] + vals[n // 2]) / 2.0
    return vals[n // 2]


# ---------------- 源1：百家日报 ----------------

def parse_baijia_rows(html):
    """解析百家日报表格行，返回 [(省份, 市场, 价格), ...]"""
    rows = []
    pat = re.compile(
        r'<tr>\s*<td[^>]*>\s*([^<]+?)\s*</td>\s*<td[^>]*>\s*([^<]+?)\s*</td>'
        r'\s*<td[^>]*>\s*([\d.]+)\s*</td>')
    for prov, market, price in pat.findall(html):
        try:
            p = float(price)
        except ValueError:
            continue
        if p > 0:
            rows.append((prov.strip(), market.strip(), p))
    return rows


def fetch_baijia(today):
    """抓百家日报全部品种当日价格，返回 {id: 价格}"""
    out = {}
    for pid, name, cid, _cat in BAIJIA_PRODUCTS:
        try:
            html = http_get('%s/cif/seach.fhtml?commdityid=%s' % (CIF_BASE, cid))
            rows = parse_baijia_rows(html)
            zj = [p for prov, _m, p in rows if '浙江' in prov]
            price = median(zj) if zj else median([p for _a, _b, p in rows])
            if price:
                out[pid] = round(price, 2)
            time.sleep(SLEEP)
        except Exception as e:  # noqa: BLE001
            print('  [warn] 百家日报 %s(%s) 失败: %r' % (name, cid, e))
    return out


# ---------------- 源2：杭州周报 ----------------

def find_hz_weekly_article(html):
    """从浙江子站首页找最新一篇杭州生活必需品周报，返回 (url, title) 或 None"""
    seen = {}
    for u, txt in re.findall(r'href="([^"]{5,200})"[^>]*>\s*([^<]{6,80}?)\s*<', html):
        u = u.strip()
        txt = txt.strip()
        if u in seen:
            continue
        seen[u] = txt
    for u, t in seen.items():
        if '杭州' in t and '生活必需品市场运行情况' in t and '/newsite/html/' in u:
            full = u if u.startswith('http') else CIF_BASE + u
            return full, t
    return None


def article_date_from_url(url):
    """从 /newsite/html/zhejiangsheng/html/1086127/2026/8/14/xxx.html 提取日期"""
    m = re.search(r'/html/(?:\d+|zhejiangsheng)/html/\d+/(\d{4})/(\d{1,2})/(\d{1,2})/', url)
    if not m:
        return None
    y, mo, d = (int(x) for x in m.groups())
    return '%04d-%02d-%02d' % (y, mo, d)


def classify_weekly_item(txt, pos):
    """就近向上查找段落关键字确定分类"""
    head = txt[max(0, pos - 500):pos]
    best = None
    for kw, cat in SECTION_KEYWORDS:
        idx = head.rfind(kw)
        if idx >= 0 and (best is None or idx > best[0]):
            best = (idx, cat)
    return best[1] if best else '蔬菜'


BAD_ITEM_PAT = re.compile(
    r'(均价|价格|涨幅|跌幅|环比|同比|上涨|下跌|回落|运行|监测|批发|日均|到杭|屠宰|交易量)')


def parse_weekly_article(html):
    """解析杭州周报正文，返回 [{name, price, category}]"""
    txt = strip_html(html)
    items = []
    seen = set()
    pat = re.compile(r'([\u4e00-\u9fa5]{2,8})(\d{1,3}(?:\.\d+)?)元/(公斤|500克)')
    for m in pat.finditer(txt):
        name, price, unit = m.group(1), float(m.group(2)), m.group(3)
        if BAD_ITEM_PAT.search(name):
            continue
        if name in seen:
            continue
        seen.add(name)
        if unit == '500克':
            price *= 2
        if price <= 0 or price > 500:
            continue
        items.append({
            'name': name,
            'price': round(price, 2),
            'category': classify_weekly_item(txt, m.start()),
        })
    return items


def fetch_hz_weekly(fetched_articles):
    """抓最新杭州周报（未抓过的），返回 (article_key, date, items) 或 None"""
    try:
        home = http_get(ZJ_HOME)
    except Exception as e:  # noqa: BLE001
        print('  [warn] 浙江子站首页失败: %r' % e)
        return None
    found = find_hz_weekly_article(home)
    if not found:
        print('  [warn] 首页未找到杭州周报')
        return None
    url, title = found
    key = url.rsplit('/', 1)[-1]
    if key in fetched_articles:
        print('  杭州周报已是最新: %s' % title)
        return None
    try:
        html = http_get(url)
    except Exception as e:  # noqa: BLE001
        print('  [warn] 杭州周报文章失败 %s: %r' % (url, e))
        return None
    items = parse_weekly_article(html)
    date = article_date_from_url(url)
    print('  杭州周报: %s (%d 个品项, 日期 %s)' % (title, len(items), date))
    return key, date, items


# ---------------- 合并与输出 ----------------

def load_old():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, encoding='utf-8') as f:
            return json.load(f)
    return {'updated_at': None, 'meta': {}, 'products': []}


def main():
    old = load_old()
    old_products = {p['id']: p for p in old.get('products', [])}
    fetched_articles = set(old.get('meta', {}).get('hz_articles', []))
    today = datetime.now(TZ8).strftime('%Y-%m-%d')
    cutoff = (datetime.now(TZ8) - timedelta(days=KEEP_DAYS)).strftime('%Y-%m-%d')

    new_points = {}  # id -> {date, price}

    print('== 百家日报（浙江省市场中位数）')
    baijia = fetch_baijia(today)
    print('   成功 %d/%d 品种' % (len(baijia), len(BAIJIA_PRODUCTS)))
    for pid, name, cid, cat in BAIJIA_PRODUCTS:
        if pid not in baijia:
            continue
        fid = 'cif-' + pid
        p = old_products.get(fid) or {
            'id': fid, 'name': name, 'category': cat, 'unit': '元/公斤',
            'source': '商务部百家日报（浙江市场）', 'prices': []}
        if not any(x['date'] == today for x in p['prices']):
            p['prices'].append({'date': today, 'price': baijia[pid]})
        old_products[fid] = p

    print('== 杭州周报')
    wk = fetch_hz_weekly(fetched_articles)
    if wk:
        key, date, items = wk
        date = date or today
        fetched_articles.add(key)
        for it in items:
            fid = 'hz-' + it['name']
            p = old_products.get(fid) or {
                'id': fid, 'name': it['name'], 'category': it['category'],
                'unit': '元/公斤', 'source': '杭州市商务局周报', 'prices': []}
            if not any(x['date'] == date for x in p['prices']):
                p['prices'].append({'date': date, 'price': it['price']})
            old_products[fid] = p

    # 排序 + 裁剪 365 天
    cat_order = {'肉类': 0, '蔬菜': 1, '水果': 2, '农副产品': 3, '水产': 4}
    products = []
    for p in old_products.values():
        p['prices'] = sorted([x for x in p['prices'] if x['date'] >= cutoff],
                             key=lambda x: x['date'])
        if not p['prices']:
            continue
        products.append(p)
    products.sort(key=lambda x: (cat_order.get(x['category'], 9), x['id']))

    data = {
        'updated_at': datetime.now(TZ8).isoformat(timespec='seconds'),
        'meta': {'hz_articles': sorted(fetched_articles)[-30:],
                 'start': '2026-08-30'},
        'products': products,
    }
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    total = sum(len(p['prices']) for p in products)
    print('已写入 %s（%d 个品种，%d 条价格记录）' % (DATA_FILE, len(products), total))
    return 0


if __name__ == '__main__':
    sys.exit(main())
