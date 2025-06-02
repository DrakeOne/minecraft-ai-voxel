// DebugOverlay.js - F3 debug information display
export class DebugOverlay {
    constructor(world, player) {
        this.world = world;
        this.player = player;
        this.visible = false;
        this.lastUpdate = 0;
        this.updateInterval = 100; // Update every 100ms
        
        // Create overlay element
        this.overlay = document.createElement('div');
        this.overlay.id = 'debugOverlay';
        this.overlay.className = 'debug-overlay';
        this.overlay.style.display = 'none';
        document.body.appendChild(this.overlay);
        
        // Listen for F3 key
        document.addEventListener('keydown', (e) => {
            if (e.code === 'F3') {
                this.toggle();
            }
        });
    }
    
    toggle() {
        this.visible = !this.visible;
        this.overlay.style.display = this.visible ? 'block' : 'none';
    }
    
    update(fps) {
        if (!this.visible) return;
        
        const now = performance.now();
        if (now - this.lastUpdate < this.updateInterval) return;
        this.lastUpdate = now;
        
        // Get player position and rotation
        const pos = this.player.position;
        const rot = this.player.rotation;
        
        // Get chunk coordinates
        const chunkX = Math.floor(pos.x / 16);
        const chunkZ = Math.floor(pos.z / 16);
        
        // Get world stats
        const worldStats = this.world.getStats();
        
        // Get memory usage
        const memory = performance.memory ? {
            used: Math.round(performance.memory.usedJSHeapSize / 1048576),
            total: Math.round(performance.memory.totalJSHeapSize / 1048576)
        } : null;
        
        // Format debug info
        const info = [
            `FPS: ${fps}`,
            `XYZ: ${pos.x.toFixed(2)} / ${pos.y.toFixed(2)} / ${pos.z.toFixed(2)}`,
            `Block: ${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}`,
            `Chunk: ${chunkX} ${chunkZ}`,
            `Facing: ${this.getFacing(rot.y)} (${(rot.y * 180 / Math.PI).toFixed(1)}°)`,
            `Pitch: ${(-rot.x * 180 / Math.PI).toFixed(1)}°`,
            '',
            `Chunks: ${worldStats.visibleChunks}/${worldStats.totalChunks} loaded`,
            `Faces: ${worldStats.totalFaces}`,
            `Workers: ${this.world.workerManager ? (this.world.workerManager.isEnabled() ? 'enabled' : 'disabled') : 'n/a'}`,
            `Flying: ${this.player.isFlying ? 'yes' : 'no'}`,
            '',
            `Seed: ${this.world.seed}`,
            `Render Distance: ${config.renderDistance} chunks`,
            memory ? `Memory: ${memory.used}MB / ${memory.total}MB` : ''
        ].filter(line => line !== null).join('\n');
        
        this.overlay.textContent = info;
    }
    
    getFacing(yaw) {
        // Convert yaw to 0-360 degrees
        let degrees = (yaw * 180 / Math.PI) % 360;
        if (degrees < 0) degrees += 360;
        
        // Convert to cardinal direction
        const directions = ['South', 'West', 'North', 'East'];
        const index = Math.round(degrees / 90) % 4;
        return directions[index];
    }
    
    dispose() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
    }
}