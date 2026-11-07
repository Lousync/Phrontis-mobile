import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { PermissionStatus } from '@capacitor/local-notifications'
import type { Todo } from './types'

/**
 * 本地通知（日程提醒 v1）：只在原生壳内工作，浏览器 dev 全部 no-op（权限态返回 'unsupported'）。
 *
 * 权限链路（Android 13+ 通知是运行时权限，Manifest 已声明 POST_NOTIFICATIONS）：
 *   - 启动时 initNotifPermission：prompt 态申请一次；denied 后绝不反复骚扰，设置页「工具」卡有状态行引导；
 *   - v7 插件没有 openSettings，拒绝态只能引导用户去系统设置（应用 → Phrontis → 通知）。
 * 精度：默认 inexact 闹钟（Doze 下可能分钟级漂移）；精确到秒需另申请 SCHEDULE_EXACT_ALARM，v1 不做。
 *
 * 排程模型：todos 任一变更后整体重排 —— 取消全部 pending 再按当前列表排
 * 「未完成、有排期、开始时间在未来」的事项。本 app 的本地通知只有这一个来源，全清重排是安全的。
 */

export type NotifPerm = 'granted' | 'denied' | 'prompt' | 'unsupported'

const REMINDER_CHANNEL = 'reminders'

const native = () => Capacitor.isNativePlatform()

/** 通知渠道：Android 8+ 必须先建；重复创建幂等。
 * v7 的 Importance/Visibility 是纯类型枚举（无运行时导出），直接传数值：3=DEFAULT、1=Public */
async function ensureChannel() {
  await LocalNotifications.createChannel({
    id: REMINDER_CHANNEL,
    name: '日程提醒',
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

/** todo id → 通知 id（32 位哈希；量级几十条，碰撞可忽略） */
function reminderId(id: string): number {
  let h = 5381
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

const fmtClock = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** 重排全部提醒：取消 pending → 按当前待办重排（原生 + 已授权才有副作用） */
export async function rescheduleTodoReminders(todos: Todo[]): Promise<void> {
  if (!native()) return
  if ((await notifPermission()) !== 'granted') return
  await ensureChannel()
  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length) {
    await LocalNotifications.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) })
  }
  const now = Date.now()
  const notifications = todos.flatMap(t => {
    if (t.done || t.parentId || !t.sched) return []
    const [y, m, d] = t.date.split('-').map(Number)
    if (!y || !m || !d) return []
    const at = new Date(y, m - 1, d, Math.floor(t.sched.s / 60), t.sched.s % 60)
    if (isNaN(at.getTime()) || at.getTime() <= now) return []
    return [{
      id: reminderId(t.id),
      schedule: { at, allowWhileIdle: true },
      title: t.title,
      body: `${t.time || fmtClock(t.sched.s)} 开始`,
      channelId: REMINDER_CHANNEL,
    }]
  })
  if (notifications.length) await LocalNotifications.schedule({ notifications })
}
