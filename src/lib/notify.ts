import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { PermissionStatus } from '@capacitor/local-notifications'
import type { Habit, Todo } from './types'

/**
 * 本地通知（日程提醒 + 打卡提醒）：只在原生壳内工作，浏览器 dev 全部 no-op（权限态返回 'unsupported'）。
 *
 * 权限链路（Android 13+ 通知是运行时权限，Manifest 已声明 POST_NOTIFICATIONS）：
 *   - 启动时 initNotifPermission：prompt 态申请一次；denied 后绝不反复骚扰，设置页「工具」卡有状态行引导；
 *   - v7 插件没有 openSettings，拒绝态只能引导用户去系统设置（应用 → Phrontis → 通知）。
 * 精度：默认 inexact 闹钟（Doze 下可能分钟级漂移）；精确到秒需另申请 SCHEDULE_EXACT_ALARM，v1 不做。
 *
 * 排程模型：todos 或 habits 任一变更后整体重排 —— 取消全部 pending，再按当前列表排
 *   - 待办：未完成、有排期、开始时间在未来的一次性提醒；
 *   - 打卡：未来 7 天逐日排具体时刻（见 rescheduleReminders 注释）。
 * 本 app 的本地通知只有这一个来源（两域共用一个入口），全清重排是安全的。
 * Android 插件对 pending 有 50 条上限：超出时按「时间从近到远」截断（打卡排的是未来 7 天，最远的日子先丢）。
 */

export type NotifPerm = 'granted' | 'denied' | 'prompt' | 'unsupported'

const REMINDER_CHANNEL = 'reminders'

/** 打卡提醒逐日排程的天数：7 天滚动窗。打卡必须在 app 内完成 → 「当天打开过 app」即触发
 * 重排丢掉当日槽；没打开过 = 没打卡 = 提醒该响。7 天内不打开 app，提醒自然过期（打卡用户本就日开）。 */
const HABIT_DAYS = 7

/** Android 插件 pending 通知上限（超量 schedule 会报错）：全量截断保最近的 */
const SCHEDULE_CAP = 50

const native = () => Capacitor.isNativePlatform()

/** 通知渠道：Android 8+ 必须先建；重复创建幂等。
 * v7 的 Importance/Visibility 是纯类型枚举（无运行时导出），直接传数值：3=DEFAULT、1=Public */
async function ensureChannel() {
  await LocalNotifications.createChannel({
    id: REMINDER_CHANNEL,
    name: '提醒（日程 · 打卡）',
    importance: 3,
    visibility: 1,
  })
}

/** 插件的权限态 → 本域四态（'prompt-with-rationale' 归入 prompt，Android 上不会出现） */
const toPerm = (s: PermissionStatus['display']): NotifPerm =>
  s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : 'prompt'

export async function notifPermission(): Promise<NotifPerm> {
  if (!native()) return 'unsupported'
  return toPerm((await LocalNotifications.checkPermissions()).display)
}

/** 启动流程：prompt 态申请一次；授权后建渠道 + 清掉已投递的旧提醒 */
export async function initNotifPermission(): Promise<NotifPerm> {
  if (!native()) return 'unsupported'
  const st = await LocalNotifications.checkPermissions()
  if (st.display === 'granted') {
    await ensureChannel()
    await LocalNotifications.removeAllDeliveredNotifications()
    return 'granted'
  }
  if (st.display === 'denied') return 'denied'
  const after = await LocalNotifications.requestPermissions()
  if (after.display === 'granted') {
    await ensureChannel()
    return 'granted'
  }
  return after.display === 'denied' ? 'denied' : 'prompt'
}

/** 用户主动点按后的申请（设置页状态行用） */
export async function requestNotifPermission(): Promise<NotifPerm> {
  if (!native()) return 'unsupported'
  const after = await LocalNotifications.requestPermissions()
  if (after.display === 'granted') await ensureChannel()
  return toPerm(after.display)
}

/** 任意 key → 通知 id（32 位哈希；几十条量级，碰撞可忽略——全清重排模式下碰撞无副作用） */
function reminderId(key: string): number {
  let h = 5381
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0
  return Math.abs(h)
}

const fmtClock = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/**
 * 重排全部提醒：取消 pending → 按当前待办与习惯重排（原生 + 已授权才有副作用）。
 * 打卡提醒用「具体时刻 × 未来 7 天」而不用 repeats:true 每天重复，原因：
 * repeats 无法感知「今天已打卡」——已打卡仍响是比漏响更差的体验；
 * 具体排程下，当天打开 app（打卡/改习惯/开 app）都触发重排，当日槽按 doneToday 丢弃；
 * 不打开 app = 没打卡 = 到点该响。
 */
export async function rescheduleReminders(todos: Todo[], habits: Habit[], leadMin = 0): Promise<void> {
  if (!native()) return
  if ((await notifPermission()) !== 'granted') return
  await ensureChannel()
  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length) {
    await LocalNotifications.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) })
  }
  /* 提前量（pm.settings.remindLead）：日程与打卡都在「开始时刻」上减 leadMin；
     负偏移跨零点由 Date 自动回退一天，d=0 的「已过点」判断改用偏移后的时刻自然涵盖 */
  const lead = Math.max(0, Math.round(leadMin))
  const now = new Date()
  const todoNotes = todos.flatMap(t => {
    if (t.done || t.parentId || !t.sched) return []
    const [y, m, d] = t.date.split('-').map(Number)
    if (!y || !m || !d) return []
    const at = new Date(y, m - 1, d, Math.floor(t.sched.s / 60), t.sched.s % 60)
    if (lead > 0) at.setMinutes(at.getMinutes() - lead)
    if (isNaN(at.getTime()) || at.getTime() <= now.getTime()) return []
    return [{
      id: reminderId(t.id),
      schedule: { at, allowWhileIdle: true },
      title: t.title,
      body: lead > 0 ? `${lead} 分钟后开始 · ${t.time || fmtClock(t.sched.s)}` : `${t.time || fmtClock(t.sched.s)} 开始`,
      channelId: REMINDER_CHANNEL,
    }]
  })
  const todayIdx = (now.getDay() + 6) % 7
  const habitNotes = habits.flatMap(h => {
    if (h.remind == null) return []
    const rows = []
    for (let d = 0; d < HABIT_DAYS; d++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, Math.floor(h.remind / 60), h.remind % 60)
      if (lead > 0) day.setMinutes(day.getMinutes() - lead)
      // d=0 是今天：已打卡或偏移后时刻已过则跳过；其余天照排（到点时若已打卡，当天更早打开 app 时重排已丢槽）
      if (d === 0 && (h.hist[todayIdx] || day.getTime() <= now.getTime())) continue
      if (isNaN(day.getTime())) continue
      const key = `${h.id}:${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
      rows.push({
        id: reminderId(key),
        schedule: { at: day, allowWhileIdle: true },
        title: h.name,
        body: d === 0 ? '今天的打卡还没完成，记得打卡' : '该打卡了',
        channelId: REMINDER_CHANNEL,
      })
    }
    return rows
  })
  /* 截断保最近：todo 在前（单一时刻，丢了就没了），打卡按天滚动、明天重开 app 会补排 */
  const notifications = [...todoNotes, ...habitNotes]
    .sort((a, b) => new Date(a.schedule.at).getTime() - new Date(b.schedule.at).getTime())
    .slice(0, SCHEDULE_CAP)
  if (notifications.length) await LocalNotifications.schedule({ notifications })
}
