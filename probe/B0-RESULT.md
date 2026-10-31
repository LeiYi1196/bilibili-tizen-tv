# B0 结果（2026-10-31，Mac 上探测，未碰电视）

原始数据 `report.json`（不含 Cookie）；Cookie 在 `.cookie`（已 .gitignore，仅本地）。

## 通过
- WBI 签名、热门、推荐、搜索、取流：全部 code 0，荷兰 IP 可用。
- 扫码登录（小号）成功；二维码页面本地渲染，登录链接不外发。
- 登录后 DASH 画质：1080P / 720P / 480P / 360P；各档都有 H.264(7)、HEVC(12)、AV1(13)。1080P H.264 约 1.4 Mbps，HEVC 约 0.83 Mbps。
- 1080P+（112）、4K 等在 accept 列表里，但小号不是大会员，没有对应流。
- 单文件 MP4 备选：最高 720P（fnval=1）。

## 视频 CDN 防盗链（R1）
- akamai 镜像（NL 默认第一节点）：无 Referer 206 ✅；Referer=bilibili.com 206 ✅；Referer=example.com 403 ❌。响应带 `access-control-allow-origin: *`。
- bilivideo.com 备用节点：无 Referer 403 ❌；错 Referer 403 ❌；只有 Referer=bilibili.com 206。
- 结论：只要电视应用发视频请求时「不带 Referer」，akamai 节点可用；若带了 file:// 或应用自己的 Referer 会 403。备用节点必须带 B 站 Referer，应用里设置不了，只能走 NAS 代理。
- 速度：akamai 持续 24 Mbps（8MB），首段 4–7 Mbps（冷缓存），1080P 足够。

## 接口跨域（R2）
- api.bilibili.com 对 `Origin: file://` 不返回允许跨域头；OPTIONS 预检 403。
- 是否被 Tizen 打包应用的 `<access origin>` 绕过，桌面验证不了，要 B1 在电视上测。

## 对计划的影响
- R1：大概率免代理（akamai），B1 实测应用发出的 Referer；备用节点失败时才需要代理。
- R2：悬而未决，是 B1 的头号测试项。过不去就上 NAS 代理（用户已同意）。
- R5：WBI 签名可用，写进 `api.js`。
- 登录后推荐 / 搜索也正常，没有触发风控。
- 编码：电视解码能力待 B1 测；有 H.264 兜底，HEVC 可省带宽。

## 下一步
B1：最小测试包上机（需用户单独授权）——测接口跨域、视频 Referer、MSE DASH、avc/hevc 解码、播放内存。
