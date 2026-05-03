import pino from 'pino';
import { Queue, Worker, Job } from 'bullmq';

export interface QueueJobData {
  runId: string;
  sessionId: string;
  eventType: string;
  payload: unknown;
  priority?: number;
}

export interface QueueJobResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

let reviewQueue: Queue<QueueJobData> | null = null;
let worker: Worker<QueueJobData> | null = null;

const logger = pino({ name: 'queue' });

export function initQueue(connection?: { host?: string; port?: number }): Queue<QueueJobData> {
  const conn = connection ?? { 
    host: process.env.REDIS_HOST ?? 'localhost', 
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10) 
  };

  if (reviewQueue) {
    return reviewQueue;
  }

  reviewQueue = new Queue<QueueJobData>('codenexus-reviews', {
    connection: {
      host: conn.host,
      port: conn.port,
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  });

  logger.info({ host: conn.host, port: conn.port }, 'Queue initialized');
  return reviewQueue;
}

export function getQueue(): Queue<QueueJobData> {
  if (!reviewQueue) {
    return initQueue();
  }
  return reviewQueue;
}

export async function addReviewJob(data: QueueJobData, priority?: number): Promise<Job<QueueJobData>> {
  const queue = getQueue();
  const jobOptions = priority ? { priority } : undefined;
  return queue.add('review', data, jobOptions);
}

export function createQueueWorker(
  name: string,
  processor: (job: Job<QueueJobData>) => Promise<QueueJobResult>,
  connection?: { host?: string; port?: number },
  concurrency = 5,
): Worker<QueueJobData> {
  const conn = connection ?? { 
    host: process.env.REDIS_HOST ?? 'localhost', 
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10) 
  };

  worker = new Worker<QueueJobData>(
    name,
    async (job) => {
      logger.info({ jobId: job.id, name: job.name }, 'Processing job');
      const result = await processor(job);
      logger.info({ jobId: job.id, success: result.success }, 'Job processed');
      return result;
    },
    {
      connection: { host: conn.host, port: conn.port },
      concurrency,
    }
  );

  logger.info({ name, concurrency }, 'Worker created');
  return worker;
}

export async function closeQueue(): Promise<void> {
  if (reviewQueue) {
    await reviewQueue.close();
    reviewQueue = null;
  }
  if (worker) {
    await worker.close();
    worker = null;
  }
}

export { Queue, Worker, Job };
export type { QueueJobData as JobData, QueueJobResult as JobResult };