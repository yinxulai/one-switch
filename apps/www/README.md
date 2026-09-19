# apps/www — 产品官网

logo、名字、功能与下载链接的纯净态落地页。**Vite + React + TypeScript + Tailwind v4**，
构建为纯静态产物（`output/`），由 **Cloudflare Worker（Workers + Static Assets）** 托管。

## 技术栈（为什么这么选）

- **Vite + React + TS + Tailwind v4**：与 `packages/console` 完全同栈，直接复用设计 token、
  logo（`public/icon.svg`）与「不用阴影、发丝边框分模块」的视觉约定，不引入新框架。
  明确不用 Next.js：这是无 SSR 需求的静态落地页，Vite 产物更简单、更快、更小。
- **部署 = Workers + Static Assets**：Vite 产物原样上传，Worker 只多一条下载路由。
  纯静态「纯净态」托管，构建与部署交给 Cloudflare 侧的 Workers Git 集成，仓库里不放部署流水线。

## 本地

```bash
pnpm --filter @osw/www dev        # Vite dev server（端口 5174）
pnpm --filter @osw/www build      # 构建静态产物到 output/
pnpm --filter @osw/www preview    # 本地预览构建产物
pnpm --filter @osw/www deploy:dry-run   # wrangler 干跑（校验配置与 worker 打包）
pnpm --filter @osw/www dev:worker # 本地跑 worker + 静态资源 + R2
```

## 多语言（i18next）

用 **i18next + react-i18next**，但**中文不建资源表**：中文是兜底语言，文案直接写在
`t(key, '中文')` 的第二个参数里（`source/App.tsx`），英文才在 `source/i18n.ts` 里有一份资源表。

```tsx
const { t, i18n } = useTranslation()
t('downloads.title', '下载')                       // en 表里没有就回落到 '下载'
t('downloads.version', '当前版本 · v{{version}}', { version })  // 插值
i18n.changeLanguage('zh')                          // 切语言（组件自动重渲）
```

好处是**永远不会漏翻译**：新增文案时先在 JSX 里写中文兜底，英文表漏了就显示中文，而不是显示 key。
初始化语言按 `navigator.language` 猜（`zh*` → 中文），识别不到也是中文；`<html lang>` 跟随界面语言。

加文案的流程：在 `App.tsx` 里写 `t('<域>.<叶子>', '中文')`，需要英文时再去 `i18n.ts` 的 `en`
对象补同名 key（用嵌套对象，别在 key 里写点号以外的结构）。

> 注意：`apps/www` 不在根 `eslint.config.js` 的 `i18n/no-hardcoded-cjk` 规则范围内
> （那段只覆盖 `apps/app`、`apps/cli`、`packages/*`），所以这里内联中文不会被 lint 拦。

## 部署（Cloudflare Workers · Git 集成）

**不走 GitHub Actions。** 由 Cloudflare 侧的 **Workers Builds** 直连本仓库：push 到生产分支即构建 + 部署
（Dashboard → Workers & Pages → 本项目 → Settings → Build）。

在 Cloudflare 项目里填：

| 项 | 值 |
| --- | --- |
| Git 仓库 / 生产分支 | `yinxulai/osw` · `main` |
| Root directory | `apps/www` |
| Build command | `pnpm install && pnpm build` |
| Deploy command | `npx wrangler deploy` |
| Version command（非生产分支） | `npx wrangler versions upload` |

> Build / Deploy / Version 三条命令的**工作目录就是 Root directory**（`apps/www`），
> 所以不需要 `--config`、也不需要 `cd`。Deploy 命令用于生产分支：直接、永久地发布。
> Version 命令用于预览分支：只上传一个版本，不接收流量、不动生产。二者只能填其一为空，
> 否则每次 push 都会同时发一次线上。
> `wrangler` 不进 `dependencies`，用 `npx` 临时取一份即可（npx 会优先用仓库里已有的）。

要点与坑：

- **包管理器**：`pnpm-lock.yaml` 在仓库根，而 Root directory 指向子目录时 Cloudflare 未必能自动识别。
  在 Build 的 **Variables and secrets** 里加 `PNPM_VERSION`（与仓库根 `packageManager` 同版）最稳。
- **wrangler.toml 就在仓库里**（`apps/www/wrangler.toml`），Git 集成会直接用它——含 `[assets]` 静态资源
  与 R2 绑定，无需在 Dashboard 里重复配绑定。
- **自定义域名**：`wrangler.toml` 的 `routes` 已声明绑定。前提是该 zone 在同一账号下；否则删掉 `routes`，
  改到 Workers → Settings → Domains & Routes 手动绑定。
- **R2 桶要先建好**（名字与 `wrangler.toml` 的 `bucket_name` 一致），否则部署会因绑定缺失失败。

本地想手动部署一次：`pnpm --filter @osw/www deploy`（需先 `wrangler login` 或配 `CLOUDFLARE_API_TOKEN`）。

## 下载（站内直接下载，不跳 GitHub）

安装包由 release 工作流生成（命名见 `apps/app/electron-builder.config.cjs` 的
`artifactName`，形如 `OSW-<version>-<os>-<arch>.<ext>`），上传到 R2 桶。Worker 路由
`/~asset/<platform>`（`mac` / `win` / `linux`）在桶里按平台匹配最新对象并流式返回。

### 发版后把安装包上传到 R2（手动，需先配好 R2 凭证）

```bash
cd apps/www
# 每个平台一个命令，路径里的版本号与当前发布版本一致（也可直接 `r2 cp` 整个目录）
wrangler r2 object put osw-downloads/1.1.0-beta.14/OSW-1.1.0-beta.14-mac-arm64.dmg --file ../../release/1.1.0-beta.14/OSW-1.1.0-beta.14-mac-arm64.dmg
wrangler r2 object put osw-downloads/1.1.0-beta.14/OSW-1.1.0-beta.14-win-x64.exe --file ../../release/1.1.0-beta.14/OSW-1.1.0-beta.14-win-x64.exe
wrangler r2 object put osw-downloads/1.1.0-beta.14/OSW-1.1.0-beta.14-linux-x86_64.AppImage --file ../../release/1.1.0-beta.14/OSW-1.1.0-beta.14-linux-x86_64.AppImage
```

> 前端下载卡片里的版本号来自仓库根 `package.json` 的 `version`（构建期注入）。发版后若
> R2 桶没有对应版本的目录，下载会 404——两者必须一致。Worker 侧是「按平台取最新对象」，
> 不依赖这个版本号。

### 校验

```bash
curl -I https://osw.yinxulai.com/              # 200，HTML
curl -I https://osw.yinxulai.com/~asset/mac    # 302/200，Content-Disposition: attachment
```

## 目录

```text
apps/www/
  source/            # React 应用
    App.tsx          # 单页落地（hero + 功能 + 下载 + 页脚）
    i18n.ts          # i18next 初始化 + 英文资源表（中文是兜底语言，见下）
    downloads.ts     # 前端下载卡片（平台 → 版本对象路径）
    platforms.ts     # 平台清单（前端与 worker 共用）
    index.css        # Tailwind v4 入口 + 基础样式
    main.tsx / vite-env.d.ts
  worker/index.ts    # Cloudflare Worker（静态托管 + 下载路由）
  public/icon.svg    # 官方 logo（自 packages/console/public/icon.svg 复制的副本；改 logo 以真源为准同步覆盖）
  wrangler.toml      # Workers + Static Assets + R2 绑定
  vite.config.ts / tsconfig.json / index.html
```
