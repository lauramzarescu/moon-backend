import {Action, PrismaClient, TriggerType} from '@prisma/client';
import {GenericRepository} from '../generic.repository';

export class ActionRepository extends GenericRepository<Action> {
    constructor(prisma: PrismaClient) {
        super(prisma, 'action');
    }

    public async getActive(organizationId: string, triggerType: TriggerType): Promise<Action[]> {
        return this.repository.findMany({
            where: {
                organizationId,
                triggerType: triggerType,
                enabled: true,
            },
        });
    }
}
