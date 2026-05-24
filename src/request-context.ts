import { AsyncLocalStorage } from "node:async_hooks";

export interface McpRequestContext {
  clientUserAgent?: string;
}

export const requestContext = new AsyncLocalStorage<McpRequestContext>();
