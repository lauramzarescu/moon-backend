import {PrismaClient, User} from '@prisma/client';
import {GenericRepository} from "../generic.repository";

export class UserRepository extends GenericRepository<User> {
    constructor(prisma: PrismaClient) {
        super(prisma, 'user');
    }
}
