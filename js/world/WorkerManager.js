// WorkerManager.js - Safe Web Workers implementation for GitHub Pages
import { config } from '../config.js';

// Terrain generation worker code as a string
const TERRAIN_WORKER_CODE = `
console.log('[TerrainWorker] Inline worker initialized');

// Simple noise function
function noise2D(x, y) {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
}

self.onmessage = function(e) {
    const { type, data } = e.data;
    
    if (type === 'GENERATE_CHUNK') {
        try {
            const { chunkX, chunkZ, chunkSize } = data;
            console.log('[TerrainWorker] Generating chunk at (' + chunkX + ', ' + chunkZ + ')');
            
            const blocks = new Uint8Array(chunkSize * chunkSize * chunkSize);
            
            // Generate simple terrain
            for (let x = 0; x < chunkSize; x++) {
                for (let z = 0; z < chunkSize; z++) {
                    const worldX = chunkX * chunkSize + x;
                    const worldZ = chunkZ * chunkSize + z;
                    
                    // Simple height
                    let height = 5 + Math.floor(noise2D(worldX * 0.05, worldZ * 0.05) * 3);
                    height = Math.max(0, Math.min(height, chunkSize - 1));
                    
                    for (let y = 0; y <= height; y++) {
                        const index = x + y * chunkSize + z * chunkSize * chunkSize;
                        if (y === height) {
                            blocks[index] = 1; // Grass
                        } else if (y > height - 3) {
                            blocks[index] = 2; // Dirt  
                        } else {
                            blocks[index] = 3; // Stone
                        }
                    }
                }
            }
            
            self.postMessage({
                type: 'CHUNK_GENERATED',
                data: { chunkX, chunkZ, blocks: blocks.buffer }
            }, [blocks.buffer]);
            
        } catch (error) {
            self.postMessage({
                type: 'ERROR',
                error: error.message
            });
        }
    }
};
`;

// Mesh generation worker code as a string
const MESH_WORKER_CODE = `
console.log('[MeshWorker] Inline worker initialized');

const BlockType = {
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3
};

const blockColors = {
    1: { r: 0.3, g: 0.8, b: 0.3 },
    2: { r: 0.5, g: 0.3, b: 0.1 },
    3: { r: 0.5, g: 0.5, b: 0.5 }
};

const faces = [
    { dir: [0, 1, 0], name: 'top' },
    { dir: [0, -1, 0], name: 'bottom' },
    { dir: [1, 0, 0], name: 'right' },
    { dir: [-1, 0, 0], name: 'left' },
    { dir: [0, 0, 1], name: 'front' },
    { dir: [0, 0, -1], name: 'back' }
];

function getBlock(blocks, x, y, z, chunkSize) {
    if (x < 0 || x >= chunkSize || y < 0 || y >= chunkSize || z < 0 || z >= chunkSize) {
        return 0;
    }
    return blocks[x + y * chunkSize + z * chunkSize * chunkSize];
}

function shouldRenderFace(blocks, x, y, z, dir, chunkSize) {
    return getBlock(blocks, x + dir[0], y + dir[1], z + dir[2], chunkSize) === 0;
}

function addFace(vertices, normals, colors, indices, x, y, z, face, color, vertexCount) {
    const half = 0.5;
    let faceVertices = [];
    let normal = [0, 0, 0];
    
    // Define vertices based on face
    switch(face.name) {
        case 'top':
            faceVertices = [
                [x - half, y + half, z - half],
                [x - half, y + half, z + half],
                [x + half, y + half, z + half],
                [x + half, y + half, z - half]
            ];
            normal = [0, 1, 0];
            break;
        case 'bottom':
            faceVertices = [
                [x - half, y - half, z - half],
                [x + half, y - half, z - half],
                [x + half, y - half, z + half],
                [x - half, y - half, z + half]
            ];
            normal = [0, -1, 0];
            break;
        case 'right':
            faceVertices = [
                [x + half, y - half, z - half],
                [x + half, y + half, z - half],
                [x + half, y + half, z + half],
                [x + half, y - half, z + half]
            ];
            normal = [1, 0, 0];
            break;
        case 'left':
            faceVertices = [
                [x - half, y - half, z + half],
                [x - half, y + half, z + half],
                [x - half, y + half, z - half],
                [x - half, y - half, z - half]
            ];
            normal = [-1, 0, 0];
            break;
        case 'front':
            faceVertices = [
                [x + half, y - half, z + half],
                [x + half, y + half, z + half],
                [x - half, y + half, z + half],
                [x - half, y - half, z + half]
            ];
            normal = [0, 0, 1];
            break;
        case 'back':
            faceVertices = [
                [x - half, y - half, z - half],
                [x - half, y + half, z - half],
                [x + half, y + half, z - half],
                [x + half, y - half, z - half]
            ];
            normal = [0, 0, -1];
            break;
    }
    
    const baseIndex = vertexCount;
    faceVertices.forEach(vertex => {
        vertices.push(...vertex);
        normals.push(...normal);
        colors.push(color.r, color.g, color.b);
    });
    
    indices.push(
        baseIndex, baseIndex + 1, baseIndex + 2,
        baseIndex, baseIndex + 2, baseIndex + 3
    );
}

self.onmessage = function(e) {
    const { type, data } = e.data;
    
    if (type === 'GENERATE_MESH') {
        try {
            const { blocks, chunkSize, chunkX, chunkZ } = data;
            const blockArray = new Uint8Array(blocks);
            
            const vertices = [];
            const normals = [];
            const colors = [];
            const indices = [];
            let vertexCount = 0;
            
            for (let x = 0; x < chunkSize; x++) {
                for (let y = 0; y < chunkSize; y++) {
                    for (let z = 0; z < chunkSize; z++) {
                        const block = getBlock(blockArray, x, y, z, chunkSize);
                        if (block === 0) continue;
                        
                        const worldX = chunkX * chunkSize + x;
                        const worldY = y;
                        const worldZ = chunkZ * chunkSize + z;
                        
                        const color = blockColors[block];
                        
                        faces.forEach(face => {
                            if (shouldRenderFace(blockArray, x, y, z, face.dir, chunkSize)) {
                                addFace(vertices, normals, colors, indices, worldX, worldY, worldZ, face, color, vertexCount);
                                vertexCount += 4;
                            }
                        });
                    }
                }
            }
            
            self.postMessage({
                type: 'MESH_GENERATED',
                data: {
                    chunkX,
                    chunkZ,
                    vertices: new Float32Array(vertices).buffer,
                    normals: new Float32Array(normals).buffer,
                    colors: new Float32Array(colors).buffer,
                    indices: new Uint32Array(indices).buffer
                }
            }, [
                new Float32Array(vertices).buffer,
                new Float32Array(normals).buffer,
                new Float32Array(colors).buffer,
                new Uint32Array(indices).buffer
            ]);
            
        } catch (error) {
            self.postMessage({
                type: 'ERROR',
                error: error.message
            });
        }
    }
};
`;

export class WorkerManager {
    constructor(world, scene) {
        this.world = world;
        this.scene = scene;
        this.enabled = false;
        this.workers = {
            terrain: [],
            mesh: []
        };
        this.pendingChunks = new Map();
        this.activeRequests = new Set();
        
        // Try to initialize workers
        this.tryInitialize();
    }
    
    tryInitialize() {
        try {
            // Test if workers are supported
            if (typeof Worker === 'undefined') {
                console.warn('[WorkerManager] Web Workers not supported');
                return false;
            }
            
            // Test if we can create blob workers
            const testBlob = new Blob(['self.postMessage("test")'], { type: 'application/javascript' });
            const testUrl = URL.createObjectURL(testBlob);
            const testWorker = new Worker(testUrl);
            
            testWorker.onmessage = (e) => {
                if (e.data === 'test') {
                    console.log('[WorkerManager] Blob workers supported, initializing...');
                    testWorker.terminate();
                    URL.revokeObjectURL(testUrl);
                    this.initialize();
                }
            };
            
            testWorker.onerror = (error) => {
                console.warn('[WorkerManager] Blob workers not supported:', error);
                testWorker.terminate();
                URL.revokeObjectURL(testUrl);
            };
            
            // Timeout fallback
            setTimeout(() => {
                if (!this.enabled) {
                    console.warn('[WorkerManager] Worker test timeout');
                    try {
                        testWorker.terminate();
                        URL.revokeObjectURL(testUrl);
                    } catch (e) {}
                }
            }, 1000);
            
        } catch (error) {
            console.warn('[WorkerManager] Failed to test workers:', error);
            return false;
        }
    }
    
    initialize() {
        try {
            const workerCount = Math.min(navigator.hardwareConcurrency || 2, 2); // Max 2 workers each
            
            // Create terrain workers
            for (let i = 0; i < workerCount; i++) {
                const blob = new Blob([TERRAIN_WORKER_CODE], { type: 'application/javascript' });
                const url = URL.createObjectURL(blob);
                const worker = new Worker(url);
                
                worker.onmessage = (e) => this.handleTerrainMessage(e, i);
                worker.onerror = (error) => {
                    console.error(`[WorkerManager] Terrain worker ${i} error:`, error);
                };
                
                this.workers.terrain.push({
                    worker,
                    url,
                    busy: false,
                    id: i
                });
            }
            
            // Create mesh workers
            for (let i = 0; i < workerCount; i++) {
                const blob = new Blob([MESH_WORKER_CODE], { type: 'application/javascript' });
                const url = URL.createObjectURL(blob);
                const worker = new Worker(url);
                
                worker.onmessage = (e) => this.handleMeshMessage(e, i);
                worker.onerror = (error) => {
                    console.error(`[WorkerManager] Mesh worker ${i} error:`, error);
                };
                
                this.workers.mesh.push({
                    worker,
                    url,
                    busy: false,
                    id: i
                });
            }
            
            this.enabled = true;
            console.log(`[WorkerManager] Initialized with ${workerCount} workers each`);
            
        } catch (error) {
            console.error('[WorkerManager] Failed to initialize:', error);
            this.enabled = false;
        }
    }
    
    handleTerrainMessage(e, workerId) {
        const { type, data, error } = e.data;
        
        if (type === 'CHUNK_GENERATED') {
            const { chunkX, chunkZ, blocks } = data;
            const key = `${chunkX},${chunkZ}`;
            
            // Mark worker as available
            this.workers.terrain[workerId].busy = false;
            
            // Update chunk
            const chunk = this.world.getChunk(chunkX, chunkZ);
            chunk.blocks = new Uint8Array(blocks);
            
            // Generate mesh
            this.requestMesh(chunkX, chunkZ, blocks);
            
        } else if (type === 'ERROR') {
            console.error(`[WorkerManager] Terrain worker ${workerId} error:`, error);
            this.workers.terrain[workerId].busy = false;
            
            // Fallback to sync generation
            const key = Array.from(this.activeRequests).find(k => !this.workers.terrain.some(w => w.busy));
            if (key) {
                this.activeRequests.delete(key);
                const [x, z] = key.split(',').map(Number);
                const chunk = this.world.getChunk(x, z);
                chunk.generateTerrain();
                chunk.updateMesh(this.scene);
            }
        }
    }
    
    handleMeshMessage(e, workerId) {
        const { type, data, error } = e.data;
        
        if (type === 'MESH_GENERATED') {
            const { chunkX, chunkZ, vertices, normals, colors, indices } = data;
            const key = `${chunkX},${chunkZ}`;
            
            // Mark worker as available
            this.workers.mesh[workerId].busy = false;
            this.activeRequests.delete(key);
            
            // Create mesh
            const chunk = this.world.getChunk(chunkX, chunkZ);
            
            if (vertices.byteLength > 0) {
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(vertices), 3));
                geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(normals), 3));
                geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(colors), 3));
                geometry.setIndex(new THREE.Uint32BufferAttribute(new Uint32Array(indices), 1));
                geometry.computeBoundingBox();
                geometry.computeBoundingSphere();
                
                // Remove old mesh
                if (chunk.mesh) {
                    this.scene.remove(chunk.mesh);
                    chunk.mesh.geometry.dispose();
                    chunk.mesh.material.dispose();
                }
                
                // Create new mesh
                const material = new THREE.MeshLambertMaterial({ 
                    vertexColors: true,
                    side: THREE.FrontSide
                });
                
                chunk.mesh = new THREE.Mesh(geometry, material);
                this.scene.add(chunk.mesh);
            }
            
            // Process pending chunks
            this.processPending();
            
        } else if (type === 'ERROR') {
            console.error(`[WorkerManager] Mesh worker ${workerId} error:`, error);
            this.workers.mesh[workerId].busy = false;
            
            // Fallback to sync generation
            const key = Array.from(this.activeRequests).find(k => !this.workers.mesh.some(w => w.busy));
            if (key) {
                this.activeRequests.delete(key);
                const [x, z] = key.split(',').map(Number);
                const chunk = this.world.getChunk(x, z);
                chunk.updateMesh(this.scene);
            }
        }
    }
    
    requestChunk(chunkX, chunkZ) {
        if (!this.enabled) return false;
        
        const key = `${chunkX},${chunkZ}`;
        
        // Check if already processing
        if (this.activeRequests.has(key)) return true;
        
        // Find available terrain worker
        const worker = this.workers.terrain.find(w => !w.busy);
        
        if (worker) {
            worker.busy = true;
            this.activeRequests.add(key);
            
            worker.worker.postMessage({
                type: 'GENERATE_CHUNK',
                data: {
                    chunkX,
                    chunkZ,
                    chunkSize: config.chunkSize
                }
            });
            
            return true;
        } else {
            // Add to pending
            this.pendingChunks.set(key, { x: chunkX, z: chunkZ });
            return true;
        }
    }
    
    requestMesh(chunkX, chunkZ, blocks) {
        const worker = this.workers.mesh.find(w => !w.busy);
        
        if (worker) {
            worker.busy = true;
            
            worker.worker.postMessage({
                type: 'GENERATE_MESH',
                data: {
                    blocks,
                    chunkSize: config.chunkSize,
                    chunkX,
                    chunkZ
                }
            }, [blocks]);
        } else {
            // Fallback to sync
            const chunk = this.world.getChunk(chunkX, chunkZ);
            chunk.updateMesh(this.scene);
            this.activeRequests.delete(`${chunkX},${chunkZ}`);
        }
    }
    
    processPending() {
        if (this.pendingChunks.size === 0) return;
        
        const availableWorker = this.workers.terrain.find(w => !w.busy);
        if (availableWorker) {
            const [key, data] = this.pendingChunks.entries().next().value;
            this.pendingChunks.delete(key);
            this.requestChunk(data.x, data.z);
        }
    }
    
    isEnabled() {
        return this.enabled;
    }
    
    dispose() {
        // Terminate all workers
        [...this.workers.terrain, ...this.workers.mesh].forEach(w => {
            try {
                w.worker.terminate();
                URL.revokeObjectURL(w.url);
            } catch (e) {}
        });
        
        this.workers.terrain = [];
        this.workers.mesh = [];
        this.pendingChunks.clear();
        this.activeRequests.clear();
        this.enabled = false;
        
        console.log('[WorkerManager] Disposed');
    }
}