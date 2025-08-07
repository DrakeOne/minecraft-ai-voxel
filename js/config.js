// Game configuration - OPTIMIZADO PARA TERRENO 3D
export const config = {
    // World settings
    chunkSize: 16,
    renderDistance: 4,  // This will be dynamically updatable
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
        useWorkers: true,         // ACTIVADO - Genera terreno 3D con DensityGenerator
        workerCount: 4,          // Increased worker count for better performance
        fallbackToSync: true,    // Always have fallback
        debugWorkers: false,     // Reducir logs para mejor rendimiento
        useAdvancedLoader: false // DESACTIVADO - Sistema experimental con problemas
    },
    
    // Performance settings
    performance: {
        maxChunksPerFrame: 5,    // Maximum chunks to process per frame
        predictiveDistance: 3,    // Chunks to predict ahead based on movement
        chunkLoadDelay: 50,      // Milliseconds between chunk loads
        priorityLoadRadius: 2,   // High priority loading radius
        expandedViewFactor: 1.5  // Frustum expansion for predictive loading
    }
};

// NEW: Function to update render distance
export function updateRenderDistance(newDistance) {
    // Validate input
    const distance = Math.max(1, Math.min(20, parseInt(newDistance)));
    config.renderDistance = distance;
    
    // Adjust performance settings based on render distance
    config.performance.maxChunksPerFrame = Math.max(3, Math.min(10, Math.floor(distance / 2)));
    config.performance.predictiveDistance = Math.max(2, Math.min(5, Math.floor(distance / 3)));
    
    Logger.info('[Config] Render distance updated to:', distance);
    Logger.debug('[Config] Performance settings adjusted:', config.performance);
    return distance;
}

// Block types
export const BlockType = {
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3
};

// Block colors - Mejorados para mejor visualización
export const blockColors = {
    [BlockType.GRASS]: 0x4CAF50,  // Verde vibrante
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
    chunksProcessing: 0
};

// Import Logger if available
let Logger = {
    info: console.log,
    debug: () => {},
    warn: console.warn,
    error: console.error
};

// Try to import the actual Logger
try {
    import('./utils/Logger.js').then(module => {
        Logger = module.Logger;
    }).catch(() => {
        // Logger not available, use console
    });
} catch (e) {
    // Import not supported in this context
}