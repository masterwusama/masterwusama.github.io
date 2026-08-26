# 临时验证：Python scoring.py 与 stock.js 原函数（Node 抽取）的四大流派分数对比
import json
import subprocess
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path(__file__).parent))
from scoring import compute_scores  # noqa: E402

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

if diffs:
    print('不一致 %d 处:' % len(diffs))
    for code, key, p, j in diffs:
        print(f'  {code} {key}: Python={p} JS={j}')
    sys.exit(1)
else:
    print('全部一致: %d 家 × (4 项分数 + 12 项价格参考) 完全相同' % len(js_scores))
    print('示例 3 家:')
    for f in sorted(companies_dir.glob('*.json'))[:3]:
        d = json.loads(f.read_text(encoding='utf-8'))
        py = compute_scores(d)
        print(' ', d['code'], d['name'], py)
