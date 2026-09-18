import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ROUTE_MODE_OPTIONS } from '@/features/route-mode/route-mode-options'
import { RouteModeOptionCard } from '@/features/route-mode/route-mode-option-card'
import { useRouteMode, useRouteModeStore } from '@/features/route-mode/use-route-mode'
import { useTranslation } from '@/i18n/provider'

/**
 * 路由模式弹窗 —— 全局只有这一份，页头的模式按钮和设置页的「生效模式」都只是它的入口。
 *
 * 为什么不用「一个开关直接切」：两个模式的差异大到不是同一个操作的两个取值，
 * 顺手滑过去会让用户在完全没意识到发生了什么的情况下换掉代理的全部行为。
 * 所以这里先把两边**并排摊开**：是什么、差在哪、现在哪个在生效，看清楚再选。
 * 左右并排而不是上下堆叠，是为了让两边逐条对着读（见 `ROUTE_MODE_OPTIONS.traitKeys`）。
 *
 * 选择即生效（不需要再点「确定」），但**切换失败就不收起**：
 * 收起弹窗等于替用户宣布「切好了」，而服务端可能刚拒绝这次写入 ——
 * 失败时留着弹窗，用户看到的就是「还停在原来那个上面」。
 */
export function RouteModeDialog() {
  const open = useRouteModeStore(state => state.dialogOpen)
  const setDialogOpen = useRouteModeStore(state => state.setDialogOpen)
  const { mode, switching, switchMode } = useRouteMode()
  const t = useTranslation()

  const select = async (next: typeof mode) => {
    if (next === mode) {
      setDialogOpen(false)
      return
    }
    const switched = await switchMode(next)
    if (switched) setDialogOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('router.mode.dialog.title')}</DialogTitle>
          <DialogDescription>{t('router.mode.hint')}</DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label={t('router.mode.dialog.title')} className="grid gap-3 sm:grid-cols-2">
          {ROUTE_MODE_OPTIONS.map(option => (
            <RouteModeOptionCard
              key={option.value}
              option={option}
              active={option.value === mode}
              switching={switching}
              onSelect={() => void select(option.value)}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
