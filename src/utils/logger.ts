import pino from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type Logger = pino.Logger;

const level = (process.env.LOG_LEVEL ?? "info") as LogLevel;

export const logger: Logger = pino({ level }, pino.destination(2));
