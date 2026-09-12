import { useEffect, useRef, useState } from 'react'
import { useToast } from '@/components/ui/toast'

const FEEDBACK_DURATION = 1500

/**
 * 复制到剪贴板，并用 key 记录当前处于「已复制」状态的按钮，
 * 让同一页面上多个复制入口各自独立反馈，不会互相点亮。
 */
export function useCopyToClipboard() {
  const toast = useToast()
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const copy = async (key: string, value: string): Promise<void> => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setCopiedKey(null), FEEDBACK_DURATION)
      toast.success('已复制到剪贴板')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制失败')
    }
  }

  return { copiedKey, copy }
}
