"""标准库打包核对：仅生成项目 ZIP、测试副本和验证记录，不联网、不删除目录。"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import zipfile

project = Path(__file__).resolve().parents[1]
workspace = project.parent.resolve()
archive = workspace / 'event-registration-checker.zip'
node = shutil.which('node')
if not node:
    raise RuntimeError('需要 Node.js 执行打包复测；普通使用无需 Node.js。')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def files():
    return sorted(p for p in project.rglob('*') if p.is_file() and '__pycache__' not in p.parts)

def bundle():
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for source in files():
            z.write(source, Path(project.name) / source.relative_to(project))

def extract_checked(destination):
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None, 'ZIP CRC 检查失败'
        for info in z.infolist():
            target = (destination / info.filename).resolve()
            assert target.is_relative_to(destination.resolve()), 'ZIP 路径越界'
        z.extractall(destination)
    return destination / project.name

for script in ['core.js', 'app.js']:
    run = subprocess.run([node, '--check', str(project / script)], capture_output=True, text=True, encoding='utf-8')
    assert run.returncode == 0, run.stderr

html = (project / 'index.html').read_text(encoding='utf-8')
resources = re.findall(r'(?:src|href)="([^"]+)"', html)
for resource in resources:
    assert not re.match(r'^[a-z]+:|^[/\\]', resource, re.I), resource
    assert (project / resource).is_file(), resource
tested_hashes = {name: digest(project / name) for name in ['index.html', 'core.js', 'app.js', 'styles.css', 'sample-registration.csv']}

verification_dir = Path(tempfile.mkdtemp(prefix='报名表 搬家验证 ', dir=workspace))
bundle()
relocated = extract_checked(verification_dir / '第一次解压')
run = subprocess.run([node, '--test', 'tests/core.test.cjs'], cwd=relocated, capture_output=True, text=True, encoding='utf-8')
output = run.stdout + run.stderr
(project / 'records' / 'relocation-tests.txt').write_text(output, encoding='utf-8')
assert run.returncode == 0, output
assert all(digest(relocated / name) == value == digest(project / name) for name, value in tested_hashes.items())

report = {
    'timestamp_utc': datetime.now(timezone.utc).isoformat(),
    'local_timezone': 'America/Denver',
    'archive': str(archive),
    'node': node,
    'node_version': subprocess.check_output([node, '--version'], text=True).strip(),
    'syntax_checks': {'core.js': 'PASS', 'app.js': 'PASS'},
    'relative_resources_all_present': resources,
    'relocated_path': str(relocated),
    'relocated_core_test_exit_code': run.returncode,
    'runtime_payload_hashes_equal_before_and_after_relocation': tested_hashes,
    'note': '换文件夹的文件完整性与 Node 逻辑测试通过；这不等于 file:// 浏览器双击测试。最终 ZIP 全文件逐项核对见压缩包旁 packaging-verification.txt。'
}
(project / 'records' / 'package-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

# 加入刚生成的真实复测日志与报告后重新打包，再在全新目录逐文件核对最终交付。
bundle()
final_copy = extract_checked(verification_dir / '最终交付核对')
original_files = {str(p.relative_to(project)).replace('\\', '/'): digest(p) for p in files()}
extracted_files = {str(p.relative_to(final_copy)).replace('\\', '/'): digest(p) for p in final_copy.rglob('*') if p.is_file()}
assert original_files == extracted_files, '最终压缩包文件或 SHA-256 不一致'
for resource in resources:
    assert (final_copy / resource).is_file()
receipt = {
    'result': 'PASS',
    'final_zip': str(archive),
    'zip_bytes': archive.stat().st_size,
    'zip_sha256': digest(archive),
    'final_extracted_path': str(final_copy),
    'file_count': len(original_files),
    'all_files_sha256_match': True,
    'all_runtime_resources_local_and_present': True,
    'relocated_core_tests': 'PASS (see records/relocation-tests.txt)',
    'file_sha256': original_files
}
receipt_path = workspace / 'packaging-verification.txt'
receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({k: v for k, v in receipt.items() if k != 'file_sha256'}, ensure_ascii=False, indent=2))
print('Receipt: ' + str(receipt_path))
