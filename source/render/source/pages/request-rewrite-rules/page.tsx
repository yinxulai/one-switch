import { useEffect, useMemo, useState } from 'react'
import { Plus, ShieldCheck } from 'lucide-react'
import { requestRewriteRuleApi } from '@/api/models'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslation, type AppTranslator } from '@/i18n/provider'
import { RuleEditorDialog } from './components/rule-editor-dialog'
import { RuleStats } from './components/rule-stats'
import { RulesTable } from './components/rules-table'
import { formatJsonActionValue, parseJsonActionValue, type RequestRewriteRule, type RuleStatusFilter } from './types'
import type { RequestRewriteRule as ApiRequestRewriteRule, Protocol } from '@common/schemas'

function toUiRule(rule: ApiRequestRewriteRule): RequestRewriteRule { return { id: rule.id, name: rule.name, description: rule.description, enabled: rule.enabled, global: rule.scope === 'global', protocols: rule.match.clientProtocols, match: { clientProtocols: rule.match.clientProtocols, upstreamProtocols: rule.match.upstreamProtocols }, actions: rule.actions.map((action, index) => ({ id: `${rule.id}-action-${index}`, stage: action.stage, target: action.type.startsWith('header-') ? 'header' : 'body', operation: action.type.endsWith('set') ? 'set' : action.type.endsWith('append') ? 'append' : action.type.endsWith('remove') || action.type.endsWith('delete') ? 'remove' : 'replace', path: 'name' in action ? action.name : action.path, value: 'value' in action ? (action.type === 'body-set' ? formatJsonActionValue(action.value) : String(action.value)) : 'search' in action ? action.search : undefined, replacement: 'replacement' in action ? action.replacement : undefined, regex: 'regex' in action ? action.regex : undefined })), testCases: rule.testCases.map(testCase => ({ ...testCase })), boundProviders: 0, updatedTime: rule.updatedTime } }
function toApiRule(rule: RequestRewriteRule): Omit<ApiRequestRewriteRule, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'> {
  return {
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    scope: rule.global ? 'global' : 'model',
    schemaVersion: 1,
    source: 'user',
    match: { clientProtocols: rule.protocols, upstreamProtocols: rule.match.upstreamProtocols as Protocol[] },
    actions: rule.actions.map(action => {
      if (action.target === 'header') {
        if (action.operation === 'remove') return { type: 'header-remove', stage: action.stage, name: action.path }
        return { type: action.operation === 'append' ? 'header-append' : 'header-set', stage: action.stage, name: action.path, value: action.value ?? '' }
      }
      if (action.operation === 'remove') return { type: 'body-delete', stage: action.stage, path: action.path }
      if (action.operation === 'replace') return { type: 'body-replace', stage: action.stage, path: action.path, search: action.value ?? '', replacement: action.replacement ?? '', regex: action.regex ?? false }
      return { type: 'body-set', stage: action.stage, path: action.path, value: parseJsonActionValue(action.value) }
    }),
    testCases: rule.testCases,
  }
}

function createRule(t: AppTranslator): RequestRewriteRule {
  const id = `rule-${Date.now()}`
  return {
    id,
    name: t('rules.untitled'),
    description: '',
    enabled: true,
    global: false,
    protocols: [],
    match: { clientProtocols: [], upstreamProtocols: [] },
    actions: [{ id: `${id}-action`, stage: 'request', target: 'header', operation: 'set', path: '', value: '' }],
    testCases: [],
    boundProviders: 0,
    updatedTime: null,
  }
}

export function RequestRewriteRulesPage() {
  const t = useTranslation()
  const toast = useToast()
  const [rules, setRules] = useState<RequestRewriteRule[]>([])
  const [editingRuleId, setEditingRuleId] = useState('')
  const [draft, setDraft] = useState<RequestRewriteRule>(() => createRule(t))
  const [loading, setLoading] = useState(true)
  useEffect(() => { void requestRewriteRuleApi.list().then(result => { if (result.success) { const next = result.data.map(toUiRule); setRules(next); if (next[0]) { setEditingRuleId(next[0].id); setDraft(next[0]) } } setLoading(false) }) }, [])
  const [editorOpen, setEditorOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RequestRewriteRule | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<RuleStatusFilter>('all')

  const savedRule = rules.find(rule => rule.id === editingRuleId)
  const dirty = draft.updatedTime === null
    || (savedRule ? JSON.stringify(savedRule) !== JSON.stringify(draft) : false)
  const filteredRules = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase()
    return rules.filter(rule => {
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'enabled' ? rule.enabled : !rule.enabled)
      const searchable = [rule.name, rule.description, ...rule.actions.flatMap(action => [action.target, action.operation, action.path, action.value ?? ''])]
        .join(' ')
        .toLocaleLowerCase()
      return matchesStatus && (!keyword || searchable.includes(keyword))
    })
  }, [rules, search, statusFilter])

  const editRule = (rule: RequestRewriteRule) => {
    setEditingRuleId(rule.id)
    setDraft(rule)
    setEditorOpen(true)
  }

  const addRule = () => {
    const next = createRule(t)
    editRule(next)
  }

  const saveRule = () => { void (async () => { const result = draft.updatedTime === null ? await requestRewriteRuleApi.create(toApiRule(draft)) : await requestRewriteRuleApi.update(draft.id, toApiRule(draft)); if (!result.success) { toast.error(result.errorMessage); return }; const next = toUiRule(result.data); setRules(current => current.some(rule => rule.id === next.id) ? current.map(rule => rule.id === next.id ? next : rule) : [next, ...current]); setDraft(next); setEditingRuleId(next.id); setEditorOpen(false); toast.success(t('rules.saved')) })() }

  const duplicateRule = (source: RequestRewriteRule = draft) => {
    const copy: RequestRewriteRule = {
      ...source,
      id: `rule-${Date.now()}`,
      name: t('rules.duplicateSuffix', { name: source.name }),
      global: false,
      boundProviders: 0,
      updatedTime: null,
      actions: source.actions.map((action, index) => ({ ...action, id: `action-${Date.now()}-${index}` })),
      testCases: source.testCases.map((testCase, index) => ({ ...testCase, id: `test-${Date.now()}-${index}` })),
    }
    editRule(copy)
  }

  const deleteRule = (target: RequestRewriteRule) => { void (async () => { const result = await requestRewriteRuleApi.remove(target.id); if (!result.success) { toast.error(result.errorMessage); return }; setRules(current => current.filter(rule => rule.id !== target.id)); setDeleteTarget(null); setEditorOpen(false); toast.success(t('rules.deleted')) })() }

  return (
    <PageLayout>
      <PageHeader
        title={t('rules.title')}
        description={t('rules.description')}
        actions={(
          <div className="flex items-center gap-2">
            <Button type="button" onClick={addRule}><Plus /> {t('rules.create')}</Button>
          </div>
        )}
      />
      <PageContent>
        {loading && <div className="system-xs-regular text-text-tertiary">{t('rules.loading')}</div>}
        <div className="flex items-center gap-2 rounded-lg border border-info/20 bg-info/8 px-3 py-2 system-xs-regular text-text-tertiary">
          <ShieldCheck className="size-3.5 shrink-0 text-info" />
          {t('rules.notice')}
        </div>
        <RuleStats rules={rules} />
        <RulesTable
          rules={filteredRules}
          search={search}
          statusFilter={statusFilter}
          onSearchChange={setSearch}
          onStatusFilterChange={setStatusFilter}
          onEdit={editRule}
          onDuplicate={duplicateRule}
          onDelete={setDeleteTarget}
          onToggle={(rule, enabled) => { setRules(current => current.map(item => item.id === rule.id ? { ...item, enabled } : item)); void requestRewriteRuleApi.update(rule.id, toApiRule({ ...rule, enabled })) }}
        />
        <RuleEditorDialog
          open={editorOpen}
          rule={draft}
          dirty={dirty}
          onOpenChange={setEditorOpen}
          onChange={setDraft}
          onSave={saveRule}
          onReset={() => savedRule && setDraft(savedRule)}
        />
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          title={t('rules.delete.title', { name: deleteTarget?.name ?? '' })}
          description={t('rules.delete.description')}
          confirmLabel={t('rules.delete.confirm')}
          variant="destructive"
          onConfirm={() => deleteTarget && deleteRule(deleteTarget)}
          onOpenChange={open => !open && setDeleteTarget(null)}
        />
      </PageContent>
    </PageLayout>
  )
}
