import {Action, PrismaClient} from '@prisma/client';
import {GenericRepository} from '../generic.repository';

export class ActionRepository extends GenericRepository<Action> {
    constructor(prisma: PrismaClient) {
        super(prisma, 'action');
    }
}
