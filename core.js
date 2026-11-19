/* 本地 CSV 解析与校验；浏览器和 Node 测试共用同一份逻辑。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RegistrationChecker = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_ROWS = 100000;
  class CsvError extends Error {
    constructor(message) { super(message); this.name = 'CsvError'; }
  }
  function parseCSV(input) {
    if (typeof input !== 'string') throw new CsvError('没有可读取的 CSV 文本。');
    const text = input.replace(/^\uFEFF/, '');
    const records = [];
    let cells = [], value = '', state = 'start', line = 1, startLine = 1, touched = false, blankRows = 0;
    function finishField() { cells.push(value); value = ''; state = 'start'; }
    function finishRecord() {
      finishField();
      if (cells.every(cell => cell.trim() === '')) blankRows++;
      else records.push({ cells, startLine, endLine: line });
      if (records.length > MAX_ROWS + 1) throw new CsvError('报名记录超过 100,000 条，请拆成较小的文件检查。');
      cells = []; touched = false;
    }
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\0') throw new CsvError(`第 ${line} 行含有无法读取的空字符，请重新导出为 CSV。`);
      if (state === 'quoted') {
        if (c === '"') {
          if (text[i + 1] === '"') { value += '"'; i++; }
          else state = 'closed';
        } else if (c === '\r' || c === '\n') {
          if (c === '\r' && text[i + 1] === '\n') i++;
          value += '\n'; line++;
        } else value += c;
        continue;
      }
      if (c === '\r' || c === '\n') {
        finishRecord();
        if (c === '\r' && text[i + 1] === '\n') i++;
        line++; startLine = line; continue;
      }
      touched = true;
      if (c === ',') { finishField(); continue; }
      if (state === 'closed') throw new CsvError(`第 ${line} 行的引号后有多余字符。带引号的字段后只能接逗号或换行。`);
      if (c === '"') {
        if (state !== 'start') throw new CsvError(`第 ${line} 行的引号位置不正确。字段中的引号需要写成两个双引号。`);
        state = 'quoted';
      } else { value += c; state = 'plain'; }
    }
    if (state === 'quoted') throw new CsvError(`从第 ${startLine} 行开始的双引号没有闭合，请补齐后重新上传。`);
    if (touched || cells.length || value.length) finishRecord();
    if (!records.length) throw new CsvError('文件里没有可检查的内容。请加入列名和报名数据。');
    const headerRecord = records.shift();
    const headers = headerRecord.cells.map(s => s.trim());
    if (headers.length < 2) throw new CsvError('至少需要姓名和邮箱两列。请确认使用英文逗号分隔的 CSV，不能直接上传 Excel、分号或制表符文件。');
    const seen = new Set();
    headers.forEach((header, index) => {
      if (!header) throw new CsvError(`第 ${index + 1} 列没有列名，请在表头补上列名。`);
      if (seen.has(header.toLowerCase())) throw new CsvError(`列名“${header}”重复，请改成不同的列名再上传。`);
      seen.add(header.toLowerCase());
    });
    return { headers, rows: records.map((r, i) => ({ ...r, number: i + 1 })), blankRows, headerLine: headerRecord.startLine };
  }
  function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
  function validEmail(value) {
    const email = String(value).trim();
    if (email.length > 254 || !/^[\x21-\x7E]+$/.test(email)) return false;
    const parts = email.split('@');
    if (parts.length !== 2) return false;
    const [local, domain] = parts;
    if (!local || local.length > 64 || !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
    const labels = domain.split('.');
    return labels.length >= 2 && labels.every(label => label.length > 0 && label.length <= 63 && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)) && /^[a-zA-Z]{2,63}$/.test(labels[labels.length - 1]);
  }
  function lineLabel(row) { return row.startLine === row.endLine ? String(row.startLine) : `${row.startLine}–${row.endLine}`; }
  function guessColumns(headers) {
    const find = aliases => headers.findIndex(h => aliases.includes(h.trim().toLowerCase().replace(/[\s_-]+/g, '')));
    return {
      name: find(['姓名', '名字', '报名姓名', '参与者姓名', 'name', 'fullname', 'participantname']),
      email: find(['邮箱', '电子邮箱', '电子邮件', '邮箱地址', 'email', 'emailaddress', 'mail'])
    };
  }
  function checkRegistrations(parsed, nameIndex, emailIndex) {
    if (![nameIndex, emailIndex].every(i => Number.isInteger(i) && i >= 0 && i < parsed.headers.length)) throw new CsvError('请分别选择姓名列和邮箱列。');
    if (nameIndex === emailIndex) throw new CsvError('姓名和邮箱不能选择同一列。');
    const groups = new Map();
    const rows = parsed.rows.map(row => {
      const issues = [];
      if (row.cells.length !== parsed.headers.length) issues.push({ type: 'structure', message: `列数不一致：表头 ${parsed.headers.length} 列，本行 ${row.cells.length} 列；请检查逗号或漏填的单元格。` });
      if (!(row.cells[nameIndex] || '').trim()) issues.push({ type: 'missing', message: '姓名未填写' });
      const email = normalizeEmail(row.cells[emailIndex]);
      if (!email) issues.push({ type: 'missing', message: '邮箱未填写' });
      else if (!validEmail(email)) issues.push({ type: 'email', message: '邮箱格式不正确' });
      const result = { ...row, issues, email };
      if (email) { if (!groups.has(email)) groups.set(email, []); groups.get(email).push(result); }
      return result;
    });
    let duplicateGroups = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      duplicateGroups++;
      const references = group.slice(0, 6).map(lineLabel).join('、');
      const suffix = group.length > 6 ? ` 等 ${group.length} 条记录` : '';
      for (const row of group) row.issues.push({ type: 'duplicate', message: `邮箱重复：CSV 第 ${references} 行${suffix}使用相同邮箱（已忽略大小写和前后空格）` });
    }
    const problemRows = rows.filter(row => row.issues.length);
    return { headers: parsed.headers, rows, problemRows, total: rows.length, problemCount: problemRows.length, issueCount: problemRows.reduce((n, row) => n + row.issues.length, 0), validCount: rows.length - problemRows.length, duplicateGroups };
  }
  function safeCell(value) {
    const text = String(value == null ? '' : value);
    // 防止导出的用户输入被电子表格当作公式执行，包括前导空白。
    return /^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? "'" + text : text;
  }
  function serializeCSV(rows, safe = true) {
    return '\uFEFF' + rows.map(row => row.map(value => {
      const text = safe ? safeCell(value) : String(value == null ? '' : value);
      return '"' + text.replace(/"/g, '""') + '"';
    }).join(',')).join('\r\n') + '\r\n';
  }
  function exportIssues(result) {
    const maxCols = result.headers.length;
    let extraCols = 0;
    for (const row of result.problemRows) extraCols = Math.max(extraCols, row.cells.length - maxCols);
    const headers = [...result.headers];
    const used = new Set(headers.map(h => h.toLowerCase()));
    for (const title of [...Array.from({ length: extraCols }, (_, i) => `额外字段 ${i + 1}`), '检查器_记录序号', '检查器_CSV起始行', '检查器_CSV结束行', '检查器_问题数量', '检查器_问题详情']) {
      let unique = title, suffix = 2;
      while (used.has(unique.toLowerCase())) unique = `${title}（${suffix++}）`;
      used.add(unique.toLowerCase()); headers.push(unique);
    }
    return serializeCSV([headers, ...result.problemRows.map(row => {
      const data = Array.from({ length: maxCols + extraCols }, (_, i) => row.cells[i] || '');
      return [...data, row.number, row.startLine, row.endLine, row.issues.length, row.issues.map(issue => issue.message).join('；')];
    })]);
  }
  const sampleCSV = '\uFEFF姓名,邮箱,票种,备注\r\n张小雨,xiaoyu@example.com,普通票,首次参加\r\n李明,li.ming@example.com,普通票,"希望交流,学习经验"\r\n王芳,LI.MING@example.com,学生票,与上一条邮箱重复\r\n陈晨, li.ming@example.com ,普通票,邮箱两端有空格\r\n,guest@example.com,普通票,漏填姓名\r\n赵宁,,学生票,漏填邮箱\r\n周一,zhouyi.example.com,普通票,邮箱缺少@\r\n吴双,wushuang@example.com,普通票,"他说""期待见面"""\r\n林晓,linxiao@example.com,普通票,"需要无障碍座位\r\n谢谢安排"\r\n';
  return { CsvError, MAX_ROWS, parseCSV, normalizeEmail, validEmail, guessColumns, checkRegistrations, lineLabel, safeCell, serializeCSV, exportIssues, sampleCSV };
});
