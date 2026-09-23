import { STATUSES, STORAGE_KEY, normalizeState, summarize, findCities } from './model.mjs?v=20260923a';
import { makeMapSvg, pngDimensions } from './map.mjs?v=20260923a';

const element = id => document.getElementById(`travel-${id}`);
const statuses = new Map(STATUSES.map(status => [status.id, status]));
const TAIWAN_PREFIX = 'tw-';
let provinces = [];
let topology = null;
let state;
let paint = 'visited';
let mapMode = 'cities';

function announce(message, error = false) {
  element('message').textContent = message;
  element('message').dataset.error = String(error);
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    element('save-state').textContent = '已保存在此浏览器';
  } catch {
    element('save-state').textContent = '无法保存，请下载图片留存';
    announce('浏览器不允许保存或存储空间不足。当前仍可选择城市和下载图片，刷新可能丢失记录。', true);
  }
}

function renderPalette() {
  element('palette').replaceChildren(...STATUSES.map(status => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.status = status.id;
    button.setAttribute('aria-pressed', String(paint === status.id));
    button.style.setProperty('--status-color', status.color);
    const swatch = document.createElement('span');
    swatch.className = 'travel-swatch';
    swatch.setAttribute('aria-hidden', 'true');
    button.append(swatch, status.label);
    return button;
  }));
}

function syncCityButton(code) {
  const button = element('cities').querySelector(`button[data-code="${CSS.escape(code)}"]`);
  if (!button) return;
  const status = statuses.get(state.selections[code] || 'none');
  button.style.setProperty('--status-color', status.color);
  button.dataset.status = status.id;
  button.setAttribute('aria-pressed', String(status.id !== 'none'));
  button.setAttribute('aria-label', `${button.dataset.province} · ${button.dataset.name}，${status.label}`);
  button.querySelector('small').textContent = status.id === 'none' ? '' : status.label;
}

function renderCities() {
  const query = element('search').value;
  const groups = findCities(provinces, element('province').value, query);
  const container = element('cities');
  container.replaceChildren();
  container.scrollTop = 0;
  const count = groups.reduce((total, province) => total + province.cities.length, 0);
  element('results-label').textContent = query.trim()
    ? `全国搜索 · 找到 ${count} 个城市 / 地区`
    : `当前地区 · ${count} 个城市 / 地区`;
  if (!count) {
    const empty = document.createElement('p');
    empty.className = 'travel-empty';
    empty.textContent = '没有匹配的城市，试试更短的名称或省名。';
    container.append(empty);
    return;
  }
  for (const province of groups) {
    const group = document.createElement('section');
    group.className = 'travel-city-group';
    const heading = document.createElement('h3');
    heading.textContent = province.name;
    const grid = document.createElement('div');
    grid.className = 'travel-city-grid';
    for (const city of province.cities) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'travel-city';
      button.dataset.code = city.code;
      button.dataset.name = city.name;
      button.dataset.province = province.name;
      const name = document.createElement('span');
      name.textContent = city.name;
      button.append(name, document.createElement('small'));
      grid.append(button);
    }
    group.append(heading, grid);
    container.append(group);
  }
  for (const button of container.querySelectorAll('button[data-code]')) syncCityButton(button.dataset.code);
}

function renderPreview() {
  element('preview').innerHTML = makeMapSvg(topology, provinces, state, mapMode).svg;
}

function syncModeToggle() {
  for (const button of element('map-mode').querySelectorAll('button[data-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mapMode));
  }
}

function renderSummary() {
  const stats = summarize(provinces, state.selections);
  element('summary').innerHTML = `<strong>${stats.total}</strong> 座城市 / 地区 <span>·</span> <strong>${stats.provinceCount}</strong> 个省级地区`;
  element('counts').replaceChildren(...STATUSES.map(status => {
    const item = document.createElement('span');
    item.style.setProperty('--status-color', status.color);
    const swatch = document.createElement('span');
    swatch.className = 'travel-swatch';
    swatch.setAttribute('aria-hidden', 'true');
    const count = document.createElement('strong');
    count.textContent = String(stats.counts[status.id]);
    item.append(swatch, `${status.label} `, count);
    return item;
  }));
}

function applyMark(code, name) {
  if (paint === 'none') delete state.selections[code];
  else state.selections[code] = paint;
  syncCityButton(code);
  renderSummary();
  renderPreview();
  announce(`${name}已${paint === 'none' ? '取消标记' : `标为「${statuses.get(paint).label}」`}。`);
  save();
}

function applyProvinceMark(code) {
  const province = provinces.find(item => item.code === code);
  if (!province) return;
  if (paint === 'none') {
    const marked = province.cities.filter(city => state.selections[city.code]).length;
    if (!marked) {
      announce(`「${province.name}」内还没有已标记的城市。`);
      return;
    }
    if (!window.confirm(`取消「${province.name}」内全部 ${marked} 处标记？此操作无法撤销。`)) return;
    for (const city of province.cities) delete state.selections[city.code];
    announce(`已取消「${province.name}」内全部标记。`);
  } else {
    for (const city of province.cities) state.selections[city.code] = paint;
    announce(`已将「${province.name}」内 ${province.cities.length} 个城市 / 地区标为「${statuses.get(paint).label}」。`);
  }
  for (const button of element('cities').querySelectorAll('button[data-code]')) syncCityButton(button.dataset.code);
  renderSummary();
  renderPreview();
  save();
}

async function downloadImage() {
  const button = element('download');
  button.disabled = true;
  button.textContent = '正在生成图片…';
  let svgUrl;
  try {
    await document.fonts.ready;
    const poster = makeMapSvg(topology, provinces, state, mapMode);
    const image = new Image();
    svgUrl = URL.createObjectURL(new Blob([poster.svg], { type: 'image/svg+xml;charset=utf-8' }));
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('SVG image failed to load'));
      image.src = svgUrl;
    });
    const canvas = document.createElement('canvas');
    const dimensions = pngDimensions(poster);
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('PNG encoding failed');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `旅行足迹-${new Date().toISOString().slice(0, 10)}.png`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    announce('高清 PNG 已生成，已发起下载；若手机显示图片预览，可长按图片保存。');
  } catch (error) {
    console.error('Travel image export failed', error);
    announce('图片生成失败，记录仍保留。请重试，或换用支持图片下载的浏览器。', true);
  } finally {
    if (svgUrl) URL.revokeObjectURL(svgUrl);
    button.disabled = false;
    button.textContent = '下载高清 PNG ↓';
  }
}

element('palette').addEventListener('click', event => {
  const button = event.target.closest('button[data-status]');
  if (!button) return;
  paint = button.dataset.status;
  for (const option of element('palette').querySelectorAll('button')) {
    option.setAttribute('aria-pressed', String(option === button));
  }
  element('paint-hint').textContent = paint === 'none'
    ? '点击已标记的城市或地图，取消它的足迹。'
    : `点击地图上的城市，标为「${statuses.get(paint).label}」。`;
});

element('province').addEventListener('change', () => {
  element('search').value = '';
  renderCities();
});
element('search').addEventListener('input', renderCities);
element('cities').addEventListener('click', event => {
  const button = event.target.closest('button[data-code]');
  if (button) applyMark(button.dataset.code, button.dataset.name);
});
element('preview').addEventListener('click', event => {
  const shape = event.target.closest('path[data-city]');
  if (shape) {
    const code = shape.dataset.city;
    const city = provinces.flatMap(province => province.cities).find(item => item.code === code);
    applyMark(code, city ? city.name : code);
    return;
  }
  const provinceShape = event.target.closest('path[data-prov]');
  if (provinceShape) applyProvinceMark(provinceShape.dataset.prov);
});
element('map-mode').addEventListener('click', event => {
  const button = event.target.closest('button[data-mode]');
  if (!button || button.dataset.mode === mapMode) return;
  mapMode = button.dataset.mode;
  syncModeToggle();
  renderPreview();
});
element('title').addEventListener('input', () => {
  state.title = Array.from(element('title').value).slice(0, 28).join('');
  renderPreview();
  save();
});
element('clear').addEventListener('click', () => {
  if (!Object.keys(state.selections).length) {
    announce('当前还没有标记的足迹。');
    return;
  }
  if (!window.confirm('清空所有已标记的城市？此操作无法撤销，建议先下载图片留存。')) return;
  state.selections = {};
  for (const button of element('cities').querySelectorAll('button[data-code]')) syncCityButton(button.dataset.code);
  renderSummary();
  renderPreview();
  announce('所有足迹已清空，图片标题保持不变。');
  save();
});
element('download').addEventListener('click', downloadImage);
element('retry').addEventListener('click', initialize);

async function initialize() {
  element('retry').hidden = true;
  announce('正在载入地图数据…');
  try {
    const [regionResponse, topologyResponse] = await Promise.all([
      fetch(new URL('../data/regions.json?v=20260918a', import.meta.url)),
      fetch(new URL('../data/china.json?v=20260918a', import.meta.url))
    ]);
    if (!regionResponse.ok) throw new Error(`regions: HTTP ${regionResponse.status}`);
    if (!topologyResponse.ok) throw new Error(`map: HTTP ${topologyResponse.status}`);
    provinces = (await regionResponse.json()).provinces;
    topology = await topologyResponse.json();
    let saved = null;
    let storageWarning = false;
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      saved = value ? JSON.parse(value) : null;
    } catch {
      storageWarning = true;
    }
    state = normalizeState(saved, provinces);
    element('title').value = state.title;
    element('province').replaceChildren(...provinces.map(province => new Option(province.name, province.code)));
    renderPalette();
    syncModeToggle();
    renderCities();
    renderSummary();
    renderPreview();
    element('controls').disabled = false;
    element('download').disabled = false;
    if (storageWarning) {
      element('save-state').textContent = '未能读取本地记录';
      announce('本地记录无法读取，已显示空白足迹。你仍可选择城市并下载图片。', true);
    } else {
      element('save-state').textContent = saved ? '已恢复本地记录' : '修改后自动保存';
      announce('先选分类，再点地图上的城市或左侧列表；每座城市只计一次。');
    }
  } catch (error) {
    console.error('Travel data load failed', error);
    announce('地图数据加载失败，请检查网络后重试。', true);
    element('retry').hidden = false;
  }
}

initialize();
