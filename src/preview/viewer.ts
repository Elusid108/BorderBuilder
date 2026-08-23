import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Mesh as FrameMesh } from '../geom/types.ts'

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

  setMesh(mesh: FrameMesh, opts?: { smooth?: boolean }): void {
    if (this.frameMesh) {
      this.root.remove(this.frameMesh)
      this.frameMesh.geometry.dispose()
      const mat = this.frameMesh.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat.dispose()
      this.frameMesh = null
    }

    const positions = new Float32Array(mesh.triangles.length * 9)
    let i = 0
    for (const t of mesh.triangles) {
      positions[i++] = t.a.x
      positions[i++] = t.a.y
      positions[i++] = t.a.z
      positions[i++] = t.b.x
      positions[i++] = t.b.y
      positions[i++] = t.b.z
      positions[i++] = t.c.x
      positions[i++] = t.c.y
      positions[i++] = t.c.z
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()

    const material = new THREE.MeshStandardMaterial({
      color: 0xc4a574,
      roughness: 0.48,
      metalness: 0.04,
      flatShading: opts?.smooth !== true,
    })

    this.frameMesh = new THREE.Mesh(geometry, material)
    this.frameMesh.castShadow = true
    this.frameMesh.receiveShadow = true
    this.root.add(this.frameMesh)
    if (!this.fitted) {
      this.fit(geometry)
      this.fitted = true
    }
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
          alphaTest: 0.04,
          side: THREE.DoubleSide,
          depthWrite: true,
        })
        this.artworkTexture = texture
        this.artworkMesh = new THREE.Mesh(geometry, material)
        this.artworkMesh.position.z = artwork.z
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
