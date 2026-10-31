#!/usr/bin/env python3
"""bili-hub：替电视保管多个 B 站账号的登录态，并代发请求（补 Cookie / UA / Referer）。
只在家庭局域网内使用；只依赖 Python 3 标准库。

用法：
  bili_hub.py serve                       启动服务（默认 0.0.0.0:8199）
  bili_hub.py import-cookie <文件>         把 “name=value; name=value” 格式的 Cookie 导入成一个账号
  bili_hub.py list                        列出账号（不显示令牌）
  bili_hub.py genkey                      生成访问密钥写入 hub.key

数据放在 $BILI_HUB_DIR（默认 ~/bili-hub）：accounts.json（600，含登录态）、hub.key（600）。
接口：
  GET  /hub/ping                          健康检查
  GET  /hub/cdn?u=<视频地址>               替电视取视频分片（补 B 站 Referer，转发 Range）；只放行 B 站 CDN 域名
  GET  /hub/accounts                      账号列表 [{mid,name,face}]
  POST /hub/qr/generate                   生成登录二维码 → {code:0,data:{url,qrcode_key}}
  GET  /hub/qr/poll?qrcode_key=…          轮询扫码；成功时服务端保存登录态并返回 mid / name
  POST /hub/accounts/delete?mid=…         删除账号
  /api/…  → api.bilibili.com      /live/… → api.live.bilibili.com
  请求头 X-Acct: <mid> 选择账号（缺省用第一个账号；没有账号就匿名）；X-Hub-Key 是访问密钥。
"""
import json
import os
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get('BILI_HUB_PORT', '8199'))
DIR = os.path.expanduser(os.environ.get('BILI_HUB_DIR', '~/bili-hub'))
ACC_FILE = os.path.join(DIR, 'accounts.json')
KEY_FILE = os.path.join(DIR, 'hub.key')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
UPSTREAM = {'/api/': ('https://api.bilibili.com/', 'https://www.bilibili.com/'),
            '/live/': ('https://api.live.bilibili.com/', 'https://live.bilibili.com/')}
LOCK = threading.Lock()
# 只允许中转 B 站视频 / 图片 CDN，避免被当成任意地址的跳板
CDN_SUFFIX = ('.bilivideo.com', '.bilivideo.cn', '.akamaized.net', '.hdslb.com')


# ---------- 账号存储 ----------
def load():
    try:
        with open(ACC_FILE) as f:
            return json.load(f)
    except Exception:
        return {'accounts': {}}


def save(db):
    os.makedirs(DIR, exist_ok=True)
    tmp = ACC_FILE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(db, f, ensure_ascii=False, indent=1)
    os.chmod(tmp, 0o600)
    os.replace(tmp, ACC_FILE)


def hub_key():
    try:
        return open(KEY_FILE).read().strip()
    except Exception:
        return ''


def cookie_header(cookies):
    return '; '.join('%s=%s' % (k, v) for k, v in cookies.items())


def pick(db, mid):
    accs = db.get('accounts', {})
    if mid == 'anon':      # 电视选择“先看看”：不带任何账号
        return None
    if mid and mid in accs:
        return accs[mid]
    return next(iter(accs.values()), None)


# ---------- 请求上游 ----------
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def upstream(url, method='GET', body=None, headers=None, timeout=20):
    """返回 (状态码, 响应头对象, 字节)。HTTP 错误状态也返回 body，不抛异常。"""
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        r = OPENER.open(req, timeout=timeout)
        return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def parse_set_cookies(headers):
    out = {}
    for c in headers.get_all('Set-Cookie') or []:
        nv = c.split(';', 1)[0]
        if '=' in nv:
            k, v = nv.split('=', 1)
            out[k.strip()] = v.strip()
    return out


def fetch_profile(cookies):
    """用一组 Cookie 问 nav，拿到 mid / 昵称 / 头像；未登录返回 None。"""
    st, _, b = upstream('https://api.bilibili.com/x/web-interface/nav',
                        headers={'User-Agent': UA, 'Referer': 'https://www.bilibili.com/', 'Cookie': cookie_header(cookies)})
    j = json.loads(b or b'{}')
    d = j.get('data') or {}
    if j.get('code') == 0 and d.get('isLogin'):
        return {'mid': str(d['mid']), 'name': d.get('uname', ''), 'face': d.get('face', '')}
    return None


def add_account(cookies):
    p = fetch_profile(cookies)
    if not p:
        return None
    with LOCK:
        db = load()
        db.setdefault('accounts', {})[p['mid']] = {**p, 'cookies': cookies}
        save(db)
    return p


# ---------- HTTP ----------
class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'bili-hub'

    def log_message(self, fmt, *args):  # 不记录查询串（里面可能有 key）
        sys.stderr.write('%s %s\n' % (self.command, self.path.split('?')[0]))

    def _cors(self):
        return {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Max-Age': '600'}

    def _send(self, code, body=b'', ctype='application/json; charset=utf-8', extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        for k, v in {**self._cors(), 'Content-Type': ctype, 'Content-Length': str(len(body)), **(extra or {})}.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204)

    def _authorized(self):
        k = hub_key()
        return not k or self.headers.get('X-Hub-Key', '') == k

    def do_GET(self):
        self._handle()

    def do_POST(self):
        self._handle()

    def _handle(self):
        u = urllib.parse.urlsplit(self.path)
        q = urllib.parse.parse_qs(u.query)
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n) if n else None
        if u.path == '/hub/ping':
            return self._send(200, {'ok': True})
        if not self._authorized():
            return self._send(401, {'code': -401, 'message': 'bad hub key'})
        try:
            if u.path == '/hub/accounts':
                db = load()
                return self._send(200, {'code': 0, 'data': [{'mid': a['mid'], 'name': a['name'], 'face': a['face']} for a in db.get('accounts', {}).values()]})
            if u.path == '/hub/qr/generate':
                st, _, b = upstream('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', headers={'User-Agent': UA, 'Referer': 'https://www.bilibili.com/'})
                return self._send(st, b)
            if u.path == '/hub/qr/poll':
                key = (q.get('qrcode_key') or [''])[0]
                st, hd, b = upstream('https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=' + urllib.parse.quote(key),
                                     headers={'User-Agent': UA, 'Referer': 'https://www.bilibili.com/'})
                j = json.loads(b or b'{}')
                d = j.get('data') or {}
                if j.get('code') == 0 and d.get('code') == 0:     # 扫码确认成功：登录态在 Set-Cookie 里，服务端留着
                    p = add_account(parse_set_cookies(hd))
                    if not p:
                        return self._send(200, {'code': 0, 'data': {'code': -1, 'message': '登录成功但验证失败'}})
                    return self._send(200, {'code': 0, 'data': {'code': 0, 'message': '', 'mid': p['mid'], 'name': p['name']}})
                return self._send(200, {'code': j.get('code', 0), 'data': {'code': d.get('code'), 'message': d.get('message', '')}})
            if u.path == '/hub/cdn':   # 备用 CDN 节点要求 Referer，电视应用设不了，由 hub 代取
                target = (q.get('u') or [''])[0]
                parts = urllib.parse.urlsplit(target)
                if parts.scheme not in ('http', 'https') or not (parts.hostname or '').endswith(CDN_SUFFIX):
                    return self._send(403, {'code': -403, 'message': 'host not allowed'})
                h = {'User-Agent': UA, 'Referer': 'https://www.bilibili.com/'}
                if self.headers.get('Range'):
                    h['Range'] = self.headers['Range']
                st, hd, b = upstream(target, 'GET', None, h, timeout=40)
                extra = {k: hd[k] for k in ('Content-Range', 'Accept-Ranges') if hd.get(k)}
                return self._send(st, b, hd.get('Content-Type', 'application/octet-stream'), extra)
            if u.path == '/hub/accounts/delete':
                mid = (q.get('mid') or [''])[0]
                with LOCK:
                    db = load()
                    ok = db.get('accounts', {}).pop(mid, None) is not None
                    save(db)
                return self._send(200, {'code': 0, 'data': {'deleted': ok}})
            for prefix, (base, referer) in UPSTREAM.items():
                if u.path.startswith(prefix):
                    return self._proxy(base + u.path[len(prefix):] + ('?' + u.query if u.query else ''), referer, body)
            return self._send(404, {'code': -404, 'message': 'not found'})
        except Exception as e:  # 上游超时 / 网络错误 → 502，别让服务崩
            return self._send(502, {'code': -502, 'message': '%s: %s' % (type(e).__name__, e)})

    def _proxy(self, url, referer, body):
        acc = pick(load(), self.headers.get('X-Acct', ''))
        h = {'User-Agent': UA, 'Referer': referer}
        if self.command == 'POST':
            h['Origin'] = referer.rstrip('/')
            if self.headers.get('Content-Type'):
                h['Content-Type'] = self.headers['Content-Type']
            # 上报进度等 POST 需要 csrf：没带就用账号的 bili_jct 补上
            if acc and body and b'csrf=' not in body and acc['cookies'].get('bili_jct'):
                body += (b'&' if body else b'') + b'csrf=' + acc['cookies']['bili_jct'].encode()
        if acc:
            h['Cookie'] = cookie_header(acc['cookies'])
        st, hd, b = upstream(url, self.command, body, h)
        self._send(st, b, hd.get('Content-Type', 'application/json'))


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'serve'
    os.makedirs(DIR, exist_ok=True)
    if cmd == 'serve':
        if not hub_key():
            print('警告：没有 hub.key，任何局域网设备都能用你的账号。先运行 genkey。', file=sys.stderr)
        print('bili-hub on :%d  dir=%s  accounts=%d' % (PORT, DIR, len(load().get('accounts', {}))), file=sys.stderr, flush=True)
        ThreadingHTTPServer(('0.0.0.0', PORT), H).serve_forever()
    elif cmd == 'import-cookie':
        text = open(sys.argv[2]).read().strip()
        cookies = dict(x.split('=', 1) for x in text.split('; ') if '=' in x)
        p = add_account(cookies)
        print('已导入：%s (%s)' % (p['name'], p['mid']) if p else '导入失败：Cookie 无效或已过期')
    elif cmd == 'list':
        for a in load().get('accounts', {}).values():
            print(a['mid'], a['name'])
    elif cmd == 'genkey':
        import secrets
        with open(KEY_FILE, 'w') as f:
            f.write(secrets.token_urlsafe(24))
        os.chmod(KEY_FILE, 0o600)
        print('已写入', KEY_FILE)
    else:
        print(__doc__)


if __name__ == '__main__':
    main()
