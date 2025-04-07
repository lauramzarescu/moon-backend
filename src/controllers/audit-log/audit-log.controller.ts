import express from 'express';
import {createAuditLogSchema} from './audit-log.schema';
import {AuditLogHelper} from './audit-log.helper';

export class AuditLogController {
    private readonly auditHelper = new AuditLogHelper();

    constructor() {}

    public async create(req: express.Request, res: express.Response, next: express.NextFunction) {
        try {
            const validatedData = createAuditLogSchema.parse(req.body);
            const newAuditLog = await this.auditHelper.create(validatedData);

            res.status(201).json(newAuditLog);
        } catch (error) {
            console.error('Error creating audit log:', error);
            res.status(500).json({error: 'Create audit log failed'});
        }
    }
}
