# 🔍 Guía de Debug para Minecraft AI Voxel

## 📋 Logs Agregados

He añadido logs exhaustivos en puntos críticos del sistema. Aquí está cómo interpretar los logs en la consola de DevTools:

### 1. Main Loop (`main.js`)
```javascript
[Main] Initializing game...
[Main] Creating world instance...
[Main] Player position: {x: 0, y: 10, z: 0}
[Main] Performance stats: {fps: 60, chunks: 10/16...}
```

### 2. ChunkLoader (`ChunkLoader.js`)
```javascript
[ChunkLoader] update: playerPos=...
[ChunkLoader] Enqueue chunk...
[ChunkLoader] loadChunk...
[ChunkLoader] applyMeshData...
```

### 3. Workers
```javascript
[TerrainWorker] Received: {id: 1, data: {...}}
[TerrainWorker] Sending result...

[MeshWorker] Processing chunk x,z...
[MeshWorker] Generated mesh data...
```

### 4. WorkerPool
```javascript
[WorkerPool] Assign job 1 to worker 0
[WorkerPool] Worker completed job...
[WorkerPool] Error...
```

## 🔎 Cómo Debuggear

1. **Abre DevTools**
   - Chrome: F12 o Ctrl+Shift+I
   - Filtro: No filtres nada inicialmente

2. **Verifica Inicialización**
   - Busca `[Main] Initializing game`
   - Confirma que el renderer y la escena se crean

3. **Observa el Worker Pipeline**
   ```
   [ChunkLoader] update → 
   [TerrainWorker] Received → 
   [TerrainWorker] Sending → 
   [MeshWorker] Processing → 
   [ChunkLoader] applyMeshData
   ```

4. **Errores Comunes**
   - No se ven chunks: Verifica logs de TerrainWorker
   - 0 faces: Verifica logs de MeshWorker
   - Sin respuesta: Verifica logs de WorkerPool

## 🚨 Qué Buscar

### Errores de Workers
```javascript
// Error de inicialización
[WorkerPool] Error: Failed to load worker at URL...

// Error de ejecución
[TerrainWorker] Error: Cannot read property...
```

### Errores de Chunks
```javascript
// No se generan chunks
[ChunkLoader] calculateRequiredChunks: [] // Lista vacía = problema

// Chunks sin mesh
[MeshWorker] Generated mesh data: {vertexCount: 0} // 0 vértices = problema
```

### Errores de Rendimiento
```javascript
[Main] Performance stats: {
    fps: <30,     // Problema de rendimiento
    frameTime: >16 // Frame time alto
}
```

## 🛠️ Solución de Problemas

1. **Si no hay chunks visibles**
   - Verifica `[ChunkLoader] update`
   - Confirma que `calculateRequiredChunks` devuelve chunks
   - Verifica que los workers responden

2. **Si hay 0 faces**
   - Verifica `[MeshWorker]` logs
   - Confirma que el terrainData no está vacío
   - Verifica la generación de geometría

3. **Si los workers no responden**
   - Verifica la consola por errores de CORS
   - Confirma que las rutas a los workers son correctas
   - Verifica que los workers se inicializan

## 📊 Estadísticas Importantes

```javascript
[Main] Performance stats: {
    fps: 60,           // Debería ser ~60
    visibleChunks: 16, // Típicamente 16-25
    totalFaces: >0,    // Debe ser >0
    frameTime: <16     // Debe ser <16ms
}
```

## 🔧 Comandos Útiles para la Consola

```javascript
// Ver estado del mundo
world.getStats()

// Ver chunks activos
world.chunkLoader.activeChunks

// Ver workers activos
world.chunkLoader.terrainWorkerPool.getStats()
```

## 📱 Debug en Móvil

1. Conecta el móvil al PC
2. Chrome: `chrome://inspect`
3. Busca tu dispositivo
4. Los logs serán visibles en DevTools

---

Si necesitas ayuda interpretando algún error específico, por favor proporciona el log exacto que ves en la consola.