/* =========================================================
 * 跑团桌 · 数据层 (data.js)
 * 主源: dnd5eapi.co (5e SRD REST API)
 * 策略: 按需拉取 → localStorage 永久缓存 → 多源回退
 * ========================================================= */
(function (global) {
  'use strict';

  var DnD = global.DnD = global.DnD || {};

  var BASES = [
    'https://www.dnd5eapi.co/api',
    'https://www.dnd5eapi.co/api/v2014'
  ];
  var CACHE_PREFIX = 'dnd_cache_';
  var CACHE_VER = 1;
  var TIMEOUT = 8000;

  /* ---------- 缓存 ---------- */
  function cacheGet(key) {
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || obj.v !== CACHE_VER) return null;
      return obj.data;
    } catch (e) { return null; }
  }

  function cacheSet(key, data) {
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
        v: CACHE_VER, t: Date.now(), data: data
      }));
    } catch (e) { /* 存储满时静默失败 */ }
  }

  /* ---------- 网络请求（带超时） ---------- */
  function fetchJSON(path, base) {
    return new Promise(function (resolve, reject) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
        reject(new Error('请求超时'));
      }, TIMEOUT);
      fetch(base + path, ctrl ? { signal: ctrl.signal } : {})
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) { clearTimeout(timer); resolve(data); })
        .catch(function (err) { clearTimeout(timer); reject(err); });
    });
  }

  /* 缓存优先，多源回退 */
  function get(path) {
    var cached = cacheGet(path);
    if (cached) return Promise.resolve(cached);
    var chain = Promise.reject(new Error('start'));
    BASES.forEach(function (base) {
      chain = chain.catch(function () { return fetchJSON(path, base); });
    });
    return chain.then(function (data) {
      cacheSet(path, data);
      return data;
    });
  }

  /* ---------- 资源 API ---------- */
  function getList(endpoint) {
    return get('/' + endpoint).then(function (doc) {
      return doc.results || [];
    });
  }

  var Data = {
    get: get,

    getRaces: function () { return getList('races'); },
    getRace: function (index) { return get('/races/' + index); },

    getClasses: function () { return getList('classes'); },
    getClass: function (index) { return get('/classes/' + index); },

    getAbilityScores: function () { return getList('ability-scores'); },
    getSkills: function () { return getList('skills'); },

    getMonsters: function () { return getList('monsters'); },
    getMonster: function (index) { return get('/monsters/' + index); },

    getSpells: function () { return getList('spells'); },
    getSpell: function (index) { return get('/spells/' + index); },

    /* 本地模糊搜索怪物（基于已缓存索引） */
    searchMonsters: function (keyword) {
      var kw = String(keyword || '').trim().toLowerCase();
      if (!kw) return Promise.resolve([]);
      return Data.getMonsters().then(function (list) {
        return list.filter(function (m) {
          return m.name.toLowerCase().indexOf(kw) !== -1;
        });
      });
    },

    /* 按 url 相对路径取详情（怪物列表项的 url 形如 /api/monsters/xxx） */
    fromUrl: function (url) {
      var m = String(url || '').match(/\/api\/(?:v\d+\/)?([a-z-]+)\/([a-z0-9-]+)\/?$/);
      if (!m) return Promise.reject(new Error('无效 url: ' + url));
      return get('/' + m[1] + '/' + m[2]);
    },

    clearCache: function () {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(CACHE_PREFIX) === 0) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
    }
  };

  DnD.Data = Data;
})(window);
