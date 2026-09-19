import { useQuery } from '@tanstack/react-query'
import { storageApi } from '@/api/observability'
import { unwrap } from '@/api/unwrap'

export const storageKeys = { usage: ['storage-usage'] as const }

/**
 * 观测库当前占用的磁盘字节数；还没拿到（或读取失败）时返回 `null`。
 *
 * `staleTime` 给到 30 秒是因为它只在设置页露一次脸：这是个文件 `stat`，读它本身很便宜，
 * 但没有理由让用户在页面上停留时反复问。真正会改变它的动作只有「清理历史日志」，
 * 那条路径自己会失效这个 key（见 `./use-request-log-retention.ts`）。
 *
 * 失败不抛给界面：占用只是一个读数，拿不到就用占位符，不该把整个设置页变成错误页。
 */
export function useStorageUsage(): number | null {
  const query = useQuery({
    queryKey: storageKeys.usage,
    queryFn: () => unwrap(storageApi.usage()),
    staleTime: 30_000,
    retry: false,
  })
  return query.data?.dataBytes ?? null
}
