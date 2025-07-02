import winston from 'winston';
import path from 'path';

export function createLogger(logFilePath: string): winston.Logger {
  const logDir = path.dirname(logFilePath);
  
  return winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.File({ filename: logFilePath }),
      new winston.transports.Console({
        format: winston.format.simple(),
        level: 'error'
      })
    ]
  });
}