export interface SseEvent {
  event?: string
  data: string
}

export function parseSseIncremental(buffer: string): [SseEvent[], string] {
  const events: SseEvent[] = []
  let rest = buffer
  const boundary = /\r?\n\r?\n/
  for (;;) {
    const match = boundary.exec(rest)
    if (!match || match.index < 0) break
    const raw = rest.slice(0, match.index)
    rest = rest.slice(match.index + match[0].length)
    let eventName: string | undefined
    const dataLines: string[] = []
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue
      const separator = line.indexOf(':')
      const field = separator < 0 ? line : line.slice(0, separator)
      const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '')
      if (field === 'event') eventName = value
      else if (field === 'data') dataLines.push(value)
    }
    if (dataLines.length > 0) events.push({ event: eventName, data: dataLines.join('\n') })
  }
  return [events, rest]
}

export function serializeSseEvent(event: SseEvent): string {
  let out = ''
  if (event.event) out += `event: ${event.event}\n`
  out += `data: ${event.data}\n\n`
  return out
}
