# 蒙电题库通

桌面端离线题库工具，面向题库导入、练习、考试、备份，以及 macOS 下的系统级答题助手场景。

## 功能概览

- 导入题库文件，当前支持 `docx`、`txt`、`xlsx`
- 维护题库、题目、考试模板与练习记录
- 提供总览面板，查看题库规模、正确率、错题与最近考试结果
- 支持整库备份、题库包导入导出
- 提供系统级答题助手
  - 优先读取系统可访问文本
  - 文本缺失时回退到本地 OCR
  - 在鼠标附近展示答案与匹配置信度

## 技术栈

- Electron
- React 18
- TypeScript
- Ant Design
- better-sqlite3
- 本地 OCR 运行时：`@gutenye/ocr-node`

## 开发环境

- Node.js `24.x`
- pnpm `10.x`
- macOS 下可额外构建原生答题助手 helper

## 快速开始

```bash
pnpm install
pnpm dev
```

首次执行 `pnpm dev` / `pnpm build` 时，会自动准备以下内容：

- 图标资源
- macOS assistant helper
- `tools/ocr-runtime` 的独立运行时依赖

## 常用命令

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm smoke
pnpm package:mac
pnpm package:win
pnpm package:linux
```

打包产物默认输出到 `release/`。

## 答题助手说明

macOS 下启用系统级答题助手时，通常需要为 `MengdianAssistantHelper` 授权：

- 辅助功能
- 屏幕录制

授权入口在应用内“设置与备份 -> 答题助手 -> 申请系统权限”。

如果你已经授权但界面仍显示未授权，先完全退出应用后再重新打开，再到“运行诊断”里确认以下信息：

- `权限主体`
- `Helper 路径`
- `Helper Bundle ID`

当前实现优先用辅助功能文本读取，全屏外部应用无法直接读取时会回退到本地 OCR，并由原生 helper 在鼠标附近显示提示气泡。

## CI

仓库内已包含 GitHub Actions 工作流：

- `verify`
  - `lint`
  - `typecheck`
  - `test`
  - `smoke`
- `package`
  - macOS / Windows / Linux 打包
- `draft-release`
  - 手动触发并生成草稿发布

## 目录结构

```text
src/main        Electron 主进程、数据库、导入与答题助手逻辑
src/preload     preload bridge
src/renderer    React 前端界面
native          macOS 原生 helper
scripts         构建与资源准备脚本
tests           单元测试与 smoke 测试
tools/ocr-runtime  本地 OCR 运行时目录
```
