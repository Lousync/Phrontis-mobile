import { AppProvider, useApp } from './lib/store'
import { useFormFactor } from './lib/useFormFactor'
import { ShellChrome, Toasts } from './components/chrome'
import { TabletChrome } from './components/TabletChrome'
import { AiPage, SessionSheet } from './components/pages/AiPage'
import { SchedulePage, TodoSheet, HabitForm } from './components/pages/SchedulePage'
import { LedgerPage, TxSheet } from './components/pages/LedgerPage'
import { NotesPage } from './components/pages/NotesPage'
import { QuizPage } from './components/pages/QuizPage'
import { UsagePage } from './components/pages/UsagePage'
import { SettingsPage, AiConfigSheet } from './components/pages/SettingsPage'
import { ScanOverlay } from './components/ScanOverlay'

function Shell() {
  const { activeTab, sheet, kbSim, kbOpen, selDate } = useApp()
  const ff = useFormFactor()
  const p = (id: string) => activeTab === id
  return (
    <>
      {/* kb-open = 键盘占据屏幕（真机 focus 探测 / 桌面模拟）；tablet = 平板形态壳（≥768px，design.md §10） */}
      <div className={'app' + (ff === 'tablet' ? ' tablet' : '') + (kbOpen ? ' kb-open' : '') + (kbSim ? ' kb-sim' : '')}>
        {ff === 'tablet' && <TabletChrome />}
        <main className="pages">
          <AiPage active={p('ai')} />
          <SchedulePage active={p('schedule')} />
          <LedgerPage active={p('ledger')} />
          <NotesPage active={p('notes')} />
          <QuizPage active={p('quiz')} />
          <UsagePage active={p('usage')} />
          <SettingsPage active={p('settings')} />
        </main>
        {ff === 'tablet' ? null : <ShellChrome />}
        {(sheet === 'tx' || sheet === 'tx-edit') && <TxSheet />}
        {sheet === 'todo' && <TodoSheet selDate={selDate} />}
        {sheet === 'habit' && <HabitForm />}
        {sheet === 'sessions' && <SessionSheet />}
        {sheet === 'ai-config' && <AiConfigSheet />}
        {sheet === 'scan' && <ScanOverlay />}
        <Toasts />
      </div>
      {kbSim && <div className="kb-sim-band">模拟输入法区域 · 真机此处为键盘</div>}
    </>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
