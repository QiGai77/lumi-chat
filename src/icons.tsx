const P: Record<string, string> = {
  phone: '<rect x="6" y="2.8" width="12" height="18.4" rx="3.2"/><path d="M10.5 18h3"/>',
  download: '<path d="M12 3.8v11.7M7.8 11.3l4.2 4.2 4.2-4.2"/><path d="M20.5 15v1.8c0 2.3-1.6 3.7-4 3.7H7.5c-2.4 0-4-1.4-4-3.7V15"/>',
  monitor: '<rect x="2.8" y="4" width="18.4" height="12.6" rx="2.6"/><path d="M8.5 20.2h7M12 16.6v3.6"/>',
  shield: '<path fill-rule="evenodd" d="M12 3l7 2.6v5.6c0 4.6-3 8.1-7 9.8-4-1.7-7-5.2-7-9.8V5.6z"/><path d="M9.2 12l2 2 3.8-3.9"/>',
  terminal: '<rect x="2.8" y="4" width="18.4" height="16" rx="3"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/>',
  users: '<circle cx="9.3" cy="7.6" r="3.9"/><path fill-rule="evenodd" d="M3 17.9c0-2.4 2.8-3.4 6.3-3.4s6.3 1 6.3 3.4-2.8 2.4-6.3 2.4S3 20.3 3 17.9z"/><path d="M16.4 4.2a3.5 3.5 0 0 1 0 6.9M18.6 14.8c1.5.3 2.4 1.1 2.4 2.4 0 1-.6 1.6-1.6 1.9"/>',
  mask: '<path fill-rule="evenodd" d="M4 4.5c5.3-1.6 10.7-1.6 16 0v6.3c0 5-3.6 9-8 9.7-4.4-.7-8-4.7-8-9.7z"/><path d="M8 9.6c.8-.6 1.7-.6 2.5 0M13.5 9.6c.8-.6 1.7-.6 2.5 0M9 14.2c1.8 1.5 4.2 1.5 6 0"/>',
  upload: '<path d="M12 15.5V3.8M7.8 8L12 3.8 16.2 8"/><path d="M20.5 15v1.8c0 2.3-1.6 3.7-4 3.7H7.5c-2.4 0-4-1.4-4-3.7V15"/>',
  left: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  user: '<circle cx="12" cy="7.8" r="4.3"/><path fill-rule="evenodd" d="M4.6 18.6c0-2.6 3.3-3.9 7.4-3.9s7.4 1.3 7.4 3.9-3.3 2.6-7.4 2.6-7.4 0-7.4-2.6z"/>',
  chat: '<path d="M12 4c4.97 0 9 3.36 9 7.5S16.97 19 12 19c-1.1 0-2.15-.16-3.12-.46L4 20l1.4-3.6C4.5 15.1 3 13.4 3 11.5 3 7.36 7.03 4 12 4z"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="3.5"/><path d="M3 10h18"/><path d="M16 14.5h2"/>',
  gear: '<path fill-rule="evenodd" d="M20.8 7.6l-.6-1.1c-.5-.9-1.7-1.2-2.6-.7l-.3.2c-1.4.8-3.1-.2-3.1-1.8v-.4c0-1-.8-1.9-1.9-1.9h-1.3c-1 0-1.9.9-1.9 1.9v.4c0 1.6-1.7 2.6-3.1 1.8l-.3-.2c-.9-.5-2.1-.2-2.6.7l-.6 1.1c-.5.9-.2 2.1.7 2.6l.3.2c1.4.8 1.4 2.8 0 3.6l-.3.2c-.9.5-1.2 1.7-.7 2.6l.6 1.1c.5.9 1.7 1.2 2.6.7l.3-.2c1.4-.8 3.1.2 3.1 1.8v.4c0 1 .9 1.9 1.9 1.9h1.3c1 0 1.9-.9 1.9-1.9v-.4c0-1.6 1.7-2.6 3.1-1.8l.3.2c.9.5 2.1.2 2.6-.7l.6-1.1c.5-.9.2-2.1-.7-2.6l-.3-.2c-1.4-.8-1.4-2.8 0-3.6l.3-.2c.9-.5 1.2-1.7.7-2.6z"/><circle cx="12" cy="12" r="2.8"/>',
  leaf: '<path d="M5 19c0-9 6-14 14-14 0 8-5 14-14 14z"/><path d="M5 19l7-7"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  search: '<circle cx="11.2" cy="11.2" r="7.6"/><path d="M16.6 16.9l4 4"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  spark: '<path d="M12 2.8c.6 4.6 2.8 6.8 7.4 7.4-4.6.6-6.8 2.8-7.4 7.4-.6-4.6-2.8-6.8-7.4-7.4 4.6-.6 6.8-2.8 7.4-7.4z"/><path d="M18.5 16.5c.2 1.6 1 2.4 2.6 2.6-1.6.2-2.4 1-2.6 2.6-.2-1.6-1-2.4-2.6-2.6 1.6-.2 2.4-1 2.6-2.6z"/>',
  compose: '<path d="M13.5 20.5h7"/><path fill-rule="evenodd" d="M12.6 4.1c.9-1.1 2.4-1.3 3.5-.4l1.9 1.5c1.1.9 1.3 2.4.5 3.5L9.1 20c-.4.5-.9.7-1.5.7l-3.6.1-.8-3.5c-.2-.6 0-1.2.4-1.7z"/><path d="M11.2 5.9l5.6 4.3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  redo: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" stroke="none"/>',
  trash: '<path d="M19.3 9.5s-.5 6.6-.8 9.4c-.1 1.3-.9 2.1-2.3 2.1-2.6.1-5.2.1-7.8 0-1.3 0-2.1-.8-2.3-2.1-.3-2.8-.8-9.4-.8-9.4"/><path d="M20.7 6.3H3.3M17.3 6.3c-.8 0-1.5-.6-1.6-1.4l-.2-1.1c-.1-.6-.7-1-1.3-1H9.8c-.6 0-1.2.4-1.3 1l-.2 1.1c-.1.8-.8 1.4-1.6 1.4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8.5 8.5"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/>',
  pen: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
  map: '<path d="M9 4L3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5z"/><path d="M9 4v13M15 6.5v13"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  star: '<path fill-rule="evenodd" d="M13.1 3.6l2.1 4.2c.2.4.6.7 1 .8l4.6.7c1 .1 1.4 1.4.7 2.1l-3.4 3.2c-.3.3-.5.8-.4 1.2l.8 4.6c.2 1-.9 1.8-1.8 1.3L12.6 19.6c-.4-.2-.8-.2-1.2 0l-4.1 2.2c-.9.5-2-.3-1.8-1.3l.8-4.6c.1-.4-.1-.9-.4-1.2L2.5 11.4c-.7-.7-.3-2 .7-2.1l4.6-.7c.4-.1.8-.4 1-.8l2.1-4.2c.4-.9 1.8-.9 2.2 0z"/>',
  starf: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="currentColor"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  thumb: '<path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 2.6 1.9L13 9h5.5a2 2 0 0 1 2 2.4l-1.4 6.6A2.5 2.5 0 0 1 16.7 20H7"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  tap: '<path d="M9.2 11.6V5.4a1.9 1.9 0 0 1 3.8 0v5.2l4.3.9c1.6.3 2.6 1.8 2.4 3.4l-.5 3.4c-.3 1.6-1.6 2.7-3.2 2.7h-3.3c-1 0-2-.5-2.6-1.3l-3.4-4.6a1.7 1.7 0 0 1 2.5-2.3z"/><path d="M6.2 6.6a5 5 0 0 1 9.6 0"/>',
  keyboard: '<rect x="2.8" y="5.5" width="18.4" height="13" rx="3"/><path d="M7 9.5h.01M10.3 9.5h.01M13.7 9.5h.01M17 9.5h.01M7 12.5h.01M17 12.5h.01M10.3 12.5h3.4M8 15.5h8"/>',
  enter: '<path d="M19.5 5v5.5c0 1.9-1.6 3.5-3.5 3.5H5.5"/><path d="M9 10.3L5.3 14 9 17.7"/>',
  scroll: '<path d="M12 3.5v17M8 7l4-3.5L16 7M8 17l4 3.5 4-3.5"/>',
  hourglass: '<path d="M6.5 3h11M6.5 21h11"/><path fill-rule="evenodd" d="M7.5 3c0 4.5 4.5 6 4.5 9s-4.5 4.5-4.5 9h9c0-4.5-4.5-6-4.5-9s4.5-4.5 4.5-9z"/>',
  grid: '<rect x="3.2" y="3.2" width="7.6" height="7.6" rx="2.4"/><rect x="13.2" y="3.2" width="7.6" height="7.6" rx="2.4"/><rect x="3.2" y="13.2" width="7.6" height="7.6" rx="2.4"/><rect x="13.2" y="13.2" width="7.6" height="7.6" rx="2.4"/>',
  clock: '<path fill-rule="evenodd" d="M21.2 12c0 5.1-4.1 9.2-9.2 9.2S2.8 17.1 2.8 12 6.9 2.8 12 2.8s9.2 4.1 9.2 9.2z"/><path d="M15.4 14.9L12 12.9V8.4"/>',
  folder: '<path fill-rule="evenodd" d="M21.5 15.2c0 4-2.4 6.3-6.4 6.3H8.4c-4 0-6.4-2.3-6.4-6.3V8.6C2 4.7 3.5 2.5 7.4 2.5h2.2c.8 0 1.6.4 2.1 1l1 1.3c.5.6 1.2 1 2.1 1h3.1c4 0 3.6 3.2 3.6 7.2z"/><path d="M7 15h10"/>',
  plug: '<path d="M9 2.8v4.4M15 2.8v4.4"/><path d="M5.8 7.2h12.4v3.6c0 3.4-2.8 6.2-6.2 6.2s-6.2-2.8-6.2-6.2z"/><path d="M12 17v4.2"/>',
  side: '<path fill-rule="evenodd" d="M16.3 2.8H7.7c-3 0-4.9 2.1-4.9 5.1v8.2c0 3 1.9 5.1 4.9 5.1h8.6c3 0 4.9-2.1 4.9-5.1V7.9c0-3-1.9-5.1-4.9-5.1z"/><path d="M9.2 2.9v18.2"/>',
  crown: '<path fill-rule="evenodd" d="M3.5 8.6l3.8 3.2 3.9-6.3c.4-.6 1.2-.6 1.6 0l3.9 6.3 3.8-3.2c.6-.5 1.5 0 1.4.8l-1.3 8.4c-.2 1.5-1.5 2.6-3 2.6H6.4c-1.5 0-2.8-1.1-3-2.6L2.1 9.4c-.1-.8.8-1.3 1.4-.8z"/>',
  branch: '<circle cx="6" cy="5.5" r="2.2"/><circle cx="6" cy="18.5" r="2.2"/><circle cx="18" cy="8.5" r="2.2"/><path d="M6 7.7v8.6M18 10.7c0 3.6-3.4 4.6-9.6 6.6"/>',
  repeat: '<path d="M4.5 11.5V10a4 4 0 0 1 4-4H19M16 3l3 3-3 3"/><path d="M19.5 12.5V14a4 4 0 0 1-4 4H5M8 21l-3-3 3-3"/>',
  cube: '<path fill-rule="evenodd" d="M12 2.8l8 4.5v9.4l-8 4.5-8-4.5V7.3z"/><path d="M4.3 7.4L12 11.8l7.7-4.4M12 11.8v9.2"/>',
  eye: '<path fill-rule="evenodd" d="M2.5 12c2.2-4.3 5.4-6.5 9.5-6.5s7.3 2.2 9.5 6.5c-2.2 4.3-5.4 6.5-9.5 6.5S4.7 16.3 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  braces: '<path d="M8.5 4C6.6 4 6 5 6 6.6v2.6C6 10.6 5.4 11.6 4 12c1.4.4 2 1.4 2 2.8v2.6C6 19 6.6 20 8.5 20M15.5 4c1.9 0 2.5 1 2.5 2.6v2.6c0 1.4.6 2.4 2 2.8-1.4.4-2 1.4-2 2.8v2.6c0 1.6-.6 2.6-2.5 2.6"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  method: '<rect x="3.5" y="5" width="11" height="14" rx="3"/><path d="M11 12h9.5M17.5 9l3 3-3 3"/>',
  exit: '<path d="M14 4.5h3.5a2.5 2.5 0 0 1 2.5 2.5v10a2.5 2.5 0 0 1-2.5 2.5H14"/><path d="M4 12h11M11 8l4 4-4 4"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="3.5"/><path d="M9.5 4v16"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
}
export function Icon({ n, s = 22, w = 1.9, c = 'currentColor' }: { n: string; s?: number; w?: number; c?: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={w}
      strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: P[n] }} />
  )
}

/** v0.18 图标块：单个小 squircle，浅色色调底 + 1px 发丝描边 + 同色系深色线条图标（参考 Figma Riffs 的小图标块）。tone 决定色调。 */
export function GlassIcon({ n, tone = 'coral', s = 34 }: { n: string; tone?: string; s?: number }) {
  return (
    <span className={`gi ${tone}`} style={{ width: s, height: s, borderRadius: Math.round(s * 0.32) }}>
      <Icon n={n} s={Math.round(s * 0.56)} w={1.8} />
    </span>
  )
}
