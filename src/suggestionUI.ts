import type { Suggestion } from './types'

let currentPanel: HTMLDivElement | null = null

let lastLeftPx: number | null = null
let lastTopPx: number | null = null

export type PanelStats = {
  totalTokens: number
  countsByTypeTag: Record<string, number>
}

export type PanelActions = {
  onMaskAll: () => void
  onUnmaskAll: () => void
  onCopyMasked: () => void
  onClearSession: () => void
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function chip(bg: string, fg: string, text: string) {
  const el = document.createElement('span')
  el.textContent = text
  el.style.display = 'inline-flex'
  el.style.alignItems = 'center'
  el.style.padding = '2px 6px'
  el.style.borderRadius = '999px'
  el.style.fontSize = '10px'
  el.style.fontWeight = '600'
  el.style.background = bg
  el.style.color = fg
  return el
}

function confidenceChip(conf?: Suggestion['confidence']) {
  if (!conf) return null
  if (conf === 'high') return chip('#dcfce7', '#166534', 'HIGH')
  if (conf === 'medium') return chip('#fef9c3', '#854d0e', 'MED')
  return chip('#e5e7eb', '#374151', 'LOW')
}

function typeIcon(type?: Suggestion['piiType']) {
  const el = document.createElement('span')
  el.style.display = 'inline-flex'
  el.style.width = '18px'
  el.style.height = '18px'
  el.style.borderRadius = '6px'
  el.style.alignItems = 'center'
  el.style.justifyContent = 'center'
  el.style.fontSize = '11px'
  el.style.fontWeight = '700'
  el.style.flex = '0 0 auto'

  const t = type ?? 'EMAIL'
  const map: Record<string, { bg: string; fg: string; text: string }> = {
    EMAIL: { bg: '#eef2ff', fg: '#3730a3', text: '@' },
    PHONE: { bg: '#ecfeff', fg: '#155e75', text: '☎' },
    SSN: { bg: '#fef2f2', fg: '#991b1b', text: '#' },
    CREDIT_CARD: { bg: '#fff7ed', fg: '#9a3412', text: '💳' },
    PERSON_NAME: { bg: '#f0fdf4', fg: '#166534', text: 'A' },
    ORG: { bg: '#f5f3ff', fg: '#5b21b6', text: '🏢' },
    LOCATION: { bg: '#eff6ff', fg: '#1d4ed8', text: '⌖' },
    ADDRESS: { bg: '#f0f9ff', fg: '#075985', text: '⌂' }
  }

  const cfg = map[t] ?? { bg: '#e5e7eb', fg: '#111827', text: '?' }
  el.style.background = cfg.bg
  el.style.color = cfg.fg
  el.textContent = cfg.text
  return el
}

function button(label: string, variant: 'primary' | 'secondary', onClick: () => void) {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.style.borderRadius = '8px'
  b.style.padding = '6px 10px'
  b.style.fontSize = '12px'
  b.style.fontWeight = '600'
  b.style.cursor = 'pointer'
  b.style.border = variant === 'primary' ? '1px solid #2563eb' : '1px solid #d1d5db'
  b.style.background = variant === 'primary' ? '#2563eb' : '#ffffff'
  b.style.color = variant === 'primary' ? '#ffffff' : '#111827'
  b.onclick = onClick
  return b
}

function buildColumn(
  title: string,
  items: Suggestion[],
  onClick: (s: Suggestion) => void,
  onHover: (s: Suggestion | null) => void
) {
  const col = document.createElement('div')
  col.style.flex = '1'
  col.style.minWidth = '0'

  const header = document.createElement('div')
  header.textContent = title
  header.style.fontSize = '11px'
  header.style.fontWeight = '600'
  header.style.color = '#374151'
  header.style.marginBottom = '6px'

  const list = document.createElement('div')
  list.style.border = '1px solid #e5e7eb'
  list.style.borderRadius = '8px'
  list.style.overflowY = 'auto'
  list.style.background = '#ffffff'

  // show 2 rows max; rest scroll
  list.style.maxHeight = `${2 * 38}px`

  if (items.length === 0) {
    const empty = document.createElement('div')
    empty.textContent = '—'
    empty.style.padding = '10px'
    empty.style.fontSize = '12px'
    empty.style.color = '#6b7280'
    list.appendChild(empty)
  } else {
    for (const s of items) {
      const row = document.createElement('div')
      row.style.padding = '8px 10px'
      row.style.fontSize = '12px'
      row.style.cursor = 'pointer'
      row.style.userSelect = 'none'
      row.style.borderBottom = '1px solid #f3f4f6'
      row.style.display = 'flex'
      row.style.gap = '8px'
      row.style.alignItems = 'flex-start'

      row.onmouseenter = () => {
        row.style.background = '#f9fafb'
        onHover(s)
      }
      row.onmouseleave = () => {
        row.style.background = '#ffffff'
        onHover(null)
      }

      const icon = typeIcon(s.piiType)

      const txt = document.createElement('div')
      txt.style.flex = '1'
      txt.style.minWidth = '0'

      const top = document.createElement('div')
      top.style.display = 'flex'
      top.style.alignItems = 'center'
      top.style.justifyContent = 'space-between'
      top.style.gap = '8px'

      const main = document.createElement('div')
      main.textContent = s.type === 'MASK' ? s.original : s.original
      main.style.fontWeight = '600'
      main.style.color = '#111827'
      main.style.overflow = 'hidden'
      main.style.textOverflow = 'ellipsis'
      main.style.whiteSpace = 'nowrap'

      const chips = document.createElement('div')
      chips.style.display = 'flex'
      chips.style.gap = '6px'
      const cchip = confidenceChip(s.confidence)
      if (cchip) chips.appendChild(cchip)
      if (s.type === 'UNMASK') {
        chips.appendChild(chip('#e0f2fe', '#075985', 'TOKEN'))
      }

      top.appendChild(main)
      top.appendChild(chips)

      const bottom = document.createElement('div')
      bottom.textContent = s.type === 'MASK' ? `→ ${s.replacement}` : `→ ${s.replacement}`
      bottom.style.fontSize = '11px'
      bottom.style.color = '#6b7280'
      bottom.style.marginTop = '2px'
      bottom.style.overflow = 'hidden'
      bottom.style.textOverflow = 'ellipsis'
      bottom.style.whiteSpace = 'nowrap'

      txt.appendChild(top)
      txt.appendChild(bottom)

      row.appendChild(icon)
      row.appendChild(txt)

      row.onclick = () => onClick(s)
      list.appendChild(row)
    }
  }

  col.appendChild(header)
  col.appendChild(list)
  return col
}

export function hideSuggestion() {
  if (!currentPanel) return
  currentPanel.remove()
  currentPanel = null
}

export function showSuggestion(
  anchorRect: DOMRect,
  maskSuggestions: Suggestion[],
  unmaskSuggestions: Suggestion[],
  onClickSuggestion: (s: Suggestion) => void,
  onHoverSuggestion: (s: Suggestion | null) => void,
  stats: PanelStats,
  actions: PanelActions
) {
  if (currentPanel) {
    currentPanel.remove()
    currentPanel = null
  }

  const panel = document.createElement('div')
  panel.style.position = 'fixed'
  panel.style.zIndex = '2147483647'
  panel.style.background = '#ffffff'
  panel.style.color = '#111827'
  panel.style.border = '1px solid #e5e7eb'
  panel.style.borderRadius = '10px'
  panel.style.boxShadow = '0 10px 24px rgba(0,0,0,0.18)'
  panel.style.padding = '10px'
  panel.style.fontFamily = 'system-ui, sans-serif'
  panel.style.width = '560px'
  panel.style.maxWidth = 'calc(100vw - 24px)'

  const header = document.createElement('div')
  header.style.display = 'flex'
  header.style.justifyContent = 'space-between'
  header.style.alignItems = 'center'
  header.style.marginBottom = '8px'
  header.style.cursor = 'move'
  header.style.userSelect = 'none'

  const title = document.createElement('div')
  title.textContent = 'PII Suggestions'
  title.style.fontSize = '12px'
  title.style.fontWeight = '600'

  const sub = document.createElement('div')
  sub.textContent = `${stats.totalTokens} token(s) in session`
  sub.style.fontSize = '11px'
  sub.style.color = '#6b7280'
  sub.style.marginTop = '2px'

  const titleWrap = document.createElement('div')
  titleWrap.style.display = 'flex'
  titleWrap.style.flexDirection = 'column'
  titleWrap.appendChild(title)
  titleWrap.appendChild(sub)

  const close = document.createElement('div')
  close.textContent = '✕'
  close.style.cursor = 'pointer'
  close.style.fontSize = '12px'
  close.style.color = '#6b7280'
  close.onclick = () => hideSuggestion()

  header.appendChild(titleWrap)
  header.appendChild(close)

  const controls = document.createElement('div')
  controls.style.display = 'flex'
  controls.style.gap = '8px'
  controls.style.marginBottom = '10px'

  const search = document.createElement('input')
  search.type = 'text'
  search.placeholder = 'Search suggestions…'
  search.style.flex = '1'
  search.style.border = '1px solid #d1d5db'
  search.style.borderRadius = '8px'
  search.style.padding = '6px 10px'
  search.style.fontSize = '12px'
  search.style.outline = 'none'

  const statsBtn = document.createElement('button')
  statsBtn.type = 'button'
  statsBtn.textContent = 'Stats'
  statsBtn.style.border = '1px solid #d1d5db'
  statsBtn.style.background = '#ffffff'
  statsBtn.style.color = '#111827'
  statsBtn.style.borderRadius = '8px'
  statsBtn.style.padding = '6px 10px'
  statsBtn.style.cursor = 'pointer'
  statsBtn.style.fontSize = '12px'
  statsBtn.style.fontWeight = '600'

  controls.appendChild(search)
  controls.appendChild(statsBtn)

  const body = document.createElement('div')
  body.style.display = 'flex'
  body.style.gap = '10px'
  body.style.width = '100%'

  const leftCol = document.createElement('div')
  leftCol.style.flex = '1'
  const rightCol = document.createElement('div')
  rightCol.style.flex = '1'

  const render = () => {
    const q = search.value.trim().toLowerCase()
    const filterFn = (s: Suggestion) => {
      if (!q) return true
      return (
        s.original.toLowerCase().includes(q) ||
        s.replacement.toLowerCase().includes(q) ||
        (s.piiType ? s.piiType.toLowerCase().includes(q) : false)
      )
    }

    leftCol.innerHTML = ''
    rightCol.innerHTML = ''

    const left = buildColumn('Mask (max 10)', maskSuggestions.filter(filterFn).slice(0, 10), onClickSuggestion, onHoverSuggestion)
    const right = buildColumn('Unmask (max 10)', unmaskSuggestions.filter(filterFn).slice(0, 10), onClickSuggestion, onHoverSuggestion)
    leftCol.appendChild(left)
    rightCol.appendChild(right)
  }

  search.oninput = () => render()

  body.appendChild(leftCol)
  body.appendChild(rightCol)

  const footer = document.createElement('div')
  footer.style.display = 'flex'
  footer.style.justifyContent = 'space-between'
  footer.style.alignItems = 'center'
  footer.style.marginTop = '10px'
  footer.style.gap = '10px'

  const leftActions = document.createElement('div')
  leftActions.style.display = 'flex'
  leftActions.style.gap = '8px'
  leftActions.appendChild(button('Mask all', 'primary', actions.onMaskAll))
  leftActions.appendChild(button('Unmask all', 'secondary', actions.onUnmaskAll))

  const rightActions = document.createElement('div')
  rightActions.style.display = 'flex'
  rightActions.style.gap = '8px'
  rightActions.appendChild(button('Copy masked', 'secondary', actions.onCopyMasked))

  footer.appendChild(leftActions)
  footer.appendChild(rightActions)

  const statsDrawer = document.createElement('div')
  statsDrawer.style.display = 'none'
  statsDrawer.style.marginTop = '10px'
  statsDrawer.style.borderTop = '1px solid #e5e7eb'
  statsDrawer.style.paddingTop = '10px'

  const statsTitle = document.createElement('div')
  statsTitle.textContent = 'Session Stats'
  statsTitle.style.fontSize = '12px'
  statsTitle.style.fontWeight = '700'
  statsTitle.style.color = '#111827'
  statsDrawer.appendChild(statsTitle)

  const grid = document.createElement('div')
  grid.style.display = 'flex'
  grid.style.flexWrap = 'wrap'
  grid.style.gap = '8px'
  grid.style.marginTop = '8px'

  const entries = Object.entries(stats.countsByTypeTag).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) {
    grid.appendChild(chip('#f3f4f6', '#374151', 'No tokens yet'))
  } else {
    for (const [tag, count] of entries) {
      grid.appendChild(chip('#f3f4f6', '#111827', `${tag}: ${count}`))
    }
  }
  statsDrawer.appendChild(grid)

  const clearRow = document.createElement('div')
  clearRow.style.marginTop = '10px'
  clearRow.appendChild(button('Clear session', 'secondary', actions.onClearSession))
  statsDrawer.appendChild(clearRow)

  statsBtn.onclick = () => {
    statsDrawer.style.display = statsDrawer.style.display === 'none' ? 'block' : 'none'
  }

  panel.appendChild(header)
  panel.appendChild(controls)
  panel.appendChild(body)
  panel.appendChild(footer)
  panel.appendChild(statsDrawer)
  document.body.appendChild(panel)

  render()

  // Position near the anchor, but keep within viewport
  const margin = 12
  const width = panel.getBoundingClientRect().width
  const height = panel.getBoundingClientRect().height

  const positionPanel = (left: number, top: number) => {
    const leftPx = clamp(left, margin, window.innerWidth - width - margin)
    const topPx = clamp(top, margin, window.innerHeight - height - margin)
    panel.style.left = `${leftPx}px`
    panel.style.top = `${topPx}px`
    lastLeftPx = leftPx
    lastTopPx = topPx
  }

  if (typeof lastLeftPx === 'number' && typeof lastTopPx === 'number') {
    positionPanel(lastLeftPx, lastTopPx)
  } else {
    const desiredLeft = anchorRect.left
    const desiredTop = anchorRect.bottom + 8

    let topPx = clamp(desiredTop, margin, window.innerHeight - height - margin)

    // If there's no room below, try above
    if (desiredTop + height + margin > window.innerHeight && anchorRect.top - height - 8 > margin) {
      topPx = clamp(anchorRect.top - height - 8, margin, window.innerHeight - height - margin)
    }

    positionPanel(desiredLeft, topPx)
  }

  let dragging = false
  let dragOffsetX = 0
  let dragOffsetY = 0

  const onMove = (e: MouseEvent) => {
    if (!dragging) return
    positionPanel(e.clientX - dragOffsetX, e.clientY - dragOffsetY)
  }

  const onUp = () => {
    if (!dragging) return
    dragging = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  header.addEventListener('mousedown', (e) => {
    // Only left mouse button
    if (e.button !== 0) return

    const rect = panel.getBoundingClientRect()
    dragging = true
    dragOffsetX = e.clientX - rect.left
    dragOffsetY = e.clientY - rect.top

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  })

  currentPanel = panel
}