import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_TITLE, STATUSES, normalizeState, summarize, findCities, provinceStatus } from '../assets/model.mjs';

const data = JSON.parse(readFileSync(new URL('../data/regions.json', import.meta.url), 'utf8'));
const topology = JSON.parse(readFileSync(new URL('../data/china.json', import.meta.url), 'utf8'));
const provinces = data.provinces;
const cities = provinces.flatMap(province => province.cities);
const blank = () => normalizeState(null, provinces);

function geometryCodeOf(unitCode) {
  return unitCode.startsWith('tw-') ? 'tw' : unitCode;
}

const { scale, translate } = topology.transform;

function absoluteArc(index) {
  let x = 0;
  let y = 0;
  const points = topology.arcs[index < 0 ? ~index : index].map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
  });
  return index < 0 ? points.reverse() : points;
}

function ringPoints(arcs) {
  const points = [];
  for (const index of arcs) {
    const part = absoluteArc(index);
    points.push(...(points.length ? part.slice(1) : part));
  }
  return points;
}

function ringArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length - 1; i += 1) sum += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
  return sum / 2;
}

test('region list covers 34 groups with unique, selectable city-level units', () => {
  assert.equal(provinces.length, 34);
  assert.equal(cities.length, 393);
  assert.equal(new Set(provinces.map(province => province.code)).size, 34);
  assert.equal(new Set(cities.map(city => city.code)).size, 393);
  assert.ok(cities.every(city => city.name && city.code));
  assert.ok(cities.every(city => !/直辖县级行政区划|市辖区/.test(city.name)));
  assert.equal(data.source.mainlandSnapshot, '2023-06-30');
  for (const code of ['11', '12', '31', '50', 'hk', 'mo']) {
    const province = provinces.find(item => item.code === code);
    assert.equal(province.cities.length, 1);
    assert.equal(province.cities[0].code, code);
  }
  const taiwan = provinces.find(item => item.code === 'tw');
  assert.equal(taiwan.cities.length, 22);
  assert.ok(taiwan.cities.some(city => city.name === '金门县'));
  assert.ok(taiwan.cities.some(city => city.name === '连江县'));
  for (const name of ['济源市', '仙桃市', '神农架林区', '白杨市', '阿坝藏族羌族自治州']) {
    assert.ok(cities.some(city => city.name === name), name);
  }
});

test('boundary topology aligns with the selectable units', () => {
  const geometries = topology.objects.cities.geometries;
  const codes = geometries.map(geometry => geometry.properties.code);
  assert.equal(new Set(codes).size, codes.length, 'geometry codes are unique');
  const validUnits = new Set(cities.map(city => geometryCodeOf(city.code)));
  for (const code of codes) assert.ok(validUnits.has(code), `geometry ${code} matches no unit`);

  const present = new Set(codes);
  const withoutBoundary = cities.filter(city => !present.has(geometryCodeOf(city.code))).map(city => city.name);
  assert.deepEqual(withoutBoundary, ['新星市', '白杨市'], 'only the two post-2021 Xinjiang cities lack boundaries');
  assert.equal(new Set(withoutBoundary.map(name => name)).size, 2);

  const insets = geometries.filter(geometry => geometry.properties.inset).map(geometry => geometry.properties.code);
  assert.deepEqual(insets, ['4603'], '三沙市 alone is drawn in the South China Sea inset');
  assert.ok(geometries.some(geometry => geometry.properties.code === 'tw'), 'Taiwan is drawn as a province polygon');
  assert.equal(topology.meta.cityGeometries, codes.length);
});

test('boundary data keeps the nine-dash line and one label anchor per province', () => {
  assert.ok(topology.objects.nineDash.geometries.length >= 1, 'nine-dash layer present');
  const labels = topology.meta.provinceLabels;
  assert.equal(labels.length, 34);
  assert.deepEqual(labels.map(label => label.code).sort(), provinces.map(province => province.code).sort());
  for (const label of labels) {
    assert.ok(label.name && typeof label.point === 'object');
    assert.ok(label.point[0] > 70 && label.point[0] < 136 && label.point[1] > 3 && label.point[1] < 54, label.name);
  }
  assert.match(topology.meta.source, /GCJ-02/);
});

test('polygons are wound for d3-geo and carry no sub-pixel slivers', () => {
  const MIN_KM2 = 0.1;
  let rings = 0;
  for (const geometry of [...topology.objects.cities.geometries, ...topology.objects.nineDash.geometries]) {
    const polygons = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs;
    const label = geometry.properties ? geometry.properties.code : 'nine-dash';
    for (const arcs of polygons) {
      arcs.forEach((indexes, index) => {
        const area = ringArea(ringPoints(indexes));
        const id = `${label} ring#${index}`;
        assert.ok(Math.abs(area) * 111 * 100.6 > MIN_KM2, `${id} is a ${MIN_KM2} km² sliver`);
        assert.ok(index === 0 ? area < 0 : area > 0, `${id} must be ${index === 0 ? 'clockwise' : 'counter-clockwise'}`);
        rings += 1;
      });
    }
  }
  assert.ok(rings > 500, `checked ${rings} rings`);
});

test('restored state rejects unknown cities, invalid categories and unsupported versions', () => {
  assert.deepEqual(normalizeState({ version: 2, selections: { '11': 'lived' } }, provinces), blank());
  assert.deepEqual(normalizeState({ version: 1, title: null, selections: null }, provinces), blank());
  const restored = normalizeState({
    version: 1,
    title: '很长的标题'.repeat(10),
    selections: { '11': 'lived', '12': 'none', '31': 'invalid', 'unknown': 'visited', 'hk': 'passed', '50': 'stayed' }
  }, provinces);
  assert.equal(Array.from(restored.title).length, 28);
  assert.deepEqual(restored.selections, { '11': 'lived', '50': 'stayed' }, 'removed 路过 marks are dropped');
});

test('counts are unique and reclassification never increases the total', () => {
  const selections = {};
  const initial = summarize(provinces, selections);
  assert.equal(initial.total, 0);
  assert.equal(initial.counts.none, 393);
  selections['3301'] = 'visited';
  selections['3302'] = 'business';
  selections['11'] = 'lived';
  let stats = summarize(provinces, selections);
  assert.equal(stats.total, 3);
  assert.equal(stats.provinceCount, 2);
  selections['3301'] = 'stayed';
  stats = summarize(provinces, selections);
  assert.equal(stats.total, 3);
  assert.equal(stats.counts.visited, 0);
  assert.equal(stats.counts.stayed, 1);
  assert.equal(stats.counts.business, 1);
  assert.equal(stats.counts.lived, 1);
  delete selections['11'];
  stats = summarize(provinces, selections);
  assert.equal(stats.total, 2);
  assert.equal(stats.provinceCount, 1);
  assert.equal(Object.values(stats.counts).reduce((sum, value) => sum + value, 0), 393);
});

test('search works across provinces, by province name, and with empty results', () => {
  assert.equal(findCities(provinces, '11', '')[0].cities.length, 1);
  const hangzhou = findCities(provinces, '11', ' 杭州 ');
  assert.equal(hangzhou.length, 1);
  assert.equal(hangzhou[0].code, '33');
  assert.equal(hangzhou[0].cities[0].name, '杭州市');
  assert.equal(findCities(provinces, '11', '浙江')[0].cities.length, 11);
  assert.equal(findCities(provinces, '11', '不存在的城市').length, 0);
  const suzhou = findCities(provinces, '11', '苏');
  assert.ok(suzhou.some(province => province.code === '32'));
  assert.ok(suzhou.some(province => province.code === '65'));
});

test('every category is available for marking and the default title stays sane', () => {
  assert.deepEqual(STATUSES.map(status => status.id), ['lived', 'stayed', 'visited', 'business', 'none']);
  assert.ok(STATUSES.every(status => /^#[0-9a-f]{6}$/.test(status.color)));
  assert.equal(blank().title, DEFAULT_TITLE);
});

test('province color follows the highest-ranked marked city', () => {
  const hebei = provinces.find(province => province.code === '13');
  const pick = index => hebei.cities[index].code;
  assert.equal(provinceStatus(hebei, {}).id, 'none', 'unmarked provinces stay 未去');
  assert.equal(provinceStatus(hebei, { [pick(0)]: 'business' }).id, 'business');
  assert.equal(provinceStatus(hebei, { [pick(0)]: 'business', [pick(1)]: 'visited' }).id, 'visited');
  assert.equal(provinceStatus(hebei, { [pick(0)]: 'stayed', [pick(1)]: 'visited' }).id, 'stayed');
  assert.equal(
    provinceStatus(hebei, { [pick(0)]: 'lived', [pick(1)]: 'stayed', [pick(2)]: 'visited', [pick(3)]: 'business' }).id,
    'lived',
    '居住 ranks above all other marks'
  );
  const taiwan = provinces.find(province => province.code === 'tw');
  assert.equal(provinceStatus(taiwan, { [taiwan.cities[0].code]: 'stayed' }).id, 'stayed', 'Taiwan aggregates by its county marks');
});
