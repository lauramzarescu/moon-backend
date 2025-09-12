import {PrismaClient, ServiceRepository} from '@prisma/client';
import {GenericRepository} from '../generic.repository';

export class ServiceRepositoryMappingRepository extends GenericRepository<ServiceRepository> {
    constructor(prisma: PrismaClient) {
        super(prisma, 'serviceRepository');
    }
}
