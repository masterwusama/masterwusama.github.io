export const DEFAULT_TITLE = '我的旅行足迹';
export const STORAGE_KEY = 'mw-travel-footprints-v1';
export const STATUSES = Object.freeze([
  { id: 'lived', label: '居住', color: '#ff8585' },
  { id: 'stayed', label: '短居', color: '#ffb880' },
  { id: 'visited', label: '游玩', color: '#ffe582' },
  { id: 'business', label: '出差', color: '#a9efbe' },
  { id: 'passed', label: '路过', color: '#99b9ff' },
  { id: 'none', label: '没去过', color: '#ffffff' }
]);

export function normalizeState(value, provinces) {
  const state = { version: 1, title: DEFAULT_TITLE, selections: {} };
  if (!value || value.version !== 1) return state;
  if (typeof value.title === 'string') state.title = Array.from(value.title).slice(0, 28).join('');
  if (!value.selections || typeof value.selections !== 'object') return state;
  const validCodes = new Set(provinces.flatMap(province => province.cities.map(city => city.code)));
  const validStatuses = new Set(STATUSES.filter(status => status.id !== 'none').map(status => status.id));
  for (const [code, status] of Object.entries(value.selections)) {
    if (validCodes.has(code) && validStatuses.has(status)) state.selections[code] = status;
  }
  return state;
}

export function summarize(provinces, selections) {
  const counts = Object.fromEntries(STATUSES.map(status => [status.id, 0]));
  let total = 0;
  let provinceCount = 0;
  for (const province of provinces) {
    let marked = false;
    for (const city of province.cities) {
      const status = selections[city.code] || 'none';
      counts[status] += 1;
      if (status !== 'none') {
        total += 1;
        marked = true;
      }
    }
    if (marked) provinceCount += 1;
  }
  return { total, provinceCount, counts };
}

export function findCities(provinces, provinceCode, query) {
  const term = query.trim().toLocaleLowerCase('zh-CN');
  return provinces
    .filter(province => term || province.code === provinceCode)
    .map(province => ({
      ...province,
      cities: province.cities.filter(city => !term || `${province.name} ${city.name}`.toLocaleLowerCase('zh-CN').includes(term))
    }))
    .filter(province => province.cities.length);
}
