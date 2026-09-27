import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'
import type { MeshData } from '../worker/protocol.ts'

export interface KitParts {
  acrylic: MeshData
  led: MeshData
  panel: MeshData
  kickstand: MeshData | null
  buttons: MeshData | null
  /** Score lines (x1 y1 x2 y2 …) drawn at `scoreZ`. */
  score: Float32Array
  scoreZ: number
  /** Exploded spacing between layers (mm). */
  explodeSpan: number
}

function toGeometry(mesh: MeshData, smooth: boolean): THREE.BufferGeometry {
  let geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
  if (mesh.normals) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
  }
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
  if (smooth) {
    // Smooth across gentle curves, keep rabbet steps and chamfers crisp.
    geometry = toCreasedNormals(geometry, (35 * Math.PI) / 180)
  } else {
    geometry.computeVertexNormals()
  }
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function disposeMesh(o: THREE.Mesh | THREE.LineSegments): void {
  o.geometry.dispose()
  const mat = o.material
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
  else mat.dispose()
}

export class FrameViewer {
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly renderer: THREE.WebGLRenderer
  private readonly controls: OrbitControls
  private readonly root: THREE.Group
  private frameMesh: THREE.Mesh | null = null
  private artworkMesh: THREE.Mesh | null = null
  private artworkTexture: THREE.Texture | null = null
  private artworkGen = 0
  private readonly resizeObserver: ResizeObserver
  private readonly host: HTMLElement
  private fitted = false
  private raf = 0
  private layers: { group: THREE.Group; step: number }[] = []
  private explode = 0
  private explodeSpan = 30
  private artworkZ = 0

  constructor(host: HTMLElement) {
    this.host = host
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x161616)

    const w = host.clientWidth || 800
    const h = host.clientHeight || 600
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 4000)
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(80, -180, 140)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    host.appendChild(this.renderer.domElement)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.target.set(0, 0, 8)
    this.controls.maxPolarAngle = Math.PI * 0.95

    this.root = new THREE.Group()
    this.scene.add(this.root)
    this.addLights()
    this.addGround()

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(host)
    this.loop()
  }

  setMesh(mesh: MeshData, opts?: { smooth?: boolean }): void {
    if (this.frameMesh) {
      this.root.remove(this.frameMesh)
      disposeMesh(this.frameMesh)
      this.frameMesh = null
    }
    const smooth = opts?.smooth === true || !!mesh.normals
    const geometry = toGeometry(mesh, smooth)
    const material = new THREE.MeshStandardMaterial({
      color: 0xc4a574,
      roughness: 0.48,
      metalness: 0.04,
      flatShading: !smooth,
    })

    this.frameMesh = new THREE.Mesh(geometry, material)
    this.frameMesh.castShadow = true
    this.frameMesh.receiveShadow = true
    this.root.add(this.frameMesh)
    this.applyExplode()
    if (!this.fitted) {
      this.fit(geometry)
      this.fitted = true
    }
  }

  /** Backlight kit layers (acrylic, LED band, back panel + kickstand + buttons), or null to hide. */
  setParts(parts: KitParts | null): void {
    this.clearParts()
    if (!parts) return
    const acrylic = new THREE.Group()
    const panel = new THREE.Group()
    const led = new THREE.Group()
    const add = (group: THREE.Group, data: MeshData | null, material: THREE.Material, smooth = false) => {
      if (!data) return
      const mesh = new THREE.Mesh(toGeometry(data, smooth), material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
    }
    add(
      acrylic,
      parts.acrylic,
      new THREE.MeshStandardMaterial({
        color: 0xcfeeff,
        roughness: 0.08,
        metalness: 0,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
    )
    if (parts.score.length > 0) {
      const n = parts.score.length / 4
      const pos = new Float32Array(n * 6)
      for (let i = 0; i < n; i++) {
        pos.set(
          [parts.score[i * 4]!, parts.score[i * 4 + 1]!, parts.scoreZ, parts.score[i * 4 + 2]!, parts.score[i * 4 + 3]!, parts.scoreZ],
          i * 6,
        )
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      acrylic.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.55 })))
    }
    add(led, parts.led, new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffc46b, emissiveIntensity: 0.9 }))
    add(panel, parts.panel, new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.7, flatShading: true }))
    add(panel, parts.kickstand, new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.6, flatShading: true }))
    add(panel, parts.buttons, new THREE.MeshStandardMaterial({ color: 0x8b939c, roughness: 0.6, flatShading: true }))
    // Exploding lifts the frame (with its LED strip and the lithophane) and the acrylic off the panel.
    this.layers = [
      { group: acrylic, step: 1 },
      { group: led, step: 2 },
      { group: panel, step: 0 },
    ]
    for (const l of this.layers) this.root.add(l.group)
    this.explodeSpan = parts.explodeSpan
    this.applyExplode()
  }

  /** 0 = assembled, 1 = fully exploded toward the back. */
  setExplode(amount: number): void {
    this.explode = Math.max(0, Math.min(1, amount))
    this.applyExplode()
  }

  private applyExplode(): void {
    const e = this.layers.length > 0 ? this.explode * this.explodeSpan : 0
    for (const l of this.layers) l.group.position.z = l.step * e
    if (this.frameMesh) this.frameMesh.position.z = 2 * e
    if (this.artworkMesh) this.artworkMesh.position.z = this.artworkZ + 2 * e
  }

  private clearParts(): void {
    for (const l of this.layers) {
      this.root.remove(l.group)
      l.group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) disposeMesh(o)
      })
    }
    this.layers = []
  }

  setArtwork(
    artwork:
      | {
          url: string
          width: number
          height: number
          z: number
        }
      | null,
  ): void {
    this.clearArtwork()
    if (!artwork || artwork.width <= 0 || artwork.height <= 0) return

    const gen = this.artworkGen
    const loader = new THREE.TextureLoader()
    loader.load(
      artwork.url,
      (texture) => {
        if (gen !== this.artworkGen) {
          texture.dispose()
          return
        }
        texture.colorSpace = THREE.SRGBColorSpace
        texture.flipY = true
        const geometry = new THREE.PlaneGeometry(artwork.width, artwork.height)
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          alphaTest: 0.5,
          side: THREE.DoubleSide,
          depthWrite: true,
        })
        this.artworkTexture = texture
        this.artworkMesh = new THREE.Mesh(geometry, material)
        this.artworkZ = artwork.z
        this.artworkMesh.position.z = artwork.z
        this.applyExplode()
        this.artworkMesh.renderOrder = 1
        this.root.add(this.artworkMesh)
      },
      undefined,
      () => {
        /* keep the frame even if the preview photo fails to load */
      },
    )
  }

  clearArtwork(): void {
    this.artworkGen++
    if (this.artworkMesh) {
      this.root.remove(this.artworkMesh)
      this.artworkMesh.geometry.dispose()
      const mat = this.artworkMesh.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat.dispose()
      this.artworkMesh = null
    }
    if (this.artworkTexture) {
      this.artworkTexture.dispose()
      this.artworkTexture = null
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    this.clearArtwork()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private fit(geometry: THREE.BufferGeometry): void {
    const box = geometry.boundingBox
    if (!box) return
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size)
    box.getCenter(center)
    const radius = Math.max(size.x, size.y, size.z, 1)
    this.controls.target.copy(center)
    const dist = radius * 1.55
    this.camera.position.set(center.x + dist * 0.45, center.y - dist * 1.05, center.z + dist * 0.75)
    this.camera.near = Math.max(0.05, radius / 200)
    this.camera.far = Math.max(4000, radius * 20)
    this.camera.updateProjectionMatrix()
    this.controls.update()
  }

  private addLights(): void {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.32))
    const hemi = new THREE.HemisphereLight(0xe8eef6, 0x3a3228, 0.55)
    this.scene.add(hemi)

    const key = new THREE.DirectionalLight(0xfff4e5, 1.15)
    key.position.set(120, -90, 180)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.near = 10
    key.shadow.camera.far = 600
    const s = 220
    key.shadow.camera.left = -s
    key.shadow.camera.right = s
    key.shadow.camera.top = s
    key.shadow.camera.bottom = -s
    this.scene.add(key)

    const fill = new THREE.DirectionalLight(0xb7c8e0, 0.35)
    fill.position.set(-140, 80, 90)
    this.scene.add(fill)
  }

  private addGround(): void {
    const grid = new THREE.GridHelper(400, 20, 0x3a3a3a, 0x2a2a2a)
    grid.rotation.x = Math.PI / 2
    grid.position.z = -0.05
    this.scene.add(grid)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(800, 800),
      new THREE.ShadowMaterial({ opacity: 0.28 }),
    )
    ground.receiveShadow = true
    ground.position.z = -0.06
    this.scene.add(ground)
  }

  private resize(): void {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    if (w < 2 || h < 2) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }
}
