/**
 * Priority Queue for chunk loading
 * Uses a min-heap for efficient priority-based operations
 */
export class ChunkPriorityQueue {
    constructor() {
        this.heap = [];
        this.chunkMap = new Map(); // For O(1) lookups
    }

    /**
     * Add or update a chunk in the queue
     */
    enqueue(chunkData) {
        const key = chunkData.key;
        
        // Check if already exists
        if (this.chunkMap.has(key)) {
            this.updatePriority(key, chunkData.priority);
            return;
        }
        
        // Add new chunk
        const index = this.heap.length;
        this.heap.push(chunkData);
        this.chunkMap.set(key, index);
        this.bubbleUp(index);
    }

    /**
     * Remove and return the highest priority chunk
     */
    dequeue() {
        if (this.heap.length === 0) return null;
        
        const result = this.heap[0];
        const end = this.heap.pop();
        
        if (this.heap.length > 0) {
            this.heap[0] = end;
            this.chunkMap.set(end.key, 0);
            this.bubbleDown(0);
        }
        
        this.chunkMap.delete(result.key);
        return result;
    }

    /**
     * Update priority of existing chunk
     */
    updatePriority(key, newPriority) {
        if (!this.chunkMap.has(key)) return;
        
        const index = this.chunkMap.get(key);
        const oldPriority = this.heap[index].priority;
        this.heap[index].priority = newPriority;
        
        // Re-heapify based on priority change
        if (newPriority < oldPriority) {
            this.bubbleUp(index);
        } else if (newPriority > oldPriority) {
            this.bubbleDown(index);
        }
    }

    /**
     * Check if queue contains a chunk
     */
    contains(key) {
        return this.chunkMap.has(key);
    }

    /**
     * Get current size
     */
    size() {
        return this.heap.length;
    }

    /**
     * Check if empty
     */
    isEmpty() {
        return this.heap.length === 0;
    }

    /**
     * Clear the queue
     */
    clear() {
        this.heap = [];
        this.chunkMap.clear();
    }

    /**
     * Peek at highest priority without removing
     */
    peek() {
        return this.heap.length > 0 ? this.heap[0] : null;
    }

    /**
     * Get all chunks sorted by priority
     */
    toArray() {
        return [...this.heap].sort((a, b) => a.priority - b.priority);
    }

    /**
     * Bubble up element to maintain heap property
     */
    bubbleUp(index) {
        const element = this.heap[index];
        
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            const parent = this.heap[parentIndex];
            
            if (element.priority >= parent.priority) break;
            
            // Swap with parent
            this.heap[index] = parent;
            this.chunkMap.set(parent.key, index);
            index = parentIndex;
        }
        
        this.heap[index] = element;
        this.chunkMap.set(element.key, index);
    }

    /**
     * Bubble down element to maintain heap property
     */
    bubbleDown(index) {
        const length = this.heap.length;
        const element = this.heap[index];
        
        while (true) {
            const leftChildIdx = 2 * index + 1;
            const rightChildIdx = 2 * index + 2;
            let swapIdx = null;
            
            // Check left child
            if (leftChildIdx < length) {
                const leftChild = this.heap[leftChildIdx];
                if (leftChild.priority < element.priority) {
                    swapIdx = leftChildIdx;
                }
            }
            
            // Check right child
            if (rightChildIdx < length) {
                const rightChild = this.heap[rightChildIdx];
                if (rightChild.priority < (swapIdx === null ? element.priority : this.heap[swapIdx].priority)) {
                    swapIdx = rightChildIdx;
                }
            }
            
            // No swap needed
            if (swapIdx === null) break;
            
            // Perform swap
            this.heap[index] = this.heap[swapIdx];
            this.chunkMap.set(this.heap[index].key, index);
            index = swapIdx;
        }
        
        this.heap[index] = element;
        this.chunkMap.set(element.key, index);
    }

    /**
     * Remove specific chunk by key
     */
    remove(key) {
        if (!this.chunkMap.has(key)) return false;
        
        const index = this.chunkMap.get(key);
        const element = this.heap[index];
        const end = this.heap.pop();
        
        if (index !== this.heap.length) {
            this.heap[index] = end;
            this.chunkMap.set(end.key, index);
            
            // Re-heapify
            if (end.priority < element.priority) {
                this.bubbleUp(index);
            } else {
                this.bubbleDown(index);
            }
        }
        
        this.chunkMap.delete(key);
        return true;
    }

    /**
     * Get statistics about the queue
     */
    getStats() {
        if (this.heap.length === 0) {
            return {
                size: 0,
                minPriority: null,
                maxPriority: null,
                avgPriority: null
            };
        }
        
        let min = Infinity;
        let max = -Infinity;
        let sum = 0;
        
        for (const chunk of this.heap) {
            min = Math.min(min, chunk.priority);
            max = Math.max(max, chunk.priority);
            sum += chunk.priority;
        }
        
        return {
            size: this.heap.length,
            minPriority: min,
            maxPriority: max,
            avgPriority: sum / this.heap.length
        };
    }

    /**
     * Rebalance the entire heap (useful after bulk updates)
     */
    rebalance() {
        // Build heap from bottom up
        for (let i = Math.floor(this.heap.length / 2) - 1; i >= 0; i--) {
            this.bubbleDown(i);
        }
    }

    /**
     * Filter chunks by a predicate
     */
    filter(predicate) {
        const toRemove = [];
        
        for (const chunk of this.heap) {
            if (!predicate(chunk)) {
                toRemove.push(chunk.key);
            }
        }
        
        for (const key of toRemove) {
            this.remove(key);
        }
    }

    /**
     * Debug visualization of heap structure
     */
    visualize() {
        if (this.heap.length === 0) return 'Empty heap';
        
        const levels = [];
        let level = 0;
        let levelNodes = 1;
        let index = 0;
        
        while (index < this.heap.length) {
            const currentLevel = [];
            for (let i = 0; i < levelNodes && index < this.heap.length; i++) {
                currentLevel.push(`${this.heap[index].key}:${this.heap[index].priority.toFixed(2)}`);
                index++;
            }
            levels.push(currentLevel);
            level++;
            levelNodes *= 2;
        }
        
        return levels.map((level, i) => {
            const indent = ' '.repeat((levels.length - i - 1) * 2);
            return indent + level.join('  ');
        }).join('\n');
    }
}