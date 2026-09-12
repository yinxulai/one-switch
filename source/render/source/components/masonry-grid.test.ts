import { describe, expect, it } from 'vitest'
import type { ClientRect } from '@dnd-kit/core'
import { fitColumns, masonrySortingStrategy } from './masonry-grid'

function rect(top: number, left: number, width: number, height: number): ClientRect {
  return { top, left, width, height, right: left + width, bottom: top + height }
}

/**
 * 两列瀑布流：索引 0/1 在第一行、2/3 在第二行，第 1 条比其它条目高，用来模拟错落的布局。
 */
const rects = [
  rect(0, 0, 200, 100),
  rect(0, 216, 200, 180),
  rect(116, 0, 200, 100),
  rect(196, 216, 200, 100),
]

function displace(index: number, activeIndex: number, overIndex: number) {
  return masonrySortingStrategy({ rects, activeIndex, overIndex, index, activeNodeRect: rects[activeIndex] })
}

describe('masonrySortingStrategy', () => {
  it('只做位移，不缩放卡片', () => {
    for (const index of [0, 1, 2, 3]) {
      expect(displace(index, 0, 2)).toMatchObject({ scaleX: 1, scaleY: 1 })
    }
  })

  it('向上拖动时，被跨过的条目整体上移', () => {
    // 把第 0 条拖到第 2 条的位置：第 1 条补到左上角，第 2 条让到第二列。
    expect(displace(1, 0, 2)).toEqual({ x: -216, y: 0, scaleX: 1, scaleY: 1 })
    expect(displace(2, 0, 2)).toEqual({ x: 216, y: -116, scaleX: 1, scaleY: 1 })
    // 没有被跨过的条目保持原位。
    expect(displace(3, 0, 2)).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1 })
  })

  it('向下拖动时，被跨过的条目整体下移', () => {
    // 把第 3 条拖到第 0 条的位置：前三条依次往后挪一格。
    expect(displace(0, 3, 0)).toEqual({ x: 216, y: 0, scaleX: 1, scaleY: 1 })
    expect(displace(1, 3, 0)).toEqual({ x: -216, y: 116, scaleX: 1, scaleY: 1 })
    expect(displace(2, 3, 0)).toEqual({ x: 216, y: 80, scaleX: 1, scaleY: 1 })
  })

  it('量不到卡片尺寸时返回空变换，交给 dnd-kit 用指针位移兜底', () => {
    expect(masonrySortingStrategy({ rects: [], activeIndex: 0, overIndex: 0, index: 0, activeNodeRect: null })).toBeNull()
  })
})

const fitOptions = { width: 0, current: 1, itemCount: 4, gap: 16, minColumnWidth: 420, maxColumns: 3 }
const fit = (width: number, current: number, extra: Partial<Omit<typeof fitOptions, 'width' | 'current'>> = {}) =>
  fitColumns({ ...fitOptions, width, current, ...extra })

describe('fitColumns', () => {
  // 每列占 420 + 16，两列至少要 856 可用宽度，三列至少要 1292。
  it('宽度够就往上加列，并受条目数与列数上限约束', () => {
    expect(fit(420, 1)).toBe(1)
    expect(fit(856, 1)).toBe(2)
    expect(fit(1292, 1)).toBe(3)
    expect(fit(4000, 1)).toBe(3)
    expect(fit(4000, 1, { maxColumns: 2 })).toBe(2)
    expect(fit(4000, 1, { itemCount: 2 })).toBe(2)
    expect(fit(100, 1)).toBe(1)
  })

  it('条目数减少时立刻收列，不受死区阻挡', () => {
    expect(fit(2000, 3, { itemCount: 1 })).toBe(1)
  })

  it('减列留死区：滚动条级别的宽度变化不会让列数跳变', () => {
    // 两列需要 856，掉到 848（滚动条占掉 8px）时仍保持两列……
    expect(fit(848, 2)).toBe(2)
    // ……一直要掉出 24px 死区（≤ 832）才真的收成一列。
    expect(fit(833, 2)).toBe(2)
    expect(fit(832, 2)).toBe(1)
    expect(fit(801, 2)).toBe(1)
  })

  it('同一宽度反复取值会收敛到不动点，不会在两种列数之间震荡', () => {
    // 848 同时是「一列」和「两列」的不动点：进去之后就出不来，这正是要的粘滞。
    expect(fit(848, fit(848, 2))).toBe(2)
    expect(fit(848, fit(848, 1))).toBe(1)
    // 在阈值两侧交错取值也不会来回跳。
    let columns = 1
    for (const width of [856, 848, 890, 848, 860, 848]) columns = fit(width, columns)
    expect(columns).toBe(2)
    expect(fit(848, columns)).toBe(2)
  })
})
