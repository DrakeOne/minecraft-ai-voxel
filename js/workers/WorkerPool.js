// DEBUG: Agrega logs exhaustivos en cada función clave
export class WorkerPool {
    constructor(workerScript, poolSize = navigator.hardwareConcurrency || 4) {
        this.workerScript = workerScript;
        this.poolSize = Math.min(poolSize, 8);
        this.workers = [];
        this.availableWorkers = [];
        this.taskQueue = [];
        this.activeJobs = new Map();
        this.jobIdCounter = 0;
        this.stats = {
            totalJobs: 0,
            completedJobs: 0,
            failedJobs: 0,
            averageTime: 0,
            peakQueueSize: 0
        };
        this.initializeWorkers();
    }

    initializeWorkers() {
        for (let i = 0; i < this.poolSize; i++) {
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
        console.log('[WorkerPool] Initialized', this.poolSize, 'workers for', this.workerScript);
    }

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
            const worker = this.getAvailableWorker();
            if (worker) {
                this.assignJobToWorker(job, worker);
            } else {
                this.taskQueue.push(job);
                this.stats.peakQueueSize = Math.max(this.stats.peakQueueSize, this.taskQueue.length);
            }
            console.log('[WorkerPool] Job enqueued', jobId, 'for', this.workerScript);
        });
    }

    getAvailableWorker() {
        return this.availableWorkers.shift() || null;
    }

    assignJobToWorker(job, workerInfo) {
        workerInfo.busy = true;
        workerInfo.currentJob = job;
        this.activeJobs.set(job.id, workerInfo);
        try {
            workerInfo.worker.postMessage({
                id: job.id,
                data: job.data
            }, job.transferables);
            console.log('[WorkerPool] Assign job', job.id, 'to worker', workerInfo.id);
        } catch (error) {
            this.handleJobError(job, workerInfo, error);
        }
    }

    handleWorkerMessage(workerInfo, event) {
        const { id, result, error } = event.data;
        const job = workerInfo.currentJob;
        if (!job || job.id !== id) {
            console.warn('[WorkerPool] Received message for unknown job:', id);
            return;
        }
        const jobTime = performance.now() - job.startTime;
        this.updateStats(jobTime, !error);
        this.activeJobs.delete(job.id);
        workerInfo.busy = false;
        workerInfo.currentJob = null;
        if (error) {
            this.handleJobError(job, workerInfo, new Error(error));
        } else {
            job.resolve(result);
            this.stats.completedJobs++;
            console.log('[WorkerPool] Worker', workerInfo.id, 'completed job', job.id, 'result:', result);
        }
        this.availableWorkers.push(workerInfo);
        this.processQueue();
    }

    handleWorkerError(workerInfo, error) {
        console.error('[WorkerPool] Worker', workerInfo.id, 'error:', error);
        const job = workerInfo.currentJob;
        if (job) {
            this.handleJobError(job, workerInfo, error);
        }
        this.restartWorker(workerInfo);
    }

    handleJobError(job, workerInfo, error) {
        job.retries++;
        if (job.retries <= job.maxRetries) {
            console.warn('[WorkerPool] Retrying job', job.id, 'attempt', job.retries);
            workerInfo.busy = false;
            workerInfo.currentJob = null;
            this.availableWorkers.push(workerInfo);
            this.taskQueue.unshift(job);
            this.processQueue();
        } else {
            job.reject(error);
            this.stats.failedJobs++;
            this.activeJobs.delete(job.id);
            workerInfo.busy = false;
            workerInfo.currentJob = null;
            this.availableWorkers.push(workerInfo);
            this.processQueue();
        }
    }

    processQueue() {
        while (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
            const job = this.taskQueue.shift();
            const worker = this.getAvailableWorker();
            if (worker) {
                this.assignJobToWorker(job, worker);
            } else {
                this.taskQueue.unshift(job);
                break;
            }
        }
    }

    restartWorker(workerInfo) {
        workerInfo.worker.terminate();
        const newWorker = new Worker(this.workerScript, { type: 'module' });
        newWorker.onmessage = (e) => this.handleWorkerMessage(workerInfo, e);
        newWorker.onerror = (e) => this.handleWorkerError(workerInfo, e);
        workerInfo.worker = newWorker;
        workerInfo.busy = false;
        workerInfo.currentJob = null;
        if (!this.availableWorkers.includes(workerInfo)) {
            this.availableWorkers.push(workerInfo);
        }
        console.warn('[WorkerPool] Restarting worker', workerInfo.id);
    }

    updateStats(jobTime, success) {
        if (success) {
            const totalTime = this.stats.averageTime * this.stats.completedJobs + jobTime;
            this.stats.averageTime = totalTime / (this.stats.completedJobs + 1);
        }
    }

    getStats() {
        return {
            ...this.stats,
            poolSize: this.poolSize,
            busyWorkers: this.workers.filter(w => w.busy).length,
            queueSize: this.taskQueue.length,
            activeJobs: this.activeJobs.size
        };
    }

    terminate() {
        for (const job of this.taskQueue) {
            job.reject(new Error('Worker pool terminated'));
        }
        this.taskQueue = [];
        for (const [jobId, workerInfo] of this.activeJobs) {
            if (workerInfo.currentJob) {
                workerInfo.currentJob.reject(new Error('Worker pool terminated'));
            }
        }
        this.activeJobs.clear();
        for (const workerInfo of this.workers) {
            workerInfo.worker.terminate();
        }
        this.workers = [];
        this.availableWorkers = [];
    }

    resize(newSize) {
        newSize = Math.min(Math.max(1, newSize), 16);
        if (newSize > this.poolSize) {
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
            const toRemove = this.poolSize - newSize;
            for (let i = 0; i < toRemove; i++) {
                const idleIndex = this.workers.findIndex(w => !w.busy && w.id >= newSize);
                if (idleIndex !== -1) {
                    const worker = this.workers.splice(idleIndex, 1)[0];
                    worker.worker.terminate();
                    const availIndex = this.availableWorkers.indexOf(worker);
                    if (availIndex !== -1) {
                        this.availableWorkers.splice(availIndex, 1);
                    }
                }
            }
        }
        this.poolSize = this.workers.length;
    }

    async executeBatch(jobs, transferables = []) {
        const promises = jobs.map((job, index) => {
            const transfer = transferables[index] || [];
            return this.execute(job, transfer);
        });
        return Promise.all(promises);
    }
}
