// Game Configuration
export const config = {
    chunkSize: 16,
    renderDistance: 4,
    blockSize: 1,
    gravity: -20,
    jumpVelocity: 10,
    moveSpeed: 5,
    mouseSensitivity: 0.005,  // FIXED: Increased from 0.002 for normal sensitivity
    mobileMoveSensitivity: 0.02
};

// Block types
export const BlockType = {
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3,
    WOOD: 4
};

// Block colors (optimized for performance)
export const blockColors = {
    [BlockType.GRASS]: 0x4CAF50,
    [BlockType.DIRT]: 0x8B4513,
    [BlockType.STONE]: 0x808080,
    [BlockType.WOOD]: 0x8B4513
};

// Performance monitoring
export const stats = {
    fps: 0,
    frameTime: 0,
    lastTime: performance.now(),
    totalFaces: 0,
    visibleChunks: 0,
    totalChunks: 0
};