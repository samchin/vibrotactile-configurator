// Necklace generator, built from the Flat_necklace.stp ring design plus the Grasshopper strap.
// Runs in the browser or Node; replaces the Rhino.Compute server.
// Everything is in millimetres, in the coordinate frame of NecklaceGrasshopperFeb20.gh
// (so the strap trim and the "curved" wrap use the .gh file's own numbers).
//
// Parts (parts/*.bin, made by flat/prep_flat.py):
//   ring_head  strap join + first ring, up to the first waist
//   ring_unit  one ring, waist to waist (repeated)
//   ring_tail  last ring + hook
//   strap      the Grasshopper strap at full length
// .bin layout: uint32 numVert, uint32 numTri, float32 xyz[numVert], uint32 tri[numTri*3]

const IN = 25.4

export const DESIGN = {
    pitch: 32.03,                 // ring-to-ring spacing of the flat design (mm)
    firstWaist: 707.655,          // x of the waist between ring 1 and ring 2
    webHalfWidth: 5.0,            // stretch zone either side of a waist; keeps motor holes (r 10.54) round
    minPitch: 27,                 // below this the rings run into each other
    strapLen: 7.975043378093169 * IN,
    strapCutX: 26.79491424560547 * IN,
    flowBase: { start: [18.670161761272787 * IN, -28.100544006127336 * IN, 0], end: [39.052997769745815 * IN, -28.09131597608359 * IN, 0] },
    flowArc: {
        center: [25.54853329668918 * IN, 0, -6.309555735713177 * IN],
        radius: 2.915934872944258 * IN,
        angle: 5.50205184881933,
        xAxis: [0.2956550542916317, 0, 0.9552947654372509],
        yAxis: [0.9552947654372509, 0, -0.2956550542916317],
    },
    rotateOrigin: [27.49 * IN, -27.94 * IN, -0.18 * IN],
    rotateAngle: 80,              // radians (Grasshopper's Rotate default), about -X
}

export const LIMITS = {
    motors: [2, 10],
    pitchCm: [DESIGN.minPitch / 10, 10],
    strapCm: [0, +(DESIGN.strapLen / 10).toFixed(2)],
}

// Length shown in the UI (cm), same formula as the old page
export function necklaceLengthCm({ motors, pitchCm, strapCm }) {
    return motors * pitchCm + strapCm
}

export function parseBin(buffer) {
    const u = new Uint32Array(buffer, 0, 2)
    const nv = u[0], nt = u[1]
    return {
        pos: new Float32Array(buffer, 8, nv * 3),
        idx: new Uint32Array(buffer, 8 + nv * 12, nt * 3),
    }
}

/**
 * @param parts    { head, unit, tail, strap } from parseBin
 * @param params   { motors, pitchCm, strapCm, curved }
 * @param manifold initialized manifold-3d module
 * @returns { pos: Float32Array, idx: Uint32Array } one watertight mesh
 */
export function buildNecklace(parts, { motors, pitchCm, strapCm, curved }, manifold) {
    const { Manifold, Mesh } = manifold
    const D = DESIGN
    const pitch = Math.max(pitchCm * 10, D.minPitch)
    const strapMm = Math.min(Math.max(strapCm * 10, 0), D.strapLen)
    const toManifold = m => new Manifold(new Mesh({ numProp: 3, vertProperties: m.pos, triVerts: m.idx }))
    const garbage = []
    const keep = m => (garbage.push(m), m)

    // Rings at the flat design's own pitch: head, (motors - 2) units, tail
    const unit = keep(toManifold(parts.unit))
    const pieces = [keep(toManifold(parts.head))]
    for (let k = 0; k < motors - 2; k++) pieces.push(keep(unit.translate([k * D.pitch, 0, 0])))
    pieces.push(keep(toManifold(parts.tail).translate([(motors - 2) * D.pitch, 0, 0])))

    // Strap: slide right by the unused length, cut off what passes the join (as in the .gh file)
    if (strapMm > 0.01) {
        const strap = keep(toManifold(parts.strap).translate([D.strapLen - strapMm, 0, 0]))
        const cut = keep(strap.trimByPlane([-1, 0, 0], -D.strapCutX))
        if (!cut.isEmpty()) pieces.push(cut)
    }
    const all = keep(Manifold.union(pieces))

    // Spacing and curving move points smoothly; split long edges first so curves stay smooth
    let mesh = all.getMesh()
    mesh = subdivided({ pos: mesh.vertProperties, idx: mesh.triVerts, numProp: mesh.numProp }, curved ? 1.0 : 0.6, curved ? null : webZones(motors))
    const waists = Array.from({ length: motors - 1 }, (_, k) => D.firstWaist + k * D.pitch)
    const stretch = pitch - D.pitch
    const pos = mesh.pos
    for (let i = 0; i < pos.length; i += 3) {
        let p = [pos[i], pos[i + 1], pos[i + 2]]
        if (stretch !== 0) p[0] = stretchX(p[0], waists, stretch)
        if (curved) p = rotatePoint(flowPoint(p))
        pos[i] = p[0]; pos[i + 1] = p[1]; pos[i + 2] = p[2]
    }
    for (const m of garbage) m.delete()
    return mesh
}

// Each waist's zone [w - a, w + a] grows by `stretch`; smoothstep keeps the walls tangent-continuous.
function stretchX(x, waists, stretch) {
    const a = DESIGN.webHalfWidth
    let dx = 0
    for (const w of waists) {
        const t = (x - (w - a)) / (2 * a)
        dx += stretch * (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
    }
    return x + dx
}

function webZones(motors) {
    const a = DESIGN.webHalfWidth
    return Array.from({ length: motors - 1 }, (_, k) => [DESIGN.firstWaist + k * DESIGN.pitch - a, DESIGN.firstWaist + k * DESIGN.pitch + a])
}

// Grasshopper "Flow" (stretch off) from the base line onto the arc: distance along the line
// becomes distance along the arc; sideways offset goes along the arc plane's normal, height goes radial.
// Past either end of the arc the necklace continues straight along the end tangent.
function flowPoint(p) {
    const { start: b0, end: b1 } = DESIGN.flowBase
    const A = DESIGN.flowArc
    let tx = b1[0] - b0[0], ty = b1[1] - b0[1]
    const tl = Math.hypot(tx, ty); tx /= tl; ty /= tl
    const rx = p[0] - b0[0], ry = p[1] - b0[1], rz = p[2] - b0[2]
    const s = rx * tx + ry * ty
    const side = -rx * ty + ry * tx
    const L = A.radius * A.angle
    const th = Math.min(Math.max(s, 0), L) / A.radius
    const c = Math.cos(th), sn = Math.sin(th)
    const X = A.xAxis, Y = A.yAxis
    const normal = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]]
    const extra = s < 0 ? s : s > L ? s - L : 0
    const out = [0, 0, 0]
    for (let k = 0; k < 3; k++) {
        const radial = c * X[k] + sn * Y[k], tangent = -sn * X[k] + c * Y[k]
        out[k] = A.center[k] + (A.radius + rz) * radial + extra * tangent + side * normal[k]
    }
    return out
}

function rotatePoint(p) {
    const o = DESIGN.rotateOrigin
    const a = -DESIGN.rotateAngle
    const y = p[1] - o[1], z = p[2] - o[2]
    return [p[0], o[1] + y * Math.cos(a) - z * Math.sin(a), o[2] + y * Math.sin(a) + z * Math.cos(a)]
}

// Split every edge longer than maxLen (optionally only edges touching the given x ranges).
// Red-green patterns, so shared edges split the same way and the mesh stays watertight.
function subdivided(mesh, maxLen, zones) {
    const np = mesh.numProp || 3
    let pos = []
    for (let i = 0; i < mesh.pos.length; i += np) pos.push(mesh.pos[i], mesh.pos[i + 1], mesh.pos[i + 2])
    let idx = Array.from(mesh.idx)
    const inZone = (a, b) => {
        if (!zones) return true
        const x0 = Math.min(pos[3 * a], pos[3 * b]), x1 = Math.max(pos[3 * a], pos[3 * b])
        return zones.some(([z0, z1]) => x1 >= z0 && x0 <= z1)
    }
    for (let pass = 0; pass < 10; pass++) {
        const mid = new Map()
        const edgeMid = (a, b) => {
            const k = a < b ? a * 4294967296 + b : b * 4294967296 + a
            let m = mid.get(k)
            if (m !== undefined) return m
            const dx = pos[3 * a] - pos[3 * b], dy = pos[3 * a + 1] - pos[3 * b + 1], dz = pos[3 * a + 2] - pos[3 * b + 2]
            if (dx * dx + dy * dy + dz * dz <= maxLen * maxLen || !inZone(a, b)) { mid.set(k, -1); return -1 }
            m = pos.length / 3
            pos.push((pos[3 * a] + pos[3 * b]) / 2, (pos[3 * a + 1] + pos[3 * b + 1]) / 2, (pos[3 * a + 2] + pos[3 * b + 2]) / 2)
            mid.set(k, m)
            return m
        }
        const out = []
        let split = 0
        for (let t = 0; t < idx.length; t += 3) {
            const v = [idx[t], idx[t + 1], idx[t + 2]]
            const m = [edgeMid(v[0], v[1]), edgeMid(v[1], v[2]), edgeMid(v[2], v[0])]
            const n = (m[0] >= 0) + (m[1] >= 0) + (m[2] >= 0)
            if (n === 0) { out.push(v[0], v[1], v[2]); continue }
            split++
            if (n === 3) { out.push(v[0], m[0], m[2], v[1], m[1], m[0], v[2], m[2], m[1], m[0], m[1], m[2]); continue }
            // rotate so the first split edge is (a, b)
            let r = m[0] >= 0 ? 0 : m[1] >= 0 ? 1 : 2
            if (n === 2 && m[0] >= 0 && m[2] >= 0) r = 2
            const a = v[r], b = v[(r + 1) % 3], c = v[(r + 2) % 3]
            const mab = m[r], mbc = m[(r + 1) % 3], mca = m[(r + 2) % 3]
            if (n === 1) out.push(a, mab, c, mab, b, c)
            else if (mbc >= 0) out.push(a, mab, c, mab, b, mbc, mab, mbc, c)
            else out.push(a, mab, mca, mab, b, c, mab, c, mca)
        }
        idx = out
        if (!split) break
    }
    return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx) }
}

export function toSTL(mesh) {
    const n = mesh.idx.length / 3
    const buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf)
    dv.setUint32(80, n, true)
    const P = mesh.pos, I = mesh.idx
    for (let t = 0; t < n; t++) {
        const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2]
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
        const l = Math.hypot(nx, ny, nz) || 1
        const o = 84 + t * 50
        dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true)
        for (const [k, v] of [a, b, c].entries())
            for (let j = 0; j < 3; j++) dv.setFloat32(o + 12 + k * 12 + j * 4, P[v + j], true)
    }
    return buf
}
