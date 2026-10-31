import { useState } from 'react'
import { AppProvider, useApp } from './lib/store'
import { TabBar, Toasts, TopBar } from './components/chrome'
import { AiPage, SessionSheet } from './components/pages/AiPage'
import { SchedulePage, TodoSheet } from './components/pages/SchedulePage'
import { LedgerPage, TxSheet } from './components/pages/LedgerPage'
import { NoteSheet, NotesPage } from './components/pages/NotesPage'
import { UsagePage } from './components/pages/UsagePage'
import { SettingsPage } from './components/pages/SettingsPage'

function Shell() {
  const { activeTab, sheet } = useApp()
  /* 桌面 letterbox 专用：模拟输入法占位（真机 <480px 时按钮不渲染），验证键盘弹起时贴底控件上提 */
  const [kbSim, setKbSim] = useState(false)
  const p = (id: string) => activeTab === id
  return (
    <>
      <div className={'app' + (kbSim ? ' kb-sim' : '')}>
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
        <Toasts />
      </div>
      <button className={'kb-sim-toggle' + (kbSim ? ' on' : '')} onClick={() => setKbSim(s => !s)}>
        {kbSim ? '关闭模拟输入法' : '模拟输入法'}
      </button>
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
