// Builds the necklace off the main thread so the page stays responsive.
import Module from 'https://cdn.jsdelivr.net/npm/manifold-3d@3.0.0/manifold.js'
import { buildNecklace, parseBin, toSTL } from './necklace.js'

const ready = (async () => {
    const wasm = await Module()
    wasm.setup()
    // no-cache: revalidate so regenerated parts show up without a hard refresh
    const load = async name => parseBin(await (await fetch(`parts/${name}.bin`, { cache: 'no-cache' })).arrayBuffer())
    const [head, unit, tail, strap] = await Promise.all(['ring_head', 'ring_unit', 'ring_tail', 'strap'].map(load))
    return { wasm, parts: { head, unit, tail, strap } }
})()

let last = null, lastParams = null

self.onmessage = async ({ data }) => {
    try {
        const { wasm, parts } = await ready
        if (data.type === 'build') {
            const t = performance.now()
            last = buildNecklace(parts, data.params, wasm)
            lastParams = data.params
            const pos = last.pos.slice(), idx = last.idx.slice()
            self.postMessage({ type: 'mesh', id: data.id, pos, idx, ms: performance.now() - t }, [pos.buffer, idx.buffer])
        } else if (data.type === 'stl' && last) {
            // the cone is shown as worn but printed flat, so the download is always the flat piece
            const printable = lastParams.shape === 'cone' && lastParams.worn ? buildNecklace(parts, { ...lastParams, worn: false }, wasm) : last
            const stl = toSTL(printable)
            self.postMessage({ type: 'stl', stl }, [stl])
        }
    } catch (err) {
        self.postMessage({ type: 'error', message: String(err && err.message || err) })
    }
}
