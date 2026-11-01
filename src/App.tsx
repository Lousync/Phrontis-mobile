import { AppProvider, useApp } from './lib/store'
import { ShellChrome, Toasts } from './components/chrome'
import { AiPage, SessionSheet } from './components/pages/AiPage'
import { SchedulePage, TodoSheet } from './components/pages/SchedulePage'
import { LedgerPage, TxSheet } from './components/pages/LedgerPage'
import { NoteSheet, NotesPage } from './components/pages/NotesPage'
import { UsagePage } from './components/pages/UsagePage'
import { SettingsPage } from './components/pages/SettingsPage'

function Shell() {
  const { activeTab, sheet, kbSim, kbOpen, selDate } = useApp()
  const p = (id: string) => activeTab === id
  return (
    <>
      {/* kb-open = 键盘占据屏幕（真机 focus 探测 / 桌面模拟） */}
      <div className={'app' + (kbOpen ? ' kb-open' : '') + (kbSim ? ' kb-sim' : '')}>
        <main className="pages">
          <AiPage active={p('ai')} />
          <SchedulePage active={p('schedule')} />
          <LedgerPage active={p('ledger')} />
          <NotesPage active={p('notes')} />
          <UsagePage active={p('usage')} />
          <SettingsPage active={p('settings')} />
        </main>
        <ShellChrome />
        {(sheet === 'tx' || sheet === 'tx-edit') && <TxSheet />}
        {sheet === 'todo' && <TodoSheet selDate={selDate} />}
        {sheet === 'note' && <NoteSheet />}
        {sheet === 'sessions' && <SessionSheet />}
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
