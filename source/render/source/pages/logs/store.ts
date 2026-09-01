import { create } from 'zustand'
import type { LogEntry } from '@common/schemas'

export type LevelFilter = 'all' | LogEntry['level']

interface LogsUiState {
  page: number
  live: boolean
  levelFilter: LevelFilter
  searchText: string
  setPage: (page: number) => void
  setLive: (value: boolean | ((current: boolean) => boolean)) => void
  setLevelFilter: (level: LevelFilter) => void
  setSearchText: (text: string) => void
}

export const useLogsUiStore = create<LogsUiState>(set => ({
  page: 1,
  live: true,
  levelFilter: 'all',
  searchText: '',
  setPage: page => set({ page }),
  setLive: value => set(state => ({ live: typeof value === 'function' ? value(state.live) : value })),
  setLevelFilter: levelFilter => set({ page: 1, levelFilter }),
  setSearchText: searchText => set({ page: 1, searchText }),
}))
