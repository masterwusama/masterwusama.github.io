# -*- coding: utf-8 -*-
"""临时:仅重算 index.json 中各家 scores(施洛斯扣分规则变更后),不重抓数据"""
import json
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path(__file__).parent))
from scoring import compute_scores  # noqa: E402

BASE = Path(__file__).parent.parent
companies_dir = BASE / 'data' / 'companies'
index_path = BASE / 'data' / 'index.json'

idx = json.loads(index_path.read_text(encoding='utf-8'))
changed = 0
for c in idx['companies']:
    f = companies_dir / (c['code'] + '.json')
    if not f.exists():
        continue
    d = json.loads(f.read_text(encoding='utf-8'))
    try:
        new_scores = compute_scores(d)
    except Exception:
        new_scores = None
    if new_scores != c.get('scores'):
        c['scores'] = new_scores
        changed += 1
index_path.write_text(
    json.dumps(idx, ensure_ascii=False, separators=(",", ":")), encoding='utf-8')
print('updated %d/%d companies in index.json' % (changed, len(idx['companies'])))
