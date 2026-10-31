"""Bili TV 打包：复制 app/ 到暂存目录 → 写入诊断开关 diag.js → 打 unsigned wgt → 用你自己的证书签名 → SHA256。纯本机，不碰电视。
用法：python3 make.py [diag地址|off]    默认诊断回传到 Mac 收集器（测试版）；off = 正式版不回传。"""
import hashlib, json, shutil, subprocess, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP = ROOT / 'app'
OUT = ROOT / 'dist'
STAGE = OUT / 'stage'
SIGN_PROFILE = __import__('os').environ.get('TIZEN_SIGN_PROFILE', 'MyProfile')  # Tizen Studio 里配好的签名证书名
TIZEN = Path.home() / 'tizen-studio/tools/ide/bin/tizen'
arg = sys.argv[1] if len(sys.argv) > 1 else 'off'
diag = '' if arg == 'off' else arg
ver = __import__('re').search(r'version="([^"]+)" viewmodes', (APP / 'config.xml').read_text()).group(1)

shutil.rmtree(STAGE, ignore_errors=True)
shutil.copytree(APP, STAGE, ignore=shutil.ignore_patterns('.*'))
(STAGE / 'diag.js').write_text(f'window.BILI_DIAG={json.dumps(diag)};\n')
# 账号服务（NAS 上的 bili-hub）：有 hub/hub.conf.json（{"base":"http://NAS:8199","key":"…"}，含密钥，只在本地）就写进包；没有就是直连模式
conf = ROOT / 'hub/hub.conf.json'
(STAGE / 'hub.js').write_text('window.BILI_HUB=' + (json.dumps(json.loads(conf.read_text())) if conf.exists() else 'null') + ';\n')

unsigned = OUT / f'BiliTV-{ver}-unsigned.wgt'
signed = OUT / f'BiliTV-{ver}-signed.wgt'
with zipfile.ZipFile(unsigned, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for f in sorted(STAGE.rglob('*')):
        if f.is_file():
            i = zipfile.ZipInfo(f.relative_to(STAGE).as_posix(), (2026, 10, 31, 0, 0, 0))
            i.compress_type = zipfile.ZIP_DEFLATED
            i.external_attr = 0o644 << 16
            z.writestr(i, f.read_bytes())
shutil.copyfile(unsigned, signed)
subprocess.run([str(TIZEN), 'package', '-t', 'wgt', '-s', SIGN_PROFILE, '--', str(signed)], check=True)
names = zipfile.ZipFile(signed).namelist()
assert 'author-signature.xml' in names and 'signature1.xml' in names, '签名文件缺失'
sha = hashlib.sha256(signed.read_bytes()).hexdigest()
(OUT / 'build.json').write_text(json.dumps({'signed': signed.name, 'version': ver, 'sha256': sha, 'diag': diag, 'hub': (ROOT / 'hub/hub.conf.json').exists(), 'files': names}, ensure_ascii=False, indent=2) + '\n')
print('SIGNED', signed, sha)
