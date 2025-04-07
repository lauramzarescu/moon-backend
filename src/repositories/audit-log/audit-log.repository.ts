import {AuditLog, PrismaClient} from '@prisma/client';
import {GenericRepository} from '../generic.repository';

export class AuditLogRepository extends GenericRepository<AuditLog> {
    constructor(prisma: PrismaClient) {
        super(prisma, 'auditLog');
    }
}
