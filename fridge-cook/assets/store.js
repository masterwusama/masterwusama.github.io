/**
 * store.js —— 冰箱做菜 存储抽象层
 *
 * 所有持久化统一走本模块，业务代码不直接触碰 localStorage。
 * 未来如需云同步（Supabase/Gist），只需替换本文件的读写实现。
 *
 * 存储结构（单键 JSON）：
 * {
 *   version: 1,          // schema 版本，用于迁移
 *   uid: "xxxx",         // 首次访问生成的 UUID，身份锚点
 *   fridge: [..],        // 冰箱食材清单（归一化后的标准名）
 *   urgent: [..],        // 快过期标记的食材
 *   tools: [..],         // 拥有的工具
 *   common: [..],        // 自定义常用食材
 *   history: [[..],..],  // 最近输入记录（最多 10 条）
 *   eaten: [..],         // 最近做过的菜 id（防重复推荐，最多 5 个）
 *   favorites: [..],     // 收藏菜谱 id
 *   prefs: { sort, maxTime, difficulty }
 * }
 */

(function (global) {
  'use strict';

  var KEY = 'fridge-cook:state';
  var CURRENT_VERSION = 1;

  /** 各版本迁移函数表：从旧版本升级到新版本 */
  var MIGRATIONS = {
    // 例：1 -> 2 时在此添加: 2: function (state) { state.newField = []; return state; }
  };

  var DEFAULT_STATE = function () {
    return {
      version: CURRENT_VERSION,
      uid: null,
      fridge: [],
      urgent: [],
      tools: ['灶台'],
      common: [],
      history: [],
      eaten: [],
      favorites: [],
      prefs: { sort: 'fridge', maxTime: 0, difficulty: 0 }
    };
  };

  /** 生成简单 UUID（身份锚点，无需密码学强度） */
  function genUid() {
    return 'u-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /** 深拷贝，避免外部意外修改内部状态 */
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /** 版本迁移：把旧数据逐级升级到当前版本 */
  function migrate(state) {
    var v = state.version || 1;
    while (v < CURRENT_VERSION) {
      if (MIGRATIONS[v]) {
        state = MIGRATIONS[v](state);
      }
      v += 1;
    }
    state.version = CURRENT_VERSION;
    return state;
  }

  /** 校验并修复状态结构，防止脏数据导致页面异常 */
  function sanitize(state) {
    var d = DEFAULT_STATE();
    if (!state || typeof state !== 'object') return d;
    var out = d;
    ['fridge', 'urgent', 'tools', 'common', 'history', 'eaten', 'favorites'].forEach(function (k) {
      out[k] = Array.isArray(state[k]) ? state[k].slice(0, 50) : d[k];
    });
    out.prefs = Object.assign({}, d.prefs, (state.prefs && typeof state.prefs === 'object') ? state.prefs : {});
    out.uid = typeof state.uid === 'string' ? state.uid : null;
    return out;
  }

  /** 运行时状态（内存态），localStorage 不可用时降级至此 */
  var mem = null;
  var persistent = true;

  var Store = {
    /**
     * 加载状态。localStorage 不可用（隐私模式/被禁用）时降级为内存态。
     */
    load: function () {
      try {
        var raw = global.localStorage.getItem(KEY);
        if (!raw) {
          mem = sanitize(null);
          mem.uid = genUid();
          persistent = true;
          this.save();
          return clone(mem);
        }
        var parsed = JSON.parse(raw);
        mem = sanitize(migrate(parsed));
        persistent = true;
        return clone(mem);
      } catch (e) {
        // 存储被禁用或数据损坏：降级为内存态，页面仍可用
        persistent = false;
        mem = sanitize(null);
        mem.uid = genUid();
        return clone(mem);
      }
    },

    /**
     * 保存状态（带防抖：高频操作合并写入）。
     */
    save: function (debounceMs) {
      if (!persistent) return false;
      if (debounceMs) {
        clearTimeout(this._t);
        this._t = setTimeout(function () { Store._write(); }, debounceMs);
        return true;
      }
      return this._write();
    },

    _write: function () {
      try {
        global.localStorage.setItem(KEY, JSON.stringify(mem));
        return true;
      } catch (e) {
        persistent = false;
        return false;
      }
    },

    /** 获取内存态（只读使用，修改后须调用 save） */
    state: function () {
      if (!mem) this.load();
      return mem;
    },

    /** 更新一段状态并立即保存 */
    update: function (patch, debounceMs) {
      if (!mem) this.load();
      Object.keys(patch).forEach(function (k) {
        mem[k] = patch[k];
      });
      return this.save(debounceMs);
    },

    /** 导出完整备份（含 uid，用于跨设备迁移） */
    exportJson: function () {
      if (!mem) this.load();
      return JSON.stringify(mem, null, 2);
    },

    /**
     * 导入备份。校验版本与结构后覆盖当前状态。
     * @returns {boolean} 是否成功
     */
    importJson: function (json) {
      try {
        var parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.fridge)) {
          return false;
        }
        mem = sanitize(migrate(parsed));
        return this._write();
      } catch (e) {
        return false;
      }
    },

    /** 恢复出厂：清空全部本地数据 */
    reset: function () {
      try {
        global.localStorage.removeItem(KEY);
      } catch (e) { /* ignore */ }
      mem = sanitize(null);
      mem.uid = genUid();
      persistent = true;
    },

    /** 存储是否可用（不可用时页面提示用户） */
    isPersistent: function () {
      return persistent;
    }
  };

  global.FridgeStore = Store;
})(window);
