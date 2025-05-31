/**
 * Worker Pool Manager
 * Manages a pool of web workers for parallel processing
 */
export class WorkerPool {
    constructor(workerScript, poolSize = navigator.hardwareConcurrency || 4) {
        this.workerScript = workerScript;
        this.poolSize = Math.min(poolSize, 8); // Cap at 8 workers
        this.workers = [];
        this.availableWorkers = [];
        this.taskQueue = [];
        this.activeJobs = new Map();
        this.jobIdCounter = 0;
        
        // Statistics
        this.stats = {
            totalJobs: 0,
            completedJobs: 0,
            failedJobs: 0,
            averageTime: 0,
            peakQueueSize: 0
        };
        
        this.initializeWorkers();
    }

    /**
     * Initialize worker pool
     */
    initializeWorkers() {
        for (let i = 0; i < this.poolSize; i++) {
            const worker = new Worker(this.workerScript, { type: 'module' });
            const workerInfo = {
                id: i,
                worker: worker,
                busy: false,
                currentJob: null
            };
            
            // Setup message handler
            worker.onmessage = (e) => this.handleWorkerMessage(workerInfo, e);
            worker.onerror = (e) => this.handleWorkerError(workerInfo, e);
            
            this.workers.push(workerInfo);
            this.availableWorkers.push(workerInfo);
        }
    }

    /**
     * Execute a job on the worker pool
     */
    execute(data, transferables = []) {
        return new Promise((resolve, reject) => {
            const jobId = this.jobIdCounter++;
            const job = {
                id: jobId,
                data: data,
                transferables: transferables,
                resolve: resolve,
                reject: reject,
                startTime: performance.now(),
                retries: 0,
                maxRetries: 2
            };
            
            this.stats.totalJobs++;
            
            // Try to assign immediately
            const worker = this.getAvailableWorker();
            if (worker) {
                this.assignJobToWorker(job, worker);
            } else {
                // Queue the job
                this.taskQueue.push(job);
                this.stats.peakQueueSize = Math.max(this.stats.peakQueueSize, this.taskQueue.length);
            }
        });
    }

    /**
     * Get an available worker
     */
    getAvailableWorker() {
        return this.availableWorkers.shift() || null;
    }

    /**
     * Assign job to worker
     */
    assignJobToWorker(job, workerInfo) {
        workerInfo.busy = true;
        workerInfo.currentJob = job;
        this.activeJobs.set(job.id, workerInfo);
        
        // Send message to worker
        try {
            workerInfo.worker.postMessage({
                id: job.id,
                data: job.data
            }, job.transferables);
        } catch (error) {
            // Handle transfer error
            this.handleJobError(job, workerInfo, error);
        }
    }

    /**
     * Handle message from worker
     */
    handleWorkerMessage(workerInfo, event) {
        const { id, result, error } = event.data;
        const job = workerInfo.currentJob;
        
        if (!job || job.id !== id) {
            console.warn('Received message for unknown job:', id);
            return;
        }
        
        // Calculate job time
        const jobTime = performance.now() - job.startTime;
        this.updateStats(jobTime, !error);
        
        // Clean up
        this.activeJobs.delete(job.id);
        workerInfo.busy = false;
        workerInfo.currentJob = null;
        
        // Handle result
        if (error) {
            this.handleJobError(job, workerInfo, new Error(error));
        } else {
            job.resolve(result);
            this.stats.completedJobs++;
        }
        
        // Make worker available again
        this.availableWorkers.push(workerInfo);
        
        // Process next job in queue
        this.processQueue();
    }

    /**
     * Handle worker error
     */
    handleWorkerError(workerInfo, error) {
        console.error(`Worker ${workerInfo.id} error:`, error);
        
        const job = workerInfo.currentJob;
        if (job) {
            this.handleJobError(job, workerInfo, error);
        }
        
        // Restart worker
        this.restartWorker(workerInfo);
    }

    /**
     * Handle job error with retry logic
     */
    handleJobError(job, workerInfo, error) {
        job.retries++;
        
        if (job.retries <= job.maxRetries) {
            console.warn(`Retrying job ${job.id} (attempt ${job.retries})`);
            
            // Reset worker state
            workerInfo.busy = false;
            workerInfo.currentJob = null;
            this.availableWorkers.push(workerInfo);
            
            // Requeue job
            this.taskQueue.unshift(job);
            this.processQueue();
        } else {
            // Max retries exceeded
            job.reject(error);
            this.stats.failedJobs++;
            
            // Clean up
            this.activeJobs.delete(job.id);
            workerInfo.busy = false;
            workerInfo.currentJob = null;
            this.availableWorkers.push(workerInfo);
            
            this.processQueue();
        }
    }

    /**
     * Process queued jobs
     */
    processQueue() {
        while (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
            const job = this.taskQueue.shift();
            const worker = this.getAvailableWorker();
            
            if (worker) {
                this.assignJobToWorker(job, worker);
            } else {
                // Put job back
                this.taskQueue.unshift(job);
                break;
            }
        }
    }

    /**
     * Restart a worker
     */
    restartWorker(workerInfo) {
        // Terminate old worker
        workerInfo.worker.terminate();
        
        // Create new worker
        const newWorker = new Worker(this.workerScript, { type: 'module' });
        newWorker.onmessage = (e) => this.handleWorkerMessage(workerInfo, e);
        newWorker.onerror = (e) => this.handleWorkerError(workerInfo, e);
        
        workerInfo.worker = newWorker;
        workerInfo.busy = false;
        workerInfo.currentJob = null;
        
        // Make available if not already
        if (!this.availableWorkers.includes(workerInfo)) {
            this.availableWorkers.push(workerInfo);
        }
    }

    /**
     * Update statistics
     */
    updateStats(jobTime, success) {
        if (success) {
            const totalTime = this.stats.averageTime * this.stats.completedJobs + jobTime;
            this.stats.averageTime = totalTime / (this.stats.completedJobs + 1);
        }
    }

    /**
     * Get pool statistics
     */
    getStats() {
        return {
            ...this.stats,
            poolSize: this.poolSize,
            busyWorkers: this.workers.filter(w => w.busy).length,
            queueSize: this.taskQueue.length,
            activeJobs: this.activeJobs.size
        };
    }

    /**
     * Terminate all workers
     */
    terminate() {
        // Cancel all pending jobs
        for (const job of this.taskQueue) {
            job.reject(new Error('Worker pool terminated'));
        }
        this.taskQueue = [];
        
        // Cancel active jobs
        for (const [jobId, workerInfo] of this.activeJobs) {
            if (workerInfo.currentJob) {
                workerInfo.currentJob.reject(new Error('Worker pool terminated'));
            }
        }
        this.activeJobs.clear();
        
        // Terminate all workers
        for (const workerInfo of this.workers) {
            workerInfo.worker.terminate();
        }
        
        this.workers = [];
        this.availableWorkers = [];
    }

    /**
     * Resize the worker pool
     */
    resize(newSize) {
        newSize = Math.min(Math.max(1, newSize), 16); // Clamp between 1 and 16
        
        if (newSize > this.poolSize) {
            // Add workers
            for (let i = this.poolSize; i < newSize; i++) {
                const worker = new Worker(this.workerScript, { type: 'module' });
                const workerInfo = {
                    id: i,
                    worker: worker,
                    busy: false,
                    currentJob: null
                };
                
                worker.onmessage = (e) => this.handleWorkerMessage(workerInfo, e);
                worker.onerror = (e) => this.handleWorkerError(workerInfo, e);
                
                this.workers.push(workerInfo);
                this.availableWorkers.push(workerInfo);
            }
        } else if (newSize < this.poolSize) {
            // Remove workers
            const toRemove = this.poolSize - newSize;
            for (let i = 0; i < toRemove; i++) {
                // Try to remove idle workers first
                const idleIndex = this.workers.findIndex(w => !w.busy && w.id >= newSize);
                if (idleIndex !== -1) {
                    const worker = this.workers.splice(idleIndex, 1)[0];
                    worker.worker.terminate();
                    
                    // Remove from available list
                    const availIndex = this.availableWorkers.indexOf(worker);
                    if (availIndex !== -1) {
                        this.availableWorkers.splice(availIndex, 1);
                    }
                }
            }
        }
        
        this.poolSize = this.workers.length;
    }

    /**
     * Execute batch of jobs
     */
    async executeBatch(jobs, transferables = []) {
        const promises = jobs.map((job, index) => {
            const transfer = transferables[index] || [];
            return this.execute(job, transfer);
        });
        
        return Promise.all(promises);
    }
}