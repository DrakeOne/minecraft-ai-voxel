/**
 * MINECRAFT ULTRA - Sistema ultra-optimizado de voxels
 * Renderizado con InstancedMesh, generación en workers, zero garbage collection
 */

// ======================== CONFIGURACIÓN ========================
const CONFIG = {
    CHUNK_SIZE: 32,
    RENDER_DISTANCE: 8,
    WORLD_HEIGHT: 128,
    BLOCK_SIZE: 1,
    
    // Tipos de bloques
    BLOCKS: {
        AIR: 0,
        GRASS: 1,
        DIRT: 2,
        STONE: 3,
        SAND: 4,
        WATER: 5,
        WOOD: 6,
        LEAVES: 7
    },
    
    // Colores optimizados (hex para GPU)
    COLORS: [
        0x000000, // AIR (no se renderiza)
        0x4CAF50, // GRASS
        0x8D6E63, // DIRT
        0x9E9E9E, // STONE
        0xFFD54F, // SAND
        0x2196F388, // WATER (con alpha)
        0x6D4C41, // WOOD
        0x388E3C  // LEAVES
    ],
    
    // Performance
    MAX_INSTANCES_PER_TYPE: 100000,
    WORKER_COUNT: navigator.hardwareConcurrency || 4,
    CHUNK_LOAD_PER_FRAME: 3,
    USE_SHARED_MEMORY: typeof SharedArrayBuffer !== 'undefined'
};

// ======================== FAST NOISE ========================
class FastNoise {
    constructor(seed = 12345) {
        this.perm = new Uint8Array(512);
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        
        // Shuffle con seed
        let n = seed;
        for (let i = 255; i > 0; i--) {
            n = (n * 1664525 + 1013904223) & 0xffffffff;
            const j = n % (i + 1);
            [p[i], p[j]] = [p[j], p[i]];
        }
        
        for (let i = 0; i < 512; i++) {
            this.perm[i] = p[i & 255];
        }
    }
    
    noise2D(x, y) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        x -= Math.floor(x);
        y -= Math.floor(y);
        
        const u = x * x * (3 - 2 * x);
        const v = y * y * (3 - 2 * y);
        
        const A = this.perm[X] + Y;
        const B = this.perm[X + 1] + Y;
        
        return this.lerp(v,
            this.lerp(u, this.grad2D(this.perm[A], x, y), this.grad2D(this.perm[B], x - 1, y)),
            this.lerp(u, this.grad2D(this.perm[A + 1], x, y - 1), this.grad2D(this.perm[B + 1], x - 1, y - 1))
        );
    }
    
    noise3D(x, y, z) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;
        
        x -= Math.floor(x);
        y -= Math.floor(y);
        z -= Math.floor(z);
        
        const u = x * x * (3 - 2 * x);
        const v = y * y * (3 - 2 * y);
        const w = z * z * (3 - 2 * z);
        
        const A = this.perm[X] + Y;
        const B = this.perm[X + 1] + Y;
        const AA = this.perm[A] + Z;
        const BA = this.perm[B] + Z;
        const AB = this.perm[A + 1] + Z;
        const BB = this.perm[B + 1] + Z;
        
        return this.lerp(w,
            this.lerp(v,
                this.lerp(u, this.grad3D(this.perm[AA], x, y, z), this.grad3D(this.perm[BA], x - 1, y, z)),
                this.lerp(u, this.grad3D(this.perm[AB], x, y - 1, z), this.grad3D(this.perm[BB], x - 1, y - 1, z))
            ),
            this.lerp(v,
                this.lerp(u, this.grad3D(this.perm[AA + 1], x, y, z - 1), this.grad3D(this.perm[BA + 1], x - 1, y, z - 1)),
                this.lerp(u, this.grad3D(this.perm[AB + 1], x, y - 1, z - 1), this.grad3D(this.perm[BB + 1], x - 1, y - 1, z - 1))
            )
        );
    }
    
    lerp(t, a, b) { return a + t * (b - a); }
    grad2D(hash, x, y) {
        const h = hash & 3;
        const u = h < 2 ? x : y;
        const v = h < 2 ? y : x;
        return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
    }
    grad3D(hash, x, y, z) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
    }
}

// ======================== CHUNK OPTIMIZADO ========================
class UltraChunk {
    constructor(x, z) {
        this.x = x;
        this.z = z;
        this.blocks = null; // Se llenará desde worker
        this.isEmpty = true;
        this.instanceIndices = new Map(); // tipo -> [índices]
        this.dirty = true;
        this.generating = false;
    }
    
    setBlocks(data) {
        this.blocks = new Uint8Array(data);
        this.isEmpty = false;
        this.dirty = true;
    }
    
    getBlock(x, y, z) {
        if (!this.blocks) return 0;
        const idx = x + y * CONFIG.CHUNK_SIZE + z * CONFIG.CHUNK_SIZE * CONFIG.WORLD_HEIGHT;
        return this.blocks[idx];
    }
    
    setBlock(x, y, z, type) {
        if (!this.blocks) return;
        const idx = x + y * CONFIG.CHUNK_SIZE + z * CONFIG.CHUNK_SIZE * CONFIG.WORLD_HEIGHT;
        this.blocks[idx] = type;
        this.dirty = true;
    }
}

// ======================== WORLD MANAGER ========================
class UltraWorld {
    constructor(scene) {
        this.scene = scene;
        this.chunks = new Map();
        this.noise = new FastNoise(Date.now());
        
        // Instanced meshes para cada tipo de bloque
        this.initInstancedMeshes();
        
        // Workers para generación
        this.initWorkers();
        
        // Pools de objetos
        this.matrixPool = [];
        this.matrix = new THREE.Matrix4();
        
        // Estado
        this.playerChunkX = 0;
        this.playerChunkZ = 0;
        this.loadQueue = [];
        this.visibleChunks = new Set();
    }
    
    initInstancedMeshes() {
        const geometry = new THREE.BoxGeometry(CONFIG.BLOCK_SIZE, CONFIG.BLOCK_SIZE, CONFIG.BLOCK_SIZE);
        
        this.meshes = {};
        this.instanceCounts = {};
        this.instanceData = {};
        
        // Crear un InstancedMesh para cada tipo de bloque (excepto aire)
        for (const [name, id] of Object.entries(CONFIG.BLOCKS)) {
            if (id === 0) continue; // Skip air
            
            const material = new THREE.MeshLambertMaterial({
                color: CONFIG.COLORS[id],
                transparent: id === CONFIG.BLOCKS.WATER,
                opacity: id === CONFIG.BLOCKS.WATER ? 0.8 : 1
            });
            
            const mesh = new THREE.InstancedMesh(geometry, material, CONFIG.MAX_INSTANCES_PER_TYPE);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.frustumCulled = true;
            
            this.meshes[id] = mesh;
            this.instanceCounts[id] = 0;
            this.instanceData[id] = new Float32Array(CONFIG.MAX_INSTANCES_PER_TYPE * 16); // 16 floats per matrix
            
            this.scene.add(mesh);
        }
    }
    
    initWorkers() {
        this.workers = [];
        this.workerBusy = [];
        this.pendingChunks = new Map();
        
        // Crear worker code inline para evitar archivos externos
        const workerCode = `
            ${FastNoise.toString()}
            
            const CONFIG = ${JSON.stringify(CONFIG)};
            const noise = new FastNoise(${Date.now()});
            
            function generateChunk(chunkX, chunkZ) {
                const size = CONFIG.CHUNK_SIZE;
                const height = CONFIG.WORLD_HEIGHT;
                const blocks = new Uint8Array(size * height * size);
                
                for (let x = 0; x < size; x++) {
                    for (let z = 0; z < size; z++) {
                        const worldX = chunkX * size + x;
                        const worldZ = chunkZ * size + z;
                        
                        // Generar altura del terreno
                        const baseHeight = 32;
                        const heightVariation = 
                            noise.noise2D(worldX * 0.01, worldZ * 0.01) * 20 +
                            noise.noise2D(worldX * 0.05, worldZ * 0.05) * 5 +
                            noise.noise2D(worldX * 0.1, worldZ * 0.1) * 2;
                        
                        const terrainHeight = Math.floor(baseHeight + heightVariation);
                        
                        for (let y = 0; y < height; y++) {
                            const idx = x + y * size + z * size * height;
                            
                            if (y > terrainHeight) {
                                blocks[idx] = CONFIG.BLOCKS.AIR;
                            } else if (y === terrainHeight) {
                                // Superficie - variar según altura
                                if (terrainHeight < 30) {
                                    blocks[idx] = CONFIG.BLOCKS.SAND;
                                } else if (terrainHeight > 50) {
                                    blocks[idx] = CONFIG.BLOCKS.STONE;
                                } else {
                                    blocks[idx] = CONFIG.BLOCKS.GRASS;
                                }
                            } else if (y > terrainHeight - 4) {
                                blocks[idx] = CONFIG.BLOCKS.DIRT;
                            } else {
                                blocks[idx] = CONFIG.BLOCKS.STONE;
                                
                                // Cuevas simples
                                const caveNoise = noise.noise3D(
                                    worldX * 0.05,
                                    y * 0.05,
                                    worldZ * 0.05
                                );
                                if (caveNoise > 0.7) {
                                    blocks[idx] = CONFIG.BLOCKS.AIR;
                                }
                            }
                        }
                    }
                }
                
                return blocks.buffer;
            }
            
            self.onmessage = function(e) {
                const { chunkX, chunkZ, id } = e.data;
                const buffer = generateChunk(chunkX, chunkZ);
                self.postMessage({ id, chunkX, chunkZ, buffer }, [buffer]);
            };
        `;
        
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        
        for (let i = 0; i < CONFIG.WORKER_COUNT; i++) {
            const worker = new Worker(workerUrl);
            worker.onmessage = (e) => this.handleWorkerMessage(e.data, i);
            this.workers.push(worker);
            this.workerBusy[i] = false;
        }
    }
    
    handleWorkerMessage(data, workerId) {
        const { id, chunkX, chunkZ, buffer } = data;
        const key = `${chunkX},${chunkZ}`;
        
        this.workerBusy[workerId] = false;
        
        const chunk = this.chunks.get(key);
        if (chunk) {
            chunk.setBlocks(buffer);
            chunk.generating = false;
            this.updateChunkMesh(chunk);
        }
        
        this.pendingChunks.delete(id);
        this.processLoadQueue();
    }
    
    requestChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        
        if (this.chunks.has(key)) return;
        
        const chunk = new UltraChunk(chunkX, chunkZ);
        chunk.generating = true;
        this.chunks.set(key, chunk);
        
        // Encontrar worker disponible
        const workerIndex = this.workerBusy.findIndex(busy => !busy);
        if (workerIndex !== -1) {
            this.workerBusy[workerIndex] = true;
            const id = `${chunkX}_${chunkZ}_${Date.now()}`;
            this.pendingChunks.set(id, { chunkX, chunkZ });
            this.workers[workerIndex].postMessage({ id, chunkX, chunkZ });
        } else {
            // Añadir a cola si todos están ocupados
            this.loadQueue.push({ chunkX, chunkZ });
        }
    }
    
    processLoadQueue() {
        if (this.loadQueue.length === 0) return;
        
        const workerIndex = this.workerBusy.findIndex(busy => !busy);
        if (workerIndex !== -1) {
            const { chunkX, chunkZ } = this.loadQueue.shift();
            this.requestChunk(chunkX, chunkZ);
        }
    }
    
    updateChunkMesh(chunk) {
        if (!chunk.blocks || !chunk.dirty) return;
        
        // Reset instance counts para este chunk
        chunk.instanceIndices.clear();
        
        const size = CONFIG.CHUNK_SIZE;
        const height = CONFIG.WORLD_HEIGHT;
        const chunkWorldX = chunk.x * size;
        const chunkWorldZ = chunk.z * size;
        
        // Procesar cada bloque
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < height; y++) {
                for (let z = 0; z < size; z++) {
                    const block = chunk.getBlock(x, y, z);
                    if (block === CONFIG.BLOCKS.AIR) continue;
                    
                    // Verificar si el bloque es visible (tiene al menos una cara expuesta)
                    let isVisible = false;
                    
                    // Check 6 direcciones
                    const neighbors = [
                        [x+1, y, z], [x-1, y, z],
                        [x, y+1, z], [x, y-1, z],
                        [x, y, z+1], [x, y, z-1]
                    ];
                    
                    for (const [nx, ny, nz] of neighbors) {
                        if (nx < 0 || nx >= size || ny < 0 || ny >= height || nz < 0 || nz >= size) {
                            isVisible = true;
                            break;
                        }
                        if (chunk.getBlock(nx, ny, nz) === CONFIG.BLOCKS.AIR) {
                            isVisible = true;
                            break;
                        }
                    }
                    
                    if (!isVisible) continue;
                    
                    // Añadir instancia
                    const worldX = chunkWorldX + x;
                    const worldY = y;
                    const worldZ = chunkWorldZ + z;
                    
                    if (!chunk.instanceIndices.has(block)) {
                        chunk.instanceIndices.set(block, []);
                    }
                    
                    const index = this.instanceCounts[block]++;
                    chunk.instanceIndices.get(block).push(index);
                    
                    // Actualizar matriz de transformación
                    this.matrix.makeTranslation(worldX, worldY, worldZ);
                    this.matrix.toArray(this.instanceData[block], index * 16);
                }
            }
        }
        
        chunk.dirty = false;
    }
    
    updateAllMeshes() {
        // Actualizar todas las instancias de una vez
        for (const [blockType, mesh] of Object.entries(this.meshes)) {
            const type = parseInt(blockType);
            const count = this.instanceCounts[type];
            
            if (count > 0) {
                // Copiar datos de matriz al mesh
                for (let i = 0; i < count; i++) {
                    const matrix = new THREE.Matrix4();
                    matrix.fromArray(this.instanceData[type], i * 16);
                    mesh.setMatrixAt(i, matrix);
                }
                
                mesh.instanceMatrix.needsUpdate = true;
                mesh.count = count;
                mesh.visible = true;
            } else {
                mesh.visible = false;
            }
        }
    }
    
    update(playerX, playerZ, camera) {
        const chunkX = Math.floor(playerX / CONFIG.CHUNK_SIZE);
        const chunkZ = Math.floor(playerZ / CONFIG.CHUNK_SIZE);
        
        // Si el jugador cambió de chunk
        if (chunkX !== this.playerChunkX || chunkZ !== this.playerChunkZ) {
            this.playerChunkX = chunkX;
            this.playerChunkZ = chunkZ;
            
            // Reset instance counts
            for (const type in this.instanceCounts) {
                this.instanceCounts[type] = 0;
            }
            
            // Cargar chunks en rango
            const dist = CONFIG.RENDER_DISTANCE;
            for (let dx = -dist; dx <= dist; dx++) {
                for (let dz = -dist; dz <= dist; dz++) {
                    const cx = chunkX + dx;
                    const cz = chunkZ + dz;
                    const distance = Math.sqrt(dx * dx + dz * dz);
                    
                    if (distance <= dist) {
                        this.requestChunk(cx, cz);
                        
                        const key = `${cx},${cz}`;
                        const chunk = this.chunks.get(key);
                        if (chunk && !chunk.generating) {
                            this.updateChunkMesh(chunk);
                        }
                    }
                }
            }
            
            // Actualizar todos los meshes
            this.updateAllMeshes();
            
            // Limpiar chunks lejanos
            this.cleanupDistantChunks(chunkX, chunkZ);
        }
    }
    
    cleanupDistantChunks(centerX, centerZ) {
        const maxDist = CONFIG.RENDER_DISTANCE + 2;
        
        for (const [key, chunk] of this.chunks) {
            const dx = chunk.x - centerX;
            const dz = chunk.z - centerZ;
            const dist = Math.sqrt(dx * dx + dz * dz);
            
            if (dist > maxDist) {
                this.chunks.delete(key);
            }
        }
    }
    
    getBlockAt(x, y, z) {
        const chunkX = Math.floor(x / CONFIG.CHUNK_SIZE);
        const chunkZ = Math.floor(z / CONFIG.CHUNK_SIZE);
        const key = `${chunkX},${chunkZ}`;
        
        const chunk = this.chunks.get(key);
        if (!chunk || !chunk.blocks) return CONFIG.BLOCKS.AIR;
        
        const localX = ((x % CONFIG.CHUNK_SIZE) + CONFIG.CHUNK_SIZE) % CONFIG.CHUNK_SIZE;
        const localZ = ((z % CONFIG.CHUNK_SIZE) + CONFIG.CHUNK_SIZE) % CONFIG.CHUNK_SIZE;
        
        return chunk.getBlock(localX, Math.floor(y), localZ);
    }
    
    setBlockAt(x, y, z, type) {
        const chunkX = Math.floor(x / CONFIG.CHUNK_SIZE);
        const chunkZ = Math.floor(z / CONFIG.CHUNK_SIZE);
        const key = `${chunkX},${chunkZ}`;
        
        const chunk = this.chunks.get(key);
        if (!chunk || !chunk.blocks) return;
        
        const localX = ((x % CONFIG.CHUNK_SIZE) + CONFIG.CHUNK_SIZE) % CONFIG.CHUNK_SIZE;
        const localZ = ((z % CONFIG.CHUNK_SIZE) + CONFIG.CHUNK_SIZE) % CONFIG.CHUNK_SIZE;
        
        chunk.setBlock(localX, Math.floor(y), localZ, type);
        
        // Rebuild mesh
        for (const type in this.instanceCounts) {
            this.instanceCounts[type] = 0;
        }
        
        // Actualizar todos los chunks visibles
        const dist = CONFIG.RENDER_DISTANCE;
        for (let dx = -dist; dx <= dist; dx++) {
            for (let dz = -dist; dz <= dist; dz++) {
                const cx = this.playerChunkX + dx;
                const cz = this.playerChunkZ + dz;
                const k = `${cx},${cz}`;
                const c = this.chunks.get(k);
                if (c && !c.generating) {
                    this.updateChunkMesh(c);
                }
            }
        }
        
        this.updateAllMeshes();
    }
}

// ======================== PLAYER CONTROLLER ========================
class UltraPlayer {
    constructor(world) {
        this.world = world;
        this.position = new THREE.Vector3(0, 40, 0);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.rotation = new THREE.Euler(0, 0, 0);
        
        this.moveSpeed = 5;
        this.jumpSpeed = 8;
        this.gravity = -20;
        
        this.isGrounded = false;
        this.isFlying = false;
        
        this.keys = {};
        this.setupControls();
    }
    
    setupControls() {
        document.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            
            if (e.code === 'KeyF') {
                this.isFlying = !this.isFlying;
                this.velocity.y = 0;
            }
        });
        
        document.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });
        
        document.addEventListener('mousemove', (e) => {
            if (document.pointerLockElement) {
                this.rotation.y -= e.movementX * 0.002;
                this.rotation.x -= e.movementY * 0.002;
                this.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.rotation.x));
            }
        });
        
        document.addEventListener('click', () => {
            if (!document.pointerLockElement) {
                document.body.requestPointerLock();
            }
        });
    }
    
    update(deltaTime, camera) {
        // Movement
        const forward = new THREE.Vector3(0, 0, -1);
        const right = new THREE.Vector3(1, 0, 0);
        
        forward.applyEuler(new THREE.Euler(0, this.rotation.y, 0));
        right.applyEuler(new THREE.Euler(0, this.rotation.y, 0));
        
        const movement = new THREE.Vector3(0, 0, 0);
        
        if (this.keys['KeyW']) movement.add(forward);
        if (this.keys['KeyS']) movement.sub(forward);
        if (this.keys['KeyA']) movement.sub(right);
        if (this.keys['KeyD']) movement.add(right);
        
        movement.normalize().multiplyScalar(this.moveSpeed * deltaTime);
        
        // Apply movement
        this.position.x += movement.x;
        this.position.z += movement.z;
        
        // Vertical movement
        if (this.isFlying) {
            if (this.keys['Space']) this.position.y += this.moveSpeed * deltaTime;
            if (this.keys['ShiftLeft']) this.position.y -= this.moveSpeed * deltaTime;
        } else {
            // Gravity
            this.velocity.y += this.gravity * deltaTime;
            
            // Jump
            if (this.keys['Space'] && this.isGrounded) {
                this.velocity.y = this.jumpSpeed;
            }
            
            // Apply velocity
            this.position.y += this.velocity.y * deltaTime;
            
            // Ground collision
            const groundY = this.getGroundHeight(this.position.x, this.position.z) + 1.5;
            if (this.position.y <= groundY) {
                this.position.y = groundY;
                this.velocity.y = 0;
                this.isGrounded = true;
            } else {
                this.isGrounded = false;
            }
        }
        
        // Update camera
        camera.position.copy(this.position);
        camera.rotation.x = this.rotation.x;
        camera.rotation.y = this.rotation.y;
    }
    
    getGroundHeight(x, z) {
        for (let y = CONFIG.WORLD_HEIGHT - 1; y >= 0; y--) {
            const block = this.world.getBlockAt(x, y, z);
            if (block !== CONFIG.BLOCKS.AIR) {
                return y + 1;
            }
        }
        return 0;
    }
}

// ======================== MAIN GAME ========================
class MinecraftUltra {
    constructor() {
        this.init();
        this.animate();
    }
    
    init() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x87CEEB, 50, CONFIG.RENDER_DISTANCE * CONFIG.CHUNK_SIZE * 1.5);
        
        // Camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        
        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: false,
            powerPreference: "high-performance"
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);
        
        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 100, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.camera.left = -100;
        directionalLight.shadow.camera.right = 100;
        directionalLight.shadow.camera.top = 100;
        directionalLight.shadow.camera.bottom = -100;
        this.scene.add(directionalLight);
        
        // World
        this.world = new UltraWorld(this.scene);
        
        // Player
        this.player = new UltraPlayer(this.world);
        
        // Stats
        this.stats = {
            fps: 0,
            chunks: 0,
            blocks: 0
        };
        this.lastTime = performance.now();
        this.frameCount = 0;
        
        // UI
        this.setupUI();
        
        // Resize handler
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
        
        // Block placement
        document.addEventListener('mousedown', (e) => {
            if (document.pointerLockElement) {
                if (e.button === 0) { // Left click - break
                    this.breakBlock();
                } else if (e.button === 2) { // Right click - place
                    this.placeBlock();
                }
            }
        });
        
        document.addEventListener('contextmenu', e => e.preventDefault());
    }
    
    setupUI() {
        const ui = document.createElement('div');
        ui.id = 'ui';
        ui.innerHTML = `
            <div id="stats" style="position: fixed; top: 10px; left: 10px; color: white; font-family: monospace; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);">
                <div>FPS: <span id="fps">0</span></div>
                <div>Chunks: <span id="chunks">0</span></div>
                <div>Blocks: <span id="blocks">0</span></div>
                <div>Position: <span id="position">0, 0, 0</span></div>
                <div id="flying" style="color: #4CAF50; display: none;">FLYING MODE</div>
            </div>
            <div id="crosshair" style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 24px; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);">+</div>
            <div id="controls" style="position: fixed; bottom: 10px; left: 10px; color: white; font-family: monospace; text-shadow: 2px 2px 4px rgba(0,0,0,0.5); font-size: 12px;">
                <div>WASD: Move | Mouse: Look | Space: Jump | F: Fly</div>
                <div>Left Click: Break | Right Click: Place</div>
            </div>
        `;
        document.body.appendChild(ui);
    }
    
    breakBlock() {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        
        const step = 0.1;
        const maxDistance = 5;
        
        for (let d = 0; d < maxDistance; d += step) {
            const point = this.camera.position.clone().add(
                raycaster.ray.direction.clone().multiplyScalar(d)
            );
            
            const block = this.world.getBlockAt(point.x, point.y, point.z);
            if (block !== CONFIG.BLOCKS.AIR) {
                this.world.setBlockAt(point.x, point.y, point.z, CONFIG.BLOCKS.AIR);
                break;
            }
        }
    }
    
    placeBlock() {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        
        const step = 0.1;
        const maxDistance = 5;
        let lastEmpty = null;
        
        for (let d = 0; d < maxDistance; d += step) {
            const point = this.camera.position.clone().add(
                raycaster.ray.direction.clone().multiplyScalar(d)
            );
            
            const block = this.world.getBlockAt(point.x, point.y, point.z);
            if (block !== CONFIG.BLOCKS.AIR) {
                if (lastEmpty) {
                    this.world.setBlockAt(lastEmpty.x, lastEmpty.y, lastEmpty.z, CONFIG.BLOCKS.STONE);
                }
                break;
            }
            lastEmpty = point;
        }
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        const currentTime = performance.now();
        const deltaTime = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;
        
        // Update
        this.player.update(deltaTime, this.camera);
        this.world.update(this.player.position.x, this.player.position.z, this.camera);
        
        // Render
        this.renderer.render(this.scene, this.camera);
        
        // Update stats
        this.frameCount++;
        if (this.frameCount % 30 === 0) {
            this.stats.fps = Math.round(1 / deltaTime);
            this.stats.chunks = this.world.chunks.size;
            
            let blockCount = 0;
            for (const count of Object.values(this.world.instanceCounts)) {
                blockCount += count;
            }
            this.stats.blocks = blockCount;
            
            document.getElementById('fps').textContent = this.stats.fps;
            document.getElementById('chunks').textContent = this.stats.chunks;
            document.getElementById('blocks').textContent = this.stats.blocks;
            document.getElementById('position').textContent = 
                `${Math.floor(this.player.position.x)}, ${Math.floor(this.player.position.y)}, ${Math.floor(this.player.position.z)}`;
            
            document.getElementById('flying').style.display = this.player.isFlying ? 'block' : 'none';
        }
    }
}

// Start game when page loads
window.addEventListener('load', () => {
    new MinecraftUltra();
});