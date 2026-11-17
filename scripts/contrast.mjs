// v0.18 对比度检查：文字色 × 背景色，WCAG 2.x 相对亮度。用法：node scripts/contrast.mjs
const hex = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) }
const mix = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)))
const L = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const ink = hex('#141a26'), W = hex('#ffffff')
const bgs = { white: W, card: hex('#fffbf8'), page_top: hex('#ffdcc4'), page_mid: hex('#ffeee2'), sheet: hex('#fffaf7') }
const rows = []
const check = (name, fg, bgName, bg, min = 4.5) => { const r = ratio(fg, bg); rows.push([name, bgName, r.toFixed(2), r >= min ? 'ok' : 'FAIL']) }
for (const [n, b] of Object.entries(bgs)) { check('ink', ink, n, b); check('label2 #5c6270', hex('#5c6270'), n, b) }
const FAM = { coral: ['#B8361F', '#FFE7DE'], amber: ['#A84A0B', '#FFEEDB'], green: ['#0C6E4C', '#DDF4E8'], teal: ['#0A6372', '#DAF2F4'], blue: ['#1C47B0', '#E1ECFF'], indigo: ['#33289C', '#E9E6FF'], violet: ['#6E2491', '#F3E3FB'], rose: ['#A41F52', '#FFE3EE'], graphite: ['#273042', '#E6EAF1'] }
for (const [n, [d, s]] of Object.entries(FAM)) { check(`badge ${n} deep`, hex(d), 'soft', hex(s)); check(`white on ${n} deep`, W, 'deep', hex(d)); check(`label2 on ${n} glow`, hex('#5c6270'), 'soft', hex(s)) }
check('white on accent button top #cc4a2e', W, 'accent-btn', hex('#cc4a2e'))
check('white on accent button end #c13f27', W, 'accent-btn', hex('#c13f27'))
check('white on ink button', W, 'ink', ink)
check('accent text #b8361f on soft', hex('#b8361f'), 'coral-soft', mix(hex('#e0583e'), .1, W))
for (const r of rows) console.log(r.join('\t'))
process.exitCode = rows.some(r => r[3] === 'FAIL') ? 1 : 0
