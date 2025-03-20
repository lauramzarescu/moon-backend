import {AccessControl, PrismaClient} from '@prisma/client';
import {GenericRepository} from "../generic.repository";

export class AccessControlRepository extends GenericRepository<AccessControl> {
    constructor(prisma: PrismaClient) {
        super(prisma, 'accessControl');
    }
}
