// Game configuration - OPTIMIZADO PARA CARGA RÁPIDA DE CHUNKS
export const config = {
    // World settings
    chunkSize: 16,
    renderDistance: 4,  // Default conservador, ajustable dinámicamente
    blockSize: 1,
    
    // Vertical chunk system
    subChunkHeight: 16,    // Height of each sub-chunk
    worldHeight: 256,      // Total world height
    verticalChunks: 16,    // Number of vertical sub-chunks (256/16)
    
    // Physics
    gravity: -20,
    jumpVelocity: 10,
    moveSpeed: 5,
    
    // Controls
    mouseSensitivity: 0.002,
    mobileMoveSensitivity: 0.5,
    
    // Features - OPTIMIZADO PARA MEJOR RENDIMIENTO
    features: {
        useWorkers: true,         // Genera terreno 3D con DensityGenerator
        workerCount: 4,          // Workers para generación paralela
        fallbackToSync: true,    // Fallback si workers fallan
        debugWorkers: false,     // Sin logs para mejor rendimiento
        useAdvancedLoader: false // Sistema experimental desactivado
    },
    
    // Performance settings - CRÍTICO PARA CARGA RÁPIDA
    performance: {
        // Carga adaptativa basada en FPS
        maxChunksPerFrame: {
            high: 8,    // FPS > 50
            medium: 5,  // FPS > 30
            low: 3      // FPS < 30
        },
        
        // Intervalos de actualización
        chunkUpdateInterval: 50,     // ms entre actualizaciones de chunks
        frustumUpdateInterval: 100,  // ms entre actualizaciones de frustum
        
        // Priorización
        priorityRadius: 2,           // Radio de máxima prioridad
        viewAnglePriority: 0.8,      // Factor de prioridad para chunks al frente
        
        // Límites de memoria
        maxLoadedChunks: 200,        // Máximo de chunks en memoria
        maxConcurrentLoads: 8,       // Máximo de chunks cargando simultáneamente
        
        // Optimizaciones
        enableFrustumCulling: true,  // Culling de chunks no visibles
        enableDistanceFog: true,     // Niebla para ocultar bordes
        enableLOD: false,            // LOD desactivado por ahora
        
        // Cache
        cacheLifetime: 5000,         // ms que un chunk permanece en cache
        enableChunkCache: true       // Cache de chunks descargados
    }
};

// Función para actualizar distancia de renderizado dinámicamente
export function updateRenderDistance(newDistance) {
    const distance = Math.max(1, Math.min(20, parseInt(newDistance)));
    config.renderDistance = distance;
    
    // Ajustar configuración de rendimiento basada en distancia
    if (distance <= 4) {
        // Configuración para distancia corta (máximo rendimiento)
        config.performance.maxChunksPerFrame.high = 8;
        config.performance.maxChunksPerFrame.medium = 5;
        config.performance.maxChunksPerFrame.low = 3;
        config.performance.chunkUpdateInterval = 50;
    } else if (distance <= 8) {
        // Configuración para distancia media
        config.performance.maxChunksPerFrame.high = 6;
        config.performance.maxChunksPerFrame.medium = 4;
        config.performance.maxChunksPerFrame.low = 2;
        config.performance.chunkUpdateInterval = 75;
    } else {
        // Configuración para distancia larga (conservador)
        config.performance.maxChunksPerFrame.high = 4;
        config.performance.maxChunksPerFrame.medium = 3;
        config.performance.maxChunksPerFrame.low = 1;
        config.performance.chunkUpdateInterval = 100;
    }
    
    // Ajustar límite de chunks basado en distancia
    config.performance.maxLoadedChunks = Math.min(500, (distance * 2 + 1) * (distance * 2 + 1) * 2);
    
    Logger.info('[Config] Render distance updated to:', distance);
    Logger.debug('[Config] Performance adjusted for distance:', config.performance);
    return distance;
}

// Block types
export const BlockType = {
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3
};

// Block colors - Colores vibrantes para mejor visualización
export const blockColors = {
    [BlockType.GRASS]: 0x4CAF50,  // Verde césped
    [BlockType.DIRT]: 0x8D6E63,   // Marrón tierra
    [BlockType.STONE]: 0x9E9E9E   // Gris piedra
};

// Performance stats
export const stats = {
    fps: 0,
    frameTime: 0,
    totalFaces: 0,
    visibleChunks: 0,
    totalChunks: 0,
    culledChunks: 0,
    cullingEfficiency: 0,
    workerStatus: 'initializing',
    chunksInQueue: 0,
    chunksProcessing: 0,
    averageLoadTime: 0,
    memoryUsage: 0
};

// Sistema de Logger
let Logger = {
    info: (...args) => console.log(...args),
    debug: () => {},  // Desactivado por defecto
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
    verbose: () => {} // Desactivado por defecto
};

// Intentar importar el Logger real
try {
    import('./utils/Logger.js').then(module => {
        Logger = module.Logger;
    }).catch(() => {
        // Logger no disponible, usar fallback
    });
} catch (e) {
    // Import no soportado en este contexto
}

// Exportar Logger para uso global
export { Logger };