import {Prisma, PrismaClient} from '@prisma/client';
import {PaginatedResult, PaginationHandler, PaginationParams} from '../utils/pagination.util';

export abstract class GenericRepository<T> {
    protected constructor(
        protected readonly prisma: PrismaClient,
        protected readonly model: string
    ) {}

    protected get repository(): any {
        return (this.prisma as any)[this.model];
    }

    async getPaginated(
        params: PaginationParams,
        where: Prisma.Args<T, 'findMany'>['where'] = {}
    ): Promise<PaginatedResult<T>> {
        const {skip, take, page, limit, orderBy, order} = PaginationHandler.process(params);

        const whereCondition = {
            ...where,
            ...params.filters,
        };

        const [total, data] = await Promise.all([
            this.repository.count({where: whereCondition}),
            this.repository.findMany({
                where: whereCondition,
                skip,
                take,
                orderBy: {
                    [orderBy]: order,
                },
            }),
        ]);

        return PaginationHandler.createResponse(data, total, page, limit);
    }

    async getPaginatedWithRelations(
        params: PaginationParams,
        include: Prisma.Args<T, 'findMany'>['include'],
        where: Prisma.Args<T, 'findMany'>['where'] = {}
    ): Promise<PaginatedResult<T>> {
        const {skip, take, page, limit, orderBy, order} = PaginationHandler.process(params);

        const whereCondition = {
            ...where,
            ...params.filters,
        };

        const [total, data] = await Promise.all([
            this.repository.count({where: whereCondition}),
            this.repository.findMany({
                where: whereCondition,
                include,
                skip,
                take,
                orderBy: {
                    [orderBy]: order,
                },
            }),
        ]);

        return PaginationHandler.createResponse(data, total, page, limit);
    }

    async create(data: Prisma.Args<T, 'create'>['data']): Promise<T> {
        return this.repository.create({
            data,
        });
    }

    async upsert(data: Prisma.Args<T, 'upsert'>['data'], where: Prisma.Args<T, 'findFirst'>['where']): Promise<T> {
        return this.repository.upsert({
            where,
            create: data,
            update: data,
        });
    }

    async delete(id: string): Promise<T> {
        return this.repository.delete({
            where: {id},
        });
    }

    async deleteOne(where: Prisma.Args<T, 'delete'>['where']): Promise<T> {
        return this.repository.delete({where});
    }

    async deleteMany(where: Prisma.Args<T, 'deleteMany'>['where']): Promise<Prisma.BatchPayload> {
        return this.repository.deleteMany({where});
    }

    async update(id: string, data: Prisma.Args<T, 'update'>['data']): Promise<T> {
        return this.repository.update({
            where: {id},
            data,
        });
    }

    // Get methods (throw error if not found)
    async getOne(id: string): Promise<T> {
        const record = await this.repository.findUnique({
            where: {id},
        });

        if (!record) {
            throw new Error(`${this.model} with id ${id} not found`);
        }

        return record;
    }

    async getOneWhere(where: Prisma.Args<T, 'findFirst'>['where']): Promise<T> {
        const record = await this.repository.findFirst({where});
        if (!record) {
            throw new Error(`${this.model} not found`);
        }

        return record;
    }

    async getAll(orderBy?: Record<string, 'asc' | 'desc'>): Promise<T[]> {
        return this.repository.findMany({
            ...(orderBy && {orderBy}),
        });
    }

    async getMany(where: Prisma.Args<T, 'findMany'>['where']): Promise<T[]> {
        const records = await this.repository.findMany({where});

        if (!records.length) {
            throw new Error(`No ${this.model} records found with the specified criteria`);
        }

        return records;
    }

    // Find methods (return null if not found)
    async findOne(id: string): Promise<T | null> {
        return this.repository.findUnique({
            where: {id},
        });
    }

    async findOneWhere(where: Prisma.Args<T, 'findFirst'>['where']): Promise<T | null> {
        return this.repository.findFirst({where});
    }

    async findAll(): Promise<T[]> {
        return this.repository.findMany();
    }

    async findMany(where: Prisma.Args<T, 'findMany'>['where']): Promise<T[]> {
        return this.repository.findMany({where});
    }

    async findWhereIlike(field: string, value: string) {
        return this.repository.findMany({
            where: {
                [field]: {
                    contains: value,
                    mode: 'insensitive',
                },
            },
        });
    }
}
