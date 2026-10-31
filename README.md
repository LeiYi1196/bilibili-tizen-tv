# bilibili-tizen-tv

给 Samsung Tizen 电视（实测：欧版 The Frame QE55LS03FA，Tizen 6.0）写的**第三方 B 站客户端**。遥控器友好的 TV 界面，原生 JS、无框架，内存占用小。

> 非官方项目，与哔哩哔哩无关。仅供个人学习与自用；不含破解大会员、下载、绕过地区限制等功能。请遵守 B 站用户协议，建议先用小号。

## 功能（v0.4.1）
- 手机扫码登录（可跳过）；推荐 / 热门 / 搜索（热搜词 + 输入法）/ 历史
- 关注动态、直播（自写 MSE 播 HLS-fmp4）、收藏夹管理、UP 主页
- 播放：自写 MSE + sidx 轻量播放器（HEVC → H.264 → AV1 自动择优，默认 1080P）、画质切换、AI 字幕、多 P / 合集 / 番剧选集、进度上报与断点续播
- 首页一级 / 二级菜单、返回键与 OK 刷新
- 多账号（可选）：`hub/bili_hub.py` 跑在家里局域网服务器上，保管各账号登录态
- 不做：弹幕、评论、下载

## 目录
- `app/`：应用源码。`js/api.js` 接口与 WBI 签名（B 站改接口只改这里）、`js/player.js` 播放器、`js/app.js` 界面与遥控器导航
- `hub/bili_hub.py`：多账号服务（Python 3 标准库），见 `hub/README.md`
- `dev/proxy.mjs`：桌面联调用的本机代理（带 Cookie + CORS）
- `make.py`：打包并签名成 `.wgt`
- `probe/`：早期在 Mac 上探测接口 / WBI / 防盗链的脚本与结论（`B0-RESULT.md`）
- `collect-b2.mjs`：接收电视回传的诊断日志（可选）

## 桌面联调
```bash
node probe/login.mjs                     # 扫码登录，生成 probe/.cookie（仅本地，已 gitignore）
node dev/proxy.mjs &
(cd app && python3 -m http.server 8099 --bind 127.0.0.1 &)
# 浏览器打开 http://127.0.0.1:8099/index.html?dev=1&diag=0
```

## 打包安装到电视
1. 安装 Tizen Studio，在 Certificate Manager 里建好你自己的签名证书（Samsung 证书需要电视 DUID）
2. `TIZEN_SIGN_PROFILE=<你的证书名> python3 make.py off` → `dist/BiliTV-<版本>-signed.wgt`
3. 电视开开发者模式后用 `sdb` / Tizen Studio 安装
4. `app/icon.png` 是占位图标，请换成你自己的

## 遥控键
方向键移动、OK 确认、返回退出；播放页：左右 ±10 秒、上 = 控制条、OK = 播放 / 暂停、数字 1/2/3 强制 H.264/HEVC/AV1（0 = 自动）。

## 已验证的结论
- 打包应用的 `<access origin="*">` 能绕过 `api.bilibili.com` 的跨域限制，无需代理
- 视频请求不带 Referer 时，akamai 镜像节点可直取；封面图同理（`referrerPolicy: no-referrer`）
- 电视浏览器能自己保存并发送登录 Cookie；多账号需要 hub，因为 Cookie 同一时间只能一个账号

## 第三方库
blueimp-md5（MIT）、qrcode-generator（MIT），已内置于 `app/js/`。

## 许可证
MIT
