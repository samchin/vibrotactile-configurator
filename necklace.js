// Necklace generator, built from the Flat_necklace.stp ring design plus the Grasshopper strap.
// Runs in the browser or Node; replaces the Rhino.Compute server.
// Everything is in millimetres, in the coordinate frame of NecklaceGrasshopperFeb20.gh
// (so the strap trim and the "curved" wrap use the .gh file's own numbers).
// Shapes: flat; curved (the .gh file's wrap, for small build volumes); cone (printed flat, then
// bent into a cone when worn, see conePattern).
//
// Parts (parts/*.bin, made by flat/prep_flat.py):
//   ring_head  strap join + first ring, up to the first waist
//   ring_unit  one ring, waist to waist (repeated)
//   ring_tail  last ring + hook
//   strap      the Grasshopper strap at full length
// .bin layout: uint32 numVert, uint32 numTri, float32 xyz[numVert], uint32 tri[numTri*3]

const IN = 25.4
const OVERLAP = 0.05             // mm each ring piece reaches into the next, so the union fuses them

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
    axisY: -714.27,               // y of the flat necklace's centre line
    ringRadius: 12.7,             // outer radius of a motor ring
    bandWidth: 25.4,              // flat necklace's extent across (y)
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
 * @param params   { motors, pitchCm, strapCm, shape, coneDeg, neckCm, gapMm, worn }
 *                 shape 'flat' | 'curved' | 'cone' (or the older curved: true/false);
 *                 the rest are for 'cone', where worn: false gives the flat piece to print
 * @param manifold initialized manifold-3d module
 * @returns { pos: Float32Array, idx: Uint32Array } one watertight mesh
 */
export function buildNecklace(parts, { motors, pitchCm, strapCm, curved, shape, coneDeg = 45, neckCm = 38, gapMm = 4, worn = true }, manifold) {
    const { Manifold, Mesh } = manifold
    shape = shape || (curved ? 'curved' : 'flat')
    const bent = shape !== 'flat'
    const D = DESIGN
    const pitch = Math.max(pitchCm * 10, D.minPitch)
    const strapMm = Math.min(Math.max(strapCm * 10, 0), D.strapLen)
    const toManifold = m => new Manifold(new Mesh({ numProp: 3, vertProperties: m.pos, triVerts: m.idx }))
    const garbage = []
    const keep = m => (garbage.push(m), m)

    // Rings at the flat design's own pitch: head, (motors - 2) units, tail.
    // Pieces cut at a waist only touch there, and manifold keeps touching shells apart, so each
    // one slides OVERLAP into its neighbour; the stretch below works from the shortened spacing.
    const step = D.pitch - OVERLAP
    const shift = k => [k * step - OVERLAP, 0, 0]       // piece k + 1 (after the head)
    const unit = keep(toManifold(parts.unit))
    const pieces = [keep(toManifold(parts.head))]
    for (let k = 0; k < motors - 2; k++) pieces.push(keep(unit.translate(shift(k))))
    pieces.push(keep(toManifold(parts.tail).translate(shift(motors - 2))))
    const waists = Array.from({ length: motors - 1 }, (_, k) => D.firstWaist + k * step - OVERLAP / 2)

    // Strap: slide right by the unused length, cut off what passes the join (as in the .gh file)
    if (strapMm > 0.01) {
        const strap = keep(toManifold(parts.strap).translate([D.strapLen - strapMm, 0, 0]))
        const cut = keep(strap.trimByPlane([-1, 0, 0], -D.strapCutX))
        if (!cut.isEmpty()) pieces.push(cut)
    }
    // The union's mesh can carry a flat, zero-volume shell (seen where the strap meets the head)
    // that turns into a separate body once exported; keep only shells with real volume.
    const merged = keep(Manifold.ofMesh(keep(Manifold.union(pieces)).getMesh()))
    const shells = merged.decompose()
    const all = shells.length > 1 ? keep(Manifold.compose(shells.filter(s => Math.abs(s.volume()) > 1e-3))) : merged
    for (const s of shells) s.delete()

    // Spacing and curving move points smoothly; split long edges first so curves stay smooth
    let mesh = all.getMesh()
    mesh = subdivided({ pos: mesh.vertProperties, idx: mesh.triVerts, numProp: mesh.numProp }, bent ? 1.0 : 0.6, bent ? null : webZones(waists))
    const stretch = pitch - step
    const pos = mesh.pos
    for (let i = 0; i < pos.length; i += 3) {
        let p = [pos[i], pos[i + 1], pos[i + 2]]
        if (stretch !== 0) p[0] = stretchX(p[0], waists, stretch)
        if (shape === 'curved') p = rotatePoint(flowPoint(p))
        pos[i] = p[0]; pos[i + 1] = p[1]; pos[i + 2] = p[2]
    }
    if (shape === 'cone') conePattern(pos, motors, waists, stretch, step, { coneDeg, neckCm, gapMm, worn })
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

function webZones(waists) {
    const a = DESIGN.webHalfWidth
    return waists.map(w => [w - a, w + a])
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

// Lay the necklace out as the unrolled pattern of a spiral on a cone sloping coneDeg below horizontal.
// A cone unrolls flat without stretching (like a paper party hat), so the piece prints flat and bends
// into the cone when worn: radius r on the cone is r / cos(coneDeg) in the pattern, and one trip
// around the cone takes 360° * cos(coneDeg) of the pattern. The strap is the inner turn, sized to
// neckCm, so the hook ends up outside; each further turn sits one band width + gapMm further out.
// Motor rings stay rigid so their holes stay round; the webs and the strap take the bending.
// worn: true returns the bent shape (for viewing), false the flat piece (z untouched, to print).
function conePattern(pos, motors, waists, stretch, step, { coneDeg, neckCm, gapMm, worn }) {
    const D = DESIGN, h = D.ringRadius + 0.3, ramp = 15
    const cb = Math.cos(coneDeg * Math.PI / 180), sb = Math.sin(coneDeg * Math.PI / 180)
    const sx = x => stretch ? stretchX(x, waists, stretch) : x
    const centres = Array.from({ length: motors }, (_, k) => sx(D.firstWaist - D.pitch / 2 + k * step))
    let xMin = Infinity, xMax = -Infinity
    for (let i = 0; i < pos.length; i += 3) { xMin = Math.min(xMin, pos[i]); xMax = Math.max(xMax, pos[i]) }
    const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)
    // sigma(x): where along the spiral this point takes its frame. Constant across a ring (rigid),
    // ramps across webs, and blends back to x itself over `ramp` mm beyond the end rings.
    const first = centres[0], last = centres[motors - 1]
    const sigma = x => {
        if (x < first - h) { const w = smooth((x - (first - h - ramp)) / ramp); return x + (first - x) * w }
        if (x > last + h) { const w = smooth(((last + h + ramp) - x) / ramp); return x + (last - x) * w }
        for (let k = 0; k < motors; k++) {
            if (Math.abs(x - centres[k]) <= h) return centres[k]
            if (k < motors - 1 && x < centres[k + 1] - h) {
                const t = smooth((x - (centres[k] + h)) / (centres[k + 1] - centres[k] - 2 * h))
                return centres[k] + (centres[k + 1] - centres[k]) * t
            }
        }
        return x
    }
    // Archimedean spiral r = R0 + k * theta in the pattern; arc length -> angle table
    const R0 = (neckCm * 10 / (2 * Math.PI) + D.bandWidth / 2 * cb) / cb
    const k = (D.bandWidth + gapMm) / (2 * Math.PI * cb)
    const ds = 0.25, thAt = [0]
    for (let th = 0, s = 0, next = ds; thAt.length < 20000;) {
        const dth = 0.0005
        s += Math.hypot(R0 + k * th, k) * dth; th += dth
        while (s >= next && thAt.length < 20000) { thAt.push(th); next += ds }
    }
    const L = (thAt.length - 1) * ds
    const frame = s => {
        const sc = Math.min(Math.max(s, 0), L), i = Math.min(Math.floor(sc / ds), thAt.length - 2), f = sc / ds - i
        const th = thAt[i] + (thAt[i + 1] - thAt[i]) * f, r = R0 + k * th, c = Math.cos(th), sn = Math.sin(th)
        const tx = k * c - r * sn, ty = k * sn + r * c, tl = Math.hypot(tx, ty)
        const T = [tx / tl, ty / tl]
        return { P: [r * c + T[0] * (s - sc), r * sn + T[1] * (s - sc)], T, N: [-T[1], T[0]], th }
    }
    // start from the strap end; flipping x and y together turns the piece around rather than mirroring it
    const fromLow = centres[0] - xMin > xMax - last
    for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], sg = sigma(x)
        const s = fromLow ? sg - xMin : xMax - sg, along = fromLow ? x - sg : sg - x
        const v = fromLow ? pos[i + 1] - D.axisY : D.axisY - pos[i + 1]
        const { P, T, N, th } = frame(s)
        const X = P[0] + T[0] * along + N[0] * v, Y = P[1] + T[1] * along + N[1] * v
        if (!worn) { pos[i] = X; pos[i + 1] = Y; continue }
        // unrolled angle, continuous across turns (th is the spiral's angle here), then roll onto the cone
        let d = Math.atan2(Y, X) - th
        d -= 2 * Math.PI * Math.round(d / (2 * Math.PI))
        const rho = Math.hypot(X, Y), phi = (th + d) / cb, z = pos[i + 2], r = rho * cb + z * sb
        pos[i] = r * Math.cos(phi); pos[i + 1] = r * Math.sin(phi); pos[i + 2] = -rho * sb + z * cb
    }
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
