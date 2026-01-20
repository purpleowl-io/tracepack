/**
 * Contextual Logger with AsyncLocalStorage
 * 
 * Provides automatic context propagation (userId, transactionId) across
 * async boundaries without manual parameter threading.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// The "invisible backpack" that follows async execution
const asyncContext = new AsyncLocalStorage();

// Log level configuration
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3, none: 4 };

// Store original console methods before any replacement
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug
};

// Runtime configuration (set by replaceConsole)
let currentLevel = LOG_LEVELS.info;
let outputMode = 'console';
let logFilePath = null;

/**
 * Internal: formats and outputs a log entry
 */
function emit(level, message, data = {}) {
  if (LOG_LEVELS[level] < currentLevel) return;

  const ctx = asyncContext.getStore() || {};
  
  const entry = {
    ts: new Date().toISOString(),
    level,
    userId: ctx.userId ?? null,
    txId: ctx.txId ?? null,
    ...data,
    msg: message
  };

  // Add any custom context fields that were set
  if (ctx.custom) {
    Object.assign(entry, ctx.custom);
  }

  const output = JSON.stringify(entry);
  
  // Write to file if configured
  if (logFilePath && (outputMode === 'file' || outputMode === 'both')) {
    appendFileSync(logFilePath, output + '\n');
  }
  
  // Write to console if configured
  if (outputMode === 'console' || outputMode === 'both') {
    if (level === 'error') {
      originalConsole.error(output);
    } else if (level === 'warn') {
      originalConsole.warn(output);
    } else {
      originalConsole.log(output);
    }
  }
}

/**
 * The main logger object
 */
export const log = {
  debug: (msg, data) => emit('debug', msg, data),
  info:  (msg, data) => emit('info', msg, data),
  warn:  (msg, data) => emit('warn', msg, data),
  error: (msg, data) => emit('error', msg, data),

  /**
   * Get the current context (useful for passing to background jobs)
   */
  getContext: () => ({ ...asyncContext.getStore() }),

  /**
   * Add custom fields to the current context
   * These will appear in all subsequent logs within this async chain
   */
  addContext: (fields) => {
    const store = asyncContext.getStore();
    if (store) {
      store.custom = { ...store.custom, ...fields };
    }
  }
};

/**
 * Express/Connect middleware
 * Automatically extracts userId from req.user and generates a transaction ID
 */
export function loggerMiddleware(options = {}) {
  const {
    userIdPath = 'user.id',         // Path to userId in req object
    txIdHeader = 'x-transaction-id', // Header to check for existing txId
    generateTxId = () => randomUUID()
  } = options;

  return (req, res, next) => {
    // Extract userId by path (supports 'user.id', 'auth.userId', etc.)
    const userId = userIdPath.split('.').reduce(
      (obj, key) => obj?.[key], 
      req
    ) ?? null;

    // Use existing transaction ID from header, or generate new one
    const txId = req.get(txIdHeader) || generateTxId();

    // Set response header so clients can correlate
    res.set('x-transaction-id', txId);

    // Run the rest of the request inside this context
    asyncContext.run({ userId, txId, custom: {} }, next);
  };
}

/**
 * Manual context wrapper for non-Express usage
 * Use this when you need to establish context outside of HTTP requests
 * 
 * Example:
 *   await withContext({ userId: 'system', txId: 'batch-job-123' }, async () => {
 *     await processItems();
 *   });
 */
export function withContext(ctx, fn) {
  const store = {
    userId: ctx.userId ?? null,
    txId: ctx.txId ?? randomUUID(),
    custom: ctx.custom ?? {}
  };
  return asyncContext.run(store, fn);
}

/**
 * Capture current context for deferred/background work
 * 
 * Example:
 *   const captured = captureContext();
 *   setTimeout(() => {
 *     runWithCapturedContext(captured, () => {
 *       log.info('background task complete'); // Still has original context
 *     });
 *   }, 5000);
 */
export function captureContext() {
  return { ...asyncContext.getStore() };
}

export function runWithCapturedContext(captured, fn) {
  return asyncContext.run(captured, fn);
}

/**
 * Replace global console.log/warn/error/debug with contextual versions
 * Call this ONCE at your app's entry point, before anything else runs
 * 
 * @param {Object} options
 * @param {string} options.level - Log level: 'debug' | 'info' | 'warn' | 'error' | 'none' (default: 'info')
 * @param {string} options.output - Output destination: 'console' | 'file' | 'both' (default: 'console')
 * @param {string} options.filePath - Log file path, required when output is 'file' or 'both'
 */
export function replaceConsole(options = {}) {
  const {
    level = 'info',
    output = 'console',
    filePath = null
  } = options;

  // Set configuration
  currentLevel = LOG_LEVELS[level] ?? LOG_LEVELS.info;
  outputMode = output;
  logFilePath = filePath ? resolve(filePath) : null;

  // Ensure log directory exists if file output is enabled
  if (logFilePath && (outputMode === 'file' || outputMode === 'both')) {
    mkdirSync(dirname(logFilePath), { recursive: true });
  }

  console.log = (...args) => {
    const msg = args.shift();
    const data = args.length === 1 && typeof args[0] === 'object' ? args[0] : 
                 args.length > 0 ? { args } : undefined;
    emit('info', String(msg), data);
  };

  console.info = console.log;

  console.debug = (...args) => {
    const msg = args.shift();
    const data = args.length === 1 && typeof args[0] === 'object' ? args[0] : 
                 args.length > 0 ? { args } : undefined;
    emit('debug', String(msg), data);
  };

  console.warn = (...args) => {
    const msg = args.shift();
    const data = args.length === 1 && typeof args[0] === 'object' ? args[0] : 
                 args.length > 0 ? { args } : undefined;
    emit('warn', String(msg), data);
  };

  console.error = (...args) => {
    const msg = args.shift();
    const data = args.length === 1 && typeof args[0] === 'object' ? args[0] : 
                 args.length > 0 ? { args } : undefined;
    emit('error', String(msg), data);
  };
}

export default log;
