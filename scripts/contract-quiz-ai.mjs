// 契约测试：AI 错题工具的纯函数（validators + query/stats）
import {
  validateQuizAdd, validateQuizNote, validateQuizDel,
  quizQueryForModel, quizStatsForModel, quizUnmastered,
} from '../src/lib/aiTools.ts'

let pass = 0, fail = 0
const t = (name, cond) => { cond ? pass++ : (fail++, console.log('FAIL:', name)) }

// validateQuizAdd：选择题材
const add1 = validateQuizAdd({
  pageTitle: '操作系统期末试卷', type: 'choice', question: '测试题？',
  options: ['选项一', '选项二', '选项三'], answer: 'b', explanation: '因为',
})
t('quiz_add choice ok', typeof add1 === 'object' && add1.type === 'choice' && add1.answer === 'B' && add1.options.length === 3 && add1.options[1].key === 'B')
// 缺选项
t('quiz_add too few options', typeof validateQuizAdd({ pageTitle: 'x', type: 'choice', question: 'q', options: ['只有一个'], answer: 'A' }) === 'string')
// 答案字母非法
t('quiz_add bad answer key', typeof validateQuizAdd({ pageTitle: 'x', type: 'choice', question: 'q', options: ['一', '二'], answer: 'E' }) === 'string')
// 简答题
const add2 = validateQuizAdd({ pageTitle: 'x', type: 'short', question: '简述', answer: '参考答案' })
t('quiz_add short ok', typeof add2 === 'object' && add2.type === 'short' && add2.answer === '参考答案' && add2.options.length === 0)
// 简答缺参考答案
t('quiz_add short no answer', typeof validateQuizAdd({ pageTitle: 'x', type: 'short', question: '简述' }) === 'string')

// note / del 校验
t('quiz_note ok', typeof validateQuizNote({ pageTitle: 'x', no: 3, note: '口诀' }) === 'object')
t('quiz_note bad no', typeof validateQuizNote({ pageTitle: 'x', no: 0, note: '口诀' }) === 'string')
t('quiz_del ok', typeof validateQuizDel({ pageTitle: 'x', no: 2 }) === 'object')

// query / stats
const recs = [
  { pageTitle: '操作系统', no: 1, wrongCount: 3, streakCorrect: 0, question: '进程状态' },
  { pageTitle: '操作系统', no: 2, wrongCount: 0, streakCorrect: 2, question: 'SJF' },
  { pageTitle: '计算机网络', no: 1, wrongCount: 1, streakCorrect: 1, question: '握手' },
]
t('unmastered def', recs.filter(quizUnmastered).length === 2)
const q = JSON.parse(quizQueryForModel(recs, { book: '操作系统', mastery: 'unmastered' }))
t('query book+mastery', q.count === 1 && q.items[0].question === '进程状态')
const st = JSON.parse(quizStatsForModel(recs))
t('stats totals', st.total === 3 && st.unmastered === 2 && st.byBook['操作系统'].total === 2)

console.log(`pass ${pass} / fail ${fail}`)
if (fail) process.exit(1)
