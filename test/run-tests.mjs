/**
 * BOSS 公司情报卡 · 本地测试
 *
 * 用法：
 *   npm i -D jsdom            # 或在任意目录装一份，然后用 JSDOM_PATH 指定
 *   node test/run-tests.mjs
 *
 * 说明：测试只验证「提取逻辑 + UI 注入 + 半自动回填」在合成页面上的行为，
 * 不能替代真机验证（BOSS 真实 DOM 类名尚未实测）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  const fallback = process.env.JSDOM_PATH || '/tmp/bci-test/node_modules/jsdom';
  ({ JSDOM } = require(fallback));
}

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'company-intel-card.user.js'), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name + (extra ? `｜${extra}` : ''));
    console.log(`  ✗ ${name}${extra ? `｜${extra}` : ''}`);
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

async function mount(html, url, storageSeed) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  await new Promise((resolve) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve, { once: true });
    setTimeout(resolve, 300);
  });
  if (storageSeed) {
    for (const [k, v] of Object.entries(storageSeed)) {
      dom.window.localStorage.setItem(k, JSON.stringify(v));
    }
  }
  dom.window.eval(SCRIPT);
  await sleep(50);
  return dom;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function shadowOf(dom) {
  const host = dom.window.document.getElementById('bci-host');
  return host && host.shadowRoot ? host.shadowRoot.innerHTML : '';
}

function getCompany(dom, key) {
  return JSON.parse(dom.window.localStorage.getItem('bci:company:' + key) || 'null');
}

/* ---------------- 测试数据 ---------------- */
const COMPANY_HTML = `<!doctype html><html><body>
  <div class="info-primary">
    <div class="info">
      <h1 class="name">北京某某科技有限公司<i class="icon-brand"></i><div class="icon-focus">收藏</div></h1>
      <p>不需要融资<em class="dolt"></em>1000-9999人<em class="dolt"></em><a class="industry-link">互联网</a></p>
    </div>
  </div>
  <div class="job-sec company-business">
    <h3>工商信息</h3>
    <div class="business-detail"><ul>
      <li><span class="t">企业名称：</span>北京某某科技有限公司</li>
      <li><span class="t">法定代表人：</span>张三</li>
      <li><span class="t">成立时间：</span>2015-06-01</li>
      <li><span class="t">企业类型：</span>有限责任公司（自然人投资或控股）</li>
      <li><span class="t">经营状态：</span>存续</li>
      <li><span class="t">注册资本：</span>1000万人民币</li>
      <li><span class="t">注册地址：</span>北京市海淀区上地十街 10 号</li>
      <li><span class="t">统一社会信用代码：</span>91110108MA01TESTXX</li>
      <li><span class="t">所属行业：</span>互联网</li>
      <li><span class="t">经营范围：</span>技术开发、技术咨询、技术服务。</li>
    </ul></div>
  </div>
  <div class="job-sec"><h3>公司简介</h3><div class="text">这是一家测试公司，做人工智能相关业务，服务于企业客户。</div></div>
  <div class="job-sec"><h3>公司地址</h3><div class="job-location">北京市海淀区中关村大街 1 号 点击查看地图</div></div>
  <span>23在招职位</span><span>4位BOSS</span>
</body></html>`;

const JOB_HTML = `<!doctype html><html><body>
  <div class="job-banner"><div class="info-primary">
    <div class="job-status"><span>职位已关闭</span></div>
    <div class="name"><h1>Agent 平台工程师</h1><span class="salary">30-50K·15薪</span></div>
    <p><a class="text-desc text-city">上海</a></p>
  </div></div>
  <div class="sider-company">
    <p class="title">公司基本信息</p>
    <div class="company-info">
      <a href="/gongsi/brand777.html" title="上海测试智能科技"><img src="x"></a>
      <a href="/gongsi/brand777.html" title="上海测试智能科技">上海测试智能科技</a>
    </div>
    <div>不需要融资 500-999人 企业服务</div>
  </div>
  <div class="detail-section-item business-info-box"><h3>工商信息</h3><div class="level-list-box"><ul>
    <li><span>公司名称</span>上海测试智能科技有限公司</li>
    <li><span>法定代表人</span>李四</li>
    <li><span>成立日期</span>2016-08-01</li>
    <li><span>企业类型</span>有限责任公司</li>
    <li><span>经营状态</span>存续</li>
    <li><span>注册资金</span>500万人民币</li>
  </ul></div></div>
</body></html>`;

const LIST_HTML = `<!doctype html><html><body>
  <ul>
    <li class="job-card-box">
      <div class="job-info">
        <div class="job-title">
          <a class="job-name" href="/job_detail/job1.html">职位A</a>
          <span class="job-salary">\ue034\ue031-\ue037\ue031K·\ue032\ue037薪</span>
        </div>
        <ul class="tag-list"><li>1-3年</li><li>本科</li></ul>
      </div>
      <div class="job-card-footer">
        <a class="boss-info"><span class="boss-name">公司A</span></a>
        <span class="company-location">上海</span>
      </div>
    </li>
    <li class="job-card-box">
      <div class="job-info">
        <div class="job-title">
          <a class="job-name" href="/job_detail/job2.html">职位B</a>
          <span class="job-salary">\ue033\ue031\ue031-\ue033\ue036\ue031元/天</span>
        </div>
        <ul class="tag-list"><li>5天/周</li></ul>
      </div>
      <div class="job-card-footer"><span class="boss-name">公司B</span></div>
    </li>
  </ul>
</body></html>`;

const AIQICHA_HTML = `<!doctype html><html><body>
  <div class="company-detail">
    <h1>北京某某科技有限公司</h1>
    <div class="info-item"><span>统一社会信用代码</span><span>91110108MA01TESTXX</span></div>
    <div class="info-item"><span>法定代表人</span><span>张三</span></div>
    <div class="info-item"><span>注册资本</span><span>1000万人民币</span></div>
    <div class="info-item"><span>实缴资本</span><span>800万人民币</span></div>
    <div class="info-item"><span>成立日期</span><span>2015-06-01</span></div>
    <div class="info-item"><span>经营状态</span><span>存续</span></div>
    <div class="info-item"><span>参保人数</span><span>321人</span></div>
    <div class="info-item"><span>公司类型</span><span>有限责任公司（自然人投资或控股）</span></div>
    <div class="info-item"><span>注册地址</span><span>北京市海淀区上地十街 10 号</span></div>
    <div class="info-item"><span>经营范围</span><span>技术开发、技术咨询、技术服务。</span></div>
    <div class="risk-row">自身风险 12 关联风险 3</div>
  </div>
</body></html>`;

/* ---------------- 1. 纯函数 ---------------- */
console.log('\n[1] 纯函数');
{
  const dom = await mount('<html><body></body></html>', 'https://www.zhipin.com/');
  const B = dom.window.__BCI__;
  eq('cleanCompanyName 去掉“收藏”', B.cleanCompanyName('北京某某科技有限公司收藏'), '北京某某科技有限公司');
  eq('cleanCompanyName 去掉标题后缀', B.cleanCompanyName('北京某某科技有限公司-BOSS直聘'), '北京某某科技有限公司');
  eq('normKey 忽略空白与符号', B.normKey('北京 某某（科技）有限公司'), '北京某某科技有限公司');
  eq('route: 公司页', B.parseRoute().type, 'other');
  dom.window.close();
}

{
  const dom = await mount('<html><body></body></html>', 'https://www.zhipin.com/gongsi/abc123.html');
  eq('route: 公司页 brandId', dom.window.__BCI__.parseRoute().brandId, 'abc123');
  dom.window.close();
}

{
  const dom = await mount('<html><body></body></html>', 'https://www.zhipin.com/job_detail/job9.html?lid=1');
  eq('route: 职位详情', dom.window.__BCI__.parseRoute().type, 'job');
  dom.window.close();
}

{
  const dom = await mount('<html><body></body></html>', 'https://www.zhipin.com/web/geek/job?query=Agent');
  eq('route: 列表页', dom.window.__BCI__.parseRoute().type, 'list');
  dom.window.close();
}

/* ---------------- 2. 公司页 ---------------- */
console.log('\n[2] 公司页提取 + 卡片渲染');
{
  const dom = await mount(COMPANY_HTML, 'https://www.zhipin.com/gongsi/abc123.html');
  const B = dom.window.__BCI__;
  const data = B.extractCompanyPage({ type: 'company', brandId: 'abc123' });
  eq('公司名', data.name, '北京某某科技有限公司');
  eq('行业', data.boss.industry, '互联网');
  eq('规模', data.boss.scale, '1000-9999人');
  eq('融资阶段', data.boss.stage, '不需要融资');
  eq('在招职位', data.jobCount, 23);
  eq('招聘者数', data.bossCount, 4);
  ok('地址', /海淀区/.test(data.boss.address), data.boss.address);
  ok('公司介绍', /测试公司/.test(data.boss.intro), data.boss.intro);
  eq('企业全称', data.legalName, '北京某某科技有限公司');
  eq('BOSS 工商来源', data.business.source, 'boss');
  eq('信用代码', data.business.creditCode, '91110108MA01TESTXX');

  const comp = getCompany(dom, 'b:abc123');
  ok('公司记录已落库', !!comp && comp.name === '北京某某科技有限公司');
  ok('工商信息已合并进公司记录', !!comp && comp.business && comp.business.regCapital === '1000万人民币');
  ok('情报卡已渲染', /情报卡/.test(shadowOf(dom)) && /北京某某科技有限公司/.test(shadowOf(dom)));
  ok('工商区块显示 BOSS 工商', /工商信息/.test(shadowOf(dom)) && /BOSS 工商/.test(shadowOf(dom)) && /91110108MA01TESTXX/.test(shadowOf(dom)));

  const md = B.buildMarkdown();
  ok('Markdown 含公司名与行业', md.includes('# 北京某某科技有限公司') && md.includes('互联网'));
  ok('Markdown 含信用代码', md.includes('91110108MA01TESTXX'));
  dom.window.close();
}

/* ---------------- 3. 职位详情页 ---------------- */
console.log('\n[3] 职位详情页提取 + 职位首次见到');
{
  const dom = await mount(JOB_HTML, 'https://www.zhipin.com/job_detail/job9.html');
  const B = dom.window.__BCI__;
  const data = B.extractJobPage({ type: 'job', jobId: 'job9' });
  eq('职位名', data.job.title, 'Agent 平台工程师');
  eq('薪资原文', data.job.salary, '30-50K·15薪');
  eq('城市', data.job.city, '上海');
  eq('公司名', data.company.name, '上海测试智能科技');
  eq('企业全称', data.company.legalName, '上海测试智能科技有限公司');
  eq('brandId', data.company.brandId, 'brand777');
  eq('公司规模', data.company.boss.scale, '500-999人');
  eq('融资阶段', data.company.boss.stage, '不需要融资');
  eq('行业', data.company.boss.industry, '企业服务');
  eq('职位状态', data.job.status, 'closed');
  eq('职位页工商信息', data.company.business.regCapital, '500万人民币');

  const jobs = B.loadJobs();
  ok('职位已记录', !!jobs.job9 && jobs.job9.title === 'Agent 平台工程师');
  ok('公司记录已落库', !!getCompany(dom, 'b:brand777'));
  ok('情报卡渲染职位行', /Agent 平台工程师/.test(shadowOf(dom)) || /当前职位/.test(shadowOf(dom)));
  ok('卡片显示职位已关闭', /已关闭/.test(shadowOf(dom)));
  dom.window.close();
}

/* ---------------- 4. 列表页静默记录 ---------------- */
console.log('\n[4] 列表页静默记录职位首见');
{
  const dom = await mount(LIST_HTML, 'https://www.zhipin.com/web/geek/job?query=Agent');
  const B = dom.window.__BCI__;
  const jobs = B.extractListJobs({ type: 'list' });
  eq('解析到 2 条职位', jobs.length, 2);
  eq('job1 标题', jobs[0].title, '职位A');
  eq('job1 公司', jobs[0].companyName, '公司A');
  eq('job1 薪资（PUA 解码）', jobs[0].salary, '30-60K·16薪');
  eq('job2 薪资（元/天不误判）', jobs[1].salary, '200-250元/天');
  eq('job1 标签数', jobs[0].tags.length, 2);
  eq('列表页无 brandId 时不编造', jobs[0].brandId, '');

  const stored = B.loadJobs();
  ok('职位已写入本地库', !!stored.job1 && !!stored.job2);
  ok('提示条已渲染', /已记录/.test(shadowOf(dom)));
  dom.window.close();
}

/* ---------------- 5. 爱企查提取 + 半自动回填 ---------------- */
console.log('\n[5] 爱企查提取 + 半自动回填');
{
  const dom = await mount(AIQICHA_HTML, 'https://aiqicha.baidu.com/company_detail_12345');
  const B = dom.window.__BCI__;
  const biz = B.extractAiqicha();
  eq('公司名', biz.companyName, '北京某某科技有限公司');
  eq('信用代码', biz.creditCode, '91110108MA01TESTXX');
  eq('法定代表人', biz.legalPerson, '张三');
  eq('注册资本', biz.regCapital, '1000万人民币');
  eq('参保人数', biz.insuredCount, '321人');
  eq('自身风险', biz.risks.own, 12);
  eq('关联风险', biz.risks.related, 3);
  ok('字段计数 ≥ 8', biz.fieldCount >= 8, String(biz.fieldCount));
  dom.window.close();
}

{
  const dom = await mount(AIQICHA_HTML, 'https://aiqicha.baidu.com/company_detail_12345', {
    'bci:lastQuery': { key: 'b:abc123', name: '北京某某科技有限公司', ts: Date.now() }
  });
  const host = dom.window.document.getElementById('bci-host');
  const html = host.shadowRoot.innerHTML;
  ok('半自动条出现采集按钮', /采集并回填/.test(html), html.slice(0, 160));

  const btn = host.shadowRoot.querySelector('[data-act="capture"]');
  ok('找到采集按钮元素', !!btn);
  if (btn) {
    btn.click();
    await sleep(30);
    const comp = getCompany(dom, 'b:abc123');
    ok('爱企查补充回填到 BOSS 公司键', !!comp && !!comp.enrich && comp.enrich.creditCode === '91110108MA01TESTXX');
    ok('回填后提示成功', /已回填/.test(host.shadowRoot.innerHTML));
  }
  dom.window.close();
}

/* ---------------- 6. 存储键不使用公司名做唯一键（有 brandId 时） ---------------- */
console.log('\n[6] 公司键策略');
{
  const dom = await mount(COMPANY_HTML, 'https://www.zhipin.com/gongsi/abc123.html');
  const keys = Object.keys(dom.window.localStorage).filter((k) => k.indexOf('bci:company:') === 0);
  ok('使用 brandId 作为公司键', keys.some((k) => k === 'bci:company:b:abc123'), keys.join(','));
  ok('未产生公司名键', !keys.some((k) => k.indexOf('bci:company:n:') === 0), keys.join(','));
  dom.window.close();
}

/* ---------------- 7. 脏 DOM / 深层嵌套的标签-值解析 ---------------- */
console.log('\n[7] 脏 DOM 与嵌套标签值');
{
  const html = `<!doctype html><html><body><div class="company-detail">
    <h2 class="company-name">某公司 收藏</h2>
    <div class="cell"><span>统一社会信用代码：</span><span>91110000TEST0001X</span></div>
    <table><tr><td>注册资本：5000万元人民币</td></tr></table>
    <div class="wrap"><div><span>成立日期</span></div><div><span>2018-03-12</span></div></div>
    <div class="wrap"><div><span>参保人数</span></div><div><span>88人</span></div></div>
    <div class="mix">行业互联网 公司规模100-499人 融资阶段A轮</div>
  </div></body></html>`;
  const dom = await mount(html, 'https://aiqicha.baidu.com/company_detail_999');
  const B = dom.window.__BCI__;
  const biz = B.extractAiqicha();
  eq('公司名去污（收藏）', biz.companyName, '某公司');
  eq('冒号分隔的信用代码', biz.creditCode, '91110000TEST0001X');
  eq('同一元素内的注册资本', biz.regCapital, '5000万元人民币');
  eq('父级下一兄弟的成立日期', biz.foundedAt, '2018-03-12');
  eq('父级下一兄弟的参保人数', biz.insuredCount, '88人');
  ok('混合文本不污染行业', !biz.industry || biz.industry.length < 20, biz.industry);
  dom.window.close();
}

/* ---------------- 汇总 ---------------- */
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed) {
  console.log('失败项：');
  for (const f of failures) console.log('  - ' + f);
  process.exitCode = 1;
}
