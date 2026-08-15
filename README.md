<p align="center"><img width="200" src="./TuneFlow.png" alt="TuneFlow logo"></p>

<h1 align="center">TuneFlow · 音流</h1>

<p align="center">支持自行部署的 TuneFlow Web 音乐服务</p>

<a id="目录"></a>

## 目录

- [产品介绍](#product-overview)
- [功能边界](#feature-boundaries)
- [用户界面](#user-interface)
- [如何使用](#usage)
  - [Docker 部署（推荐）](#docker-deployment)
  - [源码构建与启动](#source-build)
  - [数据存储目录](#data-storage)
- [贡献代码](#contributing)
- [项目协议](#project-agreement)

<a id="product-overview"></a>

## 产品介绍

TuneFlow（音流）将音乐搜索、播放、列表、下载与本地媒体库带到浏览器：由 Node.js Service 提供数据与媒体能力，通过 Vue Web UI 使用。你可以将它部署在自己的电脑或服务器上，也可以使用 Docker 运行；播放列表、下载内容和其他持久化数据均由你自己的存储空间管理。

所用技术栈：

- Node.js 22+
- Vue 3

本仓库只构建 Node.js Service 与 Web UI，不再生成桌面安装包。未来原生客户端通过 Service API 接入。

<a id="feature-boundaries"></a>

## 功能边界

Web UI 支持导航、搜索、列表、播放、Service 下载与本地媒体库、网络导入自定义源、常规设置、本地快捷键和内置主题。不支持桌面窗口/托盘、桌面歌词、全局快捷键、安装更新、原桌面同步与开放 API、原生文件对话框、系统字体枚举或文件型自定义主题编辑。

<a id="user-interface"></a>

## 用户界面

<p><img width="100%" src="./doc/images/app.png" alt="TuneFlow 音流 Web UI"></p>

<a id="usage"></a>

## 如何使用

<a id="docker-deployment"></a>

### Docker 部署（推荐）

公开镜像发布在 Docker Hub：`apkdv/tuneflow-server`。默认将服务发布到宿主机的 `3124` 端口，并使用 Docker 卷持久化数据库、下载内容和自定义源。

#### 使用 docker run

```sh
docker pull apkdv/tuneflow-server:latest
docker volume create tuneflow-data
docker run -d \
  --name tuneflow-server \
  --init \
  --restart unless-stopped \
  -p 3124:3124 \
  -v tuneflow-data:/data \
  apkdv/tuneflow-server:latest
```

在部署主机上打开 <http://127.0.0.1:3124>；从局域网其他设备访问时，打开 `http://服务器IP:3124`。可用以下命令检查运行状态和健康接口：

```sh
docker ps --filter name=tuneflow-server
docker logs -f tuneflow-server
curl --fail http://127.0.0.1:3124/api/v1/health
```

更新到最新镜像时，删除并重建容器即可；命名卷 `tuneflow-data` 不会随容器删除：

```sh
docker pull apkdv/tuneflow-server:latest
docker stop tuneflow-server
docker rm tuneflow-server
docker run -d \
  --name tuneflow-server \
  --init \
  --restart unless-stopped \
  -p 3124:3124 \
  -v tuneflow-data:/data \
  apkdv/tuneflow-server:latest
```

#### 使用 Docker Compose

将以下内容保存为 `compose.yaml`：

```yaml
services:
  tuneflow-server:
    image: apkdv/tuneflow-server:latest
    container_name: tuneflow-server
    ports:
      - "3124:3124"
    volumes:
      - tuneflow-data:/data
    init: true
    restart: unless-stopped

volumes:
  tuneflow-data:
```

然后运行：

```sh
docker compose pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:3124/api/v1/health
```

升级时再次运行 `docker compose pull && docker compose up -d`。停止服务可运行 `docker compose down`；不要添加 `-v`，否则会删除持久化数据卷。

当前 Docker Hub 镜像发布为 `linux/amd64`。ARM 主机需要配置 AMD64 模拟支持。上述端口映射会监听宿主机的所有网络接口，仅应在可信局域网中使用，并通过主机防火墙或反向代理限制访问。如果只需本机访问，可将端口映射改为 `127.0.0.1:3124:3124`。本服务没有身份认证、多租户隔离或公网安全加固，请勿直接暴露到互联网。

<a id="source-build"></a>

### 源码构建与启动

安装 Node.js 22 或更高版本，然后运行：

```sh
npm ci
npm run build:service
npm run start:server
```

浏览器打开 <http://127.0.0.1:3124>。默认只监听本机回环地址；若要在可信局域网使用，可显式设置 `TUNEFLOW_HOST=0.0.0.0`，并通过主机防火墙或反向代理限制访问。

<a id="data-storage"></a>

### 数据存储目录

Service 独占所有持久化数据。数据根目录由 `TUNEFLOW_STORAGE_ROOT` 指定，默认是当前工作目录下的 `./data`。其中包括：

- `tuneflow.data.db`，以及 Service 运行时可能存在的 WAL/SHM 文件；
- 固定下载与本地媒体目录 `${TUNEFLOW_STORAGE_ROOT}/audio`；
- `sources/`、`tmp/`、`logs/` 与 `backups/` 支持目录。

浏览器和 API 都不能选择或修改宿主机下载路径。Docker 中 `TUNEFLOW_STORAGE_ROOT=/data`，因此媒体固定存放在 `/data/audio`。备份时应先停止 Service 并备份完整数据根目录，而不是只复制数据库文件。

从旧版本升级时，Service 会在同一数据根目录内自动迁移旧数据库文件和旧设置键。Docker 服务名与数据卷已改为 TuneFlow 命名；使用旧命名卷的部署需先将完整 `/data` 内容复制到 `tuneflow-data` 卷，再启动新容器。

构建、启动、环境变量、Docker、数据备份、媒体目录、功能边界与安全注意事项请参阅 [Server + Web 文档](./docs/server-web.md)。

<a id="contributing"></a>

## 贡献代码

本项目欢迎 PR，但为了 PR 能顺利合并，需要注意以下几点：

- 对于添加新功能的 PR，建议在提交 PR 前先创建 Issue 进行说明，以确认该功能是否确实需要。
- 对于修复 bug 的 PR，请提供修复前后的说明及重现方式。
- 对于其他类型的 PR，则适当附上说明。

提交代码前请至少运行与变更相关的测试；涉及生产构建边界时还应运行 `npm run build:service`。

<a id="project-agreement"></a>

## 项目协议

TuneFlow 基于 [Apache License 2.0](./LICENSE) 许可证发行。以下协议是对于 Apache License 2.0 的补充，如有冲突，以以下协议为准。

---

*词语约定：本协议中的“本项目”指本仓库的 TuneFlow 项目；“使用者”指签署本协议的使用者；“官方音乐平台”指对本项目内置的包括酷我、酷狗、咪咕等音乐源的官方平台统称；“版权数据”指包括但不限于图像、音频、名字等在内的他人拥有所属版权的数据。*

### 一、数据来源

1.1 本项目的各官方平台在线数据来源原理是从其公开服务器中拉取数据（与未登录状态在官方平台 APP 获取的数据相同），经过对数据简单地筛选与合并后进行展示，因此本项目不对数据的合法性、准确性负责。

1.2 本项目本身没有获取某个音频数据的能力，本项目使用的在线音频数据来源来自软件设置内“自定义源”设置所选择的“源”返回的在线链接。例如播放某首歌，本项目所做的只是将希望播放的歌曲名、艺术家等信息传递给“源”，若“源”返回了一个链接，则本项目将认为这就是该歌曲的音频数据而进行使用，至于这是不是正确的音频数据本项目无法校验其准确性，所以使用本项目的过程中可能会出现希望播放的音频与实际播放的音频不对应或者无法播放的问题。

1.3 本项目的非官方平台数据（例如“我的列表”内列表）来自使用者管理的 Service 数据根目录，本项目不对这些数据的合法性、准确性负责。

### 二、版权数据

2.1 使用本项目的过程中可能会产生版权数据。对于这些版权数据，本项目不拥有它们的所有权。为了避免侵权，使用者务必在 **24 小时内** 清除使用本项目的过程中所产生的版权数据。

### 三、音乐平台别名

3.1 本项目内的官方音乐平台别名为本项目内对官方音乐平台的一个称呼，不包含恶意。如果官方音乐平台觉得不妥，可联系本项目更改或移除。

### 四、资源使用

4.1 本项目内使用的部分包括但不限于字体、图片等资源来源于互联网。如果出现侵权可联系本项目移除。

### 五、免责声明

5.1 由于使用本项目产生的包括由于本协议或由于使用或无法使用本项目而引起的任何性质的任何直接、间接、特殊、偶然或结果性损害（包括但不限于因商誉损失、停工、计算机故障或故障引起的损害赔偿，或任何及所有其他商业损害或损失）由使用者负责。

### 六、使用限制

6.1 本项目完全免费，且开源发布于 GitHub 面向全世界人用作对技术的学习交流。本项目不对项目内的技术可能存在违反当地法律法规的行为作保证。

6.2 **禁止在违反当地法律法规的情况下使用本项目。** 对于使用者在明知或不知当地法律法规不允许的情况下使用本项目所造成的任何违法违规行为由使用者承担，本项目不承担由此造成的任何直接、间接、特殊、偶然或结果性责任。

### 七、版权保护

7.1 音乐平台不易，请尊重版权，支持正版。

### 八、非商业性质

8.1 本项目仅用于对技术可行性的探索及研究，不接受任何商业（包括但不限于广告等）合作及捐赠。

### 九、接受协议

9.1 若你使用了本项目，即代表你接受本协议。

---

若对此有疑问，请通过 [TuneFlow Issues](https://github.com/appdev/TuneFlow/issues) 联系项目维护者。
