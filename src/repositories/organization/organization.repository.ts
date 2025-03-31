import {Organization, PrismaClient} from '@prisma/client';
import {GenericRepository} from '../generic.repository';

export class OrganizationRepository extends GenericRepository<Organization> {
    constructor(prisma: PrismaClient) {
        super(prisma, 'organization');
    }
}
