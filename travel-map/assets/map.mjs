import { STATUSES, summarize, provinceStatus } from './model.mjs?v=20260923a';

const INK = '#252725';
const SEA = '#efb8b7';
const LAND = '#fffaf6';
const PADDING = 44;
const WIDTH = 1200;
const MAP_HEIGHT = 720;
const INSET_WIDTH = 236;
const INSET_HEIGHT = 330;
const INSET_GAP = 16;

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function shortProvinceName(name) {
  return name
    .replace(/^(.+?)(?:维吾尔|壮|回)?族?自治区$/, '$1')
    .replace(/^(.+?)特别行政区$/, '$1')
    .replace(/^(.+?)省$/, '$1')
    .replace(/^(.+?)市$/, '$1');
}

function statusOf(selections, code) {
  return STATUSES.find(status => status.id === (selections[code] || 'none'));
}

function fillFor(selections, code, provinceByCode) {
  // 台湾在地图上只有一个省级面，随省内市县的最高级标记着色。
  const status = code === 'tw' ? provinceStatus(provinceByCode.get('tw'), selections) : statusOf(selections, code);
  return { status, color: status.id === 'none' ? LAND : status.color };
}

export function pngDimensions(poster) {
  // 全国长图按 2 倍会超出部分手机浏览器的画布像素上限，这里封顶到 1600 万像素。
  const scale = Math.min(2, Math.sqrt(16000000 / (poster.width * poster.height)));
  return { width: Math.floor(poster.width * scale), height: Math.floor(poster.height * scale) };
}

export function makeMapSvg(topology, provinces, state, mode = 'cities') {
  const { feature, mesh, merge } = globalThis.topojson;
  const d3 = globalThis.d3;
  const cities = feature(topology, topology.objects.cities);
  const nineDash = feature(topology, topology.objects.nineDash);
  const mainFeatures = cities.features.filter(current => !current.properties.inset);
  const sansha = cities.features.find(current => current.properties.inset);
  const selections = state.selections;
  const stats = summarize(provinces, selections);
  const provinceByCode = new Map(provinces.map(province => [province.code, province]));
  const elements = [];
  const text = (x, y, value, size, weight = 400, anchor = 'start', extra = '') => {
    elements.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}"${extra}>${escapeXml(value)}</text>`);
  };

  const title = state.title.trim() || '我的旅行足迹';
  const characters = Array.from(title);
  const titleSize = characters.length > 14 ? 34 : 42;
  const perLine = Math.floor((WIDTH - PADDING * 2) / titleSize);
  const titleLines = [];
  for (let index = 0; index < characters.length; index += perLine) titleLines.push(characters.slice(index, index + perLine).join(''));
  const titleBottom = 92 + (titleLines.length - 1) * titleSize * 1.25;
  const statsY = titleBottom + 34;
  const legendY = statsY + 34;
  const mapTop = legendY + 26;
  const mapBottom = mapTop + MAP_HEIGHT;

  const inset = { x: WIDTH - PADDING - INSET_WIDTH, y: mapBottom - INSET_HEIGHT, width: INSET_WIDTH, height: INSET_HEIGHT };
  const projection = d3.geoConicEqualArea().parallels([25, 47]).rotate([-105, 0])
    .fitExtent([[PADDING, mapTop], [inset.x - INSET_GAP, mapBottom]], { type: 'FeatureCollection', features: mainFeatures });
  const path = d3.geoPath(projection);

  if (mode === 'provinces') {
    // 省级视图：把省内所有市级面合并成一个多边形，颜色取省内最高级标记。
    for (const province of provinces) {
      const geometries = topology.objects.cities.geometries.filter(current => !current.properties.inset && current.properties.prov === province.code);
      if (!geometries.length) continue;
      const status = provinceStatus(province, selections);
      const color = status.id === 'none' ? LAND : status.color;
      const markedCount = province.cities.filter(city => (selections[city.code] || 'none') !== 'none').length;
      const label = `${province.name}：${status.label}，已标记 ${markedCount} / ${province.cities.length} 座城市；点击可整省标记或取消`;
      elements.push(`<path data-prov="${escapeXml(province.code)}" d="${path({ type: 'Feature', properties: {}, geometry: merge(topology, geometries) })}" fill="${color}" stroke="${INK}" stroke-width="0.45" stroke-linejoin="round"><title>${escapeXml(label)}</title></path>`);
    }
  } else {
    for (const current of mainFeatures) {
      const code = current.properties.code;
      const { status, color } = fillFor(selections, code, provinceByCode);
      const aggregate = code === 'tw';
      const label = aggregate ? `台湾省：${status.label}（按市县在左侧列表选择，快照无市级边界）` : `${current.properties.name}：${status.label}`;
      elements.push(`<path data-city="${escapeXml(code)}" d="${path(current)}" fill="${color}" stroke="${INK}" stroke-width="0.45" stroke-linejoin="round"${aggregate ? ' pointer-events="none"' : ''}><title>${escapeXml(label)}</title></path>`);
    }
  }
  const provinceBorder = mesh(topology, topology.objects.cities, (a, b) => a !== b && a.properties.prov !== b.properties.prov);
  const outerBorder = mesh(topology, topology.objects.cities, (a, b) => a === b);
  elements.push(`<path d="${path(provinceBorder)}" fill="none" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round" pointer-events="none"/>`);
  elements.push(`<path d="${path(outerBorder)}" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round" pointer-events="none"/>`);

  const provinceBounds = new Map();
  for (const current of mainFeatures) {
    const [[x0, y0], [x1, y1]] = path.bounds(current);
    const box = provinceBounds.get(current.properties.prov) || [x0, y0, x1, y1];
    provinceBounds.set(current.properties.prov, [Math.min(box[0], x0), Math.min(box[1], y0), Math.max(box[2], x1), Math.max(box[3], y1)]);
  }
  // 省名分三档字号，最小的省（京津沪、山西、宁夏、海南、港澳等）也有名称；
  // 港澳两点相距太近，改为左右错开、锚在各自图形旁。
  const labelSizes = [
    { minW: 150, minH: 90, size: 15 },
    { minW: 70, minH: 45, size: 12.5 },
    { minW: 0, minH: 0, size: 10 }
  ];
  const labelOffsets = { hk: { dx: 7, dy: 3, anchor: 'start' }, mo: { dx: -7, dy: 4, anchor: 'end' } };
  for (const label of topology.meta.provinceLabels) {
    const box = provinceBounds.get(label.code);
    if (!box) continue;
    const size = labelSizes.find(tier => box[2] - box[0] > tier.minW && box[3] - box[1] > tier.minH)?.size;
    if (!size) continue;
    const point = projection(label.point);
    if (!point) continue;
    const offset = labelOffsets[label.code] || {};
    text(point[0] + (offset.dx || 0), point[1] + (offset.dy || 0), shortProvinceName(label.name), size, 600, offset.anchor || 'middle', ` paint-order="stroke" stroke="${SEA}" stroke-width="3.5" stroke-linejoin="round" pointer-events="none"`);
  }

  elements.push(`<text x="${PADDING}" y="46" font-size="12" font-weight="600" letter-spacing="2">TRAVEL FOOTPRINTS</text>`);
  titleLines.forEach((line, index) => text(PADDING, 92 + index * titleSize * 1.25, line, titleSize, 700));
  text(PADDING, statsY, `已标记 ${stats.total} 座城市 / 地区 · 涉及 ${stats.provinceCount} 个省级地区`, 19, 600);
  const legendWidth = (WIDTH - PADDING * 2) / STATUSES.length;
  STATUSES.forEach((status, index) => {
    const x = PADDING + index * legendWidth;
    elements.push(`<rect x="${x}" y="${legendY - 13}" width="16" height="16" rx="2" fill="${status.color}" stroke="${INK}" stroke-width="1.2"/>`);
    text(x + 24, legendY, `${status.label} ${stats.counts[status.id]}`, 14);
  });

  elements.push(`<rect x="${inset.x}" y="${inset.y}" width="${inset.width}" height="${inset.height}" fill="${SEA}" stroke="${INK}" stroke-width="1.4"/>`);
  const insetFeatures = [...nineDash.features, ...(sansha ? [sansha] : [])];
  const insetProjection = d3.geoMercator()
    .fitExtent([[inset.x + 12, inset.y + 28], [inset.x + inset.width - 12, inset.y + inset.height - 14]], { type: 'FeatureCollection', features: insetFeatures });
  const insetPath = d3.geoPath(insetProjection);
  if (sansha) {
    const status = statusOf(selections, '4603');
    elements.push(`<path data-city="4603" d="${insetPath(sansha)}" fill="${status.id === 'none' ? LAND : status.color}" stroke="${INK}" stroke-width="0.4"><title>${escapeXml(`三沙市：${status.label}`)}</title></path>`);
  }
  for (const current of nineDash.features) {
    elements.push(`<path d="${insetPath(current)}" fill="${INK}" stroke="${INK}" stroke-width="0.7" pointer-events="none"/>`);
  }
  text(inset.x + 12, inset.y + 19, '南海诸岛', 12.5, 600);

  const notes = mode === 'provinces'
    ? [
        '按省级行政区划边界绘制的位置示意图，非官方标准地图、无审图号；省份颜色取省内已标记城市的最高等级。',
        '底图数据：阿里云 DataV.GeoAtlas areas_v3（GCJ-02 坐标，快照 2021-06）。数量按标记城市去重统计。'
      ]
    : [
        '按真实行政区划边界绘制的位置示意图，非官方标准地图、无审图号；省级界线仅供参考。',
        '底图数据：阿里云 DataV.GeoAtlas areas_v3（GCJ-02 坐标，快照 2021-06）。数量按标记城市去重统计。'
      ];
  notes.forEach((note, index) => text(PADDING, mapBottom + 26 + index * 20, note, 11.5));

  const height = mapBottom + 62;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${escapeXml(`${title}，已标记 ${stats.total} 座城市或地区`)}"><title>${escapeXml(title)}</title><rect width="${WIDTH}" height="${height}" fill="${SEA}"/><g font-family="Microsoft YaHei, PingFang SC, sans-serif" fill="${INK}">${elements.join('')}</g></svg>`;
  return { svg, width: WIDTH, height };
}
