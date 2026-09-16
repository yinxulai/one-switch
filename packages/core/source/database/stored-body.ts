import { deflateSync, inflateSync } from 'node:zlib'
import { customType } from 'drizzle-orm/sqlite-core'

/**
 * 正文在库里的两种形态。
 *
 * 正文是观测库里唯一随请求长度线性膨胀的部分，而它在磁盘上占的体积远大于它的信息量：
 * 实测一份 6.9 GB 的观测库里，四个正文列合计 6.92 GB，用 zlib 按第 1 档压一遍只剩
 * 1.29 GB（18.7%，约 5.4 倍）。所以正文**压缩后落库**，读的时候再解开——存进去和取出来
 * 的是同一串字节，不丢任何内容（与「超过上限就砍掉尾巴」的做法相反）。
 *
 * 两种形态共用一个列：
 *
 *   - `string`：原样的纯文本。小于 {@link COMPRESSION_MINIMUM_BYTES} 的正文走这条，
 *     以及本次改动之前写下的所有旧行。
 *   - `Uint8Array`：zlib 压缩后的字节。SQLite 的列亲和性是 `TEXT`，而 BLOB 值在
 *     `TEXT` 亲和性下原样保留（亲和性只把数值转成文本），因此同一列能同时容纳两者，
 *     不需要新增列、不需要判别标记、也不需要数据迁移。
 *
 * 压缩级别取 1（默认是 6）：正文写入发生在请求路径上，CPU 应当省给代理本身。实测同一
 * 份数据「第 1 档 18.7% / 第 6 档 16.5% / brotli 质量 5 的 14.7%」——多花一倍以上的
 * CPU 只换来两三个百分点。压缩效率本身不是这个改动的目的，把「无上限增长」变成
 * 「有上限增长」才是。
 */
export type StoredBody = string | Uint8Array

/**
 * 小于这个字节数的正文不压缩。
 *
 * zlib 有自己的壳（2 字节头 + 4 字节校验，外加独立的 deflate 块开销），几百字节的
 * 正文压完通常只剩一成左右的收益，却要让每次读取都多走一遍解压；更重要的是，
 * 小正文保持纯文本意味着**用任何 SQLite 工具打开这个库都能直接看懂大部分行**，
 * 调试价值远大于省下的那几十字节。
 */
const COMPRESSION_MINIMUM_BYTES = 512

/** zlib 压缩级别，取值理由见文件头。 */
const COMPRESSION_LEVEL = 1

/**
 * 把正文压成落库形态。压缩后反而更大时保留原文——「压缩」不能变成「膨胀」。
 */
export function packBody(body: string | null): StoredBody | null {
  if (body === null) return null
  const raw = Buffer.from(body, 'utf8')
  if (raw.length < COMPRESSION_MINIMUM_BYTES) return body
  const packed = deflateSync(raw, { level: COMPRESSION_LEVEL })
  return packed.length < raw.length ? packed : body
}

/**
 * 把落库形态还原成正文。
 *
 * 两种形态都由 `typeof` 判定，也就是「谁写进来的谁自己认得」：压缩形态一定是
 * `Uint8Array`（node:sqlite 对 BLOB 的返回类型），文本形态一定是 `string`
 * （`TEXT` 亲和性下 BLOB 不会被转成字符串）。这个判别不需要任何额外标记，
 * 因此旧行与新行不需要区分处理，也就不存在「兼容分支」。
 *
 * 解压失败不吞异常：那说明这一行不是本项目写进去的，静默返回空串或占位符
 * 会把「库坏了」伪装成「这条日志没采集到正文」，而后者会让人去查采集逻辑。
 */
export function unpackBody(stored: unknown): string | null {
  if (stored === null || stored === undefined) return null
  if (typeof stored === 'string') return stored
  if (stored instanceof Uint8Array) return inflateSync(stored).toString('utf8')
  throw new Error(`Unexpected stored body type: ${typeof stored}`)
}

/**
 * 正文列。契约层（`@common/schemas`）看到的始终是 `string | null`，
 * 压缩与解压发生在这张列定义里，写入侧与读取侧都不需要知道它。
 */
export const storedBody = customType<{ data: string | null; driverData: StoredBody | null }>({
  // 声明成 `text`：列亲和性不参与压缩形态的判定（见 `unpackBody`），
  // 保持 `text` 也让这次改动**不产生任何 schema 变更**，因此不需要迁移。
  dataType: () => 'text',
  toDriver: packBody,
  fromDriver: unpackBody,
})
