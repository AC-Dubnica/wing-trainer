import { buildFlow, trace, type FlowEdge, type FlowNode } from '../shared/flow'
import { INPUT_GROUPS, INPUT_PORTS, OUTPUT_GROUPS, OUTPUT_SOURCES, type Snapshot } from '../shared/model'

export interface RoutingDeps {
  snap(): Snapshot
  /** Channel ids in fader order. */
  order(): number[]
  move(id: number, delta: -1 | 1): void
  /** The routing was edited (an input or an output): the sound of a recording may need to follow. */
  edited(): void
  selectChannel(id: number): void
  colors: string[]
  lightColors: Set<number>
}

function el<T extends HTMLElement = HTMLElement>(tag: string, props: Partial<T> & { class?: string } = {}, ...kids: (Node | string)[]): T {
  const { class: cls, ...rest } = props
  const e = Object.assign(document.createElement(tag) as T, rest)
  if (cls) e.className = cls
  e.append(...kids)
  return e
}
const SVGNS = 'http://www.w3.org/2000/svg'
const EDGE_COLOR: Record<FlowEdge['kind'], string> = { input: '#8b93a3', main: '#2f9bff', send: '#f5a623', matrix: '#a070c8', patch: '#2fc46e' }

/** The Routing tab: the venue as a flow of signal (inputs, channels, mixes, outputs) and the tables to patch it differently. */
export function createRouting(root: HTMLElement, deps: RoutingDeps) {
  let selected = ''
  let showSends = false
  const nodeEls = new Map<string, HTMLElement>()
  let edges: FlowEdge[] = []
  let svg: SVGSVGElement | null = null
  let wrap: HTMLElement | null = null
  let paintEdges: () => void = () => {}

  const byOrder = (nodes: FlowNode[]): FlowNode[] => {
    const order = deps.order()
    return [...nodes].sort((a, b) => order.indexOf(Number(a.id.split(':')[1])) - order.indexOf(Number(b.id.split(':')[1])))
  }
  const portSort = (a: FlowNode, b: FlowNode): number => a.id.localeCompare(b.id, undefined, { numeric: true })

  function card(n: FlowNode): HTMLElement {
    const bar = el('div', { class: 'fbar' })
    if (n.kind === 'ch') bar.style.background = deps.colors[n.color] ?? deps.colors[0]
    const c = el('div', { class: `fnode ${n.kind} ${n.muted ? 'muted' : ''}`, title: n.sub }, ...(n.kind === 'ch' ? [bar] : []), el('div', { class: 'fl', textContent: n.label }), el('div', { class: 'fs', textContent: n.sub }))
    c.onclick = () => {
      selected = selected === n.id ? '' : n.id
      if (n.kind === 'ch' && selected) deps.selectChannel(Number(n.id.split(':')[1]))
      highlight()
    }
    nodeEls.set(n.id, c)
    return c
  }

  function highlight(): void {
    const on = selected ? trace(edges, selected) : null
    for (const [id, e] of nodeEls) {
      e.classList.toggle('sel', id === selected)
      e.classList.toggle('dim', !!on && !on.has(id))
    }
    paintEdges()
  }

  function diagram(): HTMLElement {
    const flow = buildFlow(deps.snap())
    edges = flow.edges
    nodeEls.clear()
    const of = (kind: FlowNode['kind']): FlowNode[] => flow.nodes.filter((n) => n.kind === kind)
    const col = (title: string, kids: HTMLElement[]): HTMLElement => el('div', { class: 'fcol' }, el('div', { class: 'fct', textContent: title }), ...kids)
    const mixes = [...of('bus'), ...of('main'), ...of('matrix')]
    wrap = el('div', { class: 'flowwrap' },
      col('INPUTS', of('in').sort(portSort).map(card)),
      col('CHANNELS', byOrder(of('ch')).map(card)),
      col('MIXES', mixes.map(card)),
      col('OUTPUTS', of('out').sort(portSort).map(card)))
    svg = document.createElementNS(SVGNS, 'svg') as SVGSVGElement
    svg.setAttribute('class', 'flowsvg')
    wrap.prepend(svg)
    paintEdges = () => {
      if (!wrap || !svg) return
      const box = wrap.getBoundingClientRect()
      svg.setAttribute('width', String(wrap.scrollWidth))
      svg.setAttribute('height', String(wrap.scrollHeight))
      svg.replaceChildren()
      const on = selected ? trace(edges, selected) : null
      for (const e of edges) {
        const a = nodeEls.get(e.from)
        const b = nodeEls.get(e.to)
        if (!a || !b) continue
        const lit = !!on && on.has(e.from) && on.has(e.to)
        if (e.kind === 'send' && !showSends && !lit) continue
        const ra = a.getBoundingClientRect()
        const rb = b.getBoundingClientRect()
        const x1 = ra.right - box.left, y1 = ra.top + ra.height / 2 - box.top
        const sameColumn = Math.abs(ra.left - rb.left) < 20 // a bus feeding a main: loop out to the right and back
        const x2 = (sameColumn ? rb.right : rb.left) - box.left, y2 = rb.top + rb.height / 2 - box.top
        const dx = Math.max(30, Math.abs(x2 - x1) / 2)
        const path = document.createElementNS(SVGNS, 'path')
        path.setAttribute('d', sameColumn ? `M ${x1} ${y1} C ${x1 + 34} ${y1}, ${x2 + 34} ${y2}, ${x2} ${y2}` : `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`)
        path.setAttribute('fill', 'none')
        path.setAttribute('stroke', EDGE_COLOR[e.kind])
        path.setAttribute('stroke-width', lit ? '2.5' : '1')
        path.setAttribute('stroke-opacity', on ? (lit ? '1' : '0.07') : e.muted ? '0.18' : '0.4')
        if (e.muted) path.setAttribute('stroke-dasharray', '4 3')
        const t = document.createElementNS(SVGNS, 'title')
        t.textContent = `${e.from.split(':').slice(1).join(' ')} → ${e.to.split(':').slice(1).join(' ')} ${e.label}`.trim()
        path.append(t)
        svg.append(path)
      }
    }
    return el('div', { class: 'flowscroll' }, wrap)
  }

  // --- the tables that remap ---------------------------------------------------------------------------------------------

  function select<T extends string>(options: readonly T[], value: string, label: string, onChange: (v: string) => void): HTMLSelectElement {
    const s = el<HTMLSelectElement>('select', {}, ...options.map((o) => el<HTMLOptionElement>('option', { value: o, textContent: o, selected: o === value })))
    s.setAttribute('aria-label', label)
    s.onchange = () => onChange(s.value)
    return s
  }
  function numberBox(value: number, max: number, label: string, onChange: (v: number) => void): HTMLInputElement {
    const n = el<HTMLInputElement>('input', { type: 'number', min: '1', max: String(max), value: String(value) })
    n.setAttribute('aria-label', label)
    n.onchange = () => onChange(Math.min(max, Math.max(1, Math.round(Number(n.value) || 1))))
    return n
  }
  const inputMax = (grp: string): number => INPUT_PORTS[grp] ?? 48
  const sourceMax = (grp: string): number => (grp === 'MAIN' ? 4 : grp === 'MTX' ? 8 : grp === 'BUS' ? 25 : grp === 'MON' ? 2 : inputMax(grp))

  function fadersTable(): HTMLElement {
    const snap = deps.snap()
    const rows = deps.order().map((id, i, all) => {
      const c = snap.channels.find((x) => x.id === id)
      if (!c) return null
      const port = snap.inputs.find((p) => p.grp === c.source.grp && p.port === c.source.in)
      const bar = el('span', { class: 'chip' })
      bar.style.background = deps.colors[c.color] ?? deps.colors[0]
      const set = (grp: string, n: number): void => { c.source = { grp, in: n }; c.hasSource = grp !== 'OFF'; changed() }
      const up = el<HTMLButtonElement>('button', { class: 'mini', textContent: '▲', title: 'Move to the left', disabled: i === 0, onclick: () => { deps.move(id, -1); render() } })
      const down = el<HTMLButtonElement>('button', { class: 'mini', textContent: '▼', title: 'Move to the right', disabled: i === all.length - 1, onclick: () => { deps.move(id, 1); render() } })
      return el('tr', {},
        el('td', { class: 'num', textContent: String(i + 1) }), el('td', {}, bar, ` ${c.name || `Ch ${c.id}`}`, el('span', { class: 'dim', textContent: `  ch ${c.id}` })),
        el('td', {}, select(['OFF', ...INPUT_GROUPS], c.hasSource ? c.source.grp : 'OFF', `Input group of ${c.name}`, (v) => set(v, v === 'OFF' ? 1 : Math.min(c.source.in, inputMax(v)))),
          ' ', numberBox(c.source.in, inputMax(c.source.grp), `Input port of ${c.name}`, (v) => set(c.source.grp, v))),
        el('td', { class: 'dim', textContent: port?.name ? port.name : c.hasSource ? '' : 'nothing' }), el('td', {}, up, down))
    }).filter((r): r is HTMLElement => r !== null)
    return el('div', { class: 'rsec' }, el('div', { class: 'st', textContent: 'FADERS AND INPUTS' }),
      el('div', { class: 'dim note', textContent: 'The order is the order of the faders (▲ ▼ moves a channel left or right). The input is the port the channel listens to: change it to patch a different microphone or recorder track to the fader.' }),
      el('table', { class: 'rtab' }, el('thead', {}, el('tr', {}, ...['#', 'Fader', 'Input', 'Port name', ''].map((h) => el('th', { textContent: h })))), el('tbody', {}, ...rows)))
  }

  function outputsTable(): HTMLElement {
    const snap = deps.snap()
    const rows = [...snap.outputs].sort((a, b) => (a.grp === b.grp ? a.port - b.port : Object.keys(OUTPUT_GROUPS).indexOf(a.grp) - Object.keys(OUTPUT_GROUPS).indexOf(b.grp))).map((o) => {
      const set = (grp: string, n: number): void => { o.source = { grp, in: n }; changed() }
      const remove = el<HTMLButtonElement>('button', { class: 'mini', textContent: '×', title: 'Unpatch this output', onclick: () => { snap.outputs.splice(snap.outputs.indexOf(o), 1); changed() } })
      return el('tr', {}, el('td', { textContent: `${o.grp} ${o.port}` }),
        el('td', {}, select(OUTPUT_SOURCES.filter((g) => g !== 'OFF'), o.source.grp, `Source group of output ${o.grp} ${o.port}`, (v) => set(v, Math.min(o.source.in, sourceMax(v)))), ' ', numberBox(o.source.in, sourceMax(o.source.grp), `Source number of output ${o.grp} ${o.port}`, (v) => set(o.source.grp, v))),
        el('td', {}, remove))
    })
    // A new patch
    let ng = Object.keys(OUTPUT_GROUPS)[0], np = 1, sg = 'MAIN', sn = 1
    const addRow = el('tr', { class: 'add' },
      el('td', {}, select(Object.keys(OUTPUT_GROUPS), ng, 'Output group', (v) => { ng = v }), ' ', numberBox(np, 64, 'Output port', (v) => { np = v })),
      el('td', {}, select(OUTPUT_SOURCES.filter((g) => g !== 'OFF'), sg, 'Source group', (v) => { sg = v }), ' ', numberBox(sn, 25, 'Source number', (v) => { sn = v })),
      el('td', {}, el<HTMLButtonElement>('button', {
        class: 'mini wide', textContent: 'PATCH', title: 'Patch this output (it replaces what the port had)',
        onclick: () => {
          const port = Math.min(np, OUTPUT_GROUPS[ng])
          const existing = snap.outputs.find((x) => x.grp === ng && x.port === port)
          if (existing) existing.source = { grp: sg, in: sn }
          else snap.outputs.push({ grp: ng, port, source: { grp: sg, in: sn } })
          changed()
        },
      })))
    return el('div', { class: 'rsec' }, el('div', { class: 'st', textContent: 'OUTPUTS' }),
      el('div', { class: 'dim note', textContent: 'Which signal each output port of the console carries. The USB outputs are the recorder tracks: they decide which recorded track plays on which fader.' }),
      el('table', { class: 'rtab' }, el('thead', {}, el('tr', {}, ...['Output', 'Takes its signal from', ''].map((h) => el('th', { textContent: h })))), el('tbody', {}, ...rows, addRow)))
  }

  function changed(): void {
    deps.edited()
    render()
  }

  function render(): void {
    const keepScroll = root.querySelector('.flowscroll')?.scrollTop ?? 0
    const sends = el<HTMLInputElement>('input', { type: 'checkbox', checked: showSends })
    sends.onchange = () => { showSends = sends.checked; paintEdges() }
    const legend = el('div', { class: 'legend' },
      ...(['input', 'main', 'send', 'matrix', 'patch'] as const).map((k) => el('span', {}, el('i', { style: `background:${EDGE_COLOR[k]}` } as unknown as Partial<HTMLElement>), { input: 'input', main: 'to a main', send: 'bus send', matrix: 'to matrix', patch: 'to an output' }[k])),
      el('label', { class: 'sendsw' }, sends, ' show all bus sends'), el('span', { class: 'dim', textContent: 'Click a channel, a mix or an output to follow its signal.' }))
    const d = diagram()
    root.replaceChildren(el('div', { class: 'rleft' }, legend, d), el('div', { class: 'rright' }, fadersTable(), outputsTable()))
    d.scrollTop = keepScroll
    requestAnimationFrame(() => { highlight(); paintEdges() })
  }

  return { render, repaint: () => paintEdges(), clear: () => { selected = '' } }
}
