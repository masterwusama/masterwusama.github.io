// 临时验证脚本：从 assets/stock.js 抽取评分函数原文，计算 24 家四大流派分数
// 输出 JSON 到 stdout，由 _score_check.py 与 Python scoring.py 结果对比
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'assets', 'stock.js'), 'utf8');

// 按函数名提取完整函数体（括号匹配，支持嵌套函数）
function extractFunc(name) {
  const re = new RegExp('(?:^|\\n)( *)function ' + name + '\\b[^\\n]*\\n');
  const m = re.exec(SRC);
  if (!m) return null;
  const start = m.index + m[0].indexOf('function');
  let i = SRC.indexOf('{', start);
  if (i < 0) throw new Error('no body: ' + name);
  let depth = 0;
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(start, i + 1);
}

const NAMES = ['annualRows', 'ttmNetProfit', 'shareCount', 'latestField', 'epsTtmField',
  'sheetRowByDate', 'annualBalanceRows', 'cagr', 'perShareDiv',
  'consecutiveDivYears', 'sum', 'recentDividends', 'lerpScore', 'it',
  'fmtNum', 'fmtMoney', 'fmtPct', 'fmtDate', 'valueAnalysis', 'valueScores',
  'fairPe', 'bisectBuy', 'priceReferences', 'fraudAnalysis', 'managementAnalysis', 'cycleAnalysis'];

let code = SRC.match(/var BOND_10Y = [\d.]+;/)[0] + '\n';
for (const n of NAMES) {
  const f = extractFunc(n);
  if (!f) throw new Error('missing function: ' + n);
  code += f + '\n';
}
code += '\nmodule.exports = { valueAnalysis: valueAnalysis, valueScores: valueScores, priceReferences: priceReferences, fraudAnalysis: fraudAnalysis, managementAnalysis: managementAnalysis, cycleAnalysis: cycleAnalysis };\n';
fs.writeFileSync(path.join(__dirname, '_score_check_funcs.js'), code);

const { valueAnalysis, valueScores, priceReferences, fraudAnalysis, managementAnalysis, cycleAnalysis } = require('./_score_check_funcs.js');
const DATA = path.join(__dirname, '..', 'data', 'companies');
const out = {};
for (const f of fs.readdirSync(DATA).filter((x) => x.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
  try {
    const va = valueAnalysis(d);
    const sc = valueScores(d, va);
    const fa = fraudAnalysis(d);
    const ma = managementAnalysis(d);
    const ca = cycleAnalysis(d);
    out[d.code] = {
      grahamAgg: sc.grahamAgg.total, grahamDef: sc.grahamDef.total, schloss: sc.schloss.total, buffett: sc.buffett.total,
      priceRefs: priceReferences(d, va),
      fraud: fa.total,
      mgmt: ma ? ma.total : null,
      cycle: ca ? ca.total : null,
      cyclical: ca ? ca.cyclical : null,
      cyclicalScore: ca ? ca.cyclicalScore : null
    };
  } catch (e) {
    out[d.code] = { error: String(e) };
  }
}
process.stdout.write(JSON.stringify(out, null, 1));
