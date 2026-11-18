// Flow 纯逻辑单测（node 22+ 直接跑 TS：node scripts/flow-test.mts）。
// 同时把几个「TS 展开后」的步骤写到 scripts/flowvm-test/expanded.json，给 Java 的 FlowVm 跑（scripts/flowvm-test/run.sh），做到 TS → Java 端到端。
import { writeFileSync } from 'node:fs'
import { bentoLayout, bentoOrder } from '../src/bento.ts'
import { applyLearned, evalValue, evalVarCond, expandCalls, fill, paramsIn, stepLabel, validateClasses, validateFlow, type Flow, type FlowStep } from '../src/flowcore.ts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log('  ok   ' + name) } else { fail++; console.log('  FAIL ' + name, JSON.stringify(detail)) } }
const errs = (a: string[]) => a.filter(x => x.startsWith('错误'))
const mk = (id: string, steps: FlowStep[], extra: Partial<Flow> = {}): Flow => ({ id, app: '测试', name: id, desc: '', params: [], steps, updated: 0, runs: 0, ...extra })

console.log('flowcore 单测')
// v0.16 bug：do/dowhile 永远校验失败
ok('do-while 校验通过（修 v0.16 dowhile 不出栈）', errs(validateFlow([{ kind: 'do' }, { kind: 'tap', sel: { text: 'a' } }, { kind: 'dowhile', cond: { kind: 'exists', sel: { text: 'a' } } }])).length === 0,
  validateFlow([{ kind: 'do' }, { kind: 'tap', sel: { text: 'a' } }, { kind: 'dowhile', cond: { kind: 'exists', sel: { text: 'a' } } }]))
ok('空 do 体报错', errs(validateFlow([{ kind: 'do' }, { kind: 'dowhile', cond: { kind: 'exists', sel: { text: 'a' } } }])).length === 1)
ok('else 没有 if 报错', errs(validateFlow([{ kind: 'else' }])).length === 1)
ok('if 没结束报错', errs(validateFlow([{ kind: 'if', cond: { kind: 'text', text: 'x' } }])).length === 1)
ok('break 不在循环里报错', errs(validateFlow([{ kind: 'if', cond: { kind: 'text', text: 'x' } }, { kind: 'break' }, { kind: 'endif' }])).length === 1)
ok('for 的 to 可以是变量', errs(validateFlow([{ kind: 'set', var: 'n', value: '3' }, { kind: 'for', var: 'i', from: 1, to: '${n}' }, { kind: 'tap', sel: { text: 'x' } }, { kind: 'endfor' }])).length === 0)
ok('for 超过 1000 次报错', errs(validateFlow([{ kind: 'for', var: 'i', from: 1, to: 5000 }, { kind: 'tap', sel: { text: 'x' } }, { kind: 'endfor' }])).length === 1)
ok('纯文字 set 不误报未定义变量', validateFlow([{ kind: 'set', var: 'm', value: '你好 world' }]).length === 0, validateFlow([{ kind: 'set', var: 'm', value: '你好 world' }]))
ok('表达式里的未定义变量给警告', validateFlow([{ kind: 'set', var: 'm', value: 'k + 1' }]).some(x => x.includes('未定义的变量 k')))
ok('this 在方法外报错', errs(validateFlow([{ kind: 'set', var: 'this.a', value: '1' }])).length === 1)

// 求值
ok('四则与负号', evalValue('(2 + 3) * -2') === -10)
ok('路径读字段', evalValue('p.x + 1', { p: { x: 0.5, y: 0.2 } }) === 1.5)
ok('带点路径复制值', JSON.stringify(evalValue('s.tags', { s: { tags: ['a'] } })) === '["a"]')
ok('字符串拼接', evalValue("'共' + n + '件'", { n: 3 }) === '共3件')
ok('插值 ${a.b}', evalValue('名字：${u.name}', { u: { name: '小明' } }) === '名字：小明')
ok('单个引号字符串去掉引号', evalValue("'饿了么'") === '饿了么')
ok('裸词仍是文字（兼容 v0.16）', evalValue('hello', { hello: 'x' }) === 'hello')
ok('var 条件读字段', evalVarCond({ kind: 'var', var: 'c.count', op: '>=', value: '2' }, { c: { count: 2 } }) === true)
ok('var 条件 this', evalVarCond({ kind: 'var', var: 'this.n', op: '==', value: '1' }, { vars: {}, self: { n: 1 } }) === true)

// 类
const cart = mk('shop', [
  { kind: 'new', var: 'c', cls: 'Cart', args: { shop: "'饿了么'" } },
  { kind: 'method', var: 'c', method: 'add', args: { item: "'奶茶'" } },
  { kind: 'method', var: 'c', method: 'add', args: { item: "'面包'" } },
  { kind: 'if', cond: { kind: 'var', var: 'c.count', op: '==', value: '2' } }, { kind: 'tap', sel: { text: '结算${c.count}' } }, { kind: 'endif' },
], { classes: [{ name: 'Cart', fields: { count: '0', shop: "'美团'" }, methods: [
  { name: 'add', params: ['item'], steps: [{ kind: 'input', text: '${this.shop}:${item}' }, { kind: 'set', var: 'this.count', value: 'this.count + 1' }] },
  { name: 'checkout', flowId: 'pay' },
] }] })
const pay = mk('pay', [{ kind: 'tap', sel: { text: '去支付' }, confirm: true }])
const all = [cart, pay]
ok('类与方法校验通过', errs([...validateFlow(cart.steps, all, undefined, { own: cart }), ...validateClasses(cart, all)]).length === 0, [...validateFlow(cart.steps, all, undefined, { own: cart }), ...validateClasses(cart, all)])
ok('方法不存在报错', errs(validateFlow([{ kind: 'new', var: 'c', cls: 'Cart' }, { kind: 'method', var: 'c', method: 'nope' }], all, undefined, { own: cart })).length === 1)
ok('类不存在报错', errs(validateFlow([{ kind: 'new', var: 'c', cls: 'Nope' }], all)).length === 1)
ok('方法体里 this 合法', errs(validateClasses(cart, all)).length === 0)
ok('方法体为空报错', errs(validateClasses(mk('x', [], { classes: [{ name: 'A', fields: {}, methods: [{ name: 'm' }] }] }), all)).length === 1)
const ex = expandCalls(cart.steps.map((s, i) => ({ ...s, _i: i, _fid: cart.id })), all, 0, [], { own: cart })
ok('method 展开成 bind + 方法体 + unbind', ex.map(s => s.kind).join(',') === 'new,bind,input,set,unbind,bind,input,set,unbind,if,tap,endif', ex.map(s => s.kind))
ok('new 带上字段默认值', JSON.stringify(ex[0].fields) === JSON.stringify({ count: '0', shop: "'美团'" }))
ok('方法体步骤标注来源（写回用）', ex[2]._fid === 'shop::Cart.add' && ex[2]._i === 0)
const ex2 = expandCalls([{ kind: 'new', var: 'c', cls: 'Cart' }, { kind: 'method', var: 'c', method: 'checkout' }], all, 0, [], { own: cart })
ok('flowId 方法体内联目标 Flow', ex2.map(s => s.kind).join(',') === 'new,bind,tap,unbind' && ex2[2]._fid === 'pay')
const rec = mk('rec', [{ kind: 'new', var: 'a', cls: 'R' }, { kind: 'method', var: 'a', method: 'm' }], { classes: [{ name: 'R', fields: {}, methods: [{ name: 'm', steps: [{ kind: 'method', var: 'this', method: 'm' }] }] }] })
const ex3 = expandCalls(rec.steps, [rec], 0, [], { own: rec })
ok('递归方法不无限展开（保留 method 步，原生报错）', ex3.filter(s => s.kind === 'method').length === 1)

// 参数
ok('参数提取含 goal 与 args', paramsIn([{ kind: 'ai', goal: '{店名}的入口' }, { kind: 'method', var: 'c', method: 'add', args: { item: '{商品}' } }]).join() === '店名,商品')
ok('fill 不吞 ${变量}', fill([{ kind: 'input', text: '{词}-${i}' }], { 词: '露营' })[0].text === '露营-${i}')
ok('stepLabel 覆盖新节点', stepLabel({ kind: 'new', var: 'c', cls: 'Cart', args: { a: '1' } }) === '新建 c = Cart(a=1)' && stepLabel({ kind: 'ai', goal: '搜索框', act: 'input', text: 'x' }).startsWith('AI 找'))

// AI 学到的选择器写回
const fl = mk('w', [{ kind: 'ai', goal: '搜索框' }, { kind: 'ai', goal: '{店}' }, { kind: 'tap', sel: { text: '旧' }, vision: true }])
const n = applyLearned([fl], [{ fid: 'w', i: 0, sel: { id: 'a:id/search' }, x: 0.5, y: 0.1 }, { fid: 'w', i: 1, sel: { text: '某店' } }, { fid: 'w', i: 2, sel: { text: '新' } }])
ok('写回 ai/vision 步，跳过带参数的步', n === 2 && fl.steps[0].sel?.id === 'a:id/search' && !fl.steps[1].sel && fl.steps[2].sel?.text === '新', fl.steps)

// v0.19 便当格：任意应用数、手机 2 / 桌面 4 个正方形宽，格子不重叠、不出界、中间不留洞（只允许最后一行右侧空）
const holes = (n: number, cols: number) => {
  const L = bentoLayout(n, cols), H = Math.max(...L.map(c => c.r + c.h)), g: number[][] = Array.from({ length: H }, () => new Array(cols).fill(0))
  for (const c of L) for (let r = c.r; r < c.r + c.h; r++) for (let k = c.c; k < c.c + c.w; k++) { if (k >= cols) return 'out'; g[r][k]++ }
  if (g.some(row => row.some(v => v > 1))) return 'overlap'
  for (let r = 0; r < H - 1; r++) if (g[r].some(v => !v)) return 'hole@' + r
  return L[L.length - 1].size === 'add' ? '' : 'no-add'
}
let bad = ''; for (let n = 1; n <= 30; n++) for (const cols of [2, 4]) { const h = holes(n, cols); if (h) bad += ` n=${n}/${cols}:${h}` }
ok('便当格 1–30 个应用无重叠无洞', !bad, bad)
ok('便当格第一名是 hero，按 Flow 数排序', bentoLayout(3, 2)[0].size === 'hero' && bentoOrder(['a', 'b', 'c'], x => ({ a: 1, b: 3, c: 3 })[x]!).join('') === 'bca')
ok('便当格 7 个应用的手机排法固定', bentoLayout(7, 2).map(c => c.size).join() === 'hero,wide,tall,sq,sq,wide,sq,add', bentoLayout(7, 2).map(c => c.size))

// v0.20：循环里 ${i} 的 ai 步不写回（每次目标不同）
const fl2 = mk('loop', [{ kind: 'for', var: 'i', from: 1, to: 3 }, { kind: 'ai', goal: '第 ${i} 篇笔记' }, { kind: 'endfor' }])
ok('${变量} 目标的 ai 步不写回选择器', applyLearned([fl2], [{ fid: 'loop', i: 1, sel: { text: '笔记1' } }]) === 0 && !fl2.steps[1].sel)

// v0.20：对话里定制技能 / MCP / Flow 的工具（确认卡 → 保存 → 撤销）
{
  const mem = new Map<string, string>()
  ;(globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k) }
  const C = await import('../src/custom.ts')
  let n = 0; const ctx = { uid: () => 'u' + ++n, now: () => 1 }
  // 技能
  let p = await C.proposeTool('skill_save', { name: '会议纪要', prompt: '你把会议录音文字整理成纪要：结论、待办（负责人 + 截止日期）、风险。', icon: 'doc' }, ctx)
  ok('skill_save 生成待确认卡，不直接写入', p.card?.kind === 'skill' && p.card.status === 'pending' && p.card.op === 'create' && !mem.has('lumi.skills'), p)
  C.commitCard(p.card!)
  const sk = JSON.parse(mem.get('lumi.skills')!)
  ok('确认后保存为自定义技能', sk.length === 1 && sk[0].custom && sk[0].icon === 'doc' && sk[0].name === '会议纪要', sk)
  ok('skill_list 列出自定义和内置', /会议纪要（自定义）/.test((await C.proposeTool('skill_list', {}, ctx)).text || '') && /润色编辑（内置/.test((await C.proposeTool('skill_list', {}, ctx)).text || ''))
  const upd = await C.proposeTool('skill_save', { id: sk[0].id, name: '会议纪要 Pro', prompt: sk[0].prompt }, ctx)
  ok('按 id 修改是 update 卡，带修改前内容', upd.card?.op === 'update' && (upd.card.before as { name: string }).name === '会议纪要')
  C.commitCard(upd.card!); C.undoCard(upd.card!)
  ok('撤销修改恢复原名', JSON.parse(mem.get('lumi.skills')!)[0].name === '会议纪要')
  ok('内置技能不能改', /内置技能/.test((await C.proposeTool('skill_save', { id: 'polish', name: 'x', prompt: '一二三四五六七八九十' }, ctx)).text || ''))
  ok('提示词太短报错', /太短/.test((await C.proposeTool('skill_save', { name: 'x', prompt: '短' }, ctx)).text || ''))
  const del = await C.proposeTool('skill_delete', { id: sk[0].id }, ctx)
  C.commitCard(del.card!)
  ok('删除技能后为空，撤销后回来', JSON.parse(mem.get('lumi.skills')!).length === 0 && (C.undoCard(del.card!), JSON.parse(mem.get('lumi.skills')!).length === 1))
  // MCP
  ok('MCP 地址校验：非 http 协议报错', /只支持 http/.test((await C.proposeTool('mcp_add', { url: 'ftp://a.com/mcp' }, ctx)).text || ''))
  ok('MCP 地址校验：不是域名报错', !!C.checkMcpUrl('https://abc').error && !C.checkMcpUrl('mcp.example.com/mcp').error && C.checkMcpUrl('mcp.example.com/mcp').url === 'https://mcp.example.com/mcp')
  ok('MCP http 外网地址给警告', !!C.checkMcpUrl('http://mcp.example.com/mcp').warn && !C.checkMcpUrl('http://192.168.1.5:8080/mcp').warn)
  p = await C.proposeTool('mcp_add', { url: 'https://mcp.example.com/mcp', token: 'secret' }, { ...ctx, probe: async () => [{ name: 'search' }, { name: 'fetch' }] })
  ok('mcp_add 测试连接成功，卡上不显示令牌', p.card?.fields.some(f => f.v.startsWith('连接成功，2 个工具')) === true && !JSON.stringify(p.card.fields).includes('secret') && (p.card.after as { status: string }).status === 'ok', p.card?.fields)
  C.commitCard(p.card!)
  const p2 = await C.proposeTool('mcp_add', { url: 'https://mcp.example.com/mcp' }, { ...ctx, probe: async () => { throw new Error('HTTP 401') } })
  ok('同地址再加是更新；连接失败给警告但仍可保存', p2.card?.op === 'update' && (p2.card.warn || []).length === 1 && (p2.card.after as { status: string; token: string }).status === 'error' && (p2.card.after as { token: string }).token === 'secret')
  const rm = await C.proposeTool('mcp_remove', { id: (p.card!.after as { id: string }).id }, ctx)
  C.commitCard(rm.card!)
  ok('mcp_remove 确认后移除', JSON.parse(mem.get('lumi.mcp')!).length === 0)
  // Flow：按任务生成（ai 步 + for + 参数 + confirm）
  const task = { app: '小红书', name: '收藏咖啡笔记', steps: [{ kind: 'launch', app: '小红书', pkg: 'com.xingin.xhs' }, { kind: 'ai', goal: '顶部的搜索框', act: 'tap' }, { kind: 'ai', goal: '搜索输入框', act: 'input', text: '{关键词}' }, { kind: 'enter' },
    { kind: 'for', var: 'i', from: 1, to: '{数量}' }, { kind: 'ai', goal: '第 ${i} 篇笔记', act: 'tap' }, { kind: 'ai', goal: '收藏按钮', act: 'tap', confirm: true }, { kind: 'key', key: 'back' }, { kind: 'endfor' }] }
  p = await C.proposeTool('flow_save', task, ctx)
  ok('flow_save 生成确认卡：参数、AI 视觉步数、速度说明', p.card?.kind === 'flow' && p.card.pkg === 'com.xingin.xhs' && p.card.fields.some(f => f.k === '参数' && f.v === '关键词、数量') && p.card.fields.some(f => /AI 视觉 4 步/.test(f.v)) && p.card.fields.some(f => f.k === '速度' && /模型往返/.test(f.v)) && p.card.lines?.filter(l => l[0] === 'ai').length === 3, p.card?.fields)
  C.commitCard(p.card!)
  const flows = JSON.parse(mem.get('lumi.flows')!)
  ok('确认后 Flow 已保存（params 自动提取）', flows.length === 1 && flows[0].params.join() === '关键词,数量' && flows[0].fast === true)
  ok('校验不通过的 Flow 不出卡，直接把错误还给模型', /校验没通过/.test((await C.proposeTool('flow_save', { app: 'a', name: 'b', steps: [{ kind: 'if', cond: { kind: 'text', text: 'x' } }] }, ctx)).text || ''))
  ok('更新不存在的 Flow 报错', /没有 id=/.test((await C.proposeTool('flow_save', { id: 'nope', steps: [{ kind: 'enter' }] }, ctx)).text || ''))
  const fd = await C.proposeTool('flow_delete', { id: flows[0].id }, ctx)
  C.commitCard(fd.card!); ok('flow_delete 后撤销能恢复', JSON.parse(mem.get('lumi.flows')!).length === 0 && (C.undoCard(fd.card!), JSON.parse(mem.get('lumi.flows')!).length === 1))
  // 等待确认
  const w = C.waitDecision('x1'); ok('waitDecision 挂起中', C.isWaiting('x1')); C.decide('x1', true); ok('decide 后返回 true', (await w) === true && !C.isWaiting('x1'))
  const ac = new AbortController(); const w2 = C.waitDecision('x2', ac.signal); ac.abort(); ok('停止生成时确认卡按取消处理', (await w2) === false)
}

// 给 Java 的端到端用例（期望的动作序列与 FlowVmTest.FakeHost 的记录格式一致）
const cases = [
  { name: '类：购物车两次 add 后结算', steps: ex, expect: ['input:饿了么:奶茶', 'input:饿了么:面包', 'tap:结算2'] },
  { name: 'call 子流程 + for', steps: expandCalls([{ kind: 'for', var: 'i', from: 1, to: 2 }, { kind: 'call', flowId: 'pay' }, { kind: 'endfor' }], all), expect: ['tap:去支付', 'tap:去支付'] },
  { name: 'do-while 翻页（v0.16 校验会拒绝）', steps: [{ kind: 'do' }, { kind: 'tap', sel: { text: '下一页' } }, { kind: 'dowhile', cond: { kind: 'exists', sel: { text: '下一页' } } }], screen: ['下一页'], pagesLeft: 3, expect: ['tap:下一页', 'tap:下一页', 'tap:下一页'] },
  { name: 'point 字段运算后点击', steps: [{ kind: 'set', var: 'p', value: '0.2,0.4' }, { kind: 'set', var: 'p.x', value: 'p.x * 2' }, { kind: 'tap', pointVar: 'p' }], expect: ['tap@0.4,0.4'] },
  { name: '初始变量 + 参数填充', steps: fill([{ kind: 'input', text: '{词} ${who}' }], { 词: '露营' }), vars: { who: '小明' }, expect: ['input:露营 小明'] },
]
writeFileSync(new URL('./flowvm-test/expanded.json', import.meta.url), JSON.stringify(cases, null, 1))
console.log(`${pass} 通过，${fail} 失败；已写 scripts/flowvm-test/expanded.json（${cases.length} 个 TS→Java 用例）`)
if (fail) process.exit(1)
