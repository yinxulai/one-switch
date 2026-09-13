import * as React from "react"

import { cn } from "@/lib/utils"

/** 多行输入框外观对齐 router 节点面板，与 `Input` 使用同一组 token。 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-transparent bg-components-input-bg-normal px-3 py-2 text-[13px] leading-5 text-components-input-text-filled transition-colors outline-none",
        "placeholder:text-components-input-text-placeholder",
        "hover:border-components-input-border-hover hover:bg-components-input-bg-hover",
        "focus:border-components-input-border-active focus:bg-components-input-bg-active",
        "disabled:cursor-not-allowed disabled:border-transparent disabled:bg-components-input-bg-disabled disabled:text-components-input-text-filled-disabled",
        "aria-invalid:border-destructive aria-invalid:focus:ring-2 aria-invalid:focus:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
