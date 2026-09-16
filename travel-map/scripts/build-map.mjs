// 构建 travel-map/data/china.json：抓取 DataV.GeoAtlas 边界，转 TopoJSON（站点运行时直接读产物）。
// 依赖（仅构建期）：cd travel-map/scripts && npm install
// 用法：node build-map.mjs [量化精度，默认 100000]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import topojsonServer from 'topojson-server';

const BASE = 'https://geo.datav.aliyun.com/areas_v3/bound';
const PROVINCE_ONLY = new Set(['11', '12', '31', '50', 'tw', 'hk', 'mo']);
const PROVINCE_ADCODE = { tw: '710000', hk: '810000', mo: '820000' };
const INSET_CODES = new Set(['460300']);
const cacheUrl = new URL('./_cache/', import.meta.url);
const dataUrl = new URL('../data/china.json', import.meta.url);
const reportUrl = new URL('../data/map-build-report.json', import.meta.url);

async function geojson(name) {
  const file = new URL(`${name}.json`, cacheUrl);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    const response = await fetch(`${BASE}/${name}.json`);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    const text = await response.text();
    await mkdir(cacheUrl, { recursive: true });
    await writeFile(file, text, 'utf8');
    return JSON.parse(text);
  }
}

function adcodeOf(code) {
  if (code.length === 2) return `${code}0000`;
  if (code.length === 4) return `${code}00`;
  return code;
}

// d3-geo 的球面约定与 GeoJSON RFC 7946 相反：外环须顺时针、内环逆时针，
// 否则该多边形会被理解成「地球减去这块地」，渲染出一个覆盖全图的巨大填充。
function ringWinding(ring) {
  let sum = 0;
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const last = closed ? ring.length - 1 : ring.length;
  for (let i = 0; i < last; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum;
}

// 量化后仅剩 4~7 个点、面积不足 0.1 km² 的碎片（约合本图 1 像素的千分之一）会让 d3 无法判定内外环，
// 只会画出一个覆盖全图的填充，因此直接丢弃；整幅都是碎片的几何体保留最大那块，避免空几何。
const MIN_POLYGON_AREA = 0.1 / (111 * 100.6);
let sliverPolygons = 0;

function prepareGeometry(geometry) {
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return geometry;
  const multi = geometry.type === 'MultiPolygon';
  const polygons = multi ? geometry.coordinates : [geometry.coordinates];
  const areaOf = rings => Math.abs(ringWinding(rings[0])) / 2;
  const kept = polygons.filter(rings => areaOf(rings) > MIN_POLYGON_AREA);
  const result = kept.length ? kept : [polygons.reduce((a, b) => (areaOf(a) >= areaOf(b) ? a : b))];
  sliverPolygons += polygons.length - kept.length;
  for (const rings of result) {
    rings.forEach((ring, index) => {
      const wantsClockwise = index === 0;
      if ((ringWinding(ring) < 0) !== wantsClockwise) ring.reverse();
    });
  }
  return multi ? { ...geometry, coordinates: result } : { ...geometry, coordinates: result[0] };
}

const regions = JSON.parse(await readFile(new URL('../data/regions.json', import.meta.url), 'utf8'));
const national = await geojson('100000_full');
const provincePolygons = new Map();
const lineFeatures = [];
for (const feature of national.features) {
  const adcode = String(feature.properties.adcode);
  if (adcode.endsWith('_JD')) lineFeatures.push({ ...feature, geometry: prepareGeometry(feature.geometry), properties: null });
  else provincePolygons.set(adcode, feature);
}

const features = [];
const report = { missing: [], extra: [], byProvince: {}, lineFeatures: lineFeatures.length };
for (const province of regions.provinces) {
  const provinceAdcode = PROVINCE_ADCODE[province.code] || `${province.code}0000`;
  if (PROVINCE_ONLY.has(province.code)) {
    const polygon = provincePolygons.get(provinceAdcode);
    if (!polygon) { report.missing.push(`${province.name} 省级面`); continue; }
    features.push({ ...polygon, geometry: prepareGeometry(polygon.geometry), properties: { code: province.code, name: polygon.properties.name, prov: province.code, inset: false } });
    report.byProvince[province.name] = { units: 1, matched: 1, mode: 'province' };
    continue;
  }

  let children = [];
  try {
    children = (await geojson(`${provinceAdcode}_full`)).features;
  } catch (error) {
    report.missing.push(`${province.name}: ${error.message}`);
    continue;
  }
  const byAdcode = new Map(children.map(feature => [String(feature.properties.adcode), feature]));
  const byName = new Map(children.map(feature => [feature.properties.name, feature]));
  let matched = 0;
  for (const city of province.cities) {
    const adcode = adcodeOf(city.code);
    const feature = byAdcode.get(adcode) || byName.get(city.name);
    if (!feature) { report.missing.push(`${province.name} / ${city.name} (${city.code}→${adcode})`); continue; }
    matched += 1;
    features.push({ ...feature, geometry: prepareGeometry(feature.geometry), properties: { code: city.code, name: city.name, prov: province.code, inset: INSET_CODES.has(adcode) } });
    byAdcode.delete(String(feature.properties.adcode));
    byName.delete(feature.properties.name);
  }
  for (const leftover of byAdcode.values()) report.extra.push(`${province.name} / ${leftover.properties.name} (${leftover.properties.adcode})`);
  report.byProvince[province.name] = { units: province.cities.length, matched };
}

const labelCodes = { '710000': 'tw', '810000': 'hk', '820000': 'mo' };
const provinceLabels = [];
for (const [adcode, feature] of provincePolygons) {
  const point = feature.properties.centroid || feature.properties.center;
  if (!point) continue;
  provinceLabels.push({
    code: labelCodes[adcode] || adcode.slice(0, 2),
    name: feature.properties.name,
    point: [point[0], point[1]]
  });
}

const topology = topojsonServer.topology(
  { cities: { type: 'FeatureCollection', features }, nineDash: { type: 'FeatureCollection', features: lineFeatures } },
  Number(process.argv[2] || 1e5)
);
topology.meta = {
  source: 'DataV.GeoAtlas areas_v3 · GCJ-02 · CDN last-modified 2021-06',
  builtAt: new Date().toISOString().slice(0, 10),
  quantization: topology.transform ? 1 / topology.transform.scale[0] : null,
  cityGeometries: features.length,
  provinceLabels
};
const json = JSON.stringify(topology);
await writeFile(dataUrl, json, 'utf8');
await writeFile(reportUrl, JSON.stringify({
  ...report,
  sliverPolygons,
  bytes: json.length,
  gzEstimate: Math.round(json.length * 0.28),
  geometryCodes: new Set(features.map(feature => feature.properties.code)).size
}, null, 1), 'utf8');
console.log(json.length, features.length, report.missing.length, report.extra.length, lineFeatures.length, sliverPolygons);
