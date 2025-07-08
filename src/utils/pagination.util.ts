export interface PaginationParams {
    page?: number | string;
    limit?: number | string;
    filters?: Record<string, string>;
    orderBy?: string;
    order?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
    data: T[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
    };
}

type FieldType = 'string' | 'number' | 'boolean' | 'date';

type ModelFieldMapping = {
    [model: string]: {
        [key: string]: {
            field: string;
            type: FieldType;
        };
    };
};

const dbFieldMapping: ModelFieldMapping = {
    user: {
        name: {field: 'name', type: 'string'},
        email: {field: 'email', type: 'string'},
        role: {field: 'role', type: 'string'},
        status: {field: 'status', type: 'string'},
    },
    organization: {
        name: {field: 'name', type: 'string'},
        domain: {field: 'domain', type: 'string'},
    },
    auditLog: {
        action: {field: 'action', type: 'string'},
        userId: {field: 'userId', type: 'string'},
        organizationId: {field: 'organizationId', type: 'string'},
    },
};

export class PaginationHandler {
    static process(params: PaginationParams) {
        const page = Number(params.page) || 1;
        const limit = Number(params.limit) || 10;
        const skip = (page - 1) * limit;
        const orderBy = params.orderBy || 'createdAt';
        const order = params.order || 'desc';

        return {
            skip,
            take: limit,
            page,
            limit,
            orderBy,
            order,
        };
    }

    static createResponse<T>(data: T[], total: number, page: number, limit: number): PaginatedResult<T> {
        const totalPages = Math.ceil(total / limit);

        return {
            data,
            meta: {
                total,
                page,
                limit,
                totalPages,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1,
            },
        };
    }

    static translateFilters(queryParams: any, modelName: string): Record<string, any> {
        const filters: Record<string, any> = {};
        const modelMapping = dbFieldMapping[modelName];

        if (!modelMapping) {
            return filters;
        }

        Object.keys(queryParams).forEach(param => {
            if (param.startsWith('filter_')) {
                const field = param.replace('filter_', '');
                const mappingConfig = modelMapping[field];

                if (mappingConfig) {
                    const value = queryParams[param];
                    filters[mappingConfig.field] = this.convertValueToType(value, mappingConfig.type);
                }
            }
        });

        return filters;
    }

    private static convertValueToType(value: string, type: FieldType): any {
        switch (type) {
            case 'number':
                return Number(value);
            case 'boolean':
                return value.toLowerCase() === 'true';
            case 'date':
                return new Date(value);
            case 'string':
            default:
                return value;
        }
    }
}
