/**
 * Sistema de Gestión de Memoria Profesional
 * Optimiza el uso de memoria mediante object pooling y límites inteligentes
 */

import { Logger } from '../utils/Logger.js';

export class MemoryManager {
    constructor() {
        // Configuración de límites de memoria
        this.config = {
            maxChunks: 200,  // Máximo de chunks en memoria
            maxGeometries: 100,  // Máximo de geometrías en pool
            maxMaterials: 50,  // Máximo de materiales en pool
            memoryCheckInterval: 5000,  // Intervalo de chequeo en ms
            aggressiveCleanup: false,  // Limpieza agresiva cuando hay poca memoria
            targetMemoryUsage: 0.7,  // Uso objetivo de memoria (70%)
            criticalMemoryUsage: 0.9  // Uso crítico de memoria (90%)
        };
        
        // Registro de chunks
        this.chunks = new Map();  // key -> { lastAccess, size, priority }
        
        // Object pools
        this.geometryPool = [];
        this.materialPool = [];
        this.bufferPool = new Map();  // tipo -> array de buffers
        
        // Estadísticas
        this.stats = {
            totalAllocated: 0,
            totalFreed: 0,
            currentChunks: 0,
            pooledGeometries: 0,
            pooledMaterials: 0,
            memoryPressure: 0,
            lastCleanup: Date.now(),
            cleanupCount: 0
        };
        
        // Iniciar monitoreo de memoria
        this.startMemoryMonitoring();
        
        Logger.info('[MemoryManager] Inicializado con límite de ' + this.config.maxChunks + ' chunks');
    }
    
    /**
     * Iniciar monitoreo periódico de memoria
     */
    startMemoryMonitoring() {
        if (typeof window === 'undefined') return;
        
        this.memoryCheckInterval = setInterval(() => {
            this.checkMemoryPressure();
        }, this.config.memoryCheckInterval);
    }
    
    /**
     * Verificar presión de memoria
     */
    checkMemoryPressure() {
        if (!performance.memory) {
            // API no disponible, usar estimación basada en chunks
            this.stats.memoryPressure = this.chunks.size / this.config.maxChunks;
            return;
        }
        
        const used = performance.memory.usedJSHeapSize;
        const total = performance.memory.jsHeapSizeLimit;
        const usage = used / total;
        
        this.stats.memoryPressure = usage;
        
        // Activar limpieza si es necesario
        if (usage > this.config.criticalMemoryUsage) {
            Logger.warn(`[MemoryManager] Memoria crítica: ${(usage * 100).toFixed(1)}%`);
            this.performAggressiveCleanup();
        } else if (usage > this.config.targetMemoryUsage) {
            Logger.debug(`[MemoryManager] Memoria alta: ${(usage * 100).toFixed(1)}%`);
            this.performCleanup();
        }
    }
    
    /**
     * Registrar un nuevo chunk
     */
    registerChunk(key, size = 1, priority = 0) {
        this.chunks.set(key, {
            lastAccess: Date.now(),
            size: size,
            priority: priority
        });
        
        this.stats.currentChunks = this.chunks.size;
        this.stats.totalAllocated++;
        
        // Verificar límite
        if (this.chunks.size > this.config.maxChunks) {
            Logger.debug('[MemoryManager] Límite de chunks alcanzado, iniciando limpieza');
            this.freeOldestChunks(null, Math.floor(this.config.maxChunks * 0.1));
        }
    }
    
    /**
     * Actualizar acceso a chunk
     */
    updateChunkAccess(key) {
        const chunk = this.chunks.get(key);
        if (chunk) {
            chunk.lastAccess = Date.now();
        }
    }
    
    /**
     * Desregistrar chunk
     */
    unregisterChunk(key) {
        if (this.chunks.delete(key)) {
            this.stats.currentChunks = this.chunks.size;
            this.stats.totalFreed++;
        }
    }
    
    /**
     * Verificar si se puede asignar un nuevo chunk
     */
    canAllocateChunk() {
        // Verificar límite de chunks
        if (this.chunks.size >= this.config.maxChunks) {
            return false;
        }
        
        // Verificar presión de memoria
        if (this.stats.memoryPressure > this.config.targetMemoryUsage) {
            return false;
        }
        
        return true;
    }
    
    /**
     * Liberar los chunks más antiguos
     */
    freeOldestChunks(world, count = 5) {
        const sortedChunks = Array.from(this.chunks.entries())
            .sort((a, b) => {
                // Primero por prioridad, luego por último acceso
                if (a[1].priority !== b[1].priority) {
                    return a[1].priority - b[1].priority;
                }
                return a[1].lastAccess - b[1].lastAccess;
            });
        
        const chunksToFree = sortedChunks.slice(0, count);
        
        for (const [key, data] of chunksToFree) {
            if (world && world.unloadChunk) {
                world.unloadChunk(key);
            }
            this.unregisterChunk(key);
            Logger.debug(`[MemoryManager] Liberado chunk ${key}`);
        }
        
        this.stats.cleanupCount++;
        this.stats.lastCleanup = Date.now();
        
        return chunksToFree.length;
    }
    
    /**
     * Realizar limpieza normal
     */
    performCleanup() {
        // Limpiar pools
        this.cleanPools();
        
        // Liberar algunos chunks antiguos
        const toFree = Math.floor(this.chunks.size * 0.1);
        if (toFree > 0) {
            this.freeOldestChunks(null, toFree);
        }
    }
    
    /**
     * Realizar limpieza agresiva
     */
    performAggressiveCleanup() {
        Logger.warn('[MemoryManager] Iniciando limpieza agresiva de memoria');
        
        // Limpiar todos los pools
        this.clearPools();
        
        // Liberar 30% de los chunks
        const toFree = Math.floor(this.chunks.size * 0.3);
        this.freeOldestChunks(null, toFree);
        
        // Forzar garbage collection si está disponible
        if (typeof gc !== 'undefined') {
            gc();
        }
    }
    
    /**
     * OBJECT POOLING - Obtener geometría del pool
     */
    acquireGeometry() {
        if (this.geometryPool.length > 0) {
            this.stats.pooledGeometries--;
            return this.geometryPool.pop();
        }
        return new THREE.BufferGeometry();
    }
    
    /**
     * OBJECT POOLING - Devolver geometría al pool
     */
    releaseGeometry(geometry) {
        if (!geometry) return;
        
        // Limpiar geometría
        geometry.deleteAttribute('position');
        geometry.deleteAttribute('normal');
        geometry.deleteAttribute('color');
        geometry.deleteAttribute('uv');
        geometry.setIndex(null);
        
        // Agregar al pool si no está lleno
        if (this.geometryPool.length < this.config.maxGeometries) {
            this.geometryPool.push(geometry);
            this.stats.pooledGeometries++;
        } else {
            // Destruir si el pool está lleno
            geometry.dispose();
        }
    }
    
    /**
     * OBJECT POOLING - Obtener material del pool
     */
    acquireMaterial(type = 'lambert') {
        const pool = this.materialPool.filter(m => m.userData.poolType === type);
        
        if (pool.length > 0) {
            const material = pool[0];
            const index = this.materialPool.indexOf(material);
            this.materialPool.splice(index, 1);
            this.stats.pooledMaterials--;
            return material;
        }
        
        // Crear nuevo material según tipo
        let material;
        switch (type) {
            case 'lambert':
                material = new THREE.MeshLambertMaterial({ vertexColors: true });
                break;
            case 'basic':
                material = new THREE.MeshBasicMaterial({ vertexColors: true });
                break;
            default:
                material = new THREE.MeshLambertMaterial({ vertexColors: true });
        }
        
        material.userData.poolType = type;
        return material;
    }
    
    /**
     * OBJECT POOLING - Devolver material al pool
     */
    releaseMaterial(material) {
        if (!material) return;
        
        // Reset material properties
        material.needsUpdate = false;
        
        // Agregar al pool si no está lleno
        if (this.materialPool.length < this.config.maxMaterials) {
            this.materialPool.push(material);
            this.stats.pooledMaterials++;
        } else {
            // Destruir si el pool está lleno
            material.dispose();
        }
    }
    
    /**
     * BUFFER POOLING - Obtener buffer tipado
     */
    acquireBuffer(type, size) {
        const key = `${type}_${size}`;
        
        if (!this.bufferPool.has(key)) {
            this.bufferPool.set(key, []);
        }
        
        const pool = this.bufferPool.get(key);
        
        if (pool.length > 0) {
            return pool.pop();
        }
        
        // Crear nuevo buffer según tipo
        switch (type) {
            case 'float32':
                return new Float32Array(size);
            case 'uint8':
                return new Uint8Array(size);
            case 'uint16':
                return new Uint16Array(size);
            case 'uint32':
                return new Uint32Array(size);
            default:
                return new Float32Array(size);
        }
    }
    
    /**
     * BUFFER POOLING - Devolver buffer al pool
     */
    releaseBuffer(buffer, type) {
        if (!buffer) return;
        
        const size = buffer.length;
        const key = `${type}_${size}`;
        
        if (!this.bufferPool.has(key)) {
            this.bufferPool.set(key, []);
        }
        
        const pool = this.bufferPool.get(key);
        
        // Limpiar buffer
        buffer.fill(0);
        
        // Limitar tamaño del pool
        if (pool.length < 10) {
            pool.push(buffer);
        }
    }
    
    /**
     * Limpiar pools parcialmente
     */
    cleanPools() {
        // Reducir geometrías en pool
        const geometriesToRemove = Math.floor(this.geometryPool.length * 0.3);
        for (let i = 0; i < geometriesToRemove; i++) {
            const geometry = this.geometryPool.pop();
            if (geometry) {
                geometry.dispose();
                this.stats.pooledGeometries--;
            }
        }
        
        // Reducir materiales en pool
        const materialsToRemove = Math.floor(this.materialPool.length * 0.3);
        for (let i = 0; i < materialsToRemove; i++) {
            const material = this.materialPool.pop();
            if (material) {
                material.dispose();
                this.stats.pooledMaterials--;
            }
        }
        
        // Limpiar algunos buffers
        for (const [key, pool] of this.bufferPool.entries()) {
            const toRemove = Math.floor(pool.length * 0.5);
            pool.splice(0, toRemove);
        }
    }
    
    /**
     * Limpiar todos los pools
     */
    clearPools() {
        // Limpiar geometrías
        for (const geometry of this.geometryPool) {
            geometry.dispose();
        }
        this.geometryPool = [];
        this.stats.pooledGeometries = 0;
        
        // Limpiar materiales
        for (const material of this.materialPool) {
            material.dispose();
        }
        this.materialPool = [];
        this.stats.pooledMaterials = 0;
        
        // Limpiar buffers
        this.bufferPool.clear();
        
        Logger.info('[MemoryManager] Pools limpiados completamente');
    }
    
    /**
     * Obtener estadísticas
     */
    getStats() {
        return {
            chunks: `${this.stats.currentChunks}/${this.config.maxChunks}`,
            allocated: this.stats.totalAllocated,
            freed: this.stats.totalFreed,
            pooledGeometries: this.stats.pooledGeometries,
            pooledMaterials: this.stats.pooledMaterials,
            memoryPressure: `${(this.stats.memoryPressure * 100).toFixed(1)}%`,
            cleanups: this.stats.cleanupCount,
            lastCleanup: new Date(this.stats.lastCleanup).toLocaleTimeString()
        };
    }
    
    /**
     * Limpiar recursos
     */
    dispose() {
        // Detener monitoreo
        if (this.memoryCheckInterval) {
            clearInterval(this.memoryCheckInterval);
        }
        
        // Limpiar pools
        this.clearPools();
        
        // Limpiar registros
        this.chunks.clear();
        
        Logger.info('[MemoryManager] Recursos liberados');
    }
}