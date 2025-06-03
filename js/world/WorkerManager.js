// WorkerManager.js - Safe Web Workers implementation for GitHub Pages with vertical chunks
import { config } from '../config.js';

// Import DensityGenerator for the worker
const DENSITY_GENERATOR_CODE = `
class DensityGenerator {
    constructor(seed = 12345) {
        this.seed = seed;
        this.baseOffset = 64; // Increased base height for taller terrain
        this.terrainScale = 0.02;
        this.caveScale = 0.05;
        this.detailScale = 0.1;
        this.biomeOffsets = {
            plains: 0,
            hills: 20,
            mountains: 40,
            ocean: -20
        };
    }
    
    random(x, y, z) {
        const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + this.seed) * 43758.5453;
        return (n - Math.floor(n));
    }
    
    noise3D(x, y, z, scale = 1) {
        x *= scale;
        y *= scale;
        z *= scale;
        
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const zi = Math.floor(z);
        
        const xf = x - xi;
        const yf = y - yi;
        const zf = z - zi;
        
        const u = xf * xf * (3 - 2 * xf);
        const v = yf * yf * (3 - 2 * yf);
        const w = zf * zf * (3 - 2 * zf);
        
        const aaa = this.random(xi, yi, zi);
        const aba = this.random(xi, yi + 1, zi);
        const aab = this.random(xi, yi, zi + 1);
        const abb = this.random(xi, yi + 1, zi + 1);
        const baa = this.random(xi + 1, yi, zi);
        const bba = this.random(xi + 1, yi + 1, zi);
        const bab = this.random(xi + 1, yi, zi + 1);
        const bbb = this.random(xi + 1, yi + 1, zi + 1);
        
        const x1 = aaa * (1 - u) + baa * u;
        const x2 = aba * (1 - u) + bba * u;
        const y1 = x1 * (1 - v) + x2 * v;
        
        const x3 = aab * (1 - u) + bab * u;
        const x4 = abb * (1 - u) + bbb * u;
        const y2 = x3 * (1 - v) + x4 * v;
        
        return (y1 * (1 - w) + y2 * w) * 2 - 1;
    }
    
    getDensity(worldX, worldY, worldZ, biome = 'plains') {
        const biomeOffset = this.biomeOffsets[biome] || 0;
        let density = (this.baseOffset + biomeOffset) - worldY;
        
        // Increased amplitude for taller terrain
        density += this.noise3D(worldX, worldY, worldZ, this.terrainScale) * 30;
        density += this.noise3D(worldX, worldY, worldZ, this.terrainScale * 2) * 15;
        
        const caveNoise = this.noise3D(worldX, worldY, worldZ, this.caveScale);
        const caveNoise2 = this.noise3D(worldX, worldY, worldZ, this.caveScale * 2);
        
        if (caveNoise > 0.6 && caveNoise2 > 0.6) {
            density -= 50;
        }
        
        density += this.noise3D(worldX, worldY, worldZ, this.detailScale) * 5;
        
        // More overhangs at various heights
        if (worldY > 20 && worldY < 100) {
            const overhangNoise = this.noise3D(worldX * 0.03, worldY * 0.1, worldZ * 0.03);
            if (overhangNoise > 0.3) {
                density += overhangNoise * 15;
            }
        }
        
        return density;
    }
    
    getBiome(worldX, worldZ) {
        const biomeNoise = this.noise3D(worldX * 0.005, 0, worldZ * 0.005);
        
        if (biomeNoise < -0.3) return 'ocean';
        if (biomeNoise < 0) return 'plains';
        if (biomeNoise < 0.3) return 'hills';
        return 'mountains';
    }
}
`;

// Terrain generation worker code with vertical chunks support
const TERRAIN_WORKER_CODE = DENSITY_GENERATOR_CODE + `
console.log('[TerrainWorker] 3D Density worker with vertical chunks initialized');

self.onmessage = function(e) {
    const { type, data } = e.data;
    
    if (type === 'GENERATE_CHUNK_COLUMN') {
        try {
            const { chunkX, chunkZ, chunkSize, subChunkHeight, verticalChunks, seed } = data;
            console.log('[TerrainWorker] Generating chunk column at (' + chunkX + ', ' + chunkZ + ') with ' + verticalChunks + ' vertical chunks');
            
            const generator = new DensityGenerator(seed);
            const results = [];
            
            // Generate each sub-chunk
            for (let subY = 0; subY < verticalChunks; subY++) {
                const baseY = subY * subChunkHeight;
                const blocks = new Uint8Array(chunkSize * subChunkHeight * chunkSize);
                let hasContent = false;
                
                // First pass: Generate terrain using 3D density
                for (let x = 0; x < chunkSize; x++) {
                    for (let y = 0; y < subChunkHeight; y++) {
                        for (let z = 0; z < chunkSize; z++) {
                            const worldX = chunkX * chunkSize + x;
                            const worldY = baseY + y;
                            const worldZ = chunkZ * chunkSize + z;
                            
                            const biome = generator.getBiome(worldX, worldZ);
                            const density = generator.getDensity(worldX, worldY, worldZ, biome);
                            
                            const index = x + y * chunkSize + z * chunkSize * subChunkHeight;
                            
                            if (density > 0) {
                                blocks[index] = 3; // Stone
                                hasContent = true;
                            } else {
                                blocks[index] = 0; // Air
                            }
                        }
                    }
                }
                
                // Only process non-empty sub-chunks
                if (hasContent) {
                    // Second pass: Apply surface materials
                    for (let x = 0; x < chunkSize; x++) {
                        for (let y = 0; y < subChunkHeight; y++) {
                            for (let z = 0; z < chunkSize; z++) {
                                const index = x + y * chunkSize + z * chunkSize * subChunkHeight;
                                
                                if (blocks[index] !== 0) {
                                    const worldX = chunkX * chunkSize + x;
                                    const worldY = baseY + y;
                                    const worldZ = chunkZ * chunkSize + z;
                                    
                                    // Check if there's air above
                                    let hasAirAbove = false;
                                    
                                    if (y < subChunkHeight - 1) {
                                        // Check within sub-chunk
                                        const aboveIndex = x + (y + 1) * chunkSize + z * chunkSize * subChunkHeight;
                                        hasAirAbove = blocks[aboveIndex] === 0;
                                    } else if (subY < verticalChunks - 1) {
                                        // Check next sub-chunk (simplified - assume air if at boundary)
                                        const nextWorldY = worldY + 1;
                                        const biome = generator.getBiome(worldX, worldZ);
                                        const densityAbove = generator.getDensity(worldX, nextWorldY, worldZ, biome);
                                        hasAirAbove = densityAbove <= 0;
                                    } else {
                                        // Top of world
                                        hasAirAbove = true;
                                    }
                                    
                                    if (hasAirAbove) {
                                        const biome = generator.getBiome(worldX, worldZ);
                                        
                                        if (biome === 'ocean' && worldY < 40) {
                                            blocks[index] = 2; // Dirt underwater
                                        } else if (biome === 'mountains' && worldY > 100) {
                                            blocks[index] = 3; // Keep stone on high mountains
                                        } else {
                                            blocks[index] = 1; // Grass
                                        }
                                        
                                        // Add dirt layers below grass
                                        if (blocks[index] === 1) {
                                            for (let dy = 1; dy <= 3; dy++) {
                                                if (y - dy >= 0) {
                                                    const belowIndex = x + (y - dy) * chunkSize + z * chunkSize * subChunkHeight;
                                                    if (blocks[belowIndex] === 3) {
                                                        blocks[belowIndex] = 2; // Dirt
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    
                    results.push({
                        subY: subY,
                        blocks: blocks.buffer
                    });
                }
            }
            
            self.postMessage({
                type: 'CHUNK_COLUMN_GENERATED',
                data: { 
                    chunkX, 
                    chunkZ, 
                    subChunks: results 
                }
            }, results.map(r => r.blocks));
            
        } catch (error) {
            self.postMessage({
                type: 'ERROR',
                error: error.message
            });
        }
    }
};
`;

// Mesh generation worker code with sub-chunk support
const MESH_WORKER_CODE = `
console.log('[MeshWorker] Inline worker with sub-chunk support initialized');

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

function getBlock(blocks, x, y, z, chunkSize, subChunkHeight) {
    if (x < 0 || x >= chunkSize || y < 0 || y >= subChunkHeight || z < 0 || z >= chunkSize) {
        return 0;
    }
    return blocks[x + y * chunkSize + z * chunkSize * subChunkHeight];
}

function shouldRenderFace(blocks, x, y, z, dir, chunkSize, subChunkHeight, neighborData) {
    const checkX = x + dir[0];
    const checkY = y + dir[1];
    const checkZ = z + dir[2];
    
    // Check within sub-chunk
    if (checkX >= 0 && checkX < chunkSize && 
        checkY >= 0 && checkY < subChunkHeight && 
        checkZ >= 0 && checkZ < chunkSize) {
        return getBlock(blocks, checkX, checkY, checkZ, chunkSize, subChunkHeight) === 0;
    }
    
    // Check neighbor sub-chunks
    if (neighborData) {
        if (checkY < 0 && neighborData.below) {
            return getBlock(neighborData.below, checkX, subChunkHeight - 1, checkZ, chunkSize, subChunkHeight) === 0;
        }
        if (checkY >= subChunkHeight && neighborData.above) {
            return getBlock(neighborData.above, checkX, 0, checkZ, chunkSize, subChunkHeight) === 0;
        }
    }
    
    // Default to rendering face at boundaries
    return true;
}

function addFace(vertices, normals, colors, indices, x, y, z, face, color, vertexCount) {
    const half = 0.5;
    let faceVertices = [];
    let normal = [0, 0, 0];
    
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
    
    if (type === 'GENERATE_SUBCHUNK_MESH') {
        try {
            const { blocks, chunkSize, subChunkHeight, chunkX, chunkZ, subY, neighborData } = data;
            const blockArray = new Uint8Array(blocks);
            
            const vertices = [];
            const normals = [];
            const colors = [];
            const indices = [];
            let vertexCount = 0;
            
            const baseY = subY * subChunkHeight;
            
            for (let x = 0; x < chunkSize; x++) {
                for (let y = 0; y < subChunkHeight; y++) {
                    for (let z = 0; z < chunkSize; z++) {
                        const block = getBlock(blockArray, x, y, z, chunkSize, subChunkHeight);
                        if (block === 0) continue;
                        
                        const worldX = chunkX * chunkSize + x;
                        const worldY = baseY + y;
                        const worldZ = chunkZ * chunkSize + z;
                        
                        const color = blockColors[block];
                        
                        faces.forEach(face => {
                            if (shouldRenderFace(blockArray, x, y, z, face.dir, chunkSize, subChunkHeight, neighborData)) {
                                addFace(vertices, normals, colors, indices, worldX, worldY, worldZ, face, color, vertexCount);
                                vertexCount += 4;
                            }
                        });
                    }
                }
            }
            
            self.postMessage({
                type: 'SUBCHUNK_MESH_GENERATED',
                data: {
                    chunkX,
                    chunkZ,
                    subY,
                    vertices: new Float32Array(vertices).buffer,
                    normals: new Float32Array(normals).buffer,
                    colors: new Float32Array(colors).buffer,
                    indices: new Uint32Array(indices).buffer,
                    blocks: blockArray.buffer
                }
            }, [
                new Float32Array(vertices).buffer,
                new Float32Array(normals).buffer,
                new Float32Array(colors).buffer,
                new Uint32Array(indices).buffer,
                blockArray.buffer
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
        
        // Store terrain data for sub-chunks
        this.subChunkDataCache = new Map();
        
        // Try to initialize workers
        this.tryInitialize();
    }
    
    tryInitialize() {
        try {
            if (typeof Worker === 'undefined') {
                console.warn('[WorkerManager] Web Workers not supported');
                return false;
            }
            
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
            const workerCount = Math.min(navigator.hardwareConcurrency || 2, 2);
            
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
            console.log(`[WorkerManager] Initialized with ${workerCount} workers each for vertical chunks`);
            
        } catch (error) {
            console.error('[WorkerManager] Failed to initialize:', error);
            this.enabled = false;
        }
    }
    
    handleTerrainMessage(e, workerId) {
        const { type, data, error } = e.data;
        
        if (type === 'CHUNK_COLUMN_GENERATED') {
            const { chunkX, chunkZ, subChunks } = data;
            const key = `${chunkX},${chunkZ}`;
            
            this.workers.terrain[workerId].busy = false;
            
            // Get or create chunk column
            const chunkColumn = this.world.getChunkColumn(chunkX, chunkZ);
            
            // Process each sub-chunk
            subChunks.forEach(subChunkData => {
                const { subY, blocks } = subChunkData;
                
                // Store blocks in chunk column
                chunkColumn.setSubChunkBlocks(subY, new Uint8Array(blocks));
                
                // Cache for mesh generation
                const subKey = `${chunkX},${chunkZ},${subY}`;
                this.subChunkDataCache.set(subKey, new Uint8Array(blocks));
                
                // Request mesh generation
                this.requestSubChunkMesh(chunkX, chunkZ, subY, blocks);
            });
            
            this.activeRequests.delete(key);
            this.processPending();
            
        } else if (type === 'ERROR') {
            console.error(`[WorkerManager] Terrain worker ${workerId} error:`, error);
            this.workers.terrain[workerId].busy = false;
        }
    }
    
    handleMeshMessage(e, workerId) {
        const { type, data, error } = e.data;
        
        if (type === 'SUBCHUNK_MESH_GENERATED') {
            const { chunkX, chunkZ, subY, vertices, normals, colors, indices, blocks } = data;
            const key = `${chunkX},${chunkZ},${subY}`;
            
            this.workers.mesh[workerId].busy = false;
            
            // Get chunk column
            const chunkColumn = this.world.getChunkColumn(chunkX, chunkZ);
            if (!chunkColumn) return;
            
            // Create mesh if we have vertices
            if (vertices.byteLength > 0) {
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(vertices), 3));
                geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(normals), 3));
                geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(colors), 3));
                geometry.setIndex(new THREE.Uint32BufferAttribute(new Uint32Array(indices), 1));
                geometry.computeBoundingBox();
                geometry.computeBoundingSphere();
                
                const material = new THREE.MeshLambertMaterial({ 
                    vertexColors: true,
                    side: THREE.FrontSide
                });
                
                const mesh = new THREE.Mesh(geometry, material);
                
                // Update sub-chunk mesh
                const subChunk = chunkColumn.subChunks.get(subY);
                if (subChunk) {
                    if (subChunk.mesh) {
                        this.scene.remove(subChunk.mesh);
                        subChunk.mesh.geometry.dispose();
                        subChunk.mesh.material.dispose();
                    }
                    subChunk.mesh = mesh;
                    this.scene.add(mesh);
                }
            }
            
            // Clean up cache
            this.subChunkDataCache.delete(key);
            
        } else if (type === 'ERROR') {
            console.error(`[WorkerManager] Mesh worker ${workerId} error:`, error);
            this.workers.mesh[workerId].busy = false;
        }
    }
    
    requestChunk(chunkX, chunkZ) {
        if (!this.enabled) return false;
        
        const key = `${chunkX},${chunkZ}`;
        
        if (this.activeRequests.has(key)) return true;
        
        const worker = this.workers.terrain.find(w => !w.busy);
        
        if (worker) {
            worker.busy = true;
            this.activeRequests.add(key);
            
            worker.worker.postMessage({
                type: 'GENERATE_CHUNK_COLUMN',
                data: {
                    chunkX,
                    chunkZ,
                    chunkSize: config.chunkSize,
                    subChunkHeight: config.subChunkHeight,
                    verticalChunks: config.verticalChunks,
                    seed: this.world.seed || 12345
                }
            });
            
            return true;
        } else {
            this.pendingChunks.set(key, { x: chunkX, z: chunkZ });
            return true;
        }
    }
    
    requestSubChunkMesh(chunkX, chunkZ, subY, blocks) {
        const worker = this.workers.mesh.find(w => !w.busy);
        
        if (worker) {
            worker.busy = true;
            
            // Get neighbor sub-chunk data for proper face culling
            const neighborData = {};
            
            worker.worker.postMessage({
                type: 'GENERATE_SUBCHUNK_MESH',
                data: {
                    blocks,
                    chunkSize: config.chunkSize,
                    subChunkHeight: config.subChunkHeight,
                    chunkX,
                    chunkZ,
                    subY,
                    neighborData
                }
            }, [blocks]);
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
        this.subChunkDataCache.clear();
        this.enabled = false;
        
        console.log('[WorkerManager] Disposed');
    }
}