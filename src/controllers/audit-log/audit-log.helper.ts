import {TriggerType} from '@prisma/client';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {ActionRepository} from '../../repositories/action/action.repository';
import {prisma} from '../../config/db.config';
import {ActionDefinition} from '../action/action.schema';
import {ActionHelper} from '../action/action.helper';
import {CreateAuditLog} from './audit-log.schema';
import {AuditLogRepository} from '../../repositories/audit-log/audit-log.repository';

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
        } catch (error) {
            console.error('Error creating audit log:', error);
            throw new Error('Failed to create audit log');
        }
    }

    public async handleAuditEvent(data: CreateAuditLog): Promise<void> {
        console.log(`Handling audit event: ${data.action}`);

        // Find the corresponding trigger type
        const triggerType = AuditLogHelper.auditEventToTriggerMap[data.action];
        if (!triggerType) {
            console.log(`No trigger mapping for audit event: ${data.action}`);
            return;
        }

        try {
            // Find all enabled actions with matching trigger type
            const actionsToExecute = (await this.actionRepository.findMany({
                triggerType,
                organizationId: data.organizationId,
                enabled: true,
            })) as unknown as ActionDefinition[];

            // Execute each matching action
            for (const action of actionsToExecute) {
                try {
                    await this.actionHelper.execute(
                        action,
                        data.details.ip,
                        (data.details.info?.email as string) || '-'
                    );
                } catch (error) {
                    console.error(`Error executing action ${action.id}:`, error);
                }
            }
        } catch (error) {
            console.error(`Error finding actions for event ${data.action}:`, error);
        }
    }
}
