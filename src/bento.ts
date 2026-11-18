/** v0.19 Flow 总览的便当格（参考 Figma Riffs「Bento UI Components」的混合尺寸网格，只借排布思路，没有复制素材）。
 * 底层网格：手机 4 列（一个正方形占 2 列 × 2 行，一行两个正方形），≥720px 8 列（一行四个正方形）。行高等于列宽。
 * 尺寸只由 Flow 数量排序决定（同数量按出现顺序），同样的数据永远排出同样的格子：
 *   第 1 名 → hero（2×2 个正方形，列出 Flow 和播放键）
 *   之后按 wide（2×1）、tall（1×2）、sq、sq 循环。
 * 摆放用「天际线」算法（以正方形为单位）：每一格放到当前最低、最靠左的位置；那里宽度不够就降级（hero→wide→sq，wide→sq），
 * tall 后面至少还要有两格（含「新应用」）才用，否则降成 sq。这样手机和桌面都不会在中间留洞，「新应用」补在最后。 */
export type BentoSize = 'hero' | 'wide' | 'tall' | 'sq' | 'add'
export interface BentoCell { size: BentoSize; c: number; r: number; w: number; h: number }
const DIM: Record<Exclude<BentoSize, 'add'>, [number, number]> = { hero: [2, 2], wide: [2, 1], tall: [1, 2], sq: [1, 1] }
const FALLBACK: Record<Exclude<BentoSize, 'add'>, Exclude<BentoSize, 'add'>[]> = { hero: ['hero', 'wide', 'sq'], wide: ['wide', 'sq'], tall: ['tall', 'sq'], sq: ['sq'] }
const CYCLE: Exclude<BentoSize, 'add'>[] = ['wide', 'tall', 'sq', 'sq']

export function bentoOrder<T>(apps: T[], count: (a: T) => number): T[] {
  return apps.map((a, i) => ({ a, i, n: count(a) })).sort((x, y) => y.n - x.n || x.i - y.i).map(x => x.a)
}

/** n 个应用 + 1 个「新应用」在 cols 个正方形宽的网格里的位置（单位：正方形，c / r 从 0 开始）。最后一项是「新应用」。 */
export function bentoLayout(n: number, cols: number): BentoCell[] {
  const sky = new Array(cols).fill(0)
  const out: BentoCell[] = []
  const lowest = () => { const h = Math.min(...sky); const c = sky.indexOf(h); let g = 0; while (c + g < cols && sky[c + g] === h) g++; return { h, c, g } }
  const put = (size: BentoSize, w: number, hh: number) => { const { h, c } = lowest(); out.push({ size, c, r: h, w, h: hh }); for (let k = c; k < c + w; k++) sky[k] = h + hh }
  for (let i = 0; i < n; i++) {
    let want: Exclude<BentoSize, 'add'> = i === 0 ? 'hero' : CYCLE[(i - 1) % CYCLE.length]
    if (want === 'tall' && (n - i < 2 || cols < 2)) want = 'sq'   // 后面（含「新应用」）不足两格时，tall 会在底部留洞
    const { g } = lowest()
    const size = FALLBACK[want].find(s => DIM[s][0] <= g) || 'sq'
    put(size, DIM[size][0], DIM[size][1])
  }
  // 「新应用」：填满当前最低的那段空位（最多 2 格宽），手机上奇数时是一个正方形，偶数时是一整行
  const { g } = lowest()
  put('add', Math.min(g, 2), 1)
  return out
}
