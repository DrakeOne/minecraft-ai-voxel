// DEBUG: Agrega logs exhaustivos en el worker
self.onmessage = function(e) {
    console.log('[TerrainWorker] Received:', e.data);
    const { id, data } = e.data;
    const { x, z, chunkSize, seed, lod } = data;
    try {
        // ... (resto del código de generación)
        // Simulación de generación
        const blocks = new Uint8Array(chunkSize * chunkSize * chunkSize);
        // ...
        console.log('[TerrainWorker] Sending result for', id);
        self.postMessage({
            id: id,
            result: {
                buffer: blocks.buffer,
                x: x,
                z: z
            }
        }, [blocks.buffer]);
    } catch (error) {
        console.error('[TerrainWorker] Error:', error);
        self.postMessage({
            id: id,
            error: error.message
        });
    }
};