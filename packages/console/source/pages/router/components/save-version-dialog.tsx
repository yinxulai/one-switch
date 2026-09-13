import { useEffect, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useTranslation } from '@/i18n/provider'

/** 与 `SaveRouterGraphSchema` 的上限一致：前端先拦住，省掉一次「填完才被服务端拒」的往返。 */
const NAME_MAX_LENGTH = 60
const DESCRIPTION_MAX_LENGTH = 200

export interface RouterGraphVersionDraft {
  name: string
  description: string
}

type SaveVersionDialogProps = {
  open: boolean
  /** 这一版会拿到的版本号，用于展示「保存为 v几」；版本号是版本的身份，不写进名字里。 */
  nextVersion: number
  /**
   * 画布上这份内容改自哪一版 —— 沿用它的名字与说明作为输入框初值。
   *
   * 连着存好几版时用户敲的往往是同一个名字，每次让他重敲一遍没有意义。
   * 没有来源版本（空白起点、套用预设）时传空串，两个框都留空。
   */
  initialName: string
  initialDescription: string
  saving: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (draft: RouterGraphVersionDraft) => void
}

/**
 * 保存新版本时收集「名字 + 说明」。
 *
 * 两者都只是可选备注：不参与路由，留空就真的落空串。版本的唯一身份是版本号本身（列表里的 `v{n}`），
 * 所以名字不需要唯一、也不需要用「Version N」这类自动名去占位 —— 同名多版完全正常，靠版本号区分。
 * 因此这里不做校验、不拦提交，只把两个字段收齐交给调用方。
 *
 * 初值取「画布内容改自的那一版」：改一版存一版是常态，让用户把同一个名字重敲一遍纯属找麻烦。
 *
 * 用表单而不是两个裸按钮：名称框里敲回车就应该提交，这是这类弹窗的默认期待。
 */
export function SaveVersionDialog(props: SaveVersionDialogProps) {
  const { open, nextVersion, initialName, initialDescription, saving, onOpenChange, onConfirm } = props
  const t = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  /**
   * 打开的那一刻把上一版的名字与说明灌进来，之后不再跟着 props 走。
   *
   * 只在 `false → true` 的那一次赋值：保存失败时弹窗故意不关，若写成「props 一变就覆盖」，
   * 上层默认值一旦变化就会把用户刚敲进去的字冲掉。
   */
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setName(initialName)
      setDescription(initialDescription)
    }
    wasOpen.current = open
  }, [open, initialName, initialDescription])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    onConfirm({ name: name.trim(), description: description.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('router.saveDialog.title', { version: nextVersion })}</DialogTitle>
          <DialogDescription>{t('router.saveDialog.description')}</DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={submit}>
          <FormField
            label={t('router.saveDialog.nameLabel')}
            htmlFor="router-version-name"
            hint={t('router.saveDialog.nameHint')}
          >
            <Input
              id="router-version-name"
              value={name}
              maxLength={NAME_MAX_LENGTH}
              onChange={event => setName(event.target.value)}
              // 留空就真的没名字，所以这里给的是格式示范，不是「会存成什么」。
              placeholder={t('router.saveDialog.namePlaceholder')}
              autoFocus
            />
          </FormField>

          <FormField
            label={t('router.saveDialog.descriptionLabel')}
            htmlFor="router-version-description"
            hint={t('router.saveDialog.descriptionHint')}
          >
            <Textarea
              id="router-version-description"
              value={description}
              maxLength={DESCRIPTION_MAX_LENGTH}
              onChange={event => setDescription(event.target.value)}
              placeholder={t('router.saveDialog.descriptionPlaceholder')}
              rows={3}
            />
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
              {t('common.action.cancel')}
            </Button>
            {/* 提交按钮放在 form 里，回车与点击走同一条路径。 */}
            <Button type="submit" disabled={saving}>
              {saving ? t('router.saveDialog.submitting') : t('router.saveDialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
