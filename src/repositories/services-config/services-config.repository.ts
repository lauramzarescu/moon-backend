import {PrismaClient, ServicesConfig} from '@prisma/client';
import {GenericRepository} from '../generic.repository';

export class ServicesConfigRepository extends GenericRepository<ServicesConfig> {
    constructor(prisma: PrismaClient) {
        super(prisma, 'servicesConfig');
    }
}
