/**
 * 主进程 console → 运行日志。
 *
 * 主进程写不了 `runtime_logs`：`node:sqlite` 的 `DatabaseSync` 是同步 API，把它放回主进程
 * 就会重新变成「一条查询卡一下界面」（见 issue #9），所以数据库住在服务进程里。于是这里的
 * 做法和渲染进程一样——把输出送过那条 RPC（`logs.write`），由服务按与
 * `installLogCapture()` 相同的路径落库。
 *
 * 两处顺序上的讲究：
 *   1. **拦截要早于任何输出**。横幅是启动期唯一一组「服务之外」的信息（Electron 版本、
 *      数据目录、进程号），漏掉它就等于这次改动没意义，所以 `installLogForwarding()` 必须在
 *      `logStartupBanner()` 之前调用。
 *   2. **通道比第一行日志晚得多**。服务进程要起进程、开数据库，横幅发出时它还不存在，
 *      所以这个模块先攒着（有上限），等 `setLogSink()` 把落点接上再补送。时间戳随行带上，
 *      补送只是记晚了几百毫秒，不会把「这行发生在启动最早」这件事抹掉。
 *
 * 转发是**旁路**：拿不到落点就攒着，攒满了丢最早的，任何情况下都不反向影响 `console`。
 * 一个会因为日志送不出去而抛异常的主进程，比少记几行日志糟得多。
 */

/** 待补送的行数上限。启动期不会真的攒到这么多，它只是防止服务永远起不来时无限吃内存。 */
const MAX_PENDING_LINES = 500

/** 转发出去的一行。字段与 `packages/core/source/host/protocol.ts` 的 `HostLogLine` 一一对应。 */
export interface ForwardedLogLine {
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  timestamp: number
}

export type LogSink = (line: ForwardedLogLine) => void

const pending: ForwardedLogLine[] = []
let sink: LogSink | null = null
let installed = false

/**
 * console 方法到日志级别的映射。
 *
 * `log` 归到 `info`、和核心那边的 `installLogCapture()` 保持一致：运行日志页面按级别筛选
 * 时，同一种输出在两个进程里必须落在同一个桶里。
 */
const LEVELS: ReadonlyArray<readonly [string, ForwardedLogLine['level']]> = [
  ['log', 'info'],
  ['info', 'info'],
  ['warn', 'warn'],
  ['error', 'error'],
  ['debug', 'debug'],
]

/**
 * 把一行 console 参数压成字符串。
 *
 * 形状与核心 `log-buffer.ts` 的 `formatArgs` 一致，但**不能**复用那个函数：它在
 * `packages/core` 里，import 它会把数据库模块（`node:sqlite`）拖进主进程。为此这里重写一份
 * ——两边的差别只允许是「谁格式化」，落库格式由服务那一侧统一决定。
 */
function formatArgs(args: unknown[]): string {
  return args
    .map(arg => {
      if (typeof arg === 'string') return arg
      if (arg instanceof Error) return arg.stack ?? arg.message
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    })
    .join(' ')
}

function capture(level: ForwardedLogLine['level'], args: unknown[]): void {
  const line: ForwardedLogLine = { level, message: formatArgs(args), timestamp: Date.now() }
  if (sink !== null) {
    sink(line)
    return
  }
  pending.push(line)
  if (pending.length > MAX_PENDING_LINES) pending.splice(0, pending.length - MAX_PENDING_LINES)
}

/**
 * 接管主进程的 `console`，原样透传到 stdout。
 *
 * 幂等：`bootstrap()` 只跑一次，但重复调用不该把 console 包成两层。
 */
export function installLogForwarding(): void {
  if (installed) return
  installed = true

  // `console` 的类型把每个方法都写成了具体签名，逐个赋值的联合类型收窄很啰嗦；
  // 这里只关心「五个同形状的方法」，所以借一层索引签名去看它。
  const target = console as unknown as Record<string, (...args: unknown[]) => void>
  for (const [method, level] of LEVELS) {
    const original = target[method].bind(console)
    target[method] = (...args: unknown[]) => {
      capture(level, args)
      original(...args)
    }
  }
}

/**
 * 接上落点，并把之前攒下的行按原顺序补送。
 *
 * `null` 表示落点没了（比如服务已停）：之后的输出重新回到待送队列。
 */
export function setLogSink(next: LogSink | null): void {
  sink = next
  if (next === null) return
  while (pending.length > 0) {
    next(pending.shift() as ForwardedLogLine)
  }
}
