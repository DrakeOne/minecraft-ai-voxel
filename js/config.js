// Game configuration
export const config = {
    // World settings
    chunkSize: 16,
    renderDistance: 4,
    blockSize: 1,
    
    // Physics
    gravity: -20,
    jumpVelocity: 10,
    moveSpeed: 5,
    
    // Controls
    mouseSensitivity: 0.002,
    mobileMoveSensitivity: 0.5,
    
    // Features (safe defaults for GitHub Pages)
    features: {
        useWorkers: false,        // Disabled by default for safety
        workerCount: 2,          // Conservative worker count
        fallbackToSync: true,    // Always have fallback
        debugWorkers: true,      // Extra logging for workers
        useAdvancedLoader: false // DISABLED - Fix for rendering issue
    }
};

// Block types
export const BlockType = {
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3
};

// Block colors
export const blockColors = {
    [BlockType.GRASS]: 0x4CAF50,
    [BlockType.DIRT]: 0x8D6E63,
    [BlockType.STONE]: 0x9E9E9E
};

// Performance stats
export const stats = {
    fps: 0,
    frameTime: 0,
    totalFaces: 0,
    visibleChunks: 0,
    totalChunks: 0,
    workerStatus: 'disabled'
};