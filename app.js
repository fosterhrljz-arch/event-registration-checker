/* UI/state only. Parsing, validation and CSV export remain in core.js. */
(function () {
  'use strict';
  const C = window.RegistrationChecker, $ = id => document.getElementById(id);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let parsed = null, result = null, currentFile = null, filename = '', loadVersion = 0;
  let page = 1, mode = 'problems', busy = false, routeVersion = 0;
  const pageSize = 50;
  const labels = { missing: '缺失信息', email: '邮箱格式', duplicate: '重复邮箱', structure: '列数不一致' };
  const format = n => n.toLocaleString('zh-CN');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  function textNode(tag, text, className) {
    const node = document.createElement(tag); node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function showError(message) { $('error').textContent = message; $('error').hidden = false; }
  function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
  function resultNotice(message) { $('result-notice').textContent = message; $('result-notice').hidden = !message; }
  function clearResult() {
    result = null; $('record-list').replaceChildren();
    ['total-count', 'problem-count', 'valid-count'].forEach(id => $(id).textContent = '—');
    $('export-button').disabled = true;
    resultNotice('');
  }
  function clearMappings() {
    for (const id of ['name-column', 'email-column']) {
      $(id).replaceChildren(new Option('请先上传 CSV', '')); $(id).disabled = true;
    }
    $('check-button').disabled = true;
  }
  function updateCheckButton() {
    const n = $('name-column').value, e = $('email-column').value;
    $('check-button').disabled = busy || !parsed || n === '' || e === '' || n === e;
  }
  function setBusy(value, message = '正在本地读取 CSV…') {
    busy = value; $('progress').hidden = !value; $('progress-text').textContent = message;
    $('mapping').setAttribute('aria-busy', String(value)); updateCheckButton();
  }
  async function syncRoute() {
    const version = ++routeVersion;
    const wantsResults = location.hash === '#results' && !!result;
    if (location.hash === '#results' && !result) history.replaceState(null, '', '#home');
    const target = wantsResults ? $('results-view') : $('home-view');
    const other = wantsResults ? $('home-view') : $('results-view');
    if (target.hidden) {
      if (!reducedMotion.matches) { other.classList.add('leaving'); await delay(120); }
      if (version !== routeVersion) return;
      other.hidden = true; other.classList.remove('leaving', 'entering');
      target.hidden = false; target.classList.remove('leaving'); target.classList.add('entering');
      $('nav-upload').hidden = wantsResults; $('reset-button').hidden = !wantsResults;
      $('site-header').classList.remove('is-dark');
      document.title = wantsResults ? '检查结果 · 报名表检查器' : '报名表检查器';
      if (wantsResults) { window.scrollTo({ top: 0, behavior: 'instant' }); $('results-title').focus({ preventScroll: true }); }
    } else { target.classList.remove('leaving'); }
    if (!wantsResults) {
      const id = location.hash === '#upload' ? 'upload' : location.hash === '#discover' ? 'discover' : 'home-view';
      $(id).scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
      if (id === 'upload' && !target.hidden) $('upload-title').focus({ preventScroll: true });
    }
    updateScrollVisuals();
  }
  function go(hash) { if (location.hash === hash) syncRoute(); else location.hash = hash; }
  function acceptText(text, name) {
    parsed = C.parseCSV(text); filename = name;
    const guess = C.guessColumns(parsed.headers);
    for (const [id, index] of [['name-column', guess.name], ['email-column', guess.email]]) {
      const select = $(id); select.replaceChildren(new Option('请选择对应的列', ''));
      parsed.headers.forEach((header, i) => select.add(new Option(header, String(i))));
      select.value = index >= 0 ? String(index) : ''; select.disabled = false;
    }
    $('mapping').hidden = false; $('upload').classList.add('has-file');
    $('selected-filename').textContent = filename;
    $('file-info').textContent = `${parsed.headers.length} 列 · ${format(parsed.rows.length)} 条记录`;
    const extra = parsed.blankRows ? ` 已跳过 ${format(parsed.blankRows)} 个全空行。` : '';
    notice(parsed.rows.length ? '请确认姓名列和邮箱列，再开始检查。' + extra : '文件只有表头，没有报名数据。可检查空表，或更换文件。' + extra);
    updateCheckButton();
  }
  async function loadFile(file) {
    const version = ++loadVersion;
    currentFile = file; filename = file.name; parsed = null; clearResult(); clearMappings();
    $('error').hidden = true; $('mapping').hidden = true; $('upload').classList.remove('has-file');
    notice(''); setBusy(true); go('#upload');
    try {
      if (!file.name.toLowerCase().endsWith('.csv')) throw new Error('请选择以 .csv 结尾的文件。Excel 文件需要先另存为 CSV。');
      if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20 MB，请拆分后再检查。');
      if (!file.size) throw new Error('这是一个空文件。请加入列名和报名数据后再上传。');
      const bytes = await file.arrayBuffer();
      if (version !== loadVersion) return;
      let text;
      try { text = new TextDecoder($('encoding').value, { fatal: true }).decode(bytes); }
      catch { throw new Error('无法按当前编码读取文件。请切换“文件编码”重试，或另存为“CSV UTF-8”。'); }
      acceptText(text, file.name);
    } catch (error) {
      if (version !== loadVersion) return;
      parsed = null; clearResult(); clearMappings(); notice(''); showError(error.message);
    } finally { if (version === loadVersion) setBusy(false); }
  }
  function issueTitle(issue) {
    if (issue.type === 'missing') return issue.message.startsWith('姓名') ? '缺少姓名' : '缺少邮箱';
    return labels[issue.type];
  }
  function chevron() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('fill', 'none'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', 'm7 4 6 6-6 6'); svg.append(path);
    return svg;
  }
  function renderRecords() {
    if (!result) return;
    const query = $('search').value.trim().toLowerCase(), type = $('issue-filter').value;
    const rows = result.rows.filter(row => (mode === 'all' || row.issues.length) &&
      (type === 'all' || row.issues.some(issue => issue.type === type)) &&
      (!query || row.cells.some(value => value.toLowerCase().includes(query))));
    const pages = Math.max(1, Math.ceil(rows.length / pageSize)); page = Math.max(1, Math.min(page, pages));
    const nameIndex = Number($('name-column').value), emailIndex = Number($('email-column').value);
    const fragment = document.createDocumentFragment();
    for (const row of rows.slice((page - 1) * pageSize, page * pageSize)) {
      const details = document.createElement('details'); details.className = 'record';
      const summary = document.createElement('summary'); summary.className = 'record-summary';
      const title = [...new Set(row.issues.map(issueTitle))].join('、') || '通过检查';
      const identity = [row.cells[nameIndex], row.cells[emailIndex]].filter(v => v && v.trim()).join(' · ');
      summary.append(textNode('span', '第 ' + C.lineLabel(row) + ' 行', 'record-line'),
        textNode('span', title, 'record-type'), textNode('span', identity, 'record-identity'), chevron());
      const detail = document.createElement('div'); detail.className = 'record-detail';
      if (!row.issues.length) detail.append(textNode('p', '未发现问题。', 'issue-text'));
      for (const issue of row.issues) detail.append(textNode('p', issue.message, 'issue-text'));
      const fields = document.createElement('dl'); fields.className = 'original-fields';
      for (let i = 0; i < Math.max(result.headers.length, row.cells.length); i++) {
        fields.append(textNode('dt', result.headers[i] || '额外字段 ' + (i - result.headers.length + 1)),
          textNode('dd', row.cells[i] && row.cells[i].trim() ? row.cells[i] : '（空）'));
      }
      detail.append(fields); details.append(summary, detail); fragment.append(details);
    }
    $('record-list').replaceChildren(fragment); $('no-matches').hidden = rows.length > 0;
    $('empty-title').textContent = result.total ? '没有符合筛选条件的记录。' : '这份表还没有报名记录。';
    $('empty-description').textContent = result.total ? '试试其他分类，或调整搜索内容。' : '请重新上传含有报名数据的 CSV。';
    $('page-info').textContent = `共 ${format(rows.length)} 条 · 第 ${page} / ${pages} 页 · 每页 ${pageSize} 条`;
    $('pagination').hidden = rows.length <= pageSize;
    $('prev-page').disabled = page <= 1; $('next-page').disabled = page >= pages;
    for (const value of ['problems', 'all']) {
      $('view-' + value).classList.toggle('active', mode === value);
      $('view-' + value).setAttribute('aria-pressed', String(mode === value));
    }
    document.querySelectorAll('[data-filter]').forEach(button => {
      const selected = button.dataset.filter === type;
      button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
    });
    $('report-summary').textContent = `当前显示 ${format(rows.length)} 条记录，${mode === 'all' ? '全部记录' : '只看问题'}。`;
  }
  async function runCheck() {
    if (busy || $('check-button').disabled) return;
    const version = loadVersion;
    $('error').hidden = true; setBusy(true, '正在本地检查…');
    $('check-label').textContent = '正在检查'; $('check-button').querySelector('.busy-indicator').hidden = false;
    try {
      // Let the browser paint the busy state; never simulate a percentage or delay a completed check.
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      if (version !== loadVersion) return;
      result = C.checkRegistrations(parsed, Number($('name-column').value), Number($('email-column').value));
      $('total-count').textContent = format(result.total); $('problem-count').textContent = format(result.problemCount);
      $('valid-count').textContent = format(result.validCount); $('result-filename').textContent = filename;
      $('results-title').textContent = result.total ? '检查完成。' : '空表检查完成。';
      $('export-button').disabled = !result.problemCount; $('count-all').textContent = format(result.problemCount);
      const counts = { duplicate: 0, missing: 0, email: 0, structure: 0 };
      for (const row of result.rows) for (const type of new Set(row.issues.map(issue => issue.type))) counts[type]++;
      for (const [type, count] of Object.entries(counts)) $('count-' + type).textContent = format(count);
      document.querySelector('[data-filter="structure"]').hidden = !counts.structure;
      resultNotice(result.total && !result.problemCount ? '所有记录均通过当前规则检查。邮箱检查仅判断格式，不验证能否收信。' : '');
      page = 1; mode = result.problemCount ? 'problems' : 'all';
      $('search').value = ''; $('issue-filter').value = 'all'; $('more-tools').open = false;
      renderRecords(); go('#results');
    } catch (error) { showError(error.message); }
    finally {
      if (version === loadVersion) setBusy(false);
      $('check-label').textContent = '开始检查'; $('check-button').querySelector('.busy-indicator').hidden = true;
    }
  }
  function download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function reset() {
    ++loadVersion; parsed = null; result = null; currentFile = null; filename = '';
    clearResult(); clearMappings(); setBusy(false); notice(''); $('error').hidden = true;
    $('mapping').hidden = true; $('upload').classList.remove('has-file');
    $('file-input').value = ''; $('search').value = ''; $('issue-filter').value = 'all';
    go('#upload');
  }
  ['nav-upload', 'hero-upload', 'choose-file', 'change-file'].forEach(id => $(id).addEventListener('click', () => $('file-input').click()));
  $('file-input').addEventListener('change', event => { const file = event.target.files[0]; if (file) loadFile(file); event.target.value = ''; });
  $('encoding').addEventListener('change', () => { if (currentFile) loadFile(currentFile); });
  const drop = $('drop-zone');
  ['dragenter', 'dragover'].forEach(event => drop.addEventListener(event, e => { e.preventDefault(); drop.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(event => drop.addEventListener(event, e => { e.preventDefault(); drop.classList.remove('dragging'); }));
  drop.addEventListener('drop', event => {
    const files = event.dataTransfer.files;
    if (files.length !== 1) { showError('一次请选择一个 CSV 文件。'); return; }
    loadFile(files[0]);
  });
  window.addEventListener('dragover', event => event.preventDefault());
  window.addEventListener('drop', event => event.preventDefault());
  $('sample-button').addEventListener('click', () => {
    ++loadVersion; currentFile = null; parsed = null; clearResult(); clearMappings(); setBusy(false);
    $('error').hidden = true; $('encoding').value = 'utf-8';
    try { acceptText(C.sampleCSV, '示例报名表.csv'); runCheck(); } catch (error) { showError(error.message); }
  });
  ['name-column', 'email-column'].forEach(id => $(id).addEventListener('change', () => {
    clearResult(); $('error').hidden = true; updateCheckButton();
    if ($('name-column').value !== '' && $('name-column').value === $('email-column').value) showError('姓名和邮箱不能选择同一列，请重新选择。');
    else notice('列选择已更新，请开始检查。');
  }));
  $('check-button').addEventListener('click', runCheck);
  for (const value of ['problems', 'all']) $('view-' + value).addEventListener('click', () => {
    mode = value; page = 1;
    if (value === 'all') $('issue-filter').value = 'all';
    renderRecords();
  });
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    mode = 'problems'; page = 1; $('issue-filter').value = button.dataset.filter; renderRecords();
  }));
  $('issue-filter').addEventListener('change', () => { page = 1; renderRecords(); });
  $('search').addEventListener('input', () => { page = 1; renderRecords(); });
  $('prev-page').addEventListener('click', () => { page--; renderRecords(); $('record-list').scrollIntoView({ block: 'start', behavior: 'instant' }); });
  $('next-page').addEventListener('click', () => { page++; renderRecords(); $('record-list').scrollIntoView({ block: 'start', behavior: 'instant' }); });
  $('export-button').addEventListener('click', () => {
    if (!result || !result.problemCount) return;
    download(C.exportIssues(result), filename.replace(/\.csv$/i, '') + '-问题清单.csv');
    resultNotice(`已生成全部 ${format(result.problemCount)} 条问题记录的 CSV。文件保存位置由浏览器决定；可能作为公式执行的字段已加单引号保护。`);
  });
  $('reset-button').addEventListener('click', reset);
  window.addEventListener('hashchange', syncRoute);
  // Scroll-linked visual motion stays local and passive. Reduced motion keeps every section readable.
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
  }, { threshold: .16 }) : null;
  if (observer) {
    document.documentElement.classList.add('motion-ready');
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  }
  function updateScrollVisuals() {
    if ($('home-view').hidden) { $('site-header').classList.remove('is-dark'); return; }
    const rect = $('discover').getBoundingClientRect();
    $('site-header').classList.toggle('is-dark', rect.top <= 72 && rect.bottom > 72);
    if (!reducedMotion.matches) document.querySelector('.sheet-stack').style.setProperty('--sheet-y', Math.min(18, window.scrollY * .025) + 'px');
  }
  let frame = 0;
  window.addEventListener('scroll', () => {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; updateScrollVisuals(); });
  }, { passive: true });
  reducedMotion.addEventListener('change', updateScrollVisuals);
  if (location.hash) syncRoute();
})();
