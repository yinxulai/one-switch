import { createContext, useContext, type ReactNode } from 'react'
import { toast as sonnerToast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface ToastContextValue {
  toast: (message: string, type?: ToastType, duration?: number) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
}

interface ToastProviderProps {
  children: ReactNode
}

const ToastContext = createContext<ToastContextValue | null>(null)

/** sonner 自己的 API 已经够稳定，这里只做薄封装，所以函数全部提到模块作用域。 */
const showToast = (message: string, type: ToastType = 'info', duration = 4000) => {
  sonnerToast[type](message, { duration })
}

/**
 * context value 是模块级常量。
 *
 * 原来它在 `ToastProvider` 里每次渲染都重新构造一个对象（连同里面的 5 个箭头函数），
 * 于是 `useToast()` 的返回值引用每次都变。任何把 `toast` / `toast.error` 写进
 * `useCallback`、`useEffect` 依赖数组的地方，都会跟着每次重渲染重跑一遍，
 * 而这类重跑经常带 `setState`——正是最容易演变成 `Maximum update depth exceeded` 的那类写法。
 * 现在引用恒定，这类级联从源头消失。
 */
const TOAST_VALUE: ToastContextValue = {
  toast: showToast,
  success: message => sonnerToast.success(message),
  error: message => sonnerToast.error(message, { duration: 6000 }),
  info: message => sonnerToast.info(message),
  warning: message => sonnerToast.warning(message),
}

export function ToastProvider(props: ToastProviderProps) {
  return (
    <ToastContext.Provider value={TOAST_VALUE}>
      {props.children}
      <Toaster position="bottom-right" />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
