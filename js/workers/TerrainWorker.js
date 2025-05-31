/**
 * Terrain Generation Worker
 * Generates chunk terrain data in parallel
 */

// Simple noise function for terrain generation
class SimplexNoise {
    constructor(seed = Math.random()) {
        this.seed = seed;
        this.perm = this.generatePermutation();
    }

    generatePermutation() {
        const perm = [];
        for (let i = 0; i < 256; i++) {
            perm[i] = i;
        }
        
        // Shuffle based on seed
        let n = perm.length;
        while (n > 1) {
            n--;
            const k = Math.floor(this.random() * (n + 1));
            [perm[n], perm[k]] = [perm[k], perm[n]];
        }
        
        // Duplicate for overflow
        return perm.concat(perm);
    }

    random() {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }

    noise2D(x, y) {
        // Simple 2D noise implementation
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        
        x -= Math.floor(x);
        y -= Math.floor(y);
        
        const u = this.fade(x);
        const v = this.fade(y);
        
        const A = this.perm[X] + Y;
        const B = this.perm[X + 1] + Y;
        
        return this.lerp(v,
            this.lerp(u, this.grad2D(this.perm[A], x, y), this.grad2D(this.perm[B], x - 1, y)),
            this.lerp(u, this.grad2D(this.perm[A + 1], x, y - 1), this.grad2D(this.perm[B + 1], x - 1, y - 1))
        );
    }

    fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    lerp(t, a, b) {
        return a + t * (b - a);
    }

    grad2D(hash, x, y) {
        const h = hash & 3;
        const u = h < 2 ? x : y;
        const v = h < 2 ? y : x;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }
}

// Terrain generator class
class TerrainGenerator {
    constructor(seed) {
        this.noise = new SimplexNoise(seed);
        this.biomeNoise = new SimplexNoise(seed + 1000);
    }

    generateChunk(x, z, chunkSize, lod = 0) {
        const blocks = new Uint8Array(chunkSize * chunkSize * chunkSize);
        const lodScale = Math.pow(2, lod); // LOD scaling factor
        
        // Generate terrain based on LOD
        for (let localX = 0; localX < chunkSize; localX += lodScale) {
            for (let localZ = 0; localZ < chunkSize; localZ += lodScale) {
                const worldX = x * chunkSize + localX;
                const worldZ = z * chunkSize + localZ;
                
                // Generate height using multiple octaves
                const height = this.generateHeight(worldX, worldZ);
                const biome = this.getBiome(worldX, worldZ);
                
                // Fill blocks based on height and biome
                this.fillColumn(blocks, localX, localZ, height, biome, chunkSize, lodScale);
            }
        }
        
        // Add features based on LOD
        if (lod === 0) {
            this.addTrees(blocks, x, z, chunkSize);
            this.addOres(blocks, chunkSize);
        }
        
        return blocks;
    }

    generateHeight(x, z) {
        let height = 0;
        let amplitude = 30;
        let frequency = 0.005;
        
        // Multiple octaves for more interesting terrain
        for (let i = 0; i < 4; i++) {
            height += this.noise.noise2D(x * frequency, z * frequency) * amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        
        // Base height and clamping
        height = Math.floor(height + 10);
        return Math.max(0, Math.min(height, 63));
    }

    getBiome(x, z) {
        const biomeValue = this.biomeNoise.noise2D(x * 0.001, z * 0.001);
        
        if (biomeValue < -0.3) return 'desert';
        if (biomeValue < 0) return 'plains';
        if (biomeValue < 0.3) return 'forest';
        return 'mountains';
    }

    fillColumn(blocks, x, z, height, biome, chunkSize, lodScale) {
        const BlockType = {
            AIR: 0,
            GRASS: 1,
            DIRT: 2,
            STONE: 3,
            SAND: 4,
            SNOW: 5
        };
        
        // Fill column based on biome
        for (let y = 0; y <= height; y++) {
            let blockType = BlockType.STONE;
            
            if (y === height) {
                // Surface block based on biome
                switch (biome) {
                    case 'desert':
                        blockType = BlockType.SAND;
                        break;
                    case 'mountains':
                        blockType = height > 40 ? BlockType.SNOW : BlockType.STONE;
                        break;
                    default:
                        blockType = BlockType.GRASS;
                }
            } else if (y > height - 4) {
                // Sub-surface
                blockType = biome === 'desert' ? BlockType.SAND : BlockType.DIRT;
            }
            
            // Set block for LOD area
            for (let dx = 0; dx < lodScale && x + dx < chunkSize; dx++) {
                for (let dz = 0; dz < lodScale && z + dz < chunkSize; dz++) {
                    const index = (x + dx) + y * chunkSize + (z + dz) * chunkSize * chunkSize;
                    blocks[index] = blockType;
                }
            }
        }
    }

    addTrees(blocks, chunkX, chunkZ, chunkSize) {
        const BlockType = { WOOD: 4, LEAVES: 6 };
        
        // Add trees randomly
        for (let i = 0; i < 3; i++) {
            const x = Math.floor(this.noise.random() * (chunkSize - 4)) + 2;
            const z = Math.floor(this.noise.random() * (chunkSize - 4)) + 2;
            
            // Find ground level
            let groundY = 0;
            for (let y = chunkSize - 1; y >= 0; y--) {
                const index = x + y * chunkSize + z * chunkSize * chunkSize;
                if (blocks[index] !== 0) {
                    groundY = y;
                    break;
                }
            }
            
            // Only place trees on grass
            const groundIndex = x + groundY * chunkSize + z * chunkSize * chunkSize;
            if (blocks[groundIndex] !== 1) continue; // Not grass
            
            // Tree trunk
            const treeHeight = 4 + Math.floor(this.noise.random() * 3);
            for (let y = 1; y <= treeHeight; y++) {
                if (groundY + y < chunkSize) {
                    const index = x + (groundY + y) * chunkSize + z * chunkSize * chunkSize;
                    blocks[index] = BlockType.WOOD;
                }
            }
            
            // Tree leaves (simple cube for now)
            const leafStart = groundY + treeHeight - 2;
            const leafSize = 2;
            
            for (let dx = -leafSize; dx <= leafSize; dx++) {
                for (let dy = 0; dy <= leafSize; dy++) {
                    for (let dz = -leafSize; dz <= leafSize; dz++) {
                        const lx = x + dx;
                        const ly = leafStart + dy;
                        const lz = z + dz;
                        
                        if (lx >= 0 && lx < chunkSize && 
                            ly >= 0 && ly < chunkSize && 
                            lz >= 0 && lz < chunkSize) {
                            
                            // Skip corners for more natural look
                            if (Math.abs(dx) === leafSize && Math.abs(dz) === leafSize && dy === leafSize) {
                                continue;
                            }
                            
                            const index = lx + ly * chunkSize + lz * chunkSize * chunkSize;
                            if (blocks[index] === 0) {
                                blocks[index] = BlockType.LEAVES;
                            }
                        }
                    }
                }
            }
        }
    }

    addOres(blocks, chunkSize) {
        const BlockType = { COAL: 7, IRON: 8, GOLD: 9, DIAMOND: 10 };
        
        // Add ore veins
        const oreTypes = [
            { type: BlockType.COAL, count: 10, minY: 5, maxY: 50, size: 4 },
            { type: BlockType.IRON, count: 8, minY: 5, maxY: 40, size: 3 },
            { type: BlockType.GOLD, count: 4, minY: 5, maxY: 30, size: 2 },
            { type: BlockType.DIAMOND, count: 2, minY: 5, maxY: 20, size: 2 }
        ];
        
        for (const ore of oreTypes) {
            for (let i = 0; i < ore.count; i++) {
                const x = Math.floor(this.noise.random() * chunkSize);
                const y = Math.floor(this.noise.random() * (ore.maxY - ore.minY) + ore.minY);
                const z = Math.floor(this.noise.random() * chunkSize);
                
                // Create ore vein
                for (let j = 0; j < ore.size; j++) {
                    const ox = x + Math.floor(this.noise.random() * 3 - 1);
                    const oy = y + Math.floor(this.noise.random() * 3 - 1);
                    const oz = z + Math.floor(this.noise.random() * 3 - 1);
                    
                    if (ox >= 0 && ox < chunkSize &&
                        oy >= ore.minY && oy < ore.maxY &&
                        oz >= 0 && oz < chunkSize) {
                        
                        const index = ox + oy * chunkSize + oz * chunkSize * chunkSize;
                        if (blocks[index] === 3) { // Replace stone only
                            blocks[index] = ore.type;
                        }
                    }
                }
            }
        }
    }
}

// Worker message handler
let generator = null;

self.onmessage = function(e) {
    const { id, data } = e.data;
    const { x, z, chunkSize, seed, lod } = data;
    
    try {
        // Initialize generator if needed
        if (!generator || generator.noise.seed !== seed) {
            generator = new TerrainGenerator(seed);
        }
        
        // Generate terrain
        const blocks = generator.generateChunk(x, z, chunkSize, lod);
        
        // Send result back
        self.postMessage({
            id: id,
            result: {
                buffer: blocks.buffer,
                x: x,
                z: z
            }
        }, [blocks.buffer]); // Transfer ownership
        
    } catch (error) {
        self.postMessage({
            id: id,
            error: error.message
        });
    }
};