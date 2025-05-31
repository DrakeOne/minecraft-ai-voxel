import { config, stats } from './config.js';
import { World } from './world/World.js';
import { Player } from './player/Player.js';
import { InputHandler } from './input/InputHandler.js';

// Initialize Three.js
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87CEEB, 10, config.chunkSize * config.renderDistance * 1.5);
scene.background = new THREE.Color(0x87CEEB);

// Camera setup
const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);

// Renderer setup with optimizations
const canvas = document.getElementById('gameCanvas');
const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: "high-performance",
    alpha: false,
    stencil: false,
    depth: true
});

// Make renderer globally accessible for resize handler
window.renderer = renderer;

// Ensure proper sizing
function updateRendererSize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}

updateRendererSize();

// Enable optimizations
renderer.shadowMap.enabled = false;
renderer.sortObjects = true;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(50, 100, 50);
scene.add(directionalLight);

// Initialize game objects - UPDATED to pass scene to World
const world = new World(scene);
const player = new Player(world);
const inputHandler = new InputHandler(canvas, player, world, camera, scene);

// Prevent iOS bounce and ensure proper sizing
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());

// Performance monitoring
let showAdvancedStats = false;

// Toggle advanced stats with 'F3' key
document.addEventListener('keydown', (e) => {
    if (e.key === 'F3') {
        e.preventDefault();
        showAdvancedStats = !showAdvancedStats;
    }
});

// Game loop
let lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);
    
    const currentTime = performance.now();
    const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.1);
    lastTime = currentTime;

    // Update FPS counter
    stats.frameTime = currentTime - stats.lastTime;
    stats.fps = Math.round(1000 / stats.frameTime);
    stats.lastTime = currentTime;

    // Update game
    const input = inputHandler.getInput();
    player.update(deltaTime, input, camera);
    world.updateChunksAroundPlayer(player.position.x, player.position.z, camera, scene);

    // Update HUD
    document.getElementById('fps').textContent = `FPS: ${stats.fps}`;
    document.getElementById('coords').textContent = 
        `X: ${Math.floor(player.position.x)} Y: ${Math.floor(player.position.y)} Z: ${Math.floor(player.position.z)}`;
    
    // Update debug info
    if (showAdvancedStats && world.useAdvancedLoader) {
        const worldStats = world.getStats();
        document.getElementById('debug').innerHTML = 
            `Chunks: ${stats.visibleChunks}/${stats.totalChunks}<br>` +
            `Pool: ${worldStats.poolStats?.currentlyInUse || 0}/${worldStats.poolStats?.created || 0}<br>` +
            `Cache: ${Math.round((worldStats.cacheStats?.hitRate || 0) * 100)}% hit<br>` +
            `Workers: ${worldStats.busyWorkers || 0}/${worldStats.poolSize || 0}`;
    } else {
        document.getElementById('debug').textContent = 
            `Faces: ${stats.totalFaces} | Chunks: ${stats.visibleChunks}/${stats.totalChunks}`;
    }

    // Render
    renderer.render(scene, camera);
}

// Start game
window.addEventListener('load', () => {
    // Hide loading screen
    setTimeout(() => {
        const loadingProgress = document.getElementById('loadingProgress');
        if (loadingProgress) {
            loadingProgress.style.width = '100%';
        }
        setTimeout(() => {
            const loading = document.getElementById('loading');
            if (loading) {
                loading.style.display = 'none';
            }
            
            // Log system info
            console.log('=== Minecraft AI Voxel ===');
            console.log('Advanced Chunk System:', world.useAdvancedLoader ? 'ENABLED' : 'DISABLED');
            console.log('Worker Threads:', navigator.hardwareConcurrency || 4);
            console.log('Render Distance:', config.renderDistance);
            console.log('Chunk Size:', config.chunkSize);
            console.log('Press F3 for advanced stats');
            
            animate();
        }, 300);
    }, 100);
});

// Handle window resize
window.addEventListener('resize', updateRendererSize);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (world.dispose) {
        world.dispose();
    }
});