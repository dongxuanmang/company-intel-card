// ==UserScript==
// @name         Company Intel Card（公司情报卡）
// @namespace    https://github.com/dongxuanmang/company-intel-card
// @version      0.2.0
// @description  在 BOSS 直聘公司页/职位详情页聚合公司信息、招聘信号与工商信息（BOSS 自带 15 字段）；爱企查半自动补充。只读当前页 DOM，不新增请求。非官方工具。
// @author       dongxuanmang
// @homepageURL  https://github.com/dongxuanmang/company-intel-card
// @supportURL   https://github.com/dongxuanmang/company-intel-card/issues
// @updateURL    https://raw.githubusercontent.com/dongxuanmang/company-intel-card/main/company-intel-card.user.js
// @downloadURL  https://raw.githubusercontent.com/dongxuanmang/company-intel-card/main/company-intel-card.user.js
// @match        https://www.zhipin.com/*
// @match        https://aiqicha.baidu.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        GM_setClipboard
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  if (window.__BCI_LOADED__) return;
  window.__BCI_LOADED__ = true;

  /* ============================================================
   * 0. 常量
   * ============================================================ */
  const VERSION = '0.2.0';
  const TTL_LAST_QUERY = 30 * 60 * 1000; // 半自动回填的关联有效期
  const MAX_JOBS = 2000;
  const MAX_SNAPSHOTS = 40;
  const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

  const STAGES = [
    'D轮及以上', '不需要融资', '已上市', '战略融资', '天使轮',
    'Pre-A轮', 'A+轮', 'B+轮', 'C+轮', 'A轮', 'B轮', 'C轮', 'D轮', 'E轮', '未融资'
  ];
  const INDUSTRIES = [
    '互联网', '电子商务', '人工智能', '企业服务', '金融科技', '教育培训', '医疗健康',
    '游戏', '社交网络', 'O2O', '新零售', '物流运输', '汽车交通', '房产家居', '旅游',
    '文化娱乐', '硬件', '软件服务', '大数据', '云计算', '信息安全', '生活服务',
    '广告营销', '媒体', '招聘', '咨询', '制造业', '能源', '农业', '政府/非营利机构', '其他'
  ];
  const SCALE_RE = /(少于\s*\d+\s*人|\d{1,5}\s*[-~–—至]\s*\d{1,5}\s*人|\d{1,5}\s*人以上)/;
  const ALL_LABELS = [
    '统一社会信用代码', '纳税人识别号', '法定代表人', '注册资本', '实缴资本', '注册资金',
    '成立日期', '成立时间', '核准日期', '经营状态', '所属行业', '注册地址', '经营范围',
    '参保人数', '公司类型', '企业类型', '营业期限', '登记机关', '所属地区',
    '公司名称', '企业名称', '曾用名',
    '公司规模', '规模', '融资阶段', '融资', '行业', '公司地址', '办公地址',
    '公司介绍', '公司简介', '在招职位'
  ];
  // BOSS 自带的「工商信息」字段别名 → 内部字段
  const BOSS_BIZ_ALIASES = {
    '公司名称': 'companyName',
    '企业名称': 'companyName',
    '法定代表人': 'legalPerson',
    '成立日期': 'foundedAt',
    '成立时间': 'foundedAt',
    '企业类型': 'companyType',
    '公司类型': 'companyType',
    '经营状态': 'status',
    '注册资金': 'regCapital',
    '注册资本': 'regCapital',
    '实缴资本': 'paidCapital',
    '注册地址': 'address',
    '营业期限': 'businessTerm',
    '所属地区': 'region',
    '统一社会信用代码': 'creditCode',
    '核准日期': 'approvedAt',
    '曾用名': 'formerName',
    '登记机关': 'registrationAuthority',
    '所属行业': 'industry',
    '经营范围': 'scope',
    '参保人数': 'insuredCount'
  };
  const BIZ_FIELDS = [
    ['creditCode', '统一社会信用代码'],
    ['legalPerson', '法定代表人'],
    ['regCapital', '注册资本'],
    ['paidCapital', '实缴资本'],
    ['foundedAt', '成立日期'],
    ['status', '经营状态'],
    ['insuredCount', '参保人数'],
    ['companyType', '公司类型'],
    ['businessTerm', '营业期限'],
    ['region', '所属地区'],
    ['registrationAuthority', '登记机关'],
    ['approvedAt', '核准日期'],
    ['formerName', '曾用名'],
    ['address', '注册地址'],
    ['scope', '经营范围']
  ];
  // BOSS 搜索列表把薪资数字渲染成私用区字符（PUA），字体映射：0xE031 + 数字
  const PUA_DIGIT_RE = /[\uE030-\uE03F]/g;

  const KEYS = {
    company: (key) => 'bci:company:' + key,
    jobs: 'bci:jobs',
    lastQuery: 'bci:lastQuery',
    settings: 'bci:settings'
  };

  /* ============================================================
   * 1. 基础工具
   * ============================================================ */
  function clean(s) {
    if (s == null) return '';
    return String(s).replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function cleanCompanyName(s) {
    let t = clean(s);
    if (!t) return '';
    t = t.replace(/^(公司|企业)[:：]\s*/, '');
    t = t.replace(/收藏|已关注|关注|举报|分享|复制|查看全部/g, '');
    t = t.replace(/[-_|｜]\s*(BOSS直聘|BOSS|爱企查|百度).*$/i, '');
    t = t.replace(/\s*(招聘信息|公司简介|怎么样|官网)$/g, '');
    return t.replace(/\s+/g, ' ').trim();
  }

  function normKey(name) {
    return cleanCompanyName(name).toLowerCase()
      .replace(/[\s（）()【】\[\]·•,，.。:：、\-_/\\]/g, '');
  }

  function fromTitle(title) {
    let s = clean(title);
    s = s.replace(/[-_|｜].*(BOSS直聘|爱企查|百度).*$/i, '');
    s = s.replace(/\s*(招聘信息|招聘|公司简介|怎么样|官网)$/g, '');
    return s.trim();
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function fmtDay(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function daysSince(ts) {
    if (!ts) return 0;
    return Math.floor((Date.now() - ts) / 86400000);
  }

  function ageText(ts) {
    if (!ts) return '';
    const d = daysSince(ts);
    if (d <= 0) return '今天';
    return d + ' 天前';
  }

  function intFrom(s) {
    const m = String(s || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function intFromRegex(s, re) {
    const m = String(s || '').match(re);
    return m ? parseInt(m[1], 10) : 0;
  }

  function firstNonEmpty(list) {
    for (const v of list) {
      const t = clean(v);
      if (t) return t;
    }
    return '';
  }

  const SOURCE_NAMES = { aiqicha: '爱企查', boss: 'BOSS 直聘', gsxt: 'gsxt', manual: '手动录入' };
  function sourceName(s) {
    return SOURCE_NAMES[s] || s || '';
  }

  function truncate(s, n) {
    const t = clean(s);
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }

  function debounce(fn, wait) {
    let timer = null;
    return function () {
      clearTimeout(timer);
      const args = arguments;
      timer = setTimeout(() => fn.apply(null, args), wait);
    };
  }

  /* ============================================================
   * 2. 存储层（GM_* 优先，回退 localStorage）
   * ============================================================ */
  const Store = {
    get(key, def) {
      try {
        if (typeof GM_getValue === 'function') {
          const v = GM_getValue(key);
          return v === undefined ? def : v;
        }
        const raw = window.localStorage.getItem(key);
        return raw == null ? def : JSON.parse(raw);
      } catch (e) {
        return def;
      }
    },
    set(key, value) {
      try {
        if (typeof GM_setValue === 'function') GM_setValue(key, value);
        else window.localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        console.warn('[BCI] 存储写入失败', e);
      }
    },
    del(key) {
      try {
        if (typeof GM_deleteValue === 'function') GM_deleteValue(key);
        else window.localStorage.removeItem(key);
      } catch (e) { /* noop */ }
    },
    keys(prefix) {
      try {
        if (typeof GM_listValues === 'function') {
          return GM_listValues().filter((k) => k.indexOf(prefix) === 0);
        }
        const out = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.indexOf(prefix) === 0) out.push(k);
        }
        return out;
      } catch (e) {
        return [];
      }
    }
  };

  function openTab(url) {
    try {
      if (typeof GM_openInTab === 'function') GM_openInTab(url, { active: true });
      else window.open(url, '_blank', 'noopener');
    } catch (e) {
      console.warn('[BCI] 打开标签页失败', e);
    }
  }

  function copyText(text) {
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, 'text');
        return true;
      }
    } catch (e) { /* 继续尝试回退方案 */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  function download(filename, text, mime) {
    try {
      const blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (e) {} }, 1000);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ============================================================
   * 3. 路由识别
   * ============================================================ */
  function parseRoute() {
    const host = location.hostname;
    if (/(^|\.)aiqicha\.baidu\.com$/.test(host)) {
      return { type: 'aiqicha', detail: /\/company_detail/.test(location.pathname) };
    }
    if (!/(^|\.)zhipin\.com$/.test(host)) return { type: 'other' };

    const path = location.pathname;
    let m;
    if ((m = path.match(/^\/gongsi\/job\/([^/]+)\.html/))) return { type: 'companyJobs', brandId: decodeURIComponent(m[1]) };
    if ((m = path.match(/^\/gongsi\/([^/]+)\.html/))) return { type: 'company', brandId: decodeURIComponent(m[1]) };
    if ((m = path.match(/^\/gongsir\/([^/]+)\.html/))) return { type: 'companyJobs', brandId: decodeURIComponent(m[1]) };
    if ((m = path.match(/^\/job_detail\/([^/]+)\.html/))) return { type: 'job', jobId: decodeURIComponent(m[1]) };
    if (path.indexOf('/web/geek/job') === 0) return { type: 'list' };
    return { type: 'other' };
  }

  /* ============================================================
   * 4. DOM 提取层
   * ============================================================ */
  function collectBlocks(root, limit) {
    const out = [];
    if (!root) return out;
    const max = limit || 3000;
    let walker;
    try {
      walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
        acceptNode(el) {
          const tag = el.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'SVG') {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
    } catch (e) {
      return out;
    }
    let el;
    let n = 0;
    while ((el = walker.nextNode()) && n < max) {
      if (el.children && el.children.length > 4) continue;
      const text = clean(el.textContent);
      if (!text || text.length > 120) continue;
      const cls = typeof el.className === 'string' ? el.className : '';
      out.push({ el, text, tag: el.tagName, cls });
      n++;
    }
    return out;
  }

  function looksLikeLabel(text) {
    if (!text) return false;
    if (ALL_LABELS.indexOf(text) >= 0) return true;
    if (/[：:]$/.test(text) && text.length <= 16) return true;
    return false;
  }

  // 值里混进别的字段名，说明抓到的是整块容器而不是字段值
  function containsOtherLabel(text, selfLabel) {
    const t = clean(text);
    if (!t) return false;
    for (const label of ALL_LABELS) {
      if (label === selfLabel) continue;
      if (t.indexOf(label) >= 0) return true;
    }
    return false;
  }

  function valueFromLabelEl(el, labelSet, selfLabel) {
    const accept = (s) => {
      const v = clean(s).replace(/^[\s:：]+/, '');
      if (!v || v.length > 240) return '';
      if (labelSet.has(v) || looksLikeLabel(v)) return '';
      if (containsOtherLabel(v, selfLabel)) return '';
      return v;
    };

    let sib = el.nextElementSibling;
    let guard = 0;
    while (sib && guard < 3) {
      const v = accept(sib.textContent);
      if (v) return v;
      sib = sib.nextElementSibling;
      guard++;
    }

    const p = el.parentElement;
    if (p) {
      const own = clean(el.textContent);
      const pt = clean(p.textContent);
      if (pt.length <= 320 && pt !== own) {
        const v = accept(pt.replace(own, ''));
        if (v) return v;
      }
      const pn = p.nextElementSibling;
      if (pn) {
        const v = accept(pn.textContent);
        if (v) return v;
      }
    }
    return '';
  }

  function findLabelValues(root, labels) {
    const res = {};
    const labelSet = new Set(labels);
    const blocks = collectBlocks(root);
    for (const b of blocks) {
      if (b.text.length > 90) continue;
      for (const label of labels) {
        if (res[label]) continue;
        if (b.text === label || b.text === label + '：' || b.text === label + ':') {
          const v = valueFromLabelEl(b.el, labelSet, label);
          if (v) res[label] = v;
        } else if (b.text.indexOf(label) === 0 && b.text.length <= label.length + 90) {
          const rest = clean(b.text.slice(label.length)).replace(/^[\s:：]+/, '');
          if (rest && !labelSet.has(rest) && !looksLikeLabel(rest) && !containsOtherLabel(rest, label)) {
            res[label] = rest;
          }
        }
      }
    }
    return res;
  }

  function textOf(root, selector) {
    if (!root || !root.querySelector) return '';
    try {
      const el = root.querySelector(selector);
      return el ? clean(el.textContent) : '';
    } catch (e) {
      return '';
    }
  }

  function pickRoot(selectors) {
    for (const s of selectors) {
      try {
        const el = document.querySelector(s);
        if (el) {
          const t = clean(el.textContent);
          if (t.length > 60) return el;
        }
      } catch (e) { /* 选择器非法则跳过 */ }
    }
    return document.body;
  }

  function matchEnum(text, tokens) {
    const t = clean(text);
    if (!t) return '';
    let best = '';
    for (const tok of tokens) {
      if (t.indexOf(tok) >= 0 && tok.length > best.length) best = tok;
    }
    return best;
  }

  function enumInBlocks(blocks, tokens) {
    for (const b of blocks) {
      if (tokens.indexOf(b.text) >= 0) return b.text;
    }
    return '';
  }

  function matchScale(text) {
    const m = clean(text).match(SCALE_RE);
    return m ? m[0].replace(/\s+/g, '') : '';
  }

  function matchIndustry(text) {
    return matchEnum(text, INDUSTRIES);
  }

  function textAfterLabel(root, label, maxLen) {
    const blocks = collectBlocks(root);
    for (const b of blocks) {
      if (b.text !== label) continue;
      let sib = b.el.nextElementSibling;
      let guard = 0;
      while (sib && guard < 3) {
        const t = clean(sib.textContent);
        if (t && t.length >= 8 && t.length <= (maxLen || 1500)) return t;
        sib = sib.nextElementSibling;
        guard++;
      }
      const p = b.el.parentElement;
      if (p && p.nextElementSibling) {
        const t = clean(p.nextElementSibling.textContent);
        if (t && t.length >= 8) return t.slice(0, maxLen || 1500);
      }
    }
    return '';
  }

  /* ---------- 4.0 通用：BOSS 自带工商信息 / 章节文本 / 薪资解码 ---------- */

  // BOSS 搜索列表把薪资数字渲染成 PUA 字符，字体映射为 0xE031 + 数字。
  // 解码后再做一次范围校验；不成立就保留原文，绝不猜。
  function decodeSalary(raw) {
    if (!raw) return '';
    const decoded = String(raw).replace(PUA_DIGIT_RE, (ch) => {
      const d = ch.charCodeAt(0) - 0xE031;
      return d >= 0 && d <= 9 ? String(d) : ch;
    });
    return decoded.replace(PUA_DIGIT_RE, '');
  }

  function salaryPlausible(text) {
    if (!text) return false;
    const m = text.match(/(\d{1,3})\s*[-~–]\s*(\d{1,3})\s*(K|k|元)/);
    if (!m) return false;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const limit = (m[3] === 'K' || m[3] === 'k') ? 300 : 2000;
    return a > 0 && b >= a && b <= limit;
  }

  function sectionByHeading(headingText) {
    const hs = document.querySelectorAll('h1,h2,h3,h4');
    for (const h of hs) {
      if (clean(h.textContent) !== headingText) continue;
      const sec = h.closest('.job-sec') || h.closest('.detail-section-item') || h.closest('section') || h.parentElement;
      if (sec) return { heading: h, section: sec };
    }
    return null;
  }

  function sectionTextByHeading(headingText, maxLen) {
    const hit = sectionByHeading(headingText);
    if (!hit) return '';
    let t = clean(hit.section.textContent);
    if (t.indexOf(headingText) === 0) t = t.slice(headingText.length);
    t = clean(t).replace(/展开$/, '').trim();
    return t.slice(0, maxLen || 1500);
  }

  // BOSS 自己的「工商信息」区块：公司页 15 个字段，职位页 6 个字段。
  function extractBossBusiness() {
    let box = document.querySelector('.company-business') || document.querySelector('.business-info-box');
    if (!box) {
      const hit = sectionByHeading('工商信息');
      box = hit ? hit.section : null;
    }
    if (!box) return null;

    const out = { source: 'boss', url: location.href, capturedAt: Date.now() };
    const lis = box.querySelectorAll('li');
    for (const li of lis) {
      const labelEl = li.querySelector('span.t') || li.querySelector('span');
      if (!labelEl) continue;
      const label = clean(labelEl.textContent).replace(/[：:]\s*$/, '');
      const key = BOSS_BIZ_ALIASES[label];
      if (!key) continue;
      let value = clean(li.textContent);
      const idx = value.indexOf(label);
      if (idx === 0) value = value.slice(label.length);
      else if (idx > 0) value = value.slice(idx + label.length);
      value = value.replace(/^[：:\s]+/, '').trim();
      if (!value || value === '-') continue;
      out[key] = value.slice(0, 2000);
    }
    return (out.companyName || out.creditCode || out.legalPerson) ? out : null;
  }

  function pageCompanyName() {
    const h = document.querySelector('.info-primary h1.name') || document.querySelector('.info-primary h1') || document.querySelector('h1');
    return cleanCompanyName(h ? h.textContent : '') || fromTitle(document.title);
  }

  /* ---------- 4.1 公司页 ---------- */
  function extractCompanyPage(route) {
    const hints = {};
    const headerText = clean(textOf(document, '.info-primary p'));
    const industry = clean(textOf(document, '.info-primary .industry-link')) || matchIndustry(headerText);
    const scale = matchScale(headerText) || matchScale(clean(document.body.textContent).slice(0, 8000));
    const stage = matchEnum(headerText, STAGES);
    const pageText = clean(document.body.textContent);
    const jobCount = intFromRegex(pageText, /(\d+)\s*个?在招职位/) || 0;
    const bossCount = intFromRegex(pageText, /(\d+)\s*位BOSS/) || 0;

    const intro = sectionTextByHeading('公司简介', 2000);
    const addressRaw = sectionTextByHeading('公司地址', 400) || clean(textOf(document, '.job-location'));
    const address = clean(addressRaw.split('点击查看地图')[0]).slice(0, 120);

    const business = extractBossBusiness();
    if (business && !business.industry && industry) business.industry = industry;

    const name = pageCompanyName();
    const legalName = business && business.companyName ? clean(business.companyName) : '';

    hints.name = !!name;
    hints.industry = !!industry;
    hints.scale = !!scale;
    hints.stage = !!stage;
    hints.jobCount = jobCount > 0;
    hints.business = !!business;

    return {
      page: route && route.type === 'companyJobs' ? 'companyJobs' : 'company',
      name,
      legalName,
      jobCount,
      bossCount,
      business,
      boss: { industry, scale, stage, address, intro, jobCount },
      hints,
      url: location.href
    };
  }

  /* ---------- 4.2 职位详情页 ---------- */
  function extractJobPage(route) {
    const statusEl = document.querySelector('.job-status');
    const closed = statusEl
      ? /职位已关闭|停止招聘/.test(statusEl.textContent)
      : /职位已关闭/.test(document.body.textContent);

    const title = clean(firstNonEmpty([
      textOf(document, '.job-banner .info-primary .name h1'),
      textOf(document, '.job-banner h1'),
      textOf(document, '.job-name'),
      textOf(document, 'h1')
    ]));
    const salary = clean(firstNonEmpty([
      textOf(document, '.job-banner .salary'),
      textOf(document, '.job-banner .info-primary .salary'),
      textOf(document, '.salary')
    ]));
    const city = clean(firstNonEmpty([
      textOf(document, '.job-banner .text-city'),
      textOf(document, '.job-area')
    ]));

    // 公司：从右侧公司卡里取（不要用页头 .company-info，那里是职位状态）
    let companyName = '';
    let brandId = '';
    const siderLinks = document.querySelectorAll('.sider-company a[href*="/gongsi/"]');
    for (const a of siderLinks) {
      const t = cleanCompanyName(a.getAttribute('title') || a.textContent);
      const m = (a.getAttribute('href') || '').match(/\/gongsi\/([^/.]+)\.html/);
      if (m && t) {
        companyName = t;
        brandId = decodeURIComponent(m[1]);
        break;
      }
    }
    if (!companyName) {
      companyName = cleanCompanyName(firstNonEmpty([
        textOf(document, '.sider-company .company-name'),
        textOf(document, '.company-info a[href*="/gongsi/"]')
      ]));
    }

    const siderText = clean(textOf(document, '.sider-company'));
    const business = extractBossBusiness();
    const legalName = business && business.companyName ? clean(business.companyName) : '';
    const scale = matchScale(siderText);
    const stage = matchEnum(siderText, STAGES);
    let industry = matchIndustry(siderText) || (business && business.industry) || '';
    if (!industry) {
      const rest = siderText
        .replace(/公司基本信息/g, '')
        .replace(companyName, '')
        .replace(stage, '')
        .replace(scale, '')
        .replace(/查看全部职位|查看全部|位BOSS/g, '')
        .replace(/[·•]/g, ' ')
        .trim();
      if (rest && rest.length >= 2 && rest.length <= 20 && !/\d/.test(rest)) industry = clean(rest);
    }

    return {
      page: 'job',
      company: {
        name: companyName,
        legalName,
        brandId,
        boss: { industry, scale, stage },
        business
      },
      job: {
        id: (route && route.jobId) || '',
        title,
        salary,
        city,
        companyName,
        brandId,
        status: closed ? 'closed' : 'open',
        url: location.href
      }
    };
  }

  /* ---------- 4.3 职位列表页 ---------- */
  function extractListJobs(route) {
    const isCompanyJobsPage = route && route.type === 'companyJobs';
    const pageName = isCompanyJobsPage ? pageCompanyName() : '';
    const pageBrandId = isCompanyJobsPage && route ? route.brandId : '';
    const cards = document.querySelectorAll('.job-card-box, .job-card-wrapper, .job-card');
    const jobs = [];
    for (const card of cards) {
      const link = card.querySelector('a[href*="/job_detail/"]');
      if (!link) continue;
      const m = (link.getAttribute('href') || '').match(/\/job_detail\/([^/.]+)\.html/);
      if (!m) continue;
      const id = decodeURIComponent(m[1]);

      const companyLink = card.querySelector('a[href*="/gongsi/"]');
      let brandId = pageBrandId;
      if (!brandId && companyLink) {
        const bm = (companyLink.getAttribute('href') || '').match(/\/gongsi\/([^/.]+)\.html/);
        if (bm) brandId = decodeURIComponent(bm[1]);
      }

      // 搜索列表里 .boss-name 是公司名；公司职位页里 .boss-name 是 HR，不能当公司名
      const cardCompany = cleanCompanyName(firstNonEmpty([
        textOf(card, '.boss-name'),
        textOf(card, '.company-name'),
        textOf(card, '.info-public .company-name')
      ]));
      const companyName = pageName || cardCompany;

      const title = clean(firstNonEmpty([
        textOf(card, '.job-name'),
        textOf(card, '.job-title b'),
        textOf(card, '.job-title')
      ]));
      const salaryRaw = clean(firstNonEmpty([
        textOf(card, '.job-salary'),
        textOf(card, '.salary')
      ]));
      let salary = decodeSalary(salaryRaw);
      if (!salaryPlausible(salary)) salary = salaryRaw;

      const tags = [];
      for (const li of card.querySelectorAll('.tag-list li')) {
        const t = clean(li.textContent);
        if (t) tags.push(t);
      }
      const infoText = clean(firstNonEmpty([
        textOf(card, '.info-public'),
        textOf(card, '.job-info')
      ]));

      jobs.push({
        id, title, salary, salaryRaw, companyName, brandId, tags, infoText,
        url: 'https://www.zhipin.com/job_detail/' + id + '.html'
      });
    }
    return jobs;
  }

  /* ---------- 4.4 爱企查 ---------- */
  function extractAiqicha() {
    const root = pickRoot(['.company-detail', '.company-content', '#company_detail', '.main-content', 'main', '.layout']);
    const lv = findLabelValues(root, ALL_LABELS);
    const rawText = clean(root.textContent).slice(0, 30000);

    const name = cleanCompanyName(firstNonEmpty([
      textOf(root, 'h1'),
      textOf(root, '.company-name'),
      textOf(root, '[class*="company-name"]'),
      fromTitle(document.title)
    ]));

    const biz = {
      source: 'aiqicha',
      url: location.href,
      companyName: name,
      creditCode: lv['统一社会信用代码'] || lv['纳税人识别号'] || '',
      legalPerson: lv['法定代表人'] || '',
      regCapital: lv['注册资本'] || '',
      paidCapital: lv['实缴资本'] || '',
      foundedAt: lv['成立日期'] || '',
      status: lv['经营状态'] || '',
      insuredCount: lv['参保人数'] || '',
      companyType: lv['公司类型'] || '',
      industry: lv['所属行业'] || '',
      address: lv['注册地址'] || '',
      scope: lv['经营范围'] || '',
      risks: {
        own: intFromRegex(rawText, /自身风险\s*(\d+)/),
        related: intFromRegex(rawText, /关联风险\s*(\d+)/),
        cases: intFromRegex(rawText, /司法案件\s*(\d+)/)
      },
      capturedAt: Date.now()
    };
    biz.fieldCount = BIZ_FIELDS.filter((f) => !!biz[f[0]]).length;
    return biz;
  }

  /* ============================================================
   * 5. 数据记录
   * ============================================================ */
  function loadCompany(key) {
    return Store.get(KEYS.company(key), null);
  }

  function resolveCompanyKey(route, name) {
    if (route && route.brandId) {
      const bk = 'b:' + route.brandId;
      const nk = name ? 'n:' + normKey(name) : '';
      if (nk) {
        const byName = loadCompany(nk);
        if (byName) {
          byName.key = bk;
          if (!byName.brandId) byName.brandId = route.brandId;
          Store.set(KEYS.company(bk), byName);
          Store.del(KEYS.company(nk));
        }
      }
      return bk;
    }
    return name ? 'n:' + normKey(name) : '';
  }

  function dropEmpty(obj) {
    const out = {};
    for (const k of Object.keys(obj || {})) {
      if (obj[k] !== '' && obj[k] != null) out[k] = obj[k];
    }
    return out;
  }

  function pushSnapshot(company, jobCount) {
    if (!jobCount || jobCount <= 0) return;
    const snaps = Array.isArray(company.snapshots) ? company.snapshots : [];
    const last = snaps[snaps.length - 1];
    const now = Date.now();
    if (!last || last.jobCount !== jobCount || now - last.ts > 6 * 3600 * 1000) {
      snaps.push({ ts: now, jobCount });
      company.snapshots = snaps.slice(-MAX_SNAPSHOTS);
    } else {
      company.snapshots = snaps;
    }
  }

  function mergeBusiness(oldBiz, newBiz) {
    if (!newBiz) return oldBiz || null;
    if (!oldBiz) return newBiz;
    const out = Object.assign({}, oldBiz);
    for (const k of Object.keys(newBiz)) {
      const v = newBiz[k];
      if (k === 'capturedAt' || k === 'url' || k === 'source') continue;
      if (v == null || v === '') continue;
      if (k === 'companyName') {
        if (!out.companyName || out.companyName.length < v.length) out.companyName = v;
        continue;
      }
      if (!out[k] || out[k] === '-') out[k] = v;
    }
    out.source = 'boss';
    out.capturedAt = Date.now();
    out.url = newBiz.url || out.url;
    return out;
  }

  function saveCompany(route, data) {
    const name = data.name || (data.company && data.company.name) || '';
    const brandId = (route && route.brandId) || data.brandId || (data.company && data.company.brandId) || '';
    const key = resolveCompanyKey({ brandId }, name);
    if (!key) return null;

    const old = loadCompany(key) || {
      key, name, boss: {}, snapshots: [], firstSeenAt: Date.now()
    };
    if (name) old.name = name;
    old.key = key;
    if (brandId) old.brandId = brandId;
    old.boss = Object.assign({}, old.boss || {}, dropEmpty((data.company && data.company.boss) || data.boss || {}));

    const legalName = data.legalName || (data.company && data.company.legalName) || '';
    if (legalName) old.legalName = legalName;
    if (data.bossCount) old.bossCount = data.bossCount;

    const incomingBiz = data.business || (data.company && data.company.business) || null;
    if (incomingBiz) old.business = mergeBusiness(old.business, incomingBiz);

    old.sourceUrl = location.href;
    old.bossCapturedAt = Date.now();
    old.lastSeenAt = Date.now();
    if (!old.firstSeenAt) old.firstSeenAt = Date.now();
    if (data.jobCount) pushSnapshot(old, data.jobCount);

    Store.set(KEYS.company(key), old);
    return old;
  }

  function loadJobs() {
    return Store.get(KEYS.jobs, {}) || {};
  }

  let lastJobsWrite = 0;
  function recordJobs(jobs) {
    if (!jobs || !jobs.length) return 0;
    const db = loadJobs();
    const now = Date.now();
    let added = 0;
    for (const j of jobs) {
      if (!j.id) continue;
      if (!db[j.id]) {
        db[j.id] = {
          id: j.id,
          title: j.title || '',
          companyName: j.companyName || '',
          brandId: j.brandId || '',
          salary: j.salary || '',
          firstSeenAt: now,
          lastSeenAt: now
        };
        added++;
      } else {
        db[j.id].lastSeenAt = now;
        if (!db[j.id].title && j.title) db[j.id].title = j.title;
      }
    }

    const ids = Object.keys(db);
    if (ids.length > MAX_JOBS) {
      ids.sort((a, b) => (db[a].lastSeenAt || 0) - (db[b].lastSeenAt || 0));
      const remove = ids.length - MAX_JOBS;
      for (let i = 0; i < remove; i++) delete db[ids[i]];
    }

    if (added > 0 || now - lastJobsWrite > 5 * 60 * 1000) {
      Store.set(KEYS.jobs, db);
      lastJobsWrite = now;
    }
    return added;
  }

  function recordJobVisit(job) {
    if (!job || !job.id) return null;
    const db = loadJobs();
    const now = Date.now();
    if (!db[job.id]) {
      db[job.id] = {
        id: job.id,
        title: job.title || '',
        companyName: job.companyName || '',
        brandId: job.brandId || '',
        salary: job.salary || '',
        city: job.city || '',
        status: job.status || 'open',
        firstSeenAt: now,
        lastSeenAt: now
      };
      Store.set(KEYS.jobs, db);
    } else {
      db[job.id].lastSeenAt = now;
      if (!db[job.id].title && job.title) db[job.id].title = job.title;
      if (!db[job.id].companyName && job.companyName) db[job.id].companyName = job.companyName;
      if (job.status) db[job.id].status = job.status;
      Store.set(KEYS.jobs, db);
    }
    return db[job.id];
  }

  /* ============================================================
   * 6. UI
   * ============================================================ */
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .bci, .bci * { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
    .bci { color: #111827; font-size: 13px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
    .card { width: 356px; max-height: 74vh; display: flex; flex-direction: column; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 10px 32px rgba(0,0,0,.18); overflow: hidden; }
    .card.mini { width: 210px; }
    .hd { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #111827; color: #fff; cursor: default; }
    .hd .brand { font-size: 11px; font-weight: 700; letter-spacing: .4px; color: #93c5fd; flex: none; }
    .hd .name { flex: 1; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hd button { width: 22px; height: 22px; border: 0; border-radius: 5px; background: rgba(255,255,255,.12); color: #fff; cursor: pointer; font-size: 14px; line-height: 1; flex: none; }
    .hd button:hover { background: rgba(255,255,255,.24); }
    .bd { padding: 10px 12px; overflow-y: auto; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .chip { padding: 2px 8px; border-radius: 999px; background: #eff6ff; color: #1d4ed8; font-size: 11px; white-space: nowrap; }
    .chip.gray { background: #f3f4f6; color: #4b5563; }
    .row { display: flex; gap: 8px; padding: 3px 0; border-bottom: 1px dashed #f3f4f6; }
    .row:last-child { border-bottom: 0; }
    .row .k { flex: 0 0 74px; color: #6b7280; }
    .row .v { flex: 1; min-width: 0; word-break: break-all; }
    .sec { margin-top: 10px; padding-top: 8px; border-top: 1px solid #f3f4f6; }
    .sec-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .sec-hd b { font-size: 12px; color: #374151; }
    .tag { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: #f3f4f6; color: #6b7280; }
    .tag.ok { background: #ecfdf5; color: #059669; }
    .tag.warn { background: #fef2f2; color: #dc2626; }
    .muted { color: #9ca3af; font-size: 12px; }
    .intro { margin: 6px 0 2px; color: #4b5563; font-size: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .jobline { margin-bottom: 6px; padding: 6px 8px; background: #f9fafb; border-radius: 6px; font-size: 12px; }
    .jobline .t { font-weight: 600; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .actions button { padding: 5px 9px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; color: #374151; font-size: 12px; cursor: pointer; }
    .actions button:hover { background: #f9fafb; }
    .actions button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
    .actions button.primary:hover { background: #1d4ed8; }
    .foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 7px 12px; border-top: 1px solid #f3f4f6; background: #fafafa; }
    .foot .src { font-size: 10px; color: #9ca3af; }
    .foot .links { display: flex; gap: 4px; }
    .foot button { border: 0; background: transparent; color: #6b7280; font-size: 11px; cursor: pointer; padding: 2px 4px; }
    .foot button:hover { color: #2563eb; }
    .debug { margin: 8px 0 0; padding: 8px; background: #0b1020; color: #d1e8ff; border-radius: 6px; font: 10px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-all; max-height: 220px; overflow: auto; }
    .toast { position: fixed; left: 50%; bottom: 90px; transform: translateX(-50%); background: rgba(17,24,39,.94); color: #fff; padding: 8px 14px; border-radius: 8px; font-size: 12px; z-index: 2147483647; max-width: 70vw; }
    .pill { display: flex; align-items: center; gap: 8px; padding: 7px 12px; background: #111827; color: #fff; border-radius: 999px; font-size: 12px; box-shadow: 0 6px 20px rgba(0,0,0,.2); }
    .pill b { color: #93c5fd; }
    .pill .hint { color: #9ca3af; font-size: 10px; }
    .pill button { border: 0; background: rgba(255,255,255,.14); color: #e5e7eb; border-radius: 999px; padding: 2px 9px; font-size: 11px; cursor: pointer; }
    .pill button:hover { background: rgba(255,255,255,.28); }
    .bar { width: min(600px, 92vw); background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 12px 36px rgba(0,0,0,.22); overflow: hidden; }
    .bar .bh { display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: #111827; color: #fff; font-size: 12px; }
    .bar .bh b { color: #93c5fd; font-size: 11px; }
    .bar .bb { padding: 10px 12px; display: flex; align-items: center; gap: 10px; }
    .bar .bb .txt { flex: 1; font-size: 12px; color: #374151; }
    .bar .bb .txt b { color: #111827; }
    .bar button { padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; font-size: 12px; cursor: pointer; }
    .bar button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
    .kv { display: grid; grid-template-columns: 96px 1fr; gap: 2px 8px; font-size: 12px; }
    .kv .k { color: #6b7280; }
    .kv .v { word-break: break-all; }
  `;

  let hostEl = null;
  let shadow = null;
  let toastTimer = null;
  let currentCtx = null;
  let busy = false;
  let debugOpen = false;
  let pillHidden = false;
  let closedHref = '';
  const watchedKeys = new Set();

  function ensureHost(mode) {
    if (!hostEl || !document.documentElement.contains(hostEl)) {
      hostEl = document.createElement('div');
      hostEl.id = 'bci-host';
      document.documentElement.appendChild(hostEl);
      shadow = hostEl.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = CSS;
      shadow.appendChild(style);
      const root = document.createElement('div');
      root.id = 'bci-root';
      root.className = 'bci';
      shadow.appendChild(root);
      shadow.addEventListener('click', onShadowClick);
    }
    hostEl.style.display = 'block';
    if (mode === 'pill') {
      hostEl.style.cssText = 'all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483646;';
    } else if (mode === 'bar') {
      hostEl.style.cssText = 'all:initial;position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483646;';
    } else {
      hostEl.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483646;';
    }
    return shadow.getElementById('bci-root');
  }

  function hideHost() {
    if (hostEl) hostEl.style.display = 'none';
  }

  function rootEl() {
    return shadow ? shadow.getElementById('bci-root') : null;
  }

  function toast(msg) {
    if (!shadow) return;
    let el = shadow.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      shadow.appendChild(el);
    }
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { try { el.remove(); } catch (e) {} }, 2600);
  }

  function chip(text, cls) {
    return text ? `<span class="chip ${cls || ''}">${esc(text)}</span>` : '';
  }

  function row(k, v) {
    return v ? `<div class="row"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>` : '';
  }

  function trendText(snapshots) {
    if (!Array.isArray(snapshots) || snapshots.length < 2) return '';
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const delta = last.jobCount - first.jobCount;
    const days = Math.max(1, Math.round((last.ts - first.ts) / 86400000));
    const sign = delta > 0 ? '+' + delta : String(delta);
    return `${days} 天 ${sign}`;
  }

  function renderCard(ctx) {
    ensureHost('card');
    const root = rootEl();
    if (!root) return;
    if (closedHref === location.href) { hideHost(); return; }

    const company = ctx.company || {};
    const b = company.boss || {};
    const bt = company.business || null;
    const en = company.enrich || null;
    const biz = bt || en || null;
    const bizVal = (k) => (bt && bt[k]) || (en && en[k]) || '';
    const job = ctx.job || null;
    const isJobPage = ctx.route.type === 'job';

    const chips = [
      chip(b.industry), chip(b.scale), chip(b.stage)
    ].filter(Boolean).join('');

    const signalRows = [];
    if (b.jobCount) {
      const trend = trendText(company.snapshots);
      signalRows.push(row('在招职位', String(b.jobCount) + (trend ? `（${trend}）` : '')));
    }
    if (company.firstSeenAt) signalRows.push(row('首次记录', `${fmtDay(company.firstSeenAt)}（${ageText(company.firstSeenAt)}）`));
    if (isJobPage && job) {
      if (job.firstSeenAt) signalRows.push(row('该职位', `首次见到：${ageText(job.firstSeenAt)}`));
    }

    const bizSrc = bt && bt.source === 'boss'
      ? 'BOSS 工商' + (en ? ' + 爱企查补充' : '')
      : (en ? sourceName(en.source) + ' 补充' : '');
    const bizHtml = biz
      ? `<div class="sec">
           <div class="sec-hd"><b>工商信息</b><span class="tag ok">已采集 · ${esc(bizSrc)}</span></div>
           ${row('企业全称', bizVal('companyName') || company.legalName)}
           ${row('信用代码', bizVal('creditCode'))}
           ${row('法定代表人', bizVal('legalPerson'))}
           ${row('注册资本', bizVal('regCapital'))}
           ${row('成立日期', bizVal('foundedAt'))}
           ${row('经营状态', bizVal('status'))}
           ${row('参保人数', bizVal('insuredCount'))}
           ${row('公司类型', bizVal('companyType'))}
           ${row('注册地址', bizVal('address'))}
           ${row('经营范围', truncate(bizVal('scope'), 120))}
           ${en && en.risks && (en.risks.own || en.risks.related)
             ? `<div class="row"><div class="k">风险</div><div class="v">自身 ${en.risks.own || 0} · 关联 ${en.risks.related || 0}${en.risks.cases ? ' · 司法案件 ' + en.risks.cases : ''}</div></div>`
             : ''}
           ${row('采集时间', fmtDate((bt && bt.capturedAt) || (en && en.capturedAt)))}
         </div>`
      : `<div class="sec">
           <div class="sec-hd"><b>工商信息</b><span class="tag">未采集</span></div>
           <div class="muted">当前页未识别到工商区块。进公司页或职位详情页通常能直接读到 BOSS 自带工商信息；列表页没有。</div>
         </div>`;

    const jobLine = isJobPage && job
      ? `<div class="jobline"><div class="t">${esc(job.title || '当前职位')}${job.status === 'closed' ? ' <span class="tag warn">已关闭</span>' : ''}</div><div class="muted">${esc([job.salary, job.city].filter(Boolean).join(' · ') || '—')}</div></div>`
      : '';

    const introHtml = b.intro
      ? `<div class="intro" title="${esc(b.intro)}">${esc(truncate(b.intro, 120))}</div>`
      : '';
    const bossCountChip = company.bossCount ? chip(`${company.bossCount} 位 BOSS`, 'gray') : '';

    const debugHtml = debugOpen
      ? `<pre class="debug">${esc(JSON.stringify({ route: ctx.route, hints: ctx.hints || (ctx.extraction && ctx.extraction.hints) || {}, company, job: ctx.job || null, url: location.href }, null, 2))}</pre>`
      : '';

    root.innerHTML = `
      <div class="card ${debugOpen ? '' : ''}">
        <div class="hd">
          <span class="brand">情报卡</span>
          <span class="name" title="${esc(company.name || '未识别公司名')}">${esc(company.name || '未识别公司名')}</span>
          <button data-act="min" title="折叠">–</button>
          <button data-act="close" title="关闭">×</button>
        </div>
        <div class="bd">
          ${jobLine}
          ${chips || bossCountChip ? `<div class="chips">${chips}${bossCountChip}</div>` : ''}
          ${b.address ? row('公司地址', b.address) : ''}
          ${introHtml}
          ${!b.industry && !b.scale && !b.stage && !b.address ? '<div class="muted">未从当前页识别到公司字段。页面改版时请点「调试」复制结构反馈。</div>' : ''}
          <div class="actions">
            <button class="primary" data-act="aiqicha">查工商（爱企查）</button>
            <button data-act="gsxt">gsxt</button>
            <button data-act="tyc">天眼查</button>
            <button data-act="xhs">口碑搜索</button>
          </div>
          ${signalRows.length ? `<div class="sec"><div class="sec-hd"><b>招聘信号</b><span class="tag">本地记录</span></div>${signalRows.join('')}</div>` : ''}
          ${bizHtml}
          ${debugHtml}
        </div>
        <div class="foot">
          <span class="src">数据仅本地 · v${VERSION}</span>
          <span class="links">
            <button data-act="export">导出 MD</button>
            <button data-act="debug">调试</button>
            <button data-act="clear">清空</button>
          </span>
        </div>
      </div>`;
  }

  function renderPill(visible, added, total) {
    if (pillHidden) { hideHost(); return; }
    ensureHost('pill');
    const root = rootEl();
    if (!root) return;
    root.innerHTML = `
      <div class="pill">
        <span>已记录 <b>${total || 0}</b> 个职位</span>
        <span class="hint">本页 ${visible || 0}${added ? ' · 新增 ' + added : ''}</span>
        <button data-act="export-jobs" title="导出已记录的职位 JSON">导出</button>
        <button data-act="close-pill" title="隐藏提示">×</button>
      </div>`;
  }

  function renderAiqichaBar(lq, captured) {
    ensureHost('bar');
    const root = rootEl();
    if (!root) return;
    const target = lq && Date.now() - lq.ts < TTL_LAST_QUERY ? lq : null;

    let body;
    if (captured) {
      body = `<div class="bb">
        <div class="txt">已回填到 <b>${esc(captured.targetName || '')}</b>：识别 ${captured.fieldCount || 0} 个字段${captured.creditCode ? '，信用代码 ' + esc(captured.creditCode) : ''}。回到 BOSS 标签页即可查看。</div>
      </div>`;
    } else if (target && parseRoute().detail) {
      body = `<div class="bb">
        <div class="txt">BOSS 情报卡：把本页工商信息回填到 <b>${esc(target.name || '')}</b></div>
        <button class="primary" data-act="capture">采集并回填</button>
      </div>`;
    } else if (target) {
      body = `<div class="bb">
        <div class="txt">目标公司（来自 BOSS）：<b>${esc(target.name || '')}</b>。请点进目标公司的详情页，右下角会出现「采集并回填」。</div>
      </div>`;
    } else {
      body = `<div class="bb">
        <div class="txt">从 BOSS 点「查工商」过来时，这里会自动出现采集按钮。当前没有待回填的目标。</div>
      </div>`;
    }

    root.innerHTML = `
      <div class="bar">
        <div class="bh"><b>BOSS 情报卡</b><span>爱企查半自动采集</span></div>
        ${body}
      </div>`;
  }

  function renderError(err) {
    ensureHost('card');
    const root = rootEl();
    if (!root) return;
    root.innerHTML = `
      <div class="card">
        <div class="hd"><span class="brand">情报卡</span><span class="name">脚本出错</span>
          <button data-act="debug">?</button><button data-act="close">×</button></div>
        <div class="bd"><div class="muted">${esc(String(err && err.message || err))}</div></div>
      </div>`;
  }

  /* ============================================================
   * 7. 行为
   * ============================================================ */
  function currentCompanyName() {
    return (currentCtx && currentCtx.company && currentCtx.company.name) || '';
  }

  function buildMarkdown() {
    const ctx = currentCtx;
    if (!ctx) return '';
    const c = ctx.company || {};
    const b = c.boss || {};
    const bt = c.business || null;
    const en = c.enrich || null;
    const val = (k) => (bt && bt[k]) || (en && en[k]) || '';
    const job = ctx.job || null;
    const lines = [];
    lines.push(`# ${c.name || '未识别公司名'}`);
    lines.push('');
    if (c.legalName && c.legalName !== c.name) lines.push(`> 企业全称：${c.legalName}`);
    const srcNote = (bt && bt.source === 'boss' ? '｜工商：BOSS 直聘' : '') + (en ? '｜补充：' + sourceName(en.source) : '');
    lines.push(`> 采集：${fmtDate(Date.now())}｜主来源：BOSS 直聘${srcNote}`);
    lines.push('> 本卡为公司信息聚合，字段来源见文末；仅供参考，投递前请自行核实。');
    lines.push('');
    lines.push('## 基本信息');
    lines.push('');
    if (b.industry) lines.push(`- 行业：${b.industry}`);
    if (b.scale) lines.push(`- 规模：${b.scale}`);
    if (b.stage) lines.push(`- 融资阶段：${b.stage}`);
    if (b.jobCount) lines.push(`- 在招职位：${b.jobCount}`);
    if (c.bossCount) lines.push(`- 招聘者：${c.bossCount} 位 BOSS`);
    if (b.address) lines.push(`- 公司地址：${b.address}`);
    if (b.intro) lines.push(`- 公司简介：${truncate(b.intro, 400)}`);
    if (c.sourceUrl) lines.push(`- BOSS 页面：${c.sourceUrl}`);
    if (job) {
      lines.push('');
      lines.push('## 当前职位');
      lines.push('');
      lines.push(`- 职位：${job.title || ''}`);
      if (job.salary) lines.push(`- 薪资：${job.salary}`);
      if (job.city) lines.push(`- 城市：${job.city}`);
      if (job.status === 'closed') lines.push('- 状态：已关闭 / 停止招聘');
      if (job.firstSeenAt) lines.push(`- 首次见到：${fmtDay(job.firstSeenAt)}（${ageText(job.firstSeenAt)}）`);
      if (job.url) lines.push(`- 链接：${job.url}`);
    }
    lines.push('');
    lines.push('## 招聘信号');
    lines.push('');
    if (c.firstSeenAt) lines.push(`- 首次记录：${fmtDay(c.firstSeenAt)}（${ageText(c.firstSeenAt)}）`);
    if (Array.isArray(c.snapshots) && c.snapshots.length > 1) {
      lines.push(`- 在招数变化：${trendText(c.snapshots)}`);
    }
    lines.push('');
    lines.push('## 工商信息');
    lines.push('');
    if (bt || en) {
      for (const pair of BIZ_FIELDS) {
        const v = val(pair[0]);
        if (v) lines.push(`- ${pair[1]}：${v}`);
      }
      if (en && en.risks) {
        lines.push(`- 风险：自身 ${en.risks.own || 0} · 关联 ${en.risks.related || 0}${en.risks.cases ? ' · 司法案件 ' + en.risks.cases : ''}`);
      }
      if (bt && bt.url) lines.push(`- BOSS 工商区块：${bt.url}（${fmtDate(bt.capturedAt)}）`);
      if (en && en.url) lines.push(`- 爱企查补充：${en.url}（${fmtDate(en.capturedAt)}）`);
    } else {
      lines.push('- 未采集（进公司页/职位详情页可自动读取；爱企查可补充参保人数与风险）');
    }
    lines.push('');
    lines.push('## 备注');
    lines.push('');
    lines.push('- ');
    return lines.join('\n');
  }

  function exportMarkdown() {
    const md = buildMarkdown();
    if (!md) return toast('还没有可导出的数据');
    const ok = copyText(md);
    toast(ok ? 'Markdown 已复制到剪贴板' : '复制失败，请检查浏览器权限');
  }

  function exportJobs() {
    const db = loadJobs();
    const count = Object.keys(db).length;
    if (!count) return toast('还没有记录到职位');
    const ok = download(`boss-jobs-${fmtDay(Date.now())}.json`, JSON.stringify(db, null, 2));
    toast(ok ? `已导出 ${count} 条职位 JSON` : '导出失败');
  }

  function debugCopy() {
    const payload = {
      version: VERSION,
      href: location.href,
      route: currentCtx ? currentCtx.route : parseRoute(),
      hints: (currentCtx && (currentCtx.hints || (currentCtx.extraction && currentCtx.extraction.hints))) || {},
      company: currentCtx ? currentCtx.company : null,
      job: currentCtx ? currentCtx.job : null,
      blocks: collectBlocks(pickRoot(['.company-detail', '.company-content', 'main']))
        .slice(0, 120)
        .map((b) => ({ tag: b.tag, cls: b.cls, text: b.text }))
    };
    const ok = copyText(JSON.stringify(payload, null, 2));
    toast(ok ? '调试信息已复制（含页面文本块）' : '复制失败');
  }

  function clearCompany() {
    const key = currentCtx && currentCtx.company && currentCtx.company.key;
    if (!key) return toast('没有可清空的公司记录');
    if (!window.confirm('清空这家公司的本地记录？（职位记录和其他公司不受影响）')) return;
    Store.del(KEYS.company(key));
    currentCtx.company = { key, name: currentCtx.company.name, boss: {}, snapshots: [] };
    renderCard(currentCtx);
    toast('已清空');
  }

  function startLookup(kind) {
    const name = currentCompanyName();
    if (!name) return toast('未识别到公司名，先点「调试」看页面结构');
    if (currentCtx && currentCtx.company && currentCtx.company.key) {
      Store.set(KEYS.lastQuery, {
        key: currentCtx.company.key,
        name,
        ts: Date.now()
      });
    }
    if (kind === 'aiqicha') {
      openTab('https://aiqicha.baidu.com/s?q=' + encodeURIComponent(name));
      toast('已打开爱企查，进入公司详情页点「采集并回填」');
    } else if (kind === 'gsxt') {
      copyText(name);
      openTab('https://www.gsxt.gov.cn/index.html');
      toast('公司名已复制，gsxt 需手动过验证码');
    } else if (kind === 'tyc') {
      openTab('https://www.tianyancha.com/search?key=' + encodeURIComponent(name));
    } else if (kind === 'xhs') {
      openTab('https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(name + ' 公司 避坑'));
    }
  }

  function captureAiqicha() {
    const biz = extractAiqicha();
    if (!biz.companyName) return toast('未识别到公司名，请确认已进入爱企查公司详情页');
    const lq = Store.get(KEYS.lastQuery, null);
    const fresh = lq && Date.now() - lq.ts < TTL_LAST_QUERY;
    const name = fresh && lq.name ? lq.name : biz.companyName;
    const key = fresh && lq.key ? lq.key : 'n:' + normKey(biz.companyName);

    let comp = loadCompany(key) || { key, name, boss: {}, snapshots: [], firstSeenAt: Date.now() };
    if (!comp.name) comp.name = name;
    biz.manual = true;
    // v0.1 把爱企查数据放在 business 里，v0.2 起 BOSS 自带工商信息，爱企查只做「补充」
    if (comp.business && comp.business.source === 'aiqicha' && !comp.enrich) {
      comp.enrich = comp.business;
      comp.business = null;
    }
    comp.enrich = biz;
    comp.lastSeenAt = Date.now();
    Store.set(KEYS.company(key), comp);

    if (fresh) Store.set(KEYS.lastQuery, Object.assign({}, lq, { capturedAt: Date.now() }));

    renderAiqichaBar(fresh ? lq : null, Object.assign({}, biz, { targetName: name }));
    toast(`已回填「${name}」：${biz.fieldCount} 个字段`);
  }

  function onShadowClick(e) {
    const btn = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    switch (act) {
      case 'min': {
        const card = shadow.querySelector('.card');
        if (card) card.classList.toggle('mini');
        break;
      }
      case 'close':
        closedHref = location.href;
        hideHost();
        break;
      case 'aiqicha': startLookup('aiqicha'); break;
      case 'gsxt': startLookup('gsxt'); break;
      case 'tyc': startLookup('tyc'); break;
      case 'xhs': startLookup('xhs'); break;
      case 'capture': captureAiqicha(); break;
      case 'export': exportMarkdown(); break;
      case 'export-jobs': exportJobs(); break;
      case 'close-pill':
        pillHidden = true;
        hideHost();
        break;
      case 'debug':
        debugOpen = !debugOpen;
        if (currentCtx && currentCtx.route && (currentCtx.route.type === 'company' || currentCtx.route.type === 'job' || currentCtx.route.type === 'companyJobs')) {
          renderCard(currentCtx);
        } else {
          debugCopy();
        }
        break;
      case 'clear': clearCompany(); break;
      default: break;
    }
  }

  /* ============================================================
   * 8. 采集编排
   * ============================================================ */
  function collect(route) {
    if (route.type === 'company' || route.type === 'companyJobs') {
      const data = extractCompanyPage(route);
      let jobCount = data.jobCount;
      let jobs = [];
      if (route.type === 'companyJobs') {
        jobs = extractListJobs(route);
        if (jobs.length) jobCount = jobs.length;
      }
      const company = saveCompany(route, {
        name: data.name,
        legalName: data.legalName,
        bossCount: data.bossCount,
        business: data.business,
        boss: data.boss,
        jobCount
      }) || { key: '', name: data.name, boss: data.boss, snapshots: [] };

      if (jobs.length) recordJobs(jobs);

      watchCompany(company.key);
      return { route, company, jobCount, jobs, hints: data.hints, extraction: data };
    }

    if (route.type === 'job') {
      const data = extractJobPage(route);
      const rec = recordJobVisit(data.job);
      const company = saveCompany(route, {
        name: data.company.name,
        legalName: data.company.legalName,
        brandId: data.company.brandId,
        business: data.company.business,
        boss: data.company.boss
      }) || { key: '', name: data.company.name, boss: data.company.boss, snapshots: [] };

      watchCompany(company.key);
      return {
        route,
        company,
        job: Object.assign({}, data.job, rec ? { firstSeenAt: rec.firstSeenAt } : {}),
        hints: { name: !!data.company.name, business: !!data.company.business }
      };
    }

    return { route, company: { name: '', boss: {}, snapshots: [] } };
  }

  function run() {
    try {
      const route = parseRoute();
      currentRoute = route;

      if (route.type === 'aiqicha') {
        stopListWatcher();
        const lq = Store.get(KEYS.lastQuery, null);
        renderAiqichaBar(lq, null);
        return;
      }

      if (route.type === 'other') {
        stopListWatcher();
        hideHost();
        return;
      }

      if (route.type === 'list') {
        initListWatcher();
        return;
      }

      stopListWatcher();
      const ctx = collect(route);
      currentCtx = ctx;
      renderCard(ctx);
    } catch (err) {
      console.error('[BCI] run 失败', err);
      renderError(err);
    }
  }

  let refreshing = false;
  function refreshCurrent() {
    if (refreshing) return;
    refreshing = true;
    try { run(); } finally { refreshing = false; }
  }

  function watchCompany(key) {
    if (!key || watchedKeys.has(key)) return;
    watchedKeys.add(key);
    try {
      if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener(KEYS.company(key), (name, oldValue, newValue, remote) => {
          if (remote) refreshCurrent();
        });
      } else {
        window.addEventListener('storage', (e) => {
          if (e.key === KEYS.company(key)) refreshCurrent();
        });
      }
    } catch (e) { /* noop */ }
  }

  /* ============================================================
   * 9. 列表页监听
   * ============================================================ */
  let listObserver = null;
  let listTimer = null;

  function stopListWatcher() {
    if (listObserver) {
      try { listObserver.disconnect(); } catch (e) {}
      listObserver = null;
    }
    clearTimeout(listTimer);
    listTimer = null;
  }

  function initListWatcher() {
    ensureHost('pill');
    const scan = () => {
      try {
        const jobs = extractListJobs();
        const added = recordJobs(jobs);
        const total = Object.keys(loadJobs()).length;
        renderPill(jobs.length, added, total);
      } catch (err) {
        console.warn('[BCI] 列表扫描失败', err);
      }
    };
    scan();
    stopListWatcher();
    listObserver = new MutationObserver(() => {
      clearTimeout(listTimer);
      listTimer = setTimeout(scan, 1000);
    });
    listObserver.observe(document.body, { childList: true, subtree: true });
  }

  /* ============================================================
   * 10. 路由轮询 / 初始化
   * ============================================================ */
  let currentRoute = null;
  let lastHref = location.href;
  let retryTimers = [];

  function clearRetries() {
    retryTimers.forEach((t) => clearTimeout(t));
    retryTimers = [];
  }

  // BOSS 是 CSR：document-idle 时业务内容可能还没渲染完，前几秒补几次
  function scheduleRetries() {
    clearRetries();
    if (!currentRoute || ['company', 'companyJobs', 'job'].indexOf(currentRoute.type) < 0) return;
    [800, 2000, 4500, 8000].forEach((ms) => {
      retryTimers.push(setTimeout(() => {
        if (currentRoute && ['company', 'companyJobs', 'job'].indexOf(currentRoute.type) >= 0) refreshCurrent();
      }, ms));
    });
  }

  function installMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    try {
      GM_registerMenuCommand('复制当前公司 Markdown', exportMarkdown);
      GM_registerMenuCommand('复制调试信息', debugCopy);
      GM_registerMenuCommand('清空本扩展数据', () => {
        if (!window.confirm('清空 BOSS 情报卡的全部本地数据？（公司记录 + 职位记录）')) return;
        for (const k of Store.keys('bci:company:')) Store.del(k);
        Store.del(KEYS.jobs);
        Store.del(KEYS.lastQuery);
        toast('已清空全部本地数据');
        refreshCurrent();
      });
    } catch (e) { /* noop */ }
  }

  function onFocus() {
    if (currentRoute && currentRoute.type !== 'list') refreshCurrent();
  }

  function tick() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    closedHref = '';
    refreshCurrent();
    scheduleRetries();
  }

  function init() {
    installMenu();
    window.addEventListener('focus', onFocus);
    refreshCurrent();
    scheduleRetries();
    setInterval(tick, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ============================================================
   * 11. 测试钩子（不影响正常使用）
   * ============================================================ */
  window.__BCI__ = {
    version: VERSION,
    parseRoute,
    clean,
    cleanCompanyName,
    normKey,
    findLabelValues,
    collectBlocks,
    extractCompanyPage,
    extractJobPage,
    extractListJobs,
    extractAiqicha,
    loadCompany,
    loadJobs,
    buildMarkdown: () => buildMarkdown(),
    _state: () => ({ currentCtx, currentRoute, hostEl })
  };
})();
