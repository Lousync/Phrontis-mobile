import { AppProvider, useApp } from './lib/store'
import { TabBar, Toasts, TopBar } from './components/chrome'
import { AiPage, SessionSheet } from './components/pages/AiPage'
import { SchedulePage, TodoSheet } from './components/pages/SchedulePage'
import { LedgerPage, TxSheet } from './components/pages/LedgerPage'
import { NoteSheet, NotesPage } from './components/pages/NotesPage'
import { UsagePage } from './components/pages/UsagePage'
import { QrSheet, SettingsPage } from './components/pages/SettingsPage'

function Shell() {
  const { activeTab, sheet } = useApp()
  const p = (id: string) => activeTab === id
  return (
    <div className="app">
      <TopBar />
      <main className="pages">
        <AiPage active={p('ai')} />
        <SchedulePage active={p('schedule')} />
        <LedgerPage active={p('ledger')} />
        <NotesPage active={p('notes')} />
        <UsagePage active={p('usage')} />
        <SettingsPage active={p('settings')} />
      </main>
      <TabBar />
      {sheet === 'tx' && <TxSheet />}
      {sheet === 'todo' && <TodoSheet />}
      {sheet === 'note' && <NoteSheet />}
      {sheet === 'sessions' && <SessionSheet />}
      {sheet === 'qr' && <QrSheet />}
      <Toasts />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
