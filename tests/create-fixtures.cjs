// 只用于生成虚构测试数据，不参与普通用户使用。
const fs = require('node:fs');
const path = require('node:path');
const C = require('../core.js');
const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'records'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'fixtures'), { recursive: true });
fs.writeFileSync(path.join(root, 'sample-registration.csv'), C.sampleCSV, 'utf8');
for (const [name, text] of Object.entries({
  'custom-columns.csv': '票种,联络地址,参加者\r\n普通,a@example.com,王小明\r\n学生,A@EXAMPLE.COM,陈小雨\r\n',
  'empty.csv': '',
  'malformed.csv': '姓名,邮箱\r\n"未闭合,bad',
  'header-only.csv': '姓名,邮箱\r\n',
  'blank-data.csv': '姓名,邮箱,备注\r\n,,\r\n , , \r\n甲,a@example.com,\r\n',
  'unsafe.csv': '姓名,邮箱,备注\r\n<img src=x onerror=alert(1)>,bad,=1+1\r\n',
  'pagination.csv': '姓名,邮箱\r\n' + Array.from({ length: 55 }, (_, i) => `姓名${i + 1},person${i + 1}@example.com`).join('\r\n')
})) fs.writeFileSync(path.join(__dirname, 'fixtures', name), text, 'utf8');
console.log('Wrote fictional sample and 7 test fixtures.');
