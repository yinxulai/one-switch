import {
  ChartColumnIncreasing,
  ClipboardList,
  Cog,
  Database,
  GitBranch,
  ListOrdered,
  Plug,
  ScrollText,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AnimatedThemeToggler } from '@/components/ui/animated-theme-toggler'
import { buttonVariants } from '@/components/ui/button'
import { useTranslation } from '@/i18n/provider'
import type { UiCatalogKey } from '@common/i18n/catalogs'

export type PageKey = 'logicalModels' | 'providers' | 'access' | 'rules' | 'router' | 'overview' | 'requests' | 'settings' | 'logs'
export type Theme = 'light' | 'dark'
export type ThemeMode = 'system' | Theme

interface NavItem {
  key: PageKey
  labelKey: UiCatalogKey
  icon: LucideIcon
  sectionKey: UiCatalogKey
}

interface AppSidebarProps {
  activePage: PageKey
  theme: Theme
  proxyRunning: boolean
  proxyPort?: number
  onNavigate: (page: PageKey) => void
  onToggleTheme: () => void
}

const baseNavItems: NavItem[] = [
  { key: 'router', labelKey: 'nav.page.router', icon: GitBranch, sectionKey: 'nav.section.primary' },
  { key: 'logicalModels', labelKey: 'nav.page.logicalModels', icon: ListOrdered, sectionKey: 'nav.section.primary' },
  { key: 'providers', labelKey: 'nav.page.providers', icon: Database, sectionKey: 'nav.section.primary' },
  { key: 'overview', labelKey: 'nav.page.overview', icon: ChartColumnIncreasing, sectionKey: 'nav.section.data' },
  { key: 'requests', labelKey: 'nav.page.requests', icon: ClipboardList, sectionKey: 'nav.section.data' },
  { key: 'rules', labelKey: 'nav.page.rules', icon: SlidersHorizontal, sectionKey: 'nav.section.advanced' },
  { key: 'access', labelKey: 'nav.page.access', icon: Plug, sectionKey: 'nav.section.system' },
  { key: 'logs', labelKey: 'nav.page.logs', icon: ScrollText, sectionKey: 'nav.section.system' },
  { key: 'settings', labelKey: 'nav.page.settings', icon: Cog, sectionKey: 'nav.section.system' },
]

export function AppSidebar(props: AppSidebarProps) {
  const t = useTranslation()
  const navSections = baseNavItems.reduce<Array<{ key: UiCatalogKey; items: NavItem[] }>>((sections, item) => {
    const currentSection = sections.at(-1)
    if (currentSection?.key === item.sectionKey) {
      currentSection.items.push(item)
    } else {
      sections.push({ key: item.sectionKey, items: [item] })
    }
    return sections
  }, [])

  return (
    <div data-slot="app-sidebar" className="group/sidebar absolute inset-y-0 left-0 flex w-12 min-h-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out hover:w-56 motion-reduce:transition-none">
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-3">
        <img src="icon.svg" alt="" className="size-6 shrink-0 transition-[width,height] duration-200 ease-out group-hover/sidebar:size-7 motion-reduce:transition-none" />
        <div className="min-w-0 whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-hover/sidebar:delay-75 motion-reduce:transition-none">
          <h1 className="truncate text-sm font-medium leading-tight tracking-tight">{t('app.windowTitle')}</h1>
          <p className="font-mono system-2xs-medium-uppercase tracking-[1.2px] text-sidebar-foreground/70">{t('app.tagline')}</p>
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto p-1.5">
        {navSections.map(section => (
          <section key={section.key}>
            <h2 className="mb-1 flex h-2 items-center justify-start px-2 system-2xs-medium-uppercase tracking-wider text-sidebar-foreground/70 transition-[height] duration-150 group-hover/sidebar:h-5 motion-reduce:transition-none">
              <span className="px-1 opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-hover/sidebar:delay-75 motion-reduce:transition-none">{t(section.key)}</span>
            </h2>
            <div className="space-y-0.5">
              {section.items.map(item => {
                const ItemIcon = item.icon
                const active = props.activePage === item.key
                return (
                  <button
                    key={item.key}
                    onClick={() => props.onNavigate(item.key)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 system-xs-medium transition-colors',
                      active
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                    )}
                  >
                    <ItemIcon className="size-3.5 shrink-0" />
                    <span className="truncate whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-hover/sidebar:delay-75 motion-reduce:transition-none">{t(item.labelKey)}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className="shrink-0 space-y-1 p-1.5">
        <AnimatedThemeToggler
          theme={props.theme}
          onThemeChange={() => props.onToggleTheme()}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'w-full justify-start gap-2.5 px-2.5')}
        >
          <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-hover/sidebar:delay-75 motion-reduce:transition-none">{props.theme === 'dark' ? t('nav.theme.toLight') : t('nav.theme.toDark')}</span>
        </AnimatedThemeToggler>
        <div className="flex h-7 items-center gap-2.5 px-2.5 system-2xs-regular text-sidebar-foreground/80">
          <span className="flex size-3.5 shrink-0 items-center justify-center" aria-hidden="true">
            <span className={cn('size-1.5 rounded-full', props.proxyRunning ? 'animate-pulse bg-success motion-reduce:animate-none' : 'bg-sidebar-foreground/40')} />
          </span>
          <span className="truncate whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-hover/sidebar:delay-75 motion-reduce:transition-none">{props.proxyRunning ? t('nav.status.running', { port: props.proxyPort ?? 0 }) : t('nav.status.stopped')}</span>
        </div>
      </div>
    </div>
  )
}
