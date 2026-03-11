// Import libraries
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { Rhino3dmLoader } from 'three/examples/jsm/loaders/3DMLoader'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter'
import rhino3dm from 'rhino3dm'
import { RhinoCompute } from 'rhinocompute'

// Reference your specific Grasshopper definition
const definitionName = 'NecklaceGrasshopperFeb20.gh'

// Exact measurements from Rhino (inches)
const GH_CONSTANTS = {
    motorRing: 1.0419,
    connectorBase: 0.2194,
    strap: 7.9281,
    hook: 0.6388
}

/**
 * Calculates the total necklace length instantly (before RhinoCompute).
 * @param {number} numMotors - Value from "Number of Motors" slider
 * @param {number} connectorSliderValue - Value from "Length of connector" slider
 * @returns {object} Calculated lengths in inches
 */
function preCalculateNecklace(numMotors, spaceBetweenMotorsCm, strapLengthCm) {
    const totalWithoutStrap = numMotors * (spaceBetweenMotorsCm ?? 2.5)
    const totalWithStrap = totalWithoutStrap + (strapLengthCm ?? 20.24)

    return {
        excludingStrapCm: parseFloat(totalWithoutStrap.toFixed(2)),
        includingStrapCm: parseFloat(totalWithStrap.toFixed(2))
    }
}

function updateEstimatedLengths() {
    const numMotors = parseInt(document.getElementById('numMotors').value)
    const strapCm = parseFloat(document.getElementById('strapLength')?.value ?? 20.24)
    const spaceCm = parseFloat(document.getElementById('spaceBetweenMotors')?.value ?? 2.5)
    const result = preCalculateNecklace(numMotors, spaceCm, strapCm)
    document.getElementById('lengthExclStrap').innerText = result.excludingStrapCm + ' cm'
    document.getElementById('lengthInclStrap').innerText = result.includingStrapCm + ' cm'
}

/**
 * Safely convert Uint8Array to base64 string (handles large files)
 */
function uint8ArrayToBase64(uint8Array) {
    let binary = ''
    const chunkSize = 8192
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.subarray(i, i + chunkSize)
        binary += String.fromCharCode.apply(null, chunk)
    }
    return btoa(binary)
}

// Globals
let definition, doc
let scene, camera, renderer, controls, resultGroup

// Initialize rhino3dm
const rhino = await rhino3dm()
console.log('Loaded rhino3dm.')

// Load RhinoCompute config
const configRes = await fetch('config.json')
const config = await configRes.json()
RhinoCompute.url = config.url
RhinoCompute.apiKey = config.apiKey

// Setup UI Event Listeners
document.getElementById('numMotors').addEventListener('input', (e) => {
    document.getElementById('numMotorsVal').innerText = e.target.value
    updateEstimatedLengths()
})
document.getElementById('strapLength')?.addEventListener('input', (e) => {
    document.getElementById('strapLengthVal').innerText = parseFloat(e.target.value).toFixed(2)
    updateEstimatedLengths()
})
document.getElementById('spaceBetweenMotors')?.addEventListener('input', (e) => {
    document.getElementById('spaceBetweenMotorsVal').innerText = parseFloat(e.target.value).toFixed(2)
})
document.getElementById('computeBtn').addEventListener('click', compute)
document.getElementById('downloadBtn').addEventListener('click', downloadMesh)

// Fetch the Grasshopper file
let url = definitionName
let res = await fetch(url)
let buffer = await res.arrayBuffer()
definition = new Uint8Array(buffer)

// Initialize Three.js scene
init()
updateEstimatedLengths()

async function compute() {
    showSpinner(true)

    const numberOfMotors = Math.round(Number(document.getElementById('numMotors').value))
    const curved = document.getElementById('curved')?.checked || false
    const strapLengthCm = Number(document.getElementById('strapLength')?.value ?? 20.24)
    const strapLengthInches = strapLengthCm / 2.54
    const spaceBetweenMotors = Number(document.getElementById('spaceBetweenMotors')?.value ?? 2.5)

    console.log('Values:', { numberOfMotors, curved, strapLengthCm, strapLengthInches, spaceBetweenMotors })

    const trees = [
        { ParamName: 'Number of motors', InnerTree: { '0': [{ type: 'System.Int32', data: JSON.stringify(numberOfMotors) }] } },
        { ParamName: 'Curved?', InnerTree: { '0': [{ type: 'System.Boolean', data: JSON.stringify(curved) }] } },
        { ParamName: 'Strap Length', InnerTree: { '0': [{ type: 'System.Double', data: JSON.stringify(strapLengthInches) }] } },
        { ParamName: 'Distance between adjacent motors', InnerTree: { '0': [{ type: 'System.Double', data: JSON.stringify(spaceBetweenMotors) }] } }
    ]

    console.log('Trees being sent:', JSON.stringify(trees, null, 2))

    try {
        const treesWithData = trees.map(t => ({ data: t }))
        const res = await RhinoCompute.Grasshopper.evaluateDefinition(definition, treesWithData)
        console.log("Compute response:", res)
        collectResults(res)
    } catch (err) {
        console.error("Error computing definition:", err)
        showSpinner(false)
    }
}

/**
 * Parse response and load into Three.js
 */
function collectResults(responseJson) {
    const values = responseJson.values

    // Clear previous rhino doc
    if (doc !== undefined) {
        doc.delete()
    }

    doc = new rhino.File3dm()

    // Extract output panel values and geometry
    for (let i = 0; i < values.length; i++) {
        const paramName = values[i].ParamName

        for (const path in values[i].InnerTree) {
            const branch = values[i].InnerTree[path]
            for (let j = 0; j < branch.length; j++) {

                // Check for panel text outputs
                if (paramName === 'Length of necklace excluding strap in inches') {
                    const valInches = parseFloat(JSON.parse(branch[j].data))
                    const valCm = (valInches * 2.54).toFixed(2)
                    document.getElementById('lengthExclStrap').innerText = valCm + ' cm'
                    continue
                }
                if (paramName === 'Length of necklace including strap in inches') {
                    const valInches = parseFloat(JSON.parse(branch[j].data))
                    const valCm = (valInches * 2.54).toFixed(2)
                    document.getElementById('lengthInclStrap').innerText = valCm + ' cm'
                    continue
                }

                // Decode geometry output
                const rhinoObject = decodeItem(branch[j])
                if (rhinoObject !== null) {
                    // Check if Grasshopper accidentally sent a Brep instead of a Mesh
                    if (rhinoObject.objectType === rhino.ObjectType.Brep) {
                        console.warn("Skipped a Brep. Only Meshes can be displayed.")
                        rhinoObject.delete()
                    } else {
                        // Add valid Meshes/Curves to the document
                        doc.objects().add(rhinoObject, null)
                    }
                }
            }
        }
    }

    if (doc.objects().count < 1) {
        console.error('No rhino objects to load! Make sure Grasshopper is sending a Mesh.')
        showSpinner(false)
        return
    }

    // Load the document into Three.js
    const loader = new Rhino3dmLoader()
    loader.setLibraryPath('https://unpkg.com/rhino3dm@8.0.0-beta/')

    const resMaterial = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        metalness: 0.8,
        roughness: 0.2,
        side: THREE.DoubleSide
    })

    const bufferToLoad = new Uint8Array(doc.toByteArray()).buffer
    loader.parse(bufferToLoad, function (object) {
        if (resultGroup) {
            scene.remove(resultGroup)
        }
        resultGroup = new THREE.Group()

        object.traverse(child => {
            if (child.isMesh) {
                child.material = resMaterial
            }
        })

        // Rotate Rhino's Z-up to Three.js Y-up
        object.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(-90))

        resultGroup.add(object)
        scene.add(resultGroup)

        centerView()
        document.getElementById('downloadBtn').disabled = false
        showSpinner(false)

    }, (error) => {
        console.error(error)
        showSpinner(false)
    })
}

function centerView() {
    if (!resultGroup) return
    const box = new THREE.Box3().setFromObject(resultGroup)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3()).length()

    controls.target.copy(center)
    camera.position.copy(center)
    camera.position.z += size * 1.2
    camera.near = size / 100
    camera.far = size * 100
    camera.updateProjectionMatrix()
    controls.update()
}

function downloadMesh() {
    if (!resultGroup) return
    const exporter = new STLExporter()
    const stlBinary = exporter.parse(resultGroup, { binary: true })
    const blob = new Blob([stlBinary], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'necklace.stl'
    a.click()
    URL.revokeObjectURL(url)
}

/**
 * Attempt to decode data tree item to rhino geometry
 */
function decodeItem(item) {
    const data = JSON.parse(item.data)
    if (item.type === 'System.String') {
        try {
            return rhino.DracoCompression.decompressBase64String(data)
        } catch { }
    } else if (typeof data === 'object') {
        return rhino.CommonObject.decode(data)
    }
    return null
}

function showSpinner(enable) {
    if (enable)
        document.getElementById('loader').style.display = 'block'
    else
        document.getElementById('loader').style.display = 'none'
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
