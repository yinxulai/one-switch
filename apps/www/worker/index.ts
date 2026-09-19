// 站点 Worker：Workers + Static Assets 托管 + 一条「站内直接下载」路由。
//
// 静态资源（Vite 产物 `output/`）由 `[assets]` 交给 Workers Static Assets 处理，
// 这里不碰它们——只要没有命中下面的下载路由，就原样返回静态资源。
//
// 下载路由 `/~asset/<platform>`：列出 R2 桶、按平台在文件名里匹配最新版本对象，
// 流式转发给用户，「在站内直接下载、不跳转 GitHub」。平台识别规则见
// `source/platforms.ts`。

import { PLATFORMS } from '../source/platforms'

// Cloudflare 运行期类型手写声明，不引入 `@cloudflare/workers-types`：
// 统一 typecheck（`packages/toolkit/tsconfig.check.json`）把 Worker 与 React 源码放进同一个
// 程序，而那套全局类型会与 `lib.dom` 的 `Request`/`Response` 重复声明而冲突。
// 这里只描述真正用到的运行时形状，与 `apps/apis` 的做法一致。
interface R2ObjectBody {
  key: string
  httpEtag: string
  body: ReadableStream
  writeHttpMetadata(headers: Headers): void
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>
  list(options?: { cursor?: string }): Promise<{
    objects: { key: string }[]
    truncated: boolean
    cursor?: string
  }>
}

export interface Env {
  DOWNLOADS: R2Bucket
  /** Static Assets 绑定（`wrangler.toml` 的 `[assets] binding`）。 */
  ASSETS: { fetch(request: Request): Promise<Response> }
}

const DOWNLOAD_EXTENSIONS = ['.dmg', '.exe', '.AppImage']

/** 从桶里挑出该平台最新的一个安装包对象。返回其 key；没有匹配返回 null。 */
async function latestAssetFor(bucket: R2Bucket, match: string): Promise<string | null> {
  // `list` 分页返回（每页最多 1000 条，本桶只有几个安装包，一页即可）。
  // 取文件名字典序最大者：同平台文件名前缀一致（`OSW-<version>-<platform>-`），
  // 版本段等长时字典序≈语义序，所以「最新版本」≈字典序最大。
  let latest: string | null = null
  let cursor: string | undefined
  do {
    const listed = await bucket.list({ cursor })
    for (const obj of listed.objects) {
      const ok = DOWNLOAD_EXTENSIONS.some((ext) => obj.key.includes(match) && obj.key.endsWith(ext))
      if (ok && (!latest || obj.key > latest)) latest = obj.key
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)

  return latest
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const m = /^\/~asset\/([a-z]+)$/.exec(url.pathname)
    const platform = m ? PLATFORMS.find((p) => p.id === m[1]) : undefined

    if (platform) {
      const key = await latestAssetFor(env.DOWNLOADS, platform.match)
      if (!key) {
        return new Response('Not Found', { status: 404 })
      }
      const object = await env.DOWNLOADS.get(key)
      if (!object) {
        return new Response('Not Found', { status: 404 })
      }
      const headers = new Headers()
      object.writeHttpMetadata(headers)
      headers.set('etag', object.httpEtag)
      // 直接触发下载，文件名取自桶内对象名（`OSW-<version>-<platform>-<arch>.<ext>`）。
      headers.set(
        'content-disposition',
        `attachment; filename="${decodeURIComponent(key.split('/').pop() ?? 'download')}"`,
      )
      return new Response(object.body, { headers })
    }

    // 其余路径交给 Static Assets（找不到时返回 404）。
    return env.ASSETS.fetch(request)
  },
}
