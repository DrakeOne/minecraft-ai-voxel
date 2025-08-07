/**
 * FastTerrainGenerator - Generador de terreno ultra-optimizado
 * Versión simplificada para máximo rendimiento
 */

export class FastTerrainGenerator {
    constructor(seed = 12345) {
        this.seed = seed;
        
        // Cache de alturas para evitar recálculos
        this.heightCache = new Map();
        this.biomeCache = new Map();
        
        // Configuración simplificada para velocidad
        this.seaLevel = 62;
        this.baseHeight = 64;
        
        // Escalas optimizadas (menos octavas = más rápido)
        this.biomeScale = 0.005;
        this.terrainScale = 0.02;
        this.caveScale = 0.04;
    }
    
    // Hash rápido para caché
    getHashKey(x, z) {
        return `${x},${z}`;
    }
    
    // Función de ruido ultra-rápida (sin interpolación suave)
    fastRandom(x, z) {
        const n = Math.sin(x * 12.9898 + z * 78.233 + this.seed) * 43758.5453;
        return (n - Math.floor(n));
    }
    
    // Ruido 2D simplificado (1 octava para velocidad)
    fastNoise2D(x, z, scale) {
        const sampleX = x * scale;
        const sampleZ = z * scale;
        
        const xi = Math.floor(sampleX);
        const zi = Math.floor(sampleZ);
        
        // Interpolación lineal simple (más rápida que smoothstep)
        const xf = sampleX - xi;
        const zf = sampleZ - zi;
        
        const aa = this.fastRandom(xi, zi);
        const ba = this.fastRandom(xi + 1, zi);
        const ab = this.fastRandom(xi, zi + 1);
        const bb = this.fastRandom(xi + 1, zi + 1);
        
        const x1 = aa + (ba - aa) * xf;
        const x2 = ab + (bb - ab) * xf;
        
        return (x1 + (x2 - x1) * zf) * 2 - 1;
    }
    
    // Obtener bioma (versión simplificada)
    getBiome(worldX, worldZ) {
        const key = this.getHashKey(worldX, worldZ);
        
        // Usar caché si existe
        if (this.biomeCache.has(key)) {
            return this.biomeCache.get(key);
        }
        
        // Cálculo simplificado de bioma
        const biomeNoise = this.fastNoise2D(worldX, worldZ, this.biomeScale);
        
        let biome;
        if (biomeNoise < -0.3) {
            biome = 'ocean';
        } else if (biomeNoise < 0) {
            biome = 'plains';
        } else if (biomeNoise < 0.4) {
            biome = 'hills';
        } else {
            biome = 'mountains';
        }
        
        // Guardar en caché
        this.biomeCache.set(key, biome);
        
        // Limpiar caché si crece demasiado
        if (this.biomeCache.size > 1000) {
            const firstKey = this.biomeCache.keys().next().value;
            this.biomeCache.delete(firstKey);
        }
        
        return biome;
    }
    
    // Obtener altura del terreno (versión ultra-rápida)
    getTerrainHeight(worldX, worldZ) {
        const key = this.getHashKey(worldX, worldZ);
        
        // Usar caché si existe
        if (this.heightCache.has(key)) {
            return this.heightCache.get(key);
        }
        
        const biome = this.getBiome(worldX, worldZ);
        
        // Altura base por bioma (simplificada)
        let baseHeight;
        let variation;
        
        switch(biome) {
            case 'ocean':
                baseHeight = 55;
                variation = 3;
                break;
            case 'plains':
                baseHeight = 63;
                variation = 2;
                break;
            case 'hills':
                baseHeight = 70;
                variation = 10;
                break;
            case 'mountains':
                baseHeight = 80;
                variation = 20;
                break;
            default:
                baseHeight = 63;
                variation = 3;
        }
        
        // Solo 1 octava de ruido para velocidad
        const terrainNoise = this.fastNoise2D(worldX, worldZ, this.terrainScale);
        const height = Math.floor(baseHeight + terrainNoise * variation);
        
        // Guardar en caché
        this.heightCache.set(key, height);
        
        // Limpiar caché si crece demasiado
        if (this.heightCache.size > 1000) {
            const firstKey = this.heightCache.keys().next().value;
            this.heightCache.delete(firstKey);
        }
        
        return height;
    }
    
    // Verificar cuevas (simplificado para velocidad)
    hasCave(worldX, worldY, worldZ) {
        // No generar cuevas cerca de la superficie
        if (worldY > 50) return false;
        
        // Cuevas simples con 1 capa de ruido
        const cave = this.fastNoise2D(worldX + worldY * 0.1, worldZ, this.caveScale);
        return cave > 0.75;
    }
    
    // Obtener bloque (versión optimizada)
    getBlockAt(worldX, worldY, worldZ) {
        const height = this.getTerrainHeight(worldX, worldZ);
        
        // Aire sobre el terreno
        if (worldY > height) {
            return 0; // Air
        }
        
        // Cuevas (solo bajo tierra)
        if (worldY < height - 2 && this.hasCave(worldX, worldY, worldZ)) {
            return 0; // Air
        }
        
        // Bedrock
        if (worldY <= 1) {
            return 3; // Stone
        }
        
        // Superficie
        if (worldY === height) {
            const biome = this.getBiome(worldX, worldZ);
            if (biome === 'ocean' && worldY < this.seaLevel) {
                return 2; // Dirt (será sand)
            }
            return 1; // Grass
        }
        
        // Subsuperficie
        if (worldY >= height - 3) {
            return 2; // Dirt
        }
        
        // El resto es piedra
        return 3; // Stone
    }
    
    // Generar chunk optimizado (solo la altura necesaria)
    generateChunkOptimized(chunkX, chunkZ, chunkSize, minY, maxY) {
        const height = maxY - minY;
        const blocks = new Uint8Array(chunkSize * height * chunkSize);
        
        // Pre-calcular alturas para todo el chunk
        const heights = new Array(chunkSize * chunkSize);
        for (let x = 0; x < chunkSize; x++) {
            for (let z = 0; z < chunkSize; z++) {
                const worldX = chunkX * chunkSize + x;
                const worldZ = chunkZ * chunkSize + z;
                heights[x + z * chunkSize] = this.getTerrainHeight(worldX, worldZ);
            }
        }
        
        // Generar bloques
        for (let x = 0; x < chunkSize; x++) {
            for (let z = 0; z < chunkSize; z++) {
                const worldX = chunkX * chunkSize + x;
                const worldZ = chunkZ * chunkSize + z;
                const terrainHeight = heights[x + z * chunkSize];
                
                for (let y = 0; y < height; y++) {
                    const worldY = minY + y;
                    const index = x + y * chunkSize + z * chunkSize * height;
                    
                    // Optimización: skip si está muy por encima del terreno
                    if (worldY > terrainHeight + 1) {
                        blocks[index] = 0;
                        continue;
                    }
                    
                    // Generación rápida sin muchos checks
                    if (worldY > terrainHeight) {
                        blocks[index] = 0; // Air
                    } else if (worldY === terrainHeight) {
                        blocks[index] = 1; // Grass
                    } else if (worldY >= terrainHeight - 3) {
                        blocks[index] = 2; // Dirt
                    } else {
                        // Check de cuevas solo bajo tierra
                        if (worldY < 50 && this.hasCave(worldX, worldY, worldZ)) {
                            blocks[index] = 0; // Air
                        } else {
                            blocks[index] = 3; // Stone
                        }
                    }
                }
            }
        }
        
        return blocks;
    }
    
    // Limpiar cachés
    clearCache() {
        this.heightCache.clear();
        this.biomeCache.clear();
    }
}