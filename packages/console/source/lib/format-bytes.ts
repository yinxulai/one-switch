const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'] as const

/**
 * 按 1024 进制把一个字节数读成人话。
 *
 * 指数做了上限裁剪：观测库真涨到 TB 级时也只会显示 `TB` 量级的大 GB 数，不会因为
 * 数组越界吐出 `undefined`。一位小数够用——这个数字是给人看趋势的，不是给人做算术的。
 */
export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1)
  return `${(bytes / 1024 ** exponent).toFixed(1)} ${BYTE_UNITS[exponent]}`
}
