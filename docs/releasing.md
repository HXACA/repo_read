# 发布流程

本文记录把 `@reporead/core` + `@reporead/cli` 发布到 npm 的步骤。`@reporead/web` 不发布（`private: true`），由 `repo-read browse` 内嵌启动。

## 一次性准备

1. 确保 `npm login` 或 `pnpm login` 登录了有权限发布 `@reporead/*` scope 的账号
2. 把各 `package.json` 里 `YOUR_ORG` 占位符替换成真实 GitHub 组织 / 用户名：
   - `packages/core/package.json`: `homepage`, `repository.url`, `bugs.url`
   - `packages/cli/package.json`: 同上
3. 确认 `main` 分支的 CI 已经全绿

## 发布前检查

```bash
# 全套测试必须绿
pnpm --filter @reporead/core test

# 所有包干净构建
pnpm -r run clean
pnpm -r run build

# 类型检查
pnpm -r run typecheck

# 打包预览（看实际会 ship 哪些文件）
cd packages/core && npm pack --dry-run && cd ../..
cd packages/cli  && npm pack --dry-run && cd ../..
```

`npm pack --dry-run` 会列出 tarball 里的每个文件。确认：
- `dist/` 里的 `.js` 和 `.d.ts` 都在
- `README.md` + `LICENSE` 都在
- 没有 `src/`、`__tests__/`、`tsconfig.tsbuildinfo` 之类的多余文件

## Bump 版本

两个包的版本应当同步（CLI 依赖 `@reporead/core` 的 `workspace:*`；发布时 pnpm 会替换成精确版本）。

```bash
# 手动改两个包的 version，或者用 pnpm 一起 bump：
pnpm --filter "@reporead/*" exec npm version patch   # 0.1.0 -> 0.1.1
# 或 minor / major
```

## 发布

```bash
# Core 先发（CLI 依赖它）
cd packages/core
pnpm publish --access public

# CLI 后发
cd ../cli
pnpm publish --access public
```

`prepublishOnly` 会自动跑 `build` + `test`（core）或 `build`（cli）。如果任何一步失败，发布中止。

## 发布后

1. 在 GitHub 打 release tag：`v0.1.1`（与 `package.json` 一致）
2. 更新 README 顶部的安装说明，让用户可以直接 `npm install -g @reporead/cli`
3. 在 Discussions / 公告渠道说明新版本改动

## 常见问题

**`workspace:*` 没被替换**

pnpm publish 应当自动把 `workspace:*` 改写为当前 `@reporead/core` 的版本号。若看到 tarball 里还保留 `workspace:*`，用 `--no-git-checks` 绕不开，需要改 pnpm 配置或升级 pnpm 版本。

**`@reporead/cli` 装完 `repo-read` 命令找不到**

全局装（`npm install -g`）时 npm 会自动把 `bin.repo-read` 链到 PATH。如果用了 pnpm store mode 可能需要 `pnpm setup` 一次。

**撤回一个版本**

在发布后 72 小时内可以 `npm unpublish @reporead/cli@0.1.1`。超过 72 小时只能通过 deprecate：`npm deprecate @reporead/cli@0.1.1 "此版本存在 XXX 问题，请升级到 0.1.2"`。
