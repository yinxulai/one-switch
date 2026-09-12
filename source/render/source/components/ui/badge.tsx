import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md px-2 py-0.5 system-2xs-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-state-accent-solid has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:bg-destructive/10 aria-invalid:text-text-destructive [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary: "bg-inset text-text-secondary [a]:hover:bg-state-base-hover",
        destructive:
          "bg-destructive/10 text-text-destructive [a]:hover:bg-destructive/20",
        outline:
          "bg-transparent text-text-secondary ring-1 ring-inset ring-border [a]:hover:bg-state-base-hover [a]:hover:text-text-primary",
        ghost:
          "text-text-tertiary hover:bg-state-base-hover hover:text-text-primary",
        link: "text-primary underline-offset-4 hover:underline",
        success: "bg-success/10 text-text-success [a]:hover:bg-success/20",
        warning: "bg-warning/10 text-text-warning [a]:hover:bg-warning/20",
        info: "bg-info/10 text-info [a]:hover:bg-info/20",
        muted: "bg-inset text-text-tertiary [a]:hover:bg-state-base-hover",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
