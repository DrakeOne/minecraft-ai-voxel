// DensityGenerator.js - 3D density-based terrain generation
export class DensityGenerator {
    constructor(seed = 12345) {
        this.seed = seed;
        
        // Density parameters
        this.baseOffset = 10; // Base height where density transitions
        this.terrainScale = 0.02;
        this.caveScale = 0.05;
        this.detailScale = 0.1;
        
        // Biome-specific adjustments (placeholder for now)
        this.biomeOffsets = {
            plains: 0,
            hills: 5,
            mountains: 15,
            ocean: -10
        };
    }
    
    // Simple pseudo-random for seed-based generation
    random(x, y, z) {
        const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + this.seed) * 43758.5453;
        return (n - Math.floor(n));
    }
    
    // 3D noise function (simplified Perlin-like noise)
    noise3D(x, y, z, scale = 1) {
        x *= scale;
        y *= scale;
        z *= scale;
        
        // Integer coordinates
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const zi = Math.floor(z);
        
        // Fractional coordinates
        const xf = x - xi;
        const yf = y - yi;
        const zf = z - zi;
        
        // Smoothstep
        const u = xf * xf * (3 - 2 * xf);
        const v = yf * yf * (3 - 2 * yf);
        const w = zf * zf * (3 - 2 * zf);
        
        // Get corner values
        const aaa = this.random(xi, yi, zi);
        const aba = this.random(xi, yi + 1, zi);
        const aab = this.random(xi, yi, zi + 1);
        const abb = this.random(xi, yi + 1, zi + 1);
        const baa = this.random(xi + 1, yi, zi);
        const bba = this.random(xi + 1, yi + 1, zi);
        const bab = this.random(xi + 1, yi, zi + 1);
        const bbb = this.random(xi + 1, yi + 1, zi + 1);
        
        // Trilinear interpolation
        const x1 = aaa * (1 - u) + baa * u;
        const x2 = aba * (1 - u) + bba * u;
        const y1 = x1 * (1 - v) + x2 * v;
        
        const x3 = aab * (1 - u) + bab * u;
        const x4 = abb * (1 - u) + bbb * u;
        const y2 = x3 * (1 - v) + x4 * v;
        
        return (y1 * (1 - w) + y2 * w) * 2 - 1;
    }
    
    // Get density at a specific 3D point
    getDensity(worldX, worldY, worldZ, biome = 'plains') {
        // Base density decreases with height
        const biomeOffset = this.biomeOffsets[biome] || 0;
        let density = (this.baseOffset + biomeOffset) - worldY;
        
        // Primary terrain noise (large features)
        density += this.noise3D(worldX, worldY, worldZ, this.terrainScale) * 15;
        
        // Secondary terrain noise (medium features)
        density += this.noise3D(worldX, worldY, worldZ, this.terrainScale * 2) * 8;
        
        // Cave noise (subtractive)
        const caveNoise = this.noise3D(worldX, worldY, worldZ, this.caveScale);
        const caveNoise2 = this.noise3D(worldX, worldY, worldZ, this.caveScale * 2);
        
        // Create caves where both noise values are high
        if (caveNoise > 0.6 && caveNoise2 > 0.6) {
            density -= 50; // Strong negative density creates caves
        }
        
        // Detail noise (small features)
        density += this.noise3D(worldX, worldY, worldZ, this.detailScale) * 3;
        
        // Create more interesting overhangs
        if (worldY > 5 && worldY < 20) {
            const overhangNoise = this.noise3D(worldX * 0.03, worldY * 0.1, worldZ * 0.03);
            if (overhangNoise > 0.3) {
                density += overhangNoise * 10;
            }
        }
        
        return density;
    }
    
    // Determine block type based on position and surroundings
    getBlockType(worldX, worldY, worldZ, density, biome = 'plains') {
        // Air
        if (density <= 0) return 0;
        
        // Default to stone
        let blockType = 3; // Stone
        
        // Check if this is a surface block (has air above)
        const aboveDensity = this.getDensity(worldX, worldY + 1, worldZ, biome);
        
        if (aboveDensity <= 0) {
            // This is a surface block
            switch (biome) {
                case 'plains':
                case 'hills':
                    blockType = 1; // Grass
                    break;
                case 'desert':
                    blockType = 4; // Sand (need to add this block type)
                    break;
                case 'mountains':
                    if (worldY > 25) {
                        blockType = 5; // Snow (need to add this block type)
                    } else {
                        blockType = 3; // Stone
                    }
                    break;
                default:
                    blockType = 1; // Grass
            }
        } else if (density > 0 && worldY < this.baseOffset + biomeOffset - 3) {
            // Deep underground remains stone
            blockType = 3;
        } else {
            // Sub-surface layers
            const depthFromSurface = this.getDepthFromSurface(worldX, worldY, worldZ, biome);
            if (depthFromSurface >= 0 && depthFromSurface < 4) {
                blockType = 2; // Dirt
            }
        }
        
        return blockType;
    }
    
    // Helper to determine depth from surface
    getDepthFromSurface(worldX, worldY, worldZ, biome) {
        let depth = 0;
        let checkY = worldY + 1;
        
        // Check up to 10 blocks above
        while (depth < 10 && checkY < worldY + 10) {
            const density = this.getDensity(worldX, checkY, worldZ, biome);
            if (density <= 0) {
                return depth;
            }
            depth++;
            checkY++;
        }
        
        return -1; // Not near surface
    }
    
    // Get biome at position (placeholder - will be enhanced later)
    getBiome(worldX, worldZ) {
        // Simple biome determination based on position
        const biomeNoise = this.noise3D(worldX * 0.005, 0, worldZ * 0.005);
        
        if (biomeNoise < -0.3) return 'ocean';
        if (biomeNoise < 0) return 'plains';
        if (biomeNoise < 0.3) return 'hills';
        return 'mountains';
    }
}