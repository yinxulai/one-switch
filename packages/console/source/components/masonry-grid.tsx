import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { closestCenter, pointerWithin, type CollisionDetection } from '@dnd-kit/core'
import { arrayMove, type SortingStrategy } from '@dnd-kit/sortable'
import { cn } from '@/lib/utils'

/** 瀑布流用隐式行定位，行越小贴合越紧，但浏览器要维护的隐式行也越多，8px 是常见折中。 */
const ROW_HEIGHT = 8
/** 单列最小宽度：卡片里是一张模型表格，再窄就会被挤成两行文字。 */
const DEFAULT_MIN_COLUMN_WIDTH = 420
const DEFAULT_MAX_COLUMNS = 3

export interface MasonryItem {
  /** 稳定 id：排序变化时用它把测量到的高度对应回同一条目。 */
  id: string
  node: ReactNode
}

interface MasonryGridProps {
  items: MasonryItem[]
  /** 行列间距，必须和 toSpan 的换算保持一致，否则会出现重叠或缝隙。 */
  gap?: number
  minColumnWidth?: number
  maxColumns?: number
  className?: string
}

function toSpan(element: HTMLElement, gap: number) {
  // n 行能提供 n * ROW_HEIGHT + (n - 1) * gap 的高度，取刚好放得下卡片的最小 n。
  return Math.max(1, Math.ceil((element.offsetHeight + gap) / (ROW_HEIGHT + gap)))
}

/**
 * 列数切换的死区。
 *
 * 列数会反过来影响内容总高，内容总高决定纵向滚动条在不在，滚动条又占掉几像素可用宽度——
 * 于是在「刚好放得下 / 刚好放不下」的临界宽度上，列数会在 n 与 n + 1 之间反复横跳。
 * 减列时要求宽度比「刚好放得下当前列数」再窄一截，跳一次就能停住。
 */
const COLUMN_HYSTERESIS = 24

interface FitColumnsOptions {
  /** 容器当前可用宽度。 */
  width: number
  /** 当前列数，用于死区判断。 */
  current: number
  itemCount: number
  gap: number
  minColumnWidth: number
  maxColumns: number
}

/** 由可用宽度推算列数：不超过条目数与上限，减列时带死区。 */
export function fitColumns(options: FitColumnsOptions): number {
  const { width, current, itemCount, gap, minColumnWidth, maxColumns } = options
  const perColumn = minColumnWidth + gap
  const ceiling = Math.max(1, Math.min(maxColumns, itemCount))
  // 条目变少时必须立刻收列，这一步不适用死区。
  if (current > ceiling) return ceiling
  const fitted = Math.max(1, Math.min(ceiling, Math.floor((width + gap) / perColumn)))
  if (fitted >= current) return fitted
  const requiredWidth = current * perColumn - gap
  return width > requiredWidth - COLUMN_HYSTERESIS ? current : fitted
}

/**
 * 多列瀑布流布局。
 *
 * 没有用 CSS 多列（`column-count`）：多列容器里的 DOM 顺序是「列优先」，拖动排序时索引和视觉
 * 位置对不上。这里换成 grid + 逐条测量的行跨度，DOM 顺序始终等于显示顺序，条目依然是错落的。
 */
export function MasonryGrid(props: MasonryGridProps) {
  const { items, gap = 16, minColumnWidth = DEFAULT_MIN_COLUMN_WIDTH, maxColumns = DEFAULT_MAX_COLUMNS, className } = props
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [columns, setColumns] = useState(1)
  const [spans, setSpans] = useState<Record<string, number>>({})
  /**
   * 最近一次真正写进 state 的测量结果。
   *
   * 布局副作用里 setState 会同步排一次更新，而 React 并不会因为「值没变」就跳过这次更新；
   * 一旦进入嵌套同步更新链，"提交 → 量一次 → 写 state → 再提交" 就会一直自激，
   * 直到抛 `Maximum update depth exceeded`（见 checkForNestedUpdates）。
   * 有了这两个镜像，重复量到同一组值时一次 setState 都不会发出，循环从结构上就不成立。
   */
  const appliedColumnsRef = useRef(1)
  const appliedSpansRef = useRef<Record<string, number>>({})
  const itemIds = items.map(item => item.id).join('|')

  /** 量一次容器宽度与每条卡片高度，只把「真的变了」的部分写进 state。 */
  const measure = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const nextColumns = fitColumns({
      width: container.clientWidth,
      current: appliedColumnsRef.current,
      itemCount: items.length,
      gap,
      minColumnWidth,
      maxColumns,
    })
    if (nextColumns !== appliedColumnsRef.current) {
      appliedColumnsRef.current = nextColumns
      setColumns(nextColumns)
    }

    const elements = container.querySelectorAll<HTMLElement>('[data-masonry-id]')
    if (elements.length === 0) return

    let changed = false
    const nextSpans: Record<string, number> = {}
    for (const element of elements) {
      const id = element.dataset.masonryId
      if (!id) continue
      // 隐藏或尚未完成 layout 的条目量出来是 0，此时保留上一次算好的跨度，别把它冲成 1。
      if (element.offsetHeight === 0) {
        nextSpans[id] = appliedSpansRef.current[id] ?? 1
        continue
      }
      const span = toSpan(element, gap)
      nextSpans[id] = span
      if (appliedSpansRef.current[id] !== span) changed = true
    }
    // 条目被删掉时顺手丢掉过期的高度记录。
    if (Object.keys(nextSpans).length !== Object.keys(appliedSpansRef.current).length) changed = true
    if (!changed) return
    appliedSpansRef.current = nextSpans
    setSpans(nextSpans)
  }, [gap, items.length, maxColumns, minColumnWidth])

  /**
   * 每次提交后都量一次：在 paint 之前先量，首帧就是瀑布流，不会先闪一帧等高网格。
   *
   * 这里刻意不写依赖数组，代价是每次提交都要读一次布局，换来的是「父级怎么重渲染都不会量错」；
   * 之所以安全，是因为 `measure` 内部已经把「没变化」挡在 setState 之前。
   */
  useLayoutEffect(() => {
    measure()
  })

  // 提交之外的变化（窗口缩放、卡片内部异步内容变高）靠 ResizeObserver 兜住。
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => measure())
    observer.observe(container)
    for (const element of container.querySelectorAll<HTMLElement>('[data-masonry-id]')) observer.observe(element)
    return () => observer.disconnect()
  }, [itemIds, measure])

  return (
    <div
      ref={containerRef}
      className={cn('grid items-start', className)}
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridAutoRows: `${ROW_HEIGHT}px`,
        // dense 让后面的条目回填前面留下的空洞，否则短卡片下方会空出一大块。
        gridAutoFlow: 'row dense',
        gap,
      }}
    >
      {items.map(item => (
        <div key={item.id} data-masonry-id={item.id} className="min-w-0" style={{ gridRowEnd: `span ${spans[item.id] ?? 1}` }}>
          {item.node}
        </div>
      ))}
    </div>
  )
}

/**
 * 瀑布流的碰撞探测。
 *
 * 卡片又大又高，`closestCenter` 比的是卡片中心：抓在卡片角上时，指针早就移到了左边那张卡片上，
 * 目标却还停在右边那张。这里优先看指针落在哪张卡片上，只在指针落进间隙时才退回 `closestCenter`。
 */
export const masonryCollisionDetection: CollisionDetection = args => {
  const pointerCollisions = pointerWithin(args)
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args)
}

/**
 * 瀑布流的排序策略。
 *
 * 不能直接用 `rectSortingStrategy`：它会按目标卡片的高宽缩放卡片，条目高度不一致时会出现
 * 明显的纵向压扁。这里只保留位移，卡片以原尺寸滑向新的位置。
 */
export const masonrySortingStrategy: SortingStrategy = ({ rects, activeIndex, overIndex, index }) => {
  const nextRects = arrayMove(rects, overIndex, activeIndex)
  const currentRect = rects[index]
  const nextRect = nextRects[index]
  if (!currentRect || !nextRect) return null
  return {
    x: nextRect.left - currentRect.left,
    y: nextRect.top - currentRect.top,
    scaleX: 1,
    scaleY: 1,
  }
}
