import {PrismaClient, SamlConfig} from '@prisma/client';
import {GenericRepository} from "../generic.repository";

export class SamlConfigRepository extends GenericRepository<SamlConfig> {
    constructor(prisma: PrismaClient) {
        super(prisma, 'samlConfig');
    }
}
