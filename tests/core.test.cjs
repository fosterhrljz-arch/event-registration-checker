const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../core.js');
const check = text => C.checkRegistrations(C.parseCSV(text), 0, 1);

test('中文、正常报名和前后空白：不改原始字段', () => {
  const r = check('姓名,邮箱\n 张小雨 , Xiaoyu@example.com \n李明,li@example.cn');
  assert.equal(r.total, 2); assert.equal(r.issueCount, 0); assert.equal(r.rows[0].cells[0], ' 张小雨 ');
});
test('内置示例：9 条、6 条有问题、6 项、3 条通过、1 组重复', () => {
  const r = check(C.sampleCSV);
  assert.deepEqual([r.total, r.problemCount, r.issueCount, r.validCount, r.duplicateGroups], [9, 6, 6, 3, 1]);
  assert.deepEqual(r.rows[8].cells[3], '需要无障碍座位\n谢谢安排');
  assert.equal(C.lineLabel(r.rows[8]), '10–11');
});
test('交付的示例与页面内置示例完全一致', () => assert.equal(fs.readFileSync(path.join(__dirname, '../sample-registration.csv'), 'utf8'), C.sampleCSV));
test('重复邮箱忽略大小写和两端空格：同组每一条均标记', () => {
  const r = check('姓名,邮箱\n甲, Test@Example.com \n乙,test@example.COM\n丙,TEST@example.com');
  assert.equal(r.problemCount, 3); assert.equal(r.duplicateGroups, 1);
  for (const row of r.rows) assert.deepEqual(row.issues.map(i => i.type), ['duplicate']);
  assert.match(r.rows[0].issues[0].message, /2、3、4/);
});
test('同名不同邮箱不算重复，空邮箱不组成重复组', () => {
  const r = check('姓名,邮箱\n甲,a@example.com\n甲,b@example.com\n乙,\n丙,');
  assert.equal(r.duplicateGroups, 0); assert.equal(r.issueCount, 2);
});
test('空白姓名、空白邮箱、多问题同一行', () => {
  const r = check('姓名,邮箱,备注\n  ,not-an-email,报名\n乙,  ,报名\n , ,待补');
  assert.equal(r.total, 3); assert.equal(r.problemCount, 3); assert.equal(r.issueCount, 5);
});
test('全空行不计为报名，保留后续真实 CSV 行号', () => {
  const p = C.parseCSV('\n姓名,邮箱,备注\r\n , , \r\n甲,a@example.com,\r\n,,\r\n乙,b@example.com,\r\n');
  assert.equal(p.blankRows, 3); assert.deepEqual(p.rows.map(r => r.startLine), [4, 6]);
});
test('只有表头：0 条数据可以检查', () => {
  const r = check('姓名,邮箱\n,,\n'); assert.equal(r.total, 0); assert.equal(r.issueCount, 0);
});
for (const [label, text] of [['零字节', ''], ['BOM', '\uFEFF'], ['空白', '  \r\n\t'], ['逗号空表', ',,\n,,']]) {
  test(`空文件清楚报错：${label}`, () => assert.throws(() => C.parseCSV(text), /没有可检查的内容/));
}
for (const [label, text, error] of [
  ['单列', '姓名\n甲', /至少需要/], ['分号', '姓名;邮箱\n甲;a@b.com', /英文逗号/],
  ['制表符', '姓名\t邮箱\n甲\ta@b.com', /英文逗号/], ['空列名', '姓名,,邮箱', /第 2 列没有列名/],
  ['重复列名', '姓名,Email,email', /列名.*重复/], ['引号未闭合', '姓名,邮箱\n"甲,a@b.com', /第 2 行.*没有闭合/],
  ['字段内孤立引号', '姓名,邮箱\n甲"乙,a@b.com', /第 2 行的引号位置/], ['闭合后多余字符', '姓名,邮箱\n"甲"x,a@b.com', /第 2 行的引号后/],
  ['二进制空字符', '姓名,邮箱\n甲,\0', /空字符/]
]) test(`格式错误提示：${label}`, () => assert.throws(() => C.parseCSV(text), error));
test('逗号、双引号和跨行字段遵循 CSV 转义', () => {
  const p = C.parseCSV('姓名,邮箱,备注\r\n"张,三",a@example.com,"他说""你好""\r\n第二行"\r\n乙,b@example.com,普通');
  assert.deepEqual(p.rows[0].cells, ['张,三', 'a@example.com', '他说"你好"\n第二行']);
  assert.deepEqual(p.rows.map(r => [r.startLine, r.endLine]), [[2, 3], [4, 4]]);
});
test('CR、LF、CRLF 换行及无结尾换行', () => {
  for (const eol of ['\n', '\r', '\r\n']) assert.equal(check(`姓名,邮箱${eol}甲,a@example.com${eol}乙,b@example.com`).validCount, 2);
});
test('短行与多列均保留并报列数问题，不丢失额外字段', () => {
  const r = check('姓名,邮箱\n甲\n乙,b@example.com,额外');
  assert.equal(r.problemCount, 2); assert.equal(r.issueCount, 3);
  const out = C.parseCSV(C.exportIssues(r));
  assert.equal(out.headers[2], '额外字段 1'); assert.equal(out.rows[1].cells[2], '额外');
  assert.ok(out.rows.every(row => row.cells.length === out.headers.length));
});
test('自定义列名由用户映射；常见列名能自动识别', () => {
  const p = C.parseCSV('票种,联络地址,参加者\n普通,a@example.com,王小明');
  assert.deepEqual(C.guessColumns(p.headers), { name: -1, email: -1 });
  assert.equal(C.checkRegistrations(p, 2, 1).validCount, 1);
  assert.deepEqual(C.guessColumns(['Full Name', 'Email_Address']), { name: 0, email: 1 });
});
test('无效映射与同列映射报错', () => {
  const p = C.parseCSV('姓名,邮箱');
  for (const pair of [[-1, 1], [0, 2], [0.1, 1], ['0', 1]]) assert.throws(() => C.checkRegistrations(p, ...pair), /分别选择/);
  assert.throws(() => C.checkRegistrations(p, 1, 1), /不能选择同一列/);
});
test('邮箱常见合法写法、子域和加号别名', () => {
  for (const email of ['a@example.com', 'first.last+event@example.co.uk', 'USER@EXAMPLE.CN', "o'brien@example.museum", ' x-y@sub.example.com ']) assert.equal(C.validEmail(email), true, email);
});
test('邮箱常见错误、多个 @、内部空格、域名错误', () => {
  for (const email of ['', ' ', 'a', '@example.com', 'a@', 'a@@b.com', 'a b@example.com', 'a@example', 'a@.com', 'a@example..com', 'a@-example.com', 'a@example-.com', '.a@example.com', 'a.@example.com', 'a..b@example.com', '甲@例子.中国', 'a@b.c', 'a@example.123', 'a@b_com.com', 'a\nb@example.com']) assert.equal(C.validEmail(email), false, JSON.stringify(email));
});
test('空白符含全角空格，可识别缺失和邮箱两端空白', () => {
  const r = check('姓名,邮箱,备注\n　,　,待补\n甲,　a@example.com　,');
  assert.equal(r.rows[0].issues.length, 2); assert.equal(r.rows[1].issues.length, 0);
});
test('错误邮箱也可同时标记重复', () => {
  const r = check('姓名,邮箱\n甲,bad\n乙,BAD'); assert.equal(r.issueCount, 4); assert.equal(r.problemCount, 2);
});
test('导出回读：中文、逗号、引号、换行不损坏；包含原行号与详情', () => {
  const r = check('姓名,邮箱,备注\r\n"张,三",bad,"他说""你好""\n再见"\r\n乙,b@example.com,正常');
  const csv = C.exportIssues(r); const p = C.parseCSV(csv);
  assert.ok(csv.startsWith('\uFEFF')); assert.equal(p.rows.length, 1);
  assert.deepEqual(p.rows[0].cells.slice(0, 3), ['张,三', 'bad', '他说"你好"\n再见']);
  assert.deepEqual(p.rows[0].cells.slice(3, 7), ['1', '2', '3', '1']); assert.match(p.rows[0].cells[7], /邮箱格式不正确/);
});
test('导出公式防护覆盖常见前缀及前导空白，不改变内存原数据', () => {
  for (const text of ['=1+1', '+cmd', '-1+2', '@SUM(A1)', '  =1', '\t=1', '\n=1']) assert.equal(C.safeCell(text), "'" + text);
  assert.equal(C.safeCell('普通中文'), '普通中文');
  const r = check('姓名,邮箱\n=1+1,bad'); C.exportIssues(r); assert.equal(r.rows[0].cells[0], '=1+1');
});
test('原始列名与检查器新增列重名：导出列自动编号且原值不丢失', () => {
  const r = check('姓名,邮箱,检查器_问题数量,额外字段 1\n甲,bad,原始数量,原始额外值,多余字段');
  const p = C.parseCSV(C.exportIssues(r));
  assert.equal(p.headers[4], '额外字段 1（2）');
  assert.ok(p.headers.includes('检查器_问题数量（2）'));
  assert.deepEqual(p.rows[0].cells.slice(0, 5), ['甲', 'bad', '原始数量', '原始额外值', '多余字段']);
});
test('大量同邮箱记录：消息大小有界，所有记录均被标记', () => {
  const r = check('姓名,邮箱\n' + Array.from({ length: 2000 }, (_, i) => `报名${i},same@example.com`).join('\n'));
  assert.equal(r.problemCount, 2000); assert.equal(r.duplicateGroups, 1); assert.ok(r.rows[0].issues[0].message.length < 200);
});
test('100,000 条上限可检查；100,001 条明确拒绝', () => {
  const source = '姓名,邮箱\n' + Array.from({ length: C.MAX_ROWS }, (_, i) => `报名${i},user${i}@example.com`).join('\n');
  const r = check(source); assert.equal(r.total, 100000); assert.equal(r.issueCount, 0);
  assert.throws(() => C.parseCSV(source + '\n超出,x@example.com'), /超过 100,000/);
});
test('100 组确定性 CSV 往返：逗号、引号、CRLF、中文组合', () => {
  const values = ['中文', 'a,b', '说"你好"', '多\n行', '💚', '  空白  ', 'a@example.com'];
  for (let i = 0; i < 100; i++) {
    const data = [[values[i % 7], values[(i * 3 + 1) % 7], values[(i * 5 + 2) % 7]]];
    const p = C.parseCSV(C.serializeCSV([['A', 'B', 'C'], ...data], false));
    assert.deepEqual(p.rows[0].cells, data[0]);
  }
});
test('页面资源全部为相对本地路径，无联网代码、无持久化报名数据', () => {
  const base = path.join(__dirname, '..'); const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
  for (const ref of refs) {
    assert.doesNotMatch(ref, /^(?:[a-z]+:|\/)/i);
    if (ref.startsWith('#')) {
      assert.ok(['#home', '#results'].includes(ref) || html.includes(`id="${ref.slice(1)}"`), `无对应目标的页内链接：${ref}`);
    } else assert.ok(fs.existsSync(path.join(base, ref)), ref);
  }
  const code = fs.readFileSync(path.join(base, 'app.js'), 'utf8') + fs.readFileSync(path.join(base, 'core.js'), 'utf8');
  assert.doesNotMatch(code, /\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB)\b/);
  assert.match(html, /connect-src 'none'/);
});
