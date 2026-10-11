// Import libraries
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { necklaceLengthCm } from './necklace.js'

// Geometry is built in worker.js (manifold-3d, no server). Units are millimetres.
const worker = new Worker('./worker.js', { type: 'module' })

// Globals
let scene, camera, renderer, controls, resultMesh
let buildId = 0, pending = false, queued = false

function readParams() {
    return {
        motors: parseInt(document.getElementById('numMotors').value),
        strapCm: parseFloat(document.getElementById('strapLength').value),
        pitchCm: parseFloat(document.getElementById('spaceBetweenMotors').value),
        curved: document.getElementById('curved').checked,
    }
}

function updateEstimatedLengths() {
    const lengthCm = necklaceLengthCm(readParams())
    document.getElementById('lengthInclStrap').innerText = lengthCm.toFixed(2) + ' cm'
}

// Setup UI Event Listeners
document.getElementById('numMotors').addEventListener('input', (e) => {
    document.getElementById('numMotorsVal').innerText = e.target.value
    updateEstimatedLengths()
})
document.getElementById('strapLength').addEventListener('input', (e) => {
    document.getElementById('strapLengthVal').innerText = parseFloat(e.target.value).toFixed(2)
    updateEstimatedLengths()
})
document.getElementById('spaceBetweenMotors').addEventListener('input', (e) => {
    document.getElementById('spaceBetweenMotorsVal').innerText = parseFloat(e.target.value).toFixed(2)
    updateEstimatedLengths()
})
// Rebuild when a slider is released or the checkbox changes
for (const id of ['numMotors', 'strapLength', 'spaceBetweenMotors', 'curved'])
    document.getElementById(id).addEventListener('change', compute)
document.getElementById('downloadBtn').addEventListener('click', () => worker.postMessage({ type: 'stl' }))

worker.onmessage = ({ data }) => {
    if (data.type === 'mesh') {
        pending = false
        showMesh(data.pos, data.idx)
        setStatus(`Built in ${(data.ms / 1000).toFixed(1)} s · ${(data.idx.length / 3).toLocaleString()} triangles`)
        document.getElementById('downloadBtn').disabled = false
        showSpinner(false)
        if (queued) { queued = false; compute() }
    } else if (data.type === 'stl') {
        const blob = new Blob([data.stl], { type: 'application/octet-stream' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'necklace.stl'
        a.click()
        URL.revokeObjectURL(url)
    } else if (data.type === 'error') {
        pending = false
        console.error(data.message)
        setStatus('Error: ' + data.message)
        showSpinner(false)
    }
}

// Initialize Three.js scene
init()
updateEstimatedLengths()
compute()

function compute() {
    // one build at a time; if settings change mid-build, build again with the latest values
    if (pending) { queued = true; return }
    pending = true
    showSpinner(true)
    setStatus('Building…')
    worker.postMessage({ type: 'build', id: ++buildId, params: readParams() })
}

function showMesh(pos, idx) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geometry.setIndex(new THREE.BufferAttribute(idx, 1))
    geometry.computeVertexNormals()

    const first = !resultMesh
    if (resultMesh) {
        scene.remove(resultMesh)
        resultMesh.geometry.dispose()
    }
    resultMesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        metalness: 0.1,
        roughness: 0.55,
        side: THREE.DoubleSide
    }))
    scene.add(resultMesh)
    centerView(first)
}

function centerView(moveCamera) {
    if (!resultMesh) return
    const box = new THREE.Box3().setFromObject(resultMesh)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3()).length()

    controls.target.copy(center)
    if (moveCamera) {
        camera.position.copy(center)
        camera.position.z += size * 1.2
    }
    camera.near = size / 100
    camera.far = size * 100
    camera.updateProjectionMatrix()
    controls.update()
}

// Double-click the model to zoom in on that spot; double-click empty space to see everything
function focusOnPoint(event) {
    if (!resultMesh) return
    const rect = renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.intersectObject(resultMesh)[0]
    if (!hit) { centerView(true); return }
    const offset = camera.position.clone().sub(controls.target).setLength(40) // mm
    controls.target.copy(hit.point)
    camera.position.copy(hit.point).add(offset)
    camera.near = 0.5
    camera.updateProjectionMatrix()
    controls.update()
}

function setStatus(text) {
    document.getElementById('status').innerText = text
}

function showSpinner(enable) {
    document.getElementById('loader').style.display = enable ? 'block' : 'none'
}

// BOILERPLATE THREE.JS SETUP //

function init() {
    THREE.Object3D.DefaultUp = new THREE.Vector3(0, 0, 1)

    scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf0f0f0)
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
    camera.position.set(0, 30, 30)

    renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(window.innerWidth, window.innerHeight)
    document.body.appendChild(renderer.domElement)

    controls = new OrbitControls(camera, renderer.domElement)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
    directionalLight.position.set(10, 20, 10)
    scene.add(directionalLight)

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)

    window.addEventListener('resize', onWindowResize, false)
    renderer.domElement.addEventListener('dblclick', focusOnPoint)

    animate()
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
}

function animate() {
    requestAnimationFrame(animate)
    renderer.render(scene, camera)
}
