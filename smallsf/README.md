# Small SF — 站点源码快照

抓取自 <https://smallsf.com/>（作者 Ari Dutilh，2026 年 11 月）。这里是完整的**前端源码 + 全部静态数据文件**，未打包的内容见「未包含的资产」。

抓取时间：2026-11-23
版本标识：`map v=mwsvzjkk`、`cv=9a17313192`、`geo gv=894edce60d`

## 这是什么

一个单页 3D 等距（isometric）旧金山互动地图：整座城是一张约 98 亿像素的手绘风插画，切成 DZI 瓦片金字塔，用 OpenSeadragon 5.0.1 拖动缩放；上面叠加实时图层——Muni/BART/渡轮（511.org）、ADS-B 飞机、AIS 船只、模拟车流、真实日照与天气、卫星雾、球赛比分等。

技术栈：纯原生 JS（无构建工具、无框架、无 npm），OGC/IIP DZI 瓦片 + WebP，OpenSeadragon 走 CDN，字体走 Google Fonts，统计走 Seline。所有代码都是可读的、带注释的源文件，没有压缩混淆。

## 目录结构

```
smallsf/
├─ index.html            入口；内联 CSS + 主脚本（视图、相机物理、开场云层、瓦片预热）
├─ about.html            /about 页面（“How it's made”，含插图）
├─ geo.js                坐标核心：WGS84→ECEF→相机空间→地图像素，地形/深度格网解码
├─ ui.js                 顶栏、Search/Places/Layers/TV/Share 弹层、卡片、主题
├─ sound.js              环境音（默认关闭，需要用户手势才开 AudioContext）
├─ transit.js            Muni + 渡轮实时车辆、站点、线路、发车板
├─ traffic.js            基于 OSM 路网的模拟车流与真实红绿灯配时
├─ boats.js              AIS 船只
├─ planes.js             ADS-B 飞机（含高度、影子、ATC 音频）
├─ buildings.js          点击建筑：名称/年代/高度（DataSF 轮廓 + LiDAR）
├─ places.js             地标图钉与卡片
├─ events.js             Oracle Park / Chase Center 比分与灯光
├─ moments.js            烟花、跨年、节日彩蛋（独立 canvas）
├─ atmosphere.js         真实日照 + Open-Meteo 天气：雾、云影、雨
├─ lights.js             夜间街灯光斑
├─ fog.js                地图边缘的“战争迷雾”云墙
├─ minimap.js            角落小地图
├─ lists.js              纯链接分享的地点清单（不存服务端）
├─ people.js             一个挥手的朋友 + 一只水豚
├─ tv.js                 ?tv=<站名> 大屏发车板模式
├─ vendor/qrcode.js      QR 码库（TV 分享用）
├─ map.json              主图：W/H、mpp、瓦片基址、版本
├─ geo.json              投影矩阵、地面格网参数、深度格网参数
├─ photo.json / far.json 城市实景底图 / 湾区远景底图的 DZI 描述
├─ ground.bin            gzip 的 uint16 行差分网格，2200×2200×2（地表高度 + 顶面高度）
├─ depth.bin             gzip 的 uint16 行差分网格，5536×3488（可见表面深度）
├─ depthfine/            index.json + 640 个按块的高精度深度 bin
├─ water.json/.bin       水面遮罩
├─ bldg.json             建筑轮廓索引
├─ landmarks.json        地标
├─ stops.json / stops-all.json / tv-stations.json   站点数据
├─ roads.json            OSM 路网（3.3 MB）
├─ routes.json           公交线路形状（2.3 MB）
├─ caltrain-tracks.json  Caltrain 轨道
├─ people/               图层用的小图
├─ how/                  about 页插图
├─ serve.py              本地预览服务（静态文件 + 瓦片本地优先 + 远程回落）
├─ download_tiles.py     瓦片镜像工具（可重复运行）
├─ map_files/            插画主图瓦片（DZI 0–17 级，1024 px/块）
├─ photo_files/          真实航拍底图瓦片
├─ far_files/            湾区远景瓦片
└─ share.jpg             社交分享图
```

## 数据格式要点

- `map.json`：`W=124560, H=78480`（≈9.8 Gpx），`mpp=0.07111` 米/像素，`tiles` 指向 Cloudflare R2。
- `geo.json`：`ecefToWorld`、`worldToCamera` 两个 4×4 矩阵，`fwd` 视线方向；`ground` 是 8 米格网的 2200×2200 双通道高度网格；`depthGrid` 是 5536×3488 深度网格（`lo=10000, span=10000`，换算 `dm(i)=lo+du[i]*span/65535`）。
- `ground.bin` / `depth.bin`：**先 gzip，再按行做 uint16 差分编码**。`geo.js` 用 `DecompressionStream("gzip")` 解压后调用 `undelta()` 还原，除以 `scale` 再减 `offset` 得到米。
- 瓦片：标准 DZI，`TileSize=1024`，`Overlap=1`，`Format=webp`；主图共 2925 块（截至抓取时已绘制 1322 块，约五分之二城区），另有 `photo_files`（32768×24576，0.5 m/px）和 `far_files`（12288×10240，2 m/px）两层底图。

## 后端接口（静态文件里没有）

页面会请求以下同源接口，由站点自身的 Node 服务（`server.mjs`，未公开）提供，属于服务端代码，不在本次抓取范围内：

| 接口 | 用途 |
| --- | --- |
| `/api/vehicles` | Muni/BART/渡轮实时位置（511.org） |
| `/api/board?stop=` | 站点发车板 |
| `/api/boats` | AIS 船只 |
| `/api/planes` | ADS-B 飞机（adsb.fi，5 秒合并） |
| `/api/fog` | 天气卫星雾图 |
| `/api/atc`、`/api/atc-audio` | 飞机呼号与塔台音频 |
| `/api/visits` | 访问统计 |

没有这些接口时，车辆/飞机/船只/发车板图层不会出数据，其余（画面、缩放、地形、建筑、地标、车流、光照）仍可正常工作。

## 本地运行

必须用 HTTP 服务打开（`file://` 会因限制拿不到 JSON 和瓦片）。用附带的 `serve.py`，它会：

1. 提供本目录的静态文件；
2. 把 `/t/...` 请求优先从本地的 `map_files/`、`photo_files/`、`far_files/` 读取（离线可用）；本地没有的块再转发给 `tiles.smallsf.com`（该站只允许 `smallsf.com` 一个跨域来源，直接静态服务会被拦）；
3. 运行时把三个 JSON 的 `tiles` 字段改成同源路径，不改磁盘上的文件。

```powershell
cd D:\Workbuddy\2026-11-20-22-15-34\smallsf
python serve.py 8787
# 浏览器打开 http://127.0.0.1:8787/
```

要补齐或更新瓦片（可重复运行，已存在会跳过）：`python download_tiles.py 12`。

调试参数：`?nointro` 跳过开场云层，`?sun=-4` 固定太阳高度，`?drawer=canvas` 强制 canvas 渲染，`?tv=<站名>` 大屏模式，`#37.7953,-122.3936,640` 指定初始视角。

## 资产说明

- **三个 DZI 瓦片金字塔已完整镜像到本地**，共 **13,829 块 / 2.9 GB**：
  - `map_files/` — 插画主图，DZI 0–17 级，12,620 块（含 `preview.webp` 模糊占位图）
  - `photo_files/` — 真实航拍底图，1,035 块
  - `far_files/` — 湾区远景，174 块
  - 目录是标准 `级别/x_y.webp` 结构，OpenSeadragon 可直接读
- **OpenSeadragon 5.0.1 已放到 `vendor/openseadragon.min.js`**（277 KB），`index.html` 改为优先加载本地、失败再回落到 cdnjs，所以断网也能开。
- 断网时：地图画面、缩放、地形、建筑、地标、模拟车流、昼夜光照都正常；依赖 `/api/*` 的实时图层（公交、渡轮、飞机、船只、发车板、卫星雾）没有数据。
- `share.mp4`（分享视频，几十 MB）未下载。
- 服务端 `server.mjs` 与 `/api/*` 实现不在快照内。

## 版权

代码与插画版权归原作者 Ari Dutilh 所有，本快照仅供学习研究，请勿直接部署商用。
