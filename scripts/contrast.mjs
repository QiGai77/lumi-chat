// v0.18 / v0.19 对比度检查：文字色 × 背景色，WCAG 2.x 相对亮度。用法：node scripts/contrast.mjs
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
// v0.19 mesh 卡：白字在 deep（叠 .bt 底纱 34% 黑 / meshTop 顶部 14% 黑）上；奶白面板（#fffbf8）上的墨字、灰字、deep 字（播放键是 deep 底白字）
const MID = { coral: '#E85A3C', amber: '#E07A1C', green: '#1E9A66', teal: '#138E9E', blue: '#3471E6', indigo: '#5848D8', violet: '#9A42C6', rose: '#D63F78', graphite: '#465372' }
for (const [n, [d]] of Object.entries(FAM)) {
  check(`v19 white on ${n} deep+veil`, W, 'deep', mix(hex('#000000'), .2, hex(d)))
  check(`v19 deep ${n} on cream panel`, hex(d), 'panel', hex('#fffbf8'))
  check(`v19 white on ${n} mid+veil(bottom 34%)`, W, 'mid', mix(hex('#000000'), .34, hex(MID[n])))
}
check('v19 ink on cream panel', ink, 'panel', hex('#fffbf8')); check('v19 label2 on cream panel', hex('#5c6270'), 'panel', hex('#fffbf8'))
// mesh 是渐变，最终以 v19_shots.py 的像素实测为准（截图里取文字框背景 98 分位最亮像素，全部 ≥4.5:1）
for (const r of rows) console.log(r.join('\t'))
process.exitCode = rows.some(r => r[3] === 'FAIL') ? 1 : 0
