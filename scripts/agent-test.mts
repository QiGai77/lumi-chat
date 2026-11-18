// AI 接管（v0.24）纯逻辑单测：node scripts/agent-test.mts
import { actionLabel, agentCfg, agentUserText, dangerOf, fingerprint, firstJson, guardSource, mergeCandidates, outcomeText, parseAction, parseElements, pickIndex, screenGate, textNear, type AgentOutcome } from '../src/agentcore.ts'
import { fill, paramsIn, stepLabel, validateFlow, type FlowStep } from '../src/flowcore.ts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log('  ok   ' + name) } else { fail++; console.log('  FAIL ' + name, JSON.stringify(detail)) } }
const act = (r: unknown, w = 1080, h = 2400) => { const p = parseAction(r, w, h); return 'action' in p ? p.action : null }

console.log('动作解析')
ok('文字里的 JSON（带代码块）', act('好的\n```json\n{"thought":"点搜索","action":"tap","id":3}\n```')?.id === 3)
ok('tool call arguments 字符串', act('{"thought":"x","action":"scroll","dir":"up"}')?.dir === 'up')
ok('别名 click → tap', act({ action: 'click', id: 7 })?.type === 'tap')
ok('像素坐标换成比例', (() => { const a = act({ action: 'tap', x: 540, y: 1200 }); return a?.x === 0.5 && a?.y === 0.5 })())
ok('比例坐标原样', act({ action: 'tap', x: 0.25, y: 0.75 })?.x === 0.25)
ok('点击没有 id 也没有坐标 → 错误', 'error' in parseAction({ action: 'tap' }))
ok('坐标在屏幕外 → 错误', 'error' in parseAction({ action: 'tap', x: -0.2, y: 0.5 }))
ok('不认识的动作 → 错误', 'error' in parseAction({ action: 'fly' }))
ok('没有 JSON → 错误', 'error' in parseAction('我觉得应该点搜索'))
ok('input 要有 text', 'error' in parseAction({ action: 'input' }) && act({ action: 'type', text: '耳机' })?.text === '耳机')
ok('note_candidate 单个候选', (() => { const a = act({ action: 'note_candidate', candidate: { name: 'A 耳机', price: '¥199', rating: 4.8 } }); return a?.type === 'note' && a.notes[0].rating === '4.8' })())
ok('任何动作都能顺带候选', act({ action: 'scroll', candidates: [{ name: 'A' }, { name: 'B', price: '¥2' }, { price: '没名字' }] })?.notes.length === 2)
ok('done 带 pick 对象', (() => { const a = act({ action: 'done', summary: '看了 5 款', pick: { name: 'C', reason: '便宜' } }); return a?.pick?.name === 'C' && a.summary === '看了 5 款' })())
ok('done 的 pick 是字符串', act({ action: 'finish', pick: 'D', reason: '评分高' })?.pick?.reason === '评分高')
ok('ask_user 有问题', act({ action: 'ask', question: '要黑色还是白色？' })?.question === '要黑色还是白色？')
ok('wait 限制在 3 秒内', act({ action: 'wait', ms: 99999 })?.ms === 3000)
ok('JSON 字符串里的括号不打断', firstJson('x {"a":"}{","b":{"c":1}} y') === '{"a":"}{","b":{"c":1}}')
ok('「未知」不当作字段值', act({ action: 'note', candidates: [{ name: 'A', shop: '未知' }] })?.notes[0].shop === undefined)

console.log('安全拦截')
const all = agentCfg({}).stopBefore
ok('默认四类都停', all.length === 4 && all.includes('pay'))
ok('关掉付款也会被加回来', agentCfg({ stopBefore: ['send'] }).stopBefore.includes('pay'))
for (const w of ['立即购买', '提交订单', '去结算', '付款', '确认支付', '支付', '发送', '删除', '确认收货', '领券购买', '立即下单'])
  ok(`拦「${w}」`, !!dangerOf(w, all), w)
for (const w of ['搜索', '综合排序', '销量', '加入购物车', '店铺', '评价 2000+', '支付宝', '返回', '筛选'])
  ok(`不拦「${w}」`, !dangerOf(w, all), dangerOf(w, all))
ok('文字里有空格也拦', dangerOf('提 交 订 单', all)?.kind === 'submit')
ok('付款类别正确', dangerOf('确认支付 ¥279', all)?.kind === 'pay')
ok('去下单模式：立即购买放行', !dangerOf('立即购买', all, 'order'))
ok('去下单模式：提交订单仍然拦', dangerOf('提交订单', all, 'order')?.kind === 'submit')
ok('去下单模式：付款仍然拦', dangerOf('立即付款', all, 'order')?.kind === 'pay')
ok('关掉删除后不拦删除', !dangerOf('删除', agentCfg({ stopBefore: ['pay', 'submit', 'send'] }).stopBefore))
ok('原生正则源能匹配', new RegExp(guardSource(all)).test('立即购买') && !new RegExp(guardSource(all)).test('支付宝'))
ok('原生正则源（去下单）不含立即购买', !new RegExp(guardSource(all, 'order')).test('立即购买') && new RegExp(guardSource(all, 'order')).test('提交订单'))

console.log('屏幕')
const dump = `当前应用：com.taobao.taobao\n屏幕：1080x2400\n[0] EditText "蓝牙耳机" {可点,可输入,焦点} @540,140\n[1] TextView "搜索" {可点} @1000,140\n[2] View "示例耳机 C 主动降噪" (商品) {可点} @300,700\n[3] TextView "¥279" @300,820\n[4] Button (立即购买) {可点} @900,2300`
const els = parseElements(dump)
ok('解析元素', els.length === 5 && els[2].text === '示例耳机 C 主动降噪' && els[2].desc === '商品' && els[4].desc === '立即购买' && els[0].flags.includes('可输入'), els)
ok('坐标附近的文字', textNear(els, 900 / 1080, 2300 / 2400, 1080, 2400).includes('立即购买'))
ok('指纹忽略焦点', fingerprint(dump) === fingerprint(dump.replace(',焦点', '')))
ok('指纹随内容变化', fingerprint(dump) !== fingerprint(dump.replace('¥279', '¥299')))
ok('普通页面不是登录页', screenGate(dump) === null)
ok('滑块验证', screenGate('[0] TextView "请按住滑块，拖动到最右边" @1,1')?.kind === 'captcha')
ok('登录页', screenGate('[0] TextView "登录" @1,1\n[1] EditText "请输入手机号" {可输入} @1,2\n[2] Button "获取验证码" @1,3')?.kind === 'login')
ok('密码登录', screenGate('[0] TextView "密码登录" {可点} @1,1')?.kind === 'login')

console.log('候选与提示词')
let c = mergeCandidates([], [{ name: '示例耳机 A 半入耳', price: '¥199' }], 1)
c = mergeCandidates(c, [{ name: '示例耳机 A 半入耳', rating: '4.8' }, { name: '示例耳机 B' }], 2)
ok('同名合并字段、新的追加', c.length === 2 && c[0].price === '¥199' && c[0].rating === '4.8' && c[1].turn === 2, c)
ok('选中按名字模糊匹配', pickIndex(c, '示例耳机 A 半入耳蓝牙') === 0 && pickIndex(c, '不存在的') === -1)
const cfg = agentCfg({ goal: '比较 5 款耳机', criteria: '300 以内', maxSteps: 10 })
const ut = agentUserText({ cfg, turn: 9, elapsedS: 40, cands: c, history: ['- 第 1 轮 点击'], elements: dump })
ok('提示词带目标、标准、候选、收尾提示', ut.includes('比较 5 款耳机') && ut.includes('300 以内') && ut.includes('示例耳机 B') && ut.includes('收尾'), ut)
ok('去下单模式提示词', agentUserText({ cfg: { ...cfg, mode: 'order' }, turn: 1, elapsedS: 0, cands: [], history: [], elements: '' }).includes('绝对不点提交订单'))
ok('默认模型 argon、25 轮、5 分钟', agentCfg({ goal: 'x' }).model === 'argon' && agentCfg({ goal: 'x' }).maxSteps === 25 && agentCfg({ goal: 'x' }).maxMinutes === 5)
ok('轮数夹在 1-60', agentCfg({ maxSteps: 500 }).maxSteps === 60)
ok('动作文字', actionLabel(act({ action: 'tap', id: 2 })!, '示例耳机 C') === '点击「示例耳机 C」')
const o: AgentOutcome = { id: 'x', status: 'safety', at: 0, cfg, summary: '', reason: 'AI 准备点「提交订单」', candidates: c, turns: [], modelCalls: 3, modelMs: 1, ms: 9000, blocked: { kind: 'submit', word: '提交订单', target: '提交订单' } }
ok('结果文字说明停在哪', outcomeText(o).includes('停在「提交订单」前'))

console.log('Flow 里的 agent 步')
const steps: FlowStep[] = [{ kind: 'launch', app: '淘宝' }, { kind: 'input', text: '{关键词}' }, { kind: 'agent', goal: '比较 5 款{关键词}', criteria: '{预算}' }, { kind: 'tap', sel: { text: '收藏' } }]
ok('参数从 goal / criteria 里提取', JSON.stringify(paramsIn(steps)) === JSON.stringify(['关键词', '预算']), paramsIn(steps))
const filled = fill(steps, { 关键词: '耳机', 预算: '300 以内' })
ok('fill 填 goal 和 criteria', filled[2].goal === '比较 5 款耳机' && filled[2].criteria === '300 以内')
ok('agent 后面可以接步骤，校验通过', validateFlow(steps).filter(x => x.startsWith('错误')).length === 0, validateFlow(steps))
ok('agent 可以放在循环里', validateFlow([{ kind: 'for', var: 'i', from: 1, to: 2 }, { kind: 'agent', goal: '看第 ${i} 个' }, { kind: 'endfor' }]).filter(x => x.startsWith('错误')).length === 0)
ok('没有目标报错', validateFlow([{ kind: 'agent', goal: ' ' }]).some(x => x.startsWith('错误') && x.includes('AI 接管')))
ok('轮数超范围报错', validateFlow([{ kind: 'agent', goal: 'x', maxSteps: 100 }]).some(x => x.startsWith('错误')))
ok('步骤文字', stepLabel({ kind: 'agent', goal: '挑一款' }) === 'AI 接管：挑一款')

console.log(`${pass} 通过，${fail} 失败`)
if (fail) process.exit(1)
