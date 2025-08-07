/**
 * WorkerManager - Sistema optimizado de Web Workers para generación de terreno
 * Genera terreno 3D con chunks verticales usando workers inline
 */

import { config } from '../config.js';
import { Logger } from '../utils/Logger.js';

// Código del generador de densidad para terreno 3D
const DENSITY_GENERATOR_CODE = `
class DensityGenerator {
    constructor(seed = 12345) {
        this.seed = seed;
        this.baseOffset = 64;
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
        
        density += this.noise3D(worldX, worldY, worldZ, this.terrainScale) * 30;
        density += this.noise3D(worldX, worldY, worldZ, this.terrainScale * 2) * 15;
        
        const caveNoise = this.noise3D(worldX, worldY, worldZ, this.caveScale);
        const caveNoise2 = this.noise3D(worldX, worldY, worldZ, this.caveScale * 2);
        
        if (caveNoise > 0.6 && caveNoise2 > 0.6) {
            density -= 50;
        }
        
        density += this.noise3D(worldX, worldY, worldZ, this.detailScale) * 5;
        
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

// Worker de generación de terreno
const TERRAIN_WORKER_CODE = DENSITY_GENERATOR_CODE + `
self.onmessage = function(e) {
    const { type, data } = e.data;
    
    if (type === 'GENERATE_CHUNK_COLUMN') {
        try {
            const { chunkX, chunkZ, chunkSize, subChunkHeight, verticalChunks, seed } = data;
            
            const generator = new DensityGenerator(seed);
            const results = [];
            
            // Generar cada sub-chunk
            for (let subY = 0; subY < verticalChunks; subY++) {
                const baseY = subY * subChunkHeight;
                const blocks = new Uint8Array(chunkSize * subChunkHeight * chunkSize);
                let hasContent = false;
                
                // Primera pasada: generar terreno con densidad 3D
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
                
                // Solo procesar sub-chunks no vacíos
                if (hasContent) {
                    // Segunda pasada: aplicar materiales de superficie
                    for (let x = 0; x < chunkSize; x++) {
                        for (let y = 0; y < subChunkHeight; y++) {
                            for (let z = 0; z < chunkSize; z++) {
                                const index = x + y * chunkSize + z * chunkSize * subChunkHeight;
                                
                                if (blocks[index] !== 0) {
                                    const worldX = chunkX * chunkSize + x;
                                    const worldY = baseY + y;
                                    const worldZ = chunkZ * chunkSize + z;
                                    
                                    // Verificar si hay aire arriba
                                    let hasAirAbove = false;
                                    
                                    if (y < subChunkHeight - 1) {
                                        const aboveIndex = x + (y + 1) * chunkSize + z * chunkSize * subChunkHeight;
                                        hasAirAbove = blocks[aboveIndex] === 0;
                                    } else if (subY < verticalChunks - 1) {
                                        const nextWorldY = worldY + 1;
                                        const biome = generator.getBiome(worldX, worldZ);
                                        const densityAbove = generator.getDensity(worldX, nextWorldY, worldZ, biome);
                                        hasAirAbove = densityAbove <= 0;
                                    } else {
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
                                        
                                        // Añadir capas de tierra bajo el césped
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
        this.subChunkDataCache = new Map();
        
        // Intentar inicializar workers
        this.tryInitialize();
    }
    
    tryInitialize() {
        try {
            if (typeof Worker === 'undefined') {
                Logger.warn('[WorkerManager] Web Workers not supported');
                return false;
            }
            
            // Test de workers con blob
            const testBlob = new Blob(['self.postMessage("test")'], { type: 'application/javascript' });
            const testUrl = URL.createObjectURL(testBlob);
            const testWorker = new Worker(testUrl);
            
            testWorker.onmessage = (e) => {
                if (e.data === 'test') {
                    Logger.info('[WorkerManager] Blob workers supported, initializing...');
                    testWorker.terminate();
                    URL.revokeObjectURL(testUrl);
                    this.initialize();
                }
            };
            
            testWorker.onerror = (error) => {
                Logger.warn('[WorkerManager] Blob workers not supported');
                testWorker.terminate();
                URL.revokeObjectURL(testUrl);
            };
            
            // Timeout para el test
            setTimeout(() => {
                if (!this.enabled) {
                    Logger.warn('[WorkerManager] Worker test timeout');
                    try {
                        testWorker.terminate();
                        URL.revokeObjectURL(testUrl);
                    } catch (e) {}
                }
            }, 1000);
            
        } catch (error) {
            Logger.warn('[WorkerManager] Failed to test workers:', error);
            return false;
        }
    }
    
    initialize() {
        try {
            const workerCount = Math.min(navigator.hardwareConcurrency || 2, config.features.workerCount || 2);
            
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
            Logger.info(`[WorkerManager] Initialized with ${workerCount} terrain workers`);
            
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
            
            Logger.debug(`[WorkerManager] Generated ${subChunks.length} sub-chunks for column ${key}`);
            
            // Procesar cada sub-chunk
            subChunks.forEach(subChunkData => {
                const { subY, blocks } = subChunkData;
                
                // Almacenar bloques en la columna
                chunkColumn.setSubChunkBlocks(subY, new Uint8Array(blocks));
                
                // Actualizar mesh inmediatamente
                chunkColumn.updateSubChunkMesh(subY, this.scene);
            });
            
            // Marcar como completo
            this.activeRequests.delete(key);
            this.processPending();
            
        } else if (type === 'ERROR') {
            Logger.error(`[WorkerManager] Terrain worker ${workerId} error:`, error);
            this.workers.terrain[workerId].busy = false;
            
            // Reintentar o usar fallback
            const key = this.findKeyForWorker(workerId);
            if (key) {
                this.activeRequests.delete(key);
                this.processPending();
            }
        }
    }
    
    findKeyForWorker(workerId) {
        // Buscar qué chunk estaba procesando este worker
        for (const key of this.activeRequests) {
            // Implementación simplificada
            return key;
        }
        return null;
    }
    
    requestChunk(chunkX, chunkZ) {
        if (!this.enabled) return false;
        
        const key = `${chunkX},${chunkZ}`;
        
        // Si ya está en proceso, no duplicar
        if (this.activeRequests.has(key)) return true;
        
        // Buscar worker disponible
        const worker = this.workers.terrain.find(w => !w.busy);
        
        if (worker) {
            worker.busy = true;
            this.activeRequests.add(key);
            
            Logger.verbose(`[WorkerManager] Requesting chunk column at ${key}`);
            
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
            // Añadir a cola de pendientes
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
        
        // Terminar todos los workers
        [...this.workers.terrain, ...this.workers.mesh].forEach(w => {
            try {
                w.worker.terminate();
                URL.revokeObjectURL(w.url);
            } catch (e) {
                // Silenciar errores de limpieza
            }
        });
        
        this.workers.terrain = [];
        this.workers.mesh = [];
        this.pendingChunks.clear();
        this.activeRequests.clear();
        this.subChunkDataCache.clear();
        this.enabled = false;
        
        Logger.info('[WorkerManager] Disposed');
    }
}