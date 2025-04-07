declare global {
    namespace Express {
        interface Request {
            ipAddress?: string;
        }
    }
}
