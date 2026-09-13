// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { ClientAddressStep } from './client-address-step'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/features/settings/hooks', () => ({ useSettings: () => null }))

const ORIGIN = 'http://127.0.0.1:19300'

function Wrapper(props: { children: ReactNode }) {
  return <I18nProvider>{props.children}</I18nProvider>
}

function renderStep(onCopy: (key: string, value: string) => void = () => {}) {
  render(<ClientAddressStep origin={ORIGIN} copiedKey={null} onCopy={onCopy} />, { wrapper: Wrapper })
}

describe('ClientAddressStep', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
  })

  it('默认选中 OpenAI 兼容，只给带 /v1 的 Base URL', () => {
    renderStep()

    expect(screen.getByText(`${ORIGIN}/v1`)).toBeTruthy()
    // 回归点：不带 /v1 的那条是 Anthropic 的 Base URL，不能同时出现。
    expect(screen.queryByText(ORIGIN)).toBeNull()
  })

  it('切到 Anthropic 后 Base URL 收在端口为止，不再带 /v1', () => {
    renderStep()

    // Radix 的 Tabs 在自动激活模式下于获焦时切换。
    fireEvent.focus(screen.getByRole('tab', { name: 'Anthropic' }))

    expect(screen.getByText(ORIGIN)).toBeTruthy()
    expect(screen.queryByText(`${ORIGIN}/v1`)).toBeNull()
  })

  it('复制按钮给到的是当前客户端的那一条地址', () => {
    const onCopy = vi.fn()
    renderStep(onCopy)

    fireEvent.focus(screen.getByRole('tab', { name: 'Anthropic' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Base URL' }))

    expect(onCopy).toHaveBeenCalledWith('base-url:anthropic', ORIGIN)
  })

  it('完整接口地址随类型切换，且始终是根地址加路径', () => {
    renderStep()

    expect(screen.getByText(`${ORIGIN}/v1/chat/completions`)).toBeTruthy()
    expect(screen.getByText(`${ORIGIN}/v1/responses`)).toBeTruthy()

    fireEvent.focus(screen.getByRole('tab', { name: 'Anthropic' }))

    expect(screen.getByText(`${ORIGIN}/v1/messages`)).toBeTruthy()
    expect(screen.queryByText(`${ORIGIN}/v1/chat/completions`)).toBeNull()
  })

  it('根地址为空时显示占位符并禁用复制，布局不变', () => {
    render(<ClientAddressStep origin="" copiedKey={null} onCopy={() => {}} />, { wrapper: Wrapper })

    // 一条 Base URL + OpenAI 的三条完整地址都用占位符占位，而不是整块消失。
    expect(screen.getAllByText('—')).toHaveLength(4)
    expect((screen.getByRole('button', { name: 'Copy Base URL' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
