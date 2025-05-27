import {TriggerType} from '@prisma/client';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {ActionRepository} from '../../repositories/action/action.repository';
import {prisma} from '../../config/db.config';
import {ActionDefinition} from '../action/action.schema';
import {ActionHelper} from '../action/action.helper';
import {CreateAuditLog} from './audit-log.schema';
import {AuditLogRepository} from '../../repositories/audit-log/audit-log.repository';
import logger from '../../config/logger';

export class AuditLogHelper {
    private readonly actionHelper = new ActionHelper();
    private readonly actionRepository = new ActionRepository(prisma);
    private readonly auditLogRepository = new AuditLogRepository(prisma);

    // Map between AuditLogEnum events and TriggerType
    private static auditEventToTriggerMap: Partial<Record<AuditLogEnum, TriggerType>> = {
        [AuditLogEnum.USER_LOGIN]: TriggerType.user_login,
        [AuditLogEnum.USER_LOGOUT]: TriggerType.user_logout,
        [AuditLogEnum.USER_CREATED]: TriggerType.user_created,
        [AuditLogEnum.SCHEDULED_JOB_STARTED]: TriggerType.scheduled_job,
    };

    public async create(data: CreateAuditLog) {
        try {
            await this.auditLogRepository.create(data);

            await this.handleAuditEvent(data);
        } catch (error: any) {
            logger.error('Error creating audit log:', error);
            throw new Error('Failed to create audit log');
        }
    }

    public async handleAuditEvent(data: CreateAuditLog): Promise<void> {
        logger.info(`Handling audit event: ${data.action}`);

        // Find the corresponding trigger type
        const triggerType = AuditLogHelper.auditEventToTriggerMap[data.action];
        if (!triggerType) {
            logger.info(`No trigger mapping for audit event: ${data.action}`);
            return;
        }

        try {
            // Find all enabled actions with matching trigger type
            const actionsToExecute = (await this.actionRepository.getActive(
                data.organizationId,
                triggerType
            )) as unknown as ActionDefinition[];

            // Execute each matching action
            for (const action of actionsToExecute) {
                try {
                    await this.actionHelper.execute(
                        action,
                        data.details.ip,
                        (data.details.info?.email as string) || '-'
                    );
                } catch (error: any) {
                    logger.error(`Error executing action ${action.id}:`, error.message);
                }
            }
        } catch (error: any) {
            logger.error(`Error finding actions for event ${data.action}:`, error);
        }
    }
}
