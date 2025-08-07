/**
 * WorkerManager - Sistema de Web Workers con generador tipo Minecraft
 * Solo funciona con workers, sin fallback a generación básica
 */

import { config } from '../config.js';
import { Logger } from '../utils/Logger.js';

// Código del generador tipo Minecraft para los workers
const MINECRAFT_GENERATOR_CODE = `
class MinecraftTerrainGenerator {
    constructor(seed = 12345) {
        this.seed = seed;
        
        this.biomeConfig = {
            ocean: {
                baseHeight: 48,
                variation: 3,
                surfaceBlock: 2,
                subsurfaceBlock: 2,
                stoneLevel: 45
            },
            plains: {
                baseHeight: 63,
                variation: 3,
                surfaceBlock: 1,
                subsurfaceBlock: 2,
                stoneLevel: 59
            },
            desert: {
                baseHeight: 63,
                variation: 4,
                surfaceBlock: 2,
                subsurfaceBlock: 2,
                stoneLevel: 58
            },
            forest: {
                baseHeight: 64,
                variation: 5,
                surfaceBlock: 1,
                subsurfaceBlock: 2,
                stoneLevel: 59
            },
            hills: {
                baseHeight: 70,
                variation: 15,
                surfaceBlock: 1,
                subsurfaceBlock: 2,
                stoneLevel: 65
            },
            mountains: {
                baseHeight: 85,
                variation: 30,
                surfaceBlock: 3,
                subsurfaceBlock: 3,
                stoneLevel: 70
            }
        };
        
        this.seaLevel = 62;
        this.biomeScale = 0.004;
        this.terrainScale = 0.015;
        this.detailScale = 0.05;
        this.caveScale = 0.03;
    }
    
    random(x, z, offset = 0) {
        const n = Math.sin((x + offset) * 12.9898 + (z + offset) * 78.233 + this.seed) * 43758.5453;
        return (n - Math.floor(n));
    }
    
    noise2D(x, z, scale = 1, octaves = 1) {
        let value = 0;
        let amplitude = 1;
        let frequency = scale;
        let maxValue = 0;
        
        for (let i = 0; i < octaves; i++) {
            const sampleX = x * frequency;
            const sampleZ = z * frequency;
            
            const xi = Math.floor(sampleX);
            const zi = Math.floor(sampleZ);
            
            const xf = sampleX - xi;
            const zf = sampleZ - zi;
            
            const u = xf * xf * (3 - 2 * xf);
            const v = zf * zf * (3 - 2 * zf);
            
            const aa = this.random(xi, zi, i);
            const ba = this.random(xi + 1, zi, i);
            const ab = this.random(xi, zi + 1, i);
            const bb = this.random(xi + 1, zi + 1, i);
            
            const x1 = aa * (1 - u) + ba * u;
            const x2 = ab * (1 - u) + bb * u;
            const result = x1 * (1 - v) + x2 * v;
            
            value += result * amplitude;
            maxValue += amplitude;
            
            amplitude *= 0.5;
            frequency *= 2;
        }
        
        return (value / maxValue) * 2 - 1;
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
        
        const aaa = this.random(xi, zi, yi);
        const aba = this.random(xi, zi, yi + 1);
        const aab = this.random(xi, zi + 1, yi);
        const abb = this.random(xi, zi + 1, yi + 1);
        const baa = this.random(xi + 1, zi, yi);
        const bba = this.random(xi + 1, zi, yi + 1);
        const bab = this.random(xi + 1, zi + 1, yi);
        const bbb = this.random(xi + 1, zi + 1, yi + 1);
        
        const x1 = aaa * (1 - u) + baa * u;
        const x2 = aba * (1 - u) + bba * u;
        const y1 = x1 * (1 - v) + x2 * v;
        
        const x3 = aab * (1 - u) + bab * u;
        const x4 = abb * (1 - u) + bbb * u;
        const y2 = x3 * (1 - v) + x4 * v;
        
        return (y1 * (1 - w) + y2 * w) * 2 - 1;
    }
    
    getBiome(worldX, worldZ) {
        const biomeNoise = this.noise2D(worldX, worldZ, this.biomeScale, 2);
        const moistureNoise = this.noise2D(worldX + 1000, worldZ + 1000, this.biomeScale, 2);
        
        if (biomeNoise < -0.5) {
            return 'ocean';
        } else if (biomeNoise < -0.1) {
            if (moistureNoise < -0.3) {
                return 'desert';
            } else {
                return 'plains';
            }
        } else if (biomeNoise < 0.3) {
            if (moistureNoise > 0.2) {
                return 'forest';
            } else if (moistureNoise < -0.2) {
                return 'desert';
            } else {
                return 'plains';
            }
        } else if (biomeNoise < 0.6) {
            return 'hills';
        } else {
            return 'mountains';
        }
    }
    
    getTerrainHeight(worldX, worldZ) {
        const biome = this.getBiome(worldX, worldZ);
        const config = this.biomeConfig[biome];
        
        let height = config.baseHeight;
        
        const terrainNoise = this.noise2D(worldX, worldZ, this.terrainScale, 4);
        height += terrainNoise * config.variation;
        
        const detailNoise = this.noise2D(worldX, worldZ, this.detailScale, 2);
        height += detailNoise * 2;
        
        const transitionRange = 8;
        let finalHeight = height;
        let totalWeight = 1;
        
        for (let dx = -transitionRange; dx <= transitionRange; dx += transitionRange) {
            for (let dz = -transitionRange; dz <= transitionRange; dz += transitionRange) {
                if (dx === 0 && dz === 0) continue;
                
                const nearBiome = this.getBiome(worldX + dx, worldZ + dz);
                if (nearBiome !== biome) {
                    const nearConfig = this.biomeConfig[nearBiome];
                    const distance = Math.sqrt(dx * dx + dz * dz);
                    const weight = Math.max(0, 1 - distance / (transitionRange * 2));
                    
                    if (weight > 0) {
                        const nearHeight = nearConfig.baseHeight + terrainNoise * nearConfig.variation;
                        finalHeight += nearHeight * weight;
                        totalWeight += weight;
                    }
                }
            }
        }
        
        return Math.floor(finalHeight / totalWeight);
    }
    
    hasCave(worldX, worldY, worldZ) {
        const height = this.getTerrainHeight(worldX, worldZ);
        if (worldY > height - 5) return false;
        
        const cave1 = this.noise3D(worldX, worldY, worldZ, this.caveScale);
        const cave2 = this.noise3D(worldX, worldY * 1.5, worldZ, this.caveScale * 1.4);
        
        if (worldY < 40) {
            const ravine = this.noise3D(worldX * 0.01, worldY * 0.1, worldZ * 0.01, 1);
            if (Math.abs(ravine) < 0.05) return true;
        }
        
        return cave1 > 0.7 || cave2 > 0.7 || (cave1 > 0.4 && cave2 > 0.4);
    }
    
    getBlockAt(worldX, worldY, worldZ) {
        const height = this.getTerrainHeight(worldX, worldZ);
        const biome = this.getBiome(worldX, worldZ);
        const config = this.biomeConfig[biome];
        
        if (worldY > height) {
            return 0;
        }
        
        if (this.hasCave(worldX, worldY, worldZ)) {
            return 0;
        }
        
        if (worldY <= 1) {
            return 3;
        }
        
        if (worldY < config.stoneLevel) {
            return 3;
        }
        
        if (worldY === height) {
            if (biome === 'ocean' && worldY < this.seaLevel) {
                return 2;
            }
            if (biome === 'mountains' && worldY > 90) {
                return 3;
            }
            return config.surfaceBlock;
        }
        
        if (worldY >= height - 4) {
            return config.subsurfaceBlock;
        }
        
        return 3;
    }
}
`;

// Worker de generación de terreno
const TERRAIN_WORKER_CODE = MINECRAFT_GENERATOR_CODE + `
self.onmessage = function(e) {
    const { type, data } = e.data;
    
    if (type === 'GENERATE_CHUNK_COLUMN') {
        try {
            const { chunkX, chunkZ, chunkSize, subChunkHeight, verticalChunks, seed } = data;
            
            const generator = new MinecraftTerrainGenerator(seed);
            const results = [];
            
            // Generar cada sub-chunk
            for (let subY = 0; subY < verticalChunks; subY++) {
                const baseY = subY * subChunkHeight;
                const blocks = new Uint8Array(chunkSize * subChunkHeight * chunkSize);
                let hasContent = false;
                
                // Generar terreno
                for (let x = 0; x < chunkSize; x++) {
                    for (let z = 0; z < chunkSize; z++) {
                        const worldX = chunkX * chunkSize + x;
                        const worldZ = chunkZ * chunkSize + z;
                        
                        for (let y = 0; y < subChunkHeight; y++) {
                            const worldY = baseY + y;
                            const index = x + y * chunkSize + z * chunkSize * subChunkHeight;
                            
                            const block = generator.getBlockAt(worldX, worldY, worldZ);
                            blocks[index] = block;
                            
                            if (block !== 0) {
                                hasContent = true;
                            }
                        }
                    }
                }
                
                // Solo enviar sub-chunks con contenido
                if (hasContent) {
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

export class WorkerManager {
    constructor(world, scene) {
        this.world = world;
        this.scene = scene;
        this.enabled = false;
        this.workers = {
            terrain: []
        };
        this.pendingChunks = new Map();
        this.activeRequests = new Set();
        
        // Intentar inicializar workers
        this.tryInitialize();
    }
    
    tryInitialize() {
        try {
            if (typeof Worker === 'undefined') {
                Logger.error('[WorkerManager] Web Workers not supported - Game requires workers');
                return false;
            }
            
            // Test de workers con blob
            const testBlob = new Blob(['self.postMessage("test")'], { type: 'application/javascript' });
            const testUrl = URL.createObjectURL(testBlob);
            const testWorker = new Worker(testUrl);
            
            testWorker.onmessage = (e) => {
                if (e.data === 'test') {
                    Logger.info('[WorkerManager] Workers supported, initializing Minecraft terrain generator...');
                    testWorker.terminate();
                    URL.revokeObjectURL(testUrl);
                    this.initialize();
                }
            };
            
            testWorker.onerror = (error) => {
                Logger.error('[WorkerManager] Workers required but not supported');
                testWorker.terminate();
                URL.revokeObjectURL(testUrl);
            };
            
            setTimeout(() => {
                if (!this.enabled) {
                    Logger.error('[WorkerManager] Worker initialization failed');
                    try {
                        testWorker.terminate();
                        URL.revokeObjectURL(testUrl);
                    } catch (e) {}
                }
            }, 1000);
            
        } catch (error) {
            Logger.error('[WorkerManager] Failed to initialize workers:', error);
            return false;
        }
    }
    
    initialize() {
        try {
            const workerCount = Math.min(navigator.hardwareConcurrency || 2, config.features.workerCount || 4);
            
            // Crear workers de terreno
            for (let i = 0; i < workerCount; i++) {
                const blob = new Blob([TERRAIN_WORKER_CODE], { type: 'application/javascript' });
                const url = URL.createObjectURL(blob);
                const worker = new Worker(url);
                
                worker.onmessage = (e) => this.handleTerrainMessage(e, i);
                worker.onerror = (error) => {
                    Logger.error(`[WorkerManager] Terrain worker ${i} error:`, error);
                };
                
                this.workers.terrain.push({
                    worker,
                    url,
                    busy: false,
                    id: i
                });
            }
            
            this.enabled = true;
            Logger.info(`[WorkerManager] Initialized ${workerCount} workers with Minecraft terrain generator`);
            
        } catch (error) {
            Logger.error('[WorkerManager] Failed to initialize:', error);
            this.enabled = false;
        }
    }
    
    handleTerrainMessage(e, workerId) {
        const { type, data, error } = e.data;
        
        if (type === 'CHUNK_COLUMN_GENERATED') {
            const { chunkX, chunkZ, subChunks } = data;
            const key = `${chunkX},${chunkZ}`;
            
            this.workers.terrain[workerId].busy = false;
            
            // Obtener o crear columna de chunk
            const chunkColumn = this.world.getChunkColumn(chunkX, chunkZ);
            if (!chunkColumn) {
                Logger.warn(`[WorkerManager] ChunkColumn not found for ${key}`);
                this.activeRequests.delete(key);
                this.processPending();
                return;
            }
            
            Logger.verbose(`[WorkerManager] Generated ${subChunks.length} sub-chunks for ${key}`);
            
            // Procesar cada sub-chunk
            subChunks.forEach(subChunkData => {
                const { subY, blocks } = subChunkData;
                chunkColumn.setSubChunkBlocks(subY, new Uint8Array(blocks));
                chunkColumn.updateSubChunkMesh(subY, this.scene);
            });
            
            // Marcar como completo
            this.activeRequests.delete(key);
            this.processPending();
            
        } else if (type === 'ERROR') {
            Logger.error(`[WorkerManager] Worker ${workerId} error:`, error);
            this.workers.terrain[workerId].busy = false;
            
            const key = this.findKeyForWorker(workerId);
            if (key) {
                this.activeRequests.delete(key);
                this.processPending();
            }
        }
    }
    
    findKeyForWorker(workerId) {
        for (const key of this.activeRequests) {
            return key;
        }
        return null;
    }
    
    requestChunk(chunkX, chunkZ) {
        if (!this.enabled) {
            Logger.error('[WorkerManager] Cannot generate chunk - workers not enabled');
            return false;
        }
        
        const key = `${chunkX},${chunkZ}`;
        
        if (this.activeRequests.has(key)) return true;
        
        const worker = this.workers.terrain.find(w => !w.busy);
        
        if (worker) {
            worker.busy = true;
            this.activeRequests.add(key);
            
            Logger.verbose(`[WorkerManager] Generating chunk ${key}`);
            
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
    
    getStats() {
        return {
            enabled: this.enabled,
            workers: this.workers.terrain.length,
            pending: this.pendingChunks.size,
            active: this.activeRequests.size,
            busyWorkers: this.workers.terrain.filter(w => w.busy).length
        };
    }
    
    dispose() {
        Logger.info('[WorkerManager] Disposing...');
        
        this.workers.terrain.forEach(w => {
            try {
                w.worker.terminate();
                URL.revokeObjectURL(w.url);
            } catch (e) {}
        });
        
        this.workers.terrain = [];
        this.pendingChunks.clear();
        this.activeRequests.clear();
        this.enabled = false;
        
        Logger.info('[WorkerManager] Disposed');
    }
}