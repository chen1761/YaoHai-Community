# 曜海社区版

曜海社区版是本地优先的询盘、产品、客户和提醒工作台，需要 Node.js 24 LTS 或更新版本。

## 安装与首次使用

运行 `npm install`，Windows 双击 `启动曜海社区版.bat` 或执行 `npm start`。启动器创建 `data/backups/uploads`，选择可用 localhost 端口，等待 `/api/health` 后打开浏览器。首次打开完成 setup，再使用账号 login。

AI 设置由企业自备模型 API Key；Windows 优先使用当前用户 DPAPI 加密保存。DPAPI 不可用时，服务会返回 `configuration_required`，请在启动服务的环境中设置 `YH_COMMUNITY_SECRET_KEY` 后重试。Key 只保存为本地设置，不要写入源码、日志、截图或公开 issue。

## 数据、备份与恢复

运行数据在 `data/community.sqlite`，备份在 `data/backups`，上传文件在 `data/uploads`。通过设置页导出并导入备份；恢复前停止写入并保留原文件副本。生产数据不得提交 Git 或进入发布包。

发布前可设置 `REQUIRE_SECRET_REVOCATION=1` 启用旧密钥撤销门禁，并通过 `YH_SECRET_REVOCATION_EVIDENCE` 指向真实的供应商控制台证据 JSON（包含 `status: "revoked"`、`provider`、`revokedAt`、`evidenceUrl`）。检查器只验证证据存在和格式，不伪造或声称已撤销；未提供真实证据时发布检查会失败。

## 故障处理

检查 Node 版本、端口占用、`data` 写权限和终端错误；页面打不开时访问启动器显示的 `/api/health`。不要公开粘贴 API Key、cookie、数据库或客户数据。

## 社区/商业边界

社区版包含本地业务台、基础 AI 接入、备份和单机运行。企业版授权、管理后台、支付、服务化部署和商业专属功能不属于本仓库，见 `docs/COMMERCIAL-SEPARATION.md`。
