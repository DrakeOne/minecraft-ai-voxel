// Generador de terreno tipo Minecraft con biomas y cuevas
export class MinecraftTerrainGenerator {
    constructor(seed = 12345) {
        this.seed = seed;
        this.biomeConfig = {
            ocean: { baseHeight: 48, variation: 3, surfaceBlock: 2, subsurfaceBlock: 2, stoneLevel: 45 },
            plains: { baseHeight: 63, variation: 3, surfaceBlock: 1, subsurfaceBlock: 2, stoneLevel: 59 },
            desert: { baseHeight: 63, variation: 4, surfaceBlock: 2, subsurfaceBlock: 2, stoneLevel: 58 },
            forest: { baseHeight: 64, variation: 5, surfaceBlock: 1, subsurfaceBlock: 2, stoneLevel: 59 },
            hills: { baseHeight: 70, variation: 15, surfaceBlock: 1, subsurfaceBlock: 2, stoneLevel: 65 },
            mountains: { baseHeight: 85, variation: 30, surfaceBlock: 3, subsurfaceBlock: 3, stoneLevel: 70 }
        };
        this.seaLevel = 62;
        this.biomeScale = 0.004;
        this.terrainScale = 0.015;
        this.detailScale = 0.05;
        this.caveScale = 0.03;
    }
    random(x, z, offset = 0) {
        const n = Math.sin((x + offset) * 12.9898 + (z + offset) * 78.233 + this.seed) * 43758.5453;
        return (n - Math.floor(n));
    }
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
            const u = xf * xf * (3 - 2 * xf);
            const v = zf * zf * (3 - 2 * zf);
            const aa = this.random(xi, zi, i);
            const ba = this.random(xi + 1, zi, i);
            const ab = this.random(xi, zi + 1, i);
            const bb = this.random(xi + 1, zi + 1, i);
            const x1 = aa + (ba - aa) * xf;
            const x2 = ab + (bb - ab) * xf;
            const result = x1 * (1 - u) + x2 * (1 - v);
            value += result * amplitude;
            maxValue += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        return (value / maxValue) * 2 - 1;
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
        const aaa = this.random(xi, zi, yi);
        const aba = this.random(xi, zi, yi + 1);
        const aab = this.random(xi, zi + 1, yi);
        const abb = this.random(xi, zi + 1, yi + 1);
        const baa = this.random(xi + 1, zi, yi);
        const bba = this.random(xi + 1, zi, yi + 1);
        const bab = this.random(xi + 1, zi + 1, yi);
        const bbb = this.random(xi + 1, zi + 1, yi + 1);
        const x1 = aaa * (1 - u) + baa * u;
        const x2 = aba * (1 - u) + bba * u;
        const y1 = x1 * (1 - v) + x2 * v;
        const x3 = aab * (1 - u) + bab * (u);
        const x4 = abb * (1 - u) + bbb * u;
        const y2 = x3 * (1 - v) + x4 * v;
        return (y1 * (1 - w) + y2 * w) * 2 - 1;
    }
    getBiome(worldX, worldZ) {
        const biomeNoise = this.noise2D(worldX, worldZ, this.biomeScale, 2);
        if (biomeNoise < -0.3) return 'ocean';
        if (biomeNoise < 0) return 'plains';
        if (biomeNoise < 0.4) return 'hills';
        return 'mountains';
    }
    getTerrainHeight(worldX, worldZ) {
        const biome = this.getBiome(worldX, worldZ);
        let baseHeight;
        let variation;
        switch (biome) {
            case 'ocean':
                baseHeight = 48;
                variation = 3;
                break;
            case 'plains':
                baseHeight = 63;
                variation = 3;
                break;
            case 'desert':
                baseHeight = 63;
                variation = 4;
                break;
            case 'forest':
                baseHeight = 64;
                variation = 5;
                break;
            case 'hills':
                baseHeight = 70;
                variation = 15;
                break;
            case 'mountains':
                baseHeight = 85;
                variation = 30;
                break;
            default:
                baseHeight = 63;
                variation = 3;
        }
        const terrainNoise = this.noise2D(worldX, worldZ, this.terrainScale, 4);
        const height = Math.floor(baseHeight + terrainNoise * variation);
        return height;
    }
}
