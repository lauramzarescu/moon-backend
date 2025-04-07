import {PrismaClient} from '@prisma/client';
import {GenericRepository} from '../generic.repository';
import {Action} from '@prisma/client/runtime/library';

export class ActionRepository extends GenericRepository<Action> {
    constructor(prisma: PrismaClient) {
        super(prisma, 'action');
    }
}
