import {createLogger, format, transports} from 'winston';

const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss',
        }),
        format.errors({stack: true}),
        // format.splat(),
        format.json()
    ),
    defaultMeta: {service: 'moon-backend'},
    transports: [
        new transports.Console({
            format: format.combine(
                format.colorize(),
                format.printf(({level, message, timestamp, ...metadata}) => {
                    let msg = `${timestamp} [${level}]: ${message}`;

                    if (Object.keys(metadata).length > 0 && metadata.error) {
                        msg += ` ${(metadata.error as any).stack || JSON.stringify(metadata)}`;
                    }

                    return msg;
                })
            ),
        }),
    ],
});

export default logger;
