import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ThemeMode } from '@/components/app-sidebar'

interface AppUiState {
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
  /**
   * 新用户引导是否已经走完。
   *
   * 存在本地 UI 偏好里（而不是服务端设置）：它描述的是「这台机器上这个人见没见过引导」，
   * 换一台机器重新见一次引导是对的；放进服务端设置反而会跟着同步走。
   * 首页据此决定落在引导页还是智能路由。
   */
  onboardingComplete: boolean
  setOnboardingComplete: (complete: boolean) => void
}

export const useAppUiStore = create<AppUiState>()(persist(
  set => ({
    themeMode: 'system',
    setThemeMode: themeMode => set({ themeMode }),
    onboardingComplete: false,
    setOnboardingComplete: onboardingComplete => set({ onboardingComplete }),
  }),
  {
    name: 'one-switch-ui',
  },
))
