// DEBUG: Agrega logs exhaustivos en el worker
self.onmessage = function(e) {
    console.log('[MeshWorker] Received:', e.data);
    const { id, data } = e.data;
    const { terrainData, chunkSize, x, z, lod } = data;
    
    try {
        console.log('[MeshWorker] Processing chunk', x, z, 'LOD:', lod);
        const blocks = new Uint8Array(terrainData);
        
        // Simular generación de mesh
        const meshData = {
            vertices: new Float32Array(0),
            normals: new Float32Array(0),
            colors: new Float32Array(0),
            indices: new Uint32Array(0),
            vertexCount: 0,
            faceCount: 0
        };

        console.log('[MeshWorker] Generated mesh data:', {
            vertexCount: meshData.vertexCount,
            faceCount: meshData.faceCount,
            dataSize: {
                vertices: meshData.vertices.byteLength,
                normals: meshData.normals.byteLength,
                colors: meshData.colors.byteLength,
                indices: meshData.indices.byteLength
            }
        });

        // Enviar resultado
        console.log('[MeshWorker] Sending result for', id);
        self.postMessage({
            id: id,
            result: {
                vertices: meshData.vertices.buffer,
                normals: meshData.normals.buffer,
                colors: meshData.colors.buffer,
                indices: meshData.indices.buffer,
                vertexCount: meshData.vertexCount,
                faceCount: meshData.faceCount,
                terrain: terrainData
            }
        }, [
            meshData.vertices.buffer,
            meshData.normals.buffer,
            meshData.colors.buffer,
            meshData.indices.buffer
        ]);

    } catch (error) {
        console.error('[MeshWorker] Error:', error);
        self.postMessage({
            id: id,
            error: error.message
        });
    }
};