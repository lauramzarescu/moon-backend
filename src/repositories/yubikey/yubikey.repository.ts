import {PrismaClient, YubikeyInfo} from '@prisma/client';
import {GenericRepository} from '../generic.repository';

export class YubikeyRepository extends GenericRepository<YubikeyInfo> {
    constructor(prisma: PrismaClient) {
        super(prisma, 'yubikeyInfo');
    }

    async create(data: {publicId: string; nickname?: string; userId: string}): Promise<YubikeyInfo> {
        return super.create(data);
    }

    async findByUserIdAndPublicId(userId: string, publicId: string): Promise<YubikeyInfo | null> {
        return this.findOneWhere({
            userId,
            publicId,
        });
    }

    async findByPublicId(publicId: string): Promise<YubikeyInfo | null> {
        return this.findOneWhere({
            publicId,
        });
    }

    async findByUserId(userId: string): Promise<YubikeyInfo[]> {
        return this.repository.findMany({
            where: {
                userId,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
    }

    async findByIdAndUserId(id: string, userId: string): Promise<YubikeyInfo | null> {
        return this.findOneWhere({
            id,
            userId,
        });
    }

    async updateLastUsed(userId: string, publicId: string): Promise<void> {
        await this.repository.updateMany({
            where: {
                userId,
                publicId,
            },
            data: {
                lastUsed: new Date(),
            },
        });
    }

    async updateNickname(id: string, userId: string, nickname?: string): Promise<YubikeyInfo> {
        return this.repository.update({
            where: {
                id,
                userId,
            },
            data: {
                nickname,
            },
        });
    }

    async deleteById(id: string, userId: string): Promise<void> {
        await this.repository.delete({
            where: {
                id,
                userId,
            },
        });
    }

    async deleteAllByUserId(userId: string): Promise<void> {
        await this.deleteMany({
            userId,
        });
    }

    async countByUserId(userId: string): Promise<number> {
        return this.repository.count({
            where: {
                userId,
            },
        });
    }
}
