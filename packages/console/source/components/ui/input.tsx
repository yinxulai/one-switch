import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * 输入框外观对齐 router 节点面板（上游 UI 包的 `input/index.tsx`）：
 * 透明描边 → 悬停/聚焦才显形，底色走 `components-input-*` token，排版用 13px。
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-8 w-full min-w-0 rounded-lg border border-transparent bg-components-input-bg-normal px-3 py-1.5 text-[13px] leading-4 text-components-input-text-filled transition-colors outline-none",
        "placeholder:text-components-input-text-placeholder",
        "hover:border-components-input-border-hover hover:bg-components-input-bg-hover",
        "focus:border-components-input-border-active focus:bg-components-input-bg-active",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-transparent disabled:bg-components-input-bg-disabled disabled:text-components-input-text-filled-disabled",
        "aria-invalid:border-destructive aria-invalid:focus:ring-2 aria-invalid:focus:ring-destructive/20",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-[13px] file:font-medium file:text-text-primary",
        className
      )}
      {...props}
    />
  )
}

export { Input }
