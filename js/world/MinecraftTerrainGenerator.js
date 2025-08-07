/**
 * MinecraftTerrainGenerator - Generador de terreno tipo Minecraft
 * Biomas: Plains, Desert, Forest, Mountains, Ocean
 * Sin agua por ahora, pero con preparación para lagos y océanos
 */

export class MinecraftTerrainGenerator {
    constructor(seed = 12345) {
        this.seed = seed;
        
        // Configuración de altura base por bioma
        this.biomeConfig = {
            ocean: {
                baseHeight: 48,      // Nivel del mar será 62, fondo a 48
                variation: 3,
                surfaceBlock: 2,     // Dirt (será sand cuando tengamos)
                subsurfaceBlock: 2,  // Dirt
                stoneLevel: 45
            },
            plains: {
                baseHeight: 63,      // Justo sobre el nivel del mar
                variation: 3,
                surfaceBlock: 1,     // Grass
                subsurfaceBlock: 2,  // Dirt
                stoneLevel: 59
            },
            desert: {
                baseHeight: 63,
                variation: 4,
                surfaceBlock: 2,     // Dirt (será sand cuando tengamos)
                subsurfaceBlock: 2,  // Dirt (será sandstone)
                stoneLevel: 58
            },
            forest: {
                baseHeight: 64,
                variation: 5,
                surfaceBlock: 1,     // Grass
                subsurfaceBlock: 2,  // Dirt
                stoneLevel: 59
            },
            hills: {
                baseHeight: 70,
                variation: 15,
                surfaceBlock: 1,     // Grass
                subsurfaceBlock: 2,  // Dirt
                stoneLevel: 65
            },
            mountains: {
                baseHeight: 85,
                variation: 30,
                surfaceBlock: 3,     // Stone (será snow en alturas)
                subsurfaceBlock: 3,  // Stone
                stoneLevel: 70
            }
        };
        
        // Nivel del mar (donde estará el agua)
        this.seaLevel = 62;
        
        // Escalas de ruido
        this.biomeScale = 0.004;      // Muy grande para biomas extensos
        this.terrainScale = 0.015;    // Escala principal del terreno
        this.detailScale = 0.05;      // Detalles pequeños
        this.caveScale = 0.03;        // Sistema de cuevas
    }
    
    // Función de ruido pseudo-aleatoria
    random(x, z, offset = 0) {
        const n = Math.sin((x + offset) * 12.9898 + (z + offset) * 78.233 + this.seed) * 43758.5453;
        return (n - Math.floor(n));
    }
    
    // Ruido 2D simplificado para terreno
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
            
            // Interpolación suave
            const u = xf * xf * (3 - 2 * xf);
            const v = zf * zf * (3 - 2 * zf);
            
            // Valores en las esquinas
            const aa = this.random(xi, zi, i);
            const ba = this.random(xi + 1, zi, i);
            const ab = this.random(xi, zi + 1, i);
            const bb = this.random(xi + 1, zi + 1, i);
            
            // Interpolar
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
    
    // Ruido 3D para cuevas
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
        
        // Valores en los vértices del cubo
        const aaa = this.random(xi, zi, yi);
        const aba = this.random(xi, zi, yi + 1);
        const aab = this.random(xi, zi + 1, yi);
        const abb = this.random(xi, zi + 1, yi + 1);
        const baa = this.random(xi + 1, zi, yi);
        const bba = this.random(xi + 1, zi, yi + 1);
        const bab = this.random(xi + 1, zi + 1, yi);
        const bbb = this.random(xi + 1, zi + 1, yi + 1);
        
        // Interpolación trilineal
        const x1 = aaa * (1 - u) + baa * u;
        const x2 = aba * (1 - u) + bba * u;
        const y1 = x1 * (1 - v) + x2 * v;
        
        const x3 = aab * (1 - u) + bab * u;
        const x4 = abb * (1 - u) + bbb * u;
        const y2 = x3 * (1 - v) + x4 * v;
        
        return (y1 * (1 - w) + y2 * w) * 2 - 1;
    }
    
    // Obtener bioma en una posición
    getBiome(worldX, worldZ) {
        // Usar ruido de gran escala para biomas
        const biomeNoise = this.noise2D(worldX, worldZ, this.biomeScale, 2);
        const moistureNoise = this.noise2D(worldX + 1000, worldZ + 1000, this.biomeScale, 2);
        
        // Clasificar biomas basado en "temperatura" y "humedad"
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
    
    // Obtener altura del terreno en una posición
    getTerrainHeight(worldX, worldZ) {
        const biome = this.getBiome(worldX, worldZ);
        const config = this.biomeConfig[biome];
        
        // Altura base del bioma
        let height = config.baseHeight;
        
        // Ruido principal del terreno (múltiples octavas)
        const terrainNoise = this.noise2D(worldX, worldZ, this.terrainScale, 4);
        height += terrainNoise * config.variation;
        
        // Detalles adicionales
        const detailNoise = this.noise2D(worldX, worldZ, this.detailScale, 2);
        height += detailNoise * 2;
        
        // Transición suave entre biomas
        const transitionRange = 8;
        let finalHeight = height;
        let totalWeight = 1;
        
        // Muestrear biomas cercanos para transiciones suaves
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
    
    // Verificar si hay una cueva en esta posición
    hasCave(worldX, worldY, worldZ) {
        // No generar cuevas muy cerca de la superficie
        const height = this.getTerrainHeight(worldX, worldZ);
        if (worldY > height - 5) return false;
        
        // Sistema de cuevas tipo Minecraft
        const cave1 = this.noise3D(worldX, worldY, worldZ, this.caveScale);
        const cave2 = this.noise3D(worldX, worldY * 1.5, worldZ, this.caveScale * 1.4);
        
        // Cuevas grandes (tipo ravines)
        if (worldY < 40) {
            const ravine = this.noise3D(worldX * 0.01, worldY * 0.1, worldZ * 0.01, 1);
            if (Math.abs(ravine) < 0.05) return true;
        }
        
        // Cuevas normales
        return cave1 > 0.7 || cave2 > 0.7 || (cave1 > 0.4 && cave2 > 0.4);
    }
    
    // Obtener el tipo de bloque en una posición
    getBlockAt(worldX, worldY, worldZ) {
        const height = this.getTerrainHeight(worldX, worldZ);
        const biome = this.getBiome(worldX, worldZ);
        const config = this.biomeConfig[biome];
        
        // Aire sobre el terreno
        if (worldY > height) {
            return 0; // Air
        }
        
        // Verificar cuevas
        if (this.hasCave(worldX, worldY, worldZ)) {
            return 0; // Air
        }
        
        // Bedrock en el fondo
        if (worldY <= 1) {
            return 3; // Stone (será bedrock)
        }
        
        // Capa de piedra profunda
        if (worldY < config.stoneLevel) {
            return 3; // Stone
        }
        
        // Superficie
        if (worldY === height) {
            // En océanos, el fondo es diferente
            if (biome === 'ocean' && worldY < this.seaLevel) {
                return 2; // Dirt (será sand)
            }
            // En montañas altas, usar piedra
            if (biome === 'mountains' && worldY > 90) {
                return 3; // Stone (será snow)
            }
            return config.surfaceBlock;
        }
        
        // Subsuperficie (3-4 bloques bajo la superficie)
        if (worldY >= height - 4) {
            return config.subsurfaceBlock;
        }
        
        // El resto es piedra
        return 3; // Stone
    }
    
    // Generar chunk completo (para workers)
    generateChunk(chunkX, chunkZ, chunkSize, chunkHeight) {
        const blocks = new Uint8Array(chunkSize * chunkHeight * chunkSize);
        
        for (let x = 0; x < chunkSize; x++) {
            for (let z = 0; z < chunkSize; z++) {
                const worldX = chunkX * chunkSize + x;
                const worldZ = chunkZ * chunkSize + z;
                
                for (let y = 0; y < chunkHeight; y++) {
                    const worldY = y;
                    const index = x + y * chunkSize + z * chunkSize * chunkHeight;
                    
                    blocks[index] = this.getBlockAt(worldX, worldY, worldZ);
                }
            }
        }
        
        return blocks;
    }
    
    // Información de debug sobre el bioma
    getBiomeInfo(worldX, worldZ) {
        const biome = this.getBiome(worldX, worldZ);
        const height = this.getTerrainHeight(worldX, worldZ);
        
        return {
            biome: biome,
            height: height,
            seaLevel: this.seaLevel,
            isUnderwater: height < this.seaLevel
        };
    }
}