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
function preCalculateNecklace(numMotors, connectorSliderValue) {
    const dynamicConnectorLen = GH_CONSTANTS.connectorBase * connectorSliderValue
    const ringsTotal = numMotors * GH_CONSTANTS.motorRing
    const connectorsTotal = (numMotors - 1) * dynamicConnectorLen
    const arrayLength = ringsTotal + connectorsTotal
    const totalWithoutStrap = arrayLength + GH_CONSTANTS.hook
    const totalWithStrap = totalWithoutStrap + GH_CONSTANTS.strap

    return {
        excludingStrap: parseFloat(totalWithoutStrap.toFixed(2)),
        includingStrap: parseFloat(totalWithStrap.toFixed(2))
    }
}

function updateEstimatedLengths() {
    const numMotors = parseInt(document.getElementById('numMotors').value)
    const connectorVal = parseFloat(document.getElementById('lenConnector').value)
    const result = preCalculateNecklace(numMotors, connectorVal)
    document.getElementById('lengthExclStrap').innerText = result.excludingStrap + '"'
    document.getElementById('lengthInclStrap').innerText = result.includingStrap + '"'
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
document.getElementById('lenConnector').addEventListener('input', (e) => {
    document.getElementById('lenConnectorVal').innerText = parseFloat(e.target.value).toFixed(4)
    updateEstimatedLengths()
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
    const lengthOfConnector = Number(document.getElementById('lenConnector').value)
    const curved = document.getElementById('curved')?.checked || false

    console.log('Values:', { numberOfMotors, lengthOfConnector, curved })

    // Try constructing the trees and inspect their actual structure
    let param1 = new RhinoCompute.Grasshopper.DataTree('Length of connector')
    param1.append([0], [lengthOfConnector])

    let param2 = new RhinoCompute.Grasshopper.DataTree('Number of Motors')
    param2.append([0], [numberOfMotors])

    let param3 = new RhinoCompute.Grasshopper.DataTree('Curved?')
    param3.append([0], [curved])

    // Log the actual object properties
    console.log('param1 keys:', Object.keys(param1))
    console.log('param1.ParamName:', param1.ParamName)
    console.log('param1.InnerTree:', param1.InnerTree)
    console.log('param1 full:', param1)

    let trees = [param1, param2, param3]

    // Call RhinoCompute
    try {
        const res = await RhinoCompute.Grasshopper.evaluateDefinition(definition, trees)
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
                    const val = JSON.parse(branch[j].data)
                    document.getElementById('lengthExclStrap').innerText = val + '"'
                    continue
                }
                if (paramName === 'Length of necklace including strap in inches') {
                    const val = JSON.parse(branch[j].data)
                    document.getElementById('lengthInclStrap').innerText = val + '"'
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

function getAuth(key) {
    let value = localStorage[key]
    if (value === undefined) {
        const promptStr = key.includes('URL') ? 'Server URL' : 'Server API Key'
        value = window.prompt('RhinoCompute ' + promptStr)
        if (value !== null) {
            localStorage.setItem(key, value)
        }
    }
    return value
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
    scene.background = new THREE.Color(0xf0f0f0) // Soft light gray background
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
    camera.position.set(0, 30, 30)

    renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(window.innerWidth, window.innerHeight)
    document.body.appendChild(renderer.domElement)

    controls = new OrbitControls(camera, renderer.domElement)

    // Lighting setup to make the geometry pop
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