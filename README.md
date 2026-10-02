# 曜海社区版

曜海社区版是本地优先的询盘、产品、客户和提醒工作台，需要 Node.js 24 LTS 或更新版本。

## 安装与首次使用

运行 `npm install`，Windows 双击 `启动曜海社区版.bat` 或执行 `npm start`。启动器创建 `data/backups/uploads`，选择可用 localhost 端口，等待 `/api/health` 后打开浏览器。首次打开完成 setup，再使用账号 login。

AI 设置由企业自备模型 API Key；Key 只保存为本地设置，不要写入源码、日志、截图或公开 issue。

## 数据、备份与恢复

运行数据在 `data/community.sqlite`，备份在 `data/backups`，上传文件在 `data/uploads`。通过设置页导出并导入备份；恢复前停止写入并保留原文件副本。生产数据不得提交 Git 或进入发布包。

## 故障处理

检查 Node 版本、端口占用、`data` 写权限和终端错误；页面打不开时访问启动器显示的 `/api/health`。不要公开粘贴 API Key、cookie、数据库或客户数据。

## 社区/商业边界

社区版包含本地业务台、基础 AI 接入、备份和单机运行。企业版授权、管理后台、支付、服务化部署和商业专属功能不属于本仓库，见 `docs/COMMERCIAL-SEPARATION.md`。
