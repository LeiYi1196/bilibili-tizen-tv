# bili-hub（多账号服务）

替电视保管多个 B 站账号的登录态，并代发请求（补 Cookie / UA / Referer）。**只在家里局域网用，不要暴露到公网**；只依赖 Python 3 标准库。
电视应用（≥ 0.3.0）启动时连它；连不上自动退回电视本机登录。

## 运行
```bash
python3 bili_hub.py genkey   # 生成访问密钥 hub.key（权限 600）
python3 bili_hub.py serve    # 默认监听 0.0.0.0:8199，数据在当前目录
```
`accounts.json` 含登录态、`hub.key` 是密钥，均已 gitignore，切勿提交。

电视端配置：在 `hub/` 下新建 `hub.conf.json`（已 gitignore）：`{"base":"http://<服务器局域网IP>:8199","key":"<hub.key 内容>"}`，再 `python3 make.py` 打包。

## 命令
`import-cookie <文件>` 把 “name=value; …” Cookie 导入成账号；`list`；`genkey`；`serve`。账号也可在电视上“右上角账号 → 添加账号”扫码添加。

## 接口
`GET /hub/ping`（免密钥）；其余需请求头 `X-Hub-Key`：`/hub/accounts`、`/hub/qr/generate`、`/hub/qr/poll?qrcode_key=`、`/hub/accounts/delete?mid=`、`/api/*`（→ api.bilibili.com）、`/live/*`（→ api.live.bilibili.com）。请求头 `X-Acct: <mid>` 选账号，`anon` = 不带账号。
