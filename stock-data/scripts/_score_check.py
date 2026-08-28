# 临时验证：Python scoring.py 与 stock.js 原函数（Node 抽取）的四大流派分数对比
import json
import subprocess
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path(__file__).parent))
from scoring import compute_scores, cycle_analysis, cycle_history  # noqa: E402

BASE = Path(__file__).parent.parent
companies_dir = BASE / 'data' / 'companies'

js_out = subprocess.run(
    ['node', str(Path(__file__).parent / '_score_check_node.js')],
    capture_output=True, timeout=300,
)
if js_out.returncode != 0:
    print('NODE FAIL:', js_out.stderr.decode('utf-8', 'replace')[:2000])
    sys.exit(1)
js_scores = json.loads(js_out.stdout)

diffs = []
for f in sorted(companies_dir.glob('*.json')):
    d = json.loads(f.read_text(encoding='utf-8'))
    code = d['code']
    py = compute_scores(d)
    js = js_scores.get(code, {})
    for key in ('grahamAgg', 'grahamDef', 'schloss', 'buffett'):
        p, j = py[key], js.get(key)
        if p is None and j is None:
            continue
        if p is None or j is None or abs(p - j) > 1e-6:
            diffs.append((code, key, p, j))
    # 价格参考对比（金额为量级较大的数值，用相对容差）
    py_refs, js_refs = py.get('priceRefs') or {}, js.get('priceRefs') or {}
    for key in ('grahamAgg', 'grahamDef', 'schloss', 'buffett'):
        pr, jr = py_refs.get(key) or {}, js_refs.get(key) or {}
        for fld in ('buy', 'sellCons', 'sellFair'):
            p, j = pr.get(fld), jr.get(fld)
            if p is None and j is None:
                continue
            tol = 1e-9 if p is None else max(1e-9, abs(p) * 1e-9)
            if p is None or j is None or abs(p - j) > tol:
                diffs.append((code, key + '.' + fld, p, j))
    # 公允清算价值（每股）对比
    p, j = py_refs.get('fairLiq'), js_refs.get('fairLiq')
    if p is None and j is None:
        pass
    elif p is None or j is None or abs(p - j) > max(1e-9, abs(p or 0) * 1e-9):
        diffs.append((code, 'fairLiq', p, j))
    # 净现金/市值（比率）对比
    p, j = py_refs.get('netCashRatio'), js_refs.get('netCashRatio')
    if p is None and j is None:
        pass
    elif p is None or j is None or abs(p - j) > max(1e-9, abs(p or 0) * 1e-9):
        diffs.append((code, 'netCashRatio', p, j))
    # 净现金/市值 代入明细（字典）逐字段对比
    pc, jc = py_refs.get('netCashCalc'), js_refs.get('netCashCalc')
    if pc is None and jc is None:
        pass
    elif (pc is None) != (jc is None):
        diffs.append((code, 'netCashCalc', bool(pc), bool(jc)))
    else:
        for k in ('cash', 'fin', 'notes', 'otherCA', 'tl', 'mcap', 'report'):
            pv, jv = pc.get(k), jc.get(k)
            if pv == jv:
                continue
            if (isinstance(pv, (int, float)) and isinstance(jv, (int, float))
                    and abs(pv - jv) <= max(1e-6, abs(pv or 0) * 1e-9)):
                continue
            diffs.append((code, 'netCashCalc.' + k, pv, jv))
    # 造假风险分对比（百分制，舍入后一位小数，容差 1e-9）
    p, j = py.get('fraud'), js.get('fraud')
    if p is None and j is None:
        pass
    elif p is None or j is None or abs(p - j) > 1e-9:
        diffs.append((code, 'fraud', p, j))
    # 管理层管理水平分对比（同造假分口径）
    p, j = py.get('mgmt'), js.get('mgmt')
    if p is None and j is None:
        pass
    elif p is None or j is None or abs(p - j) > 1e-9:
        diffs.append((code, 'mgmt', p, j))
    # 周期模块对比：周期性判定（bool）+ 周期强度分 + 周期位置分（同口径）
    if py.get('cyclical') != js.get('cyclical'):
        diffs.append((code, 'cyclical', py.get('cyclical'), js.get('cyclical')))
    p, j = py.get('cycle'), js.get('cycle')
    if p is None and j is None:
        pass
    elif p is None or j is None or abs(p - j) > 1e-9:
        diffs.append((code, 'cycle', p, j))
    p, j = cycle_analysis(d)['cyclicalScore'], js.get('cyclicalScore')
    if p is None and j is None:
        pass
    elif p is None or j is None or abs(p - j) > 1e-9:
        diffs.append((code, 'cyclicalScore', p, j))
    # 周期趋势对比：逐年回溯分数组（年份+分数）+ 趋势状态（仅周期性公司）
    if py.get('cyclical'):
        ph = cycle_history(d)
        jh = js.get('cycleHistory') or []
        if len(ph) != len(jh):
            diffs.append((code, 'cycleHistory.len', len(ph), len(jh)))
        else:
            for idx, (a, b) in enumerate(zip(ph, jh)):
                if a['year'] != b['year']:
                    diffs.append((code, 'cycleHistory[%d].year' % idx, a['year'], b['year']))
                elif a['score'] is None and b['score'] is None:
                    pass
                elif a['score'] is None or b['score'] is None or abs(a['score'] - b['score']) > 1e-9:
                    diffs.append((code, 'cycleHistory[%d].score' % idx, a['score'], b['score']))
    if py.get('cycleTrend') != js.get('cycleTrend'):
        diffs.append((code, 'cycleTrend', py.get('cycleTrend'), js.get('cycleTrend')))

if diffs:
    print('不一致 %d 处:' % len(diffs))
    for code, key, p, j in diffs:
        print(f'  {code} {key}: Python={p} JS={j}')
    sys.exit(1)
else:
    print('全部一致: %d 家 × (4 项分数 + 价格参考含净现金代入明细 + 造假分 + 管理分 + 周期判定/强度/位置 + 趋势回溯) 完全相同' % len(js_scores))
    print('示例 3 家:')
    for f in sorted(companies_dir.glob('*.json'))[:3]:
        d = json.loads(f.read_text(encoding='utf-8'))
        py = compute_scores(d)
        print(' ', d['code'], d['name'], py)
