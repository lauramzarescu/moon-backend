import moment from 'moment-timezone';

export interface PaginationParams {
    page?: number | string;
    limit?: number | string;
    filters?: Record<string, string>;
    orderBy?: string;
    order?: 'asc' | 'desc';
    startDate?: string | Date;
    endDate?: string | Date;
    tz?: string;
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

type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'json';

type ModelFieldMapping = {
    [model: string]: {
        [key: string]: {
            field: string;
            type: FieldType;
            jsonPath?: string;
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
        userEmail: {field: 'details', type: 'json', jsonPath: 'info.email'},
        startDate: {field: 'createdAt', type: 'date'},
        endDate: {field: 'createdAt', type: 'date'},
    },
};

export class PaginationHandler {
    static process(params: PaginationParams) {
        const page = Number(params.page) || 1;
        const limit = Number(params.limit) || 10;
        const skip = (page - 1) * limit;
        const orderBy = params.orderBy || 'createdAt';
        const order = params.order || 'desc';
        const tz = params.tz || 'UTC';

        // Process date range filters
        const dateFilters = this.processDateFilters(params.startDate, params.endDate, tz);

        return {
            skip,
            take: limit,
            page,
            limit,
            orderBy,
            order,
            dateFilters,
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

        // Special handling for date range filters coming from frontend as filter_startDate and filter_endDate
        const startDateParam = queryParams['filter_startDate'];
        const endDateParam = queryParams['filter_endDate'];
        const tz = queryParams['tz'] || 'UTC';
        const createdAtRange: Record<string, Date> = {};

        if (startDateParam) {
            // Use moment to set start of day in UTC to avoid timezone shifting
            const mStart = moment.tz(String(startDateParam), [moment.ISO_8601, 'YYYY-MM-DD'], true, tz);
            if (mStart.isValid()) {
                createdAtRange.gte = mStart.startOf('day').toDate();
            }
        }
        if (endDateParam) {
            // Use moment to set end of day in UTC to avoid timezone shifting
            const m = moment.tz(String(endDateParam), moment.ISO_8601, true, tz);
            const validMoment = m.isValid() ? m : moment.tz(String(endDateParam), 'YYYY-MM-DD', tz);

            if (validMoment.isValid()) {
                const endOfDayUtc = validMoment.endOf('day');

                createdAtRange.lte = endOfDayUtc.toDate();
            } else {
                const parsedEnd = this.parseDate(String(endDateParam), tz);
                if (parsedEnd) {
                    createdAtRange.lte = moment(parsedEnd).tz(tz).endOf('day').toDate();
                }
            }
        }
        if (Object.keys(createdAtRange).length > 0) {
            filters['createdAt'] = createdAtRange;
        }

        Object.keys(queryParams).forEach(param => {
            if (!param.startsWith('filter_')) return;

            const field = param.replace('filter_', '');

            if (field === 'startDate' || field === 'endDate') return;

            const mappingConfig = modelMapping[field];
            if (!mappingConfig) return;

            const value = queryParams[param];

            if (mappingConfig.type === 'json' && mappingConfig.jsonPath) {
                const dbField = mappingConfig.field;
                const jsonPathArray = mappingConfig.jsonPath.split('.');

                filters[dbField] = {
                    path: jsonPathArray,
                    string_contains: this.convertValueToType(value, 'string'),
                };
            } else {
                filters[mappingConfig.field] = this.convertValueToType(value, mappingConfig.type);
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
            case 'json':
            case 'string':
            default:
                return value;
        }
    }

    /**
     * Process date range filters for createdAt field
     * @param startDate - Optional start date for filtering
     * @param endDate - Optional end date for filtering
     * @param tz
     * @returns Object with date filters for Prisma where clause, or null if no date filters
     */
    private static processDateFilters(
        startDate?: string | Date,
        endDate?: string | Date,
        tz: string = 'UTC'
    ): Record<string, any> | null {
        if (!startDate && !endDate) {
            return null;
        }

        const dateFilter: Record<string, any> = {};

        try {
            if (startDate) {
                const parsedStartDate = this.parseDate(startDate, tz);
                if (parsedStartDate) {
                    dateFilter.gte = parsedStartDate;
                }
            }

            if (endDate) {
                const endStr = typeof endDate === 'string' ? endDate : endDate.toISOString();
                const mEnd = moment.tz(endStr, [moment.ISO_8601, 'YYYY-MM-DD'], true, tz);
                if (mEnd.isValid()) {
                    dateFilter.lte = mEnd.endOf('day').toDate();
                }
            }

            return Object.keys(dateFilter).length > 0 ? {createdAt: dateFilter} : null;
        } catch (error) {
            // If date parsing fails, return null to ignore date filters
            console.warn('Invalid date format provided for date range filtering:', error);
            return null;
        }
    }

    /**
     * Parse date from string or Date object with validation
     * @param date - Date to parse
     * @param tz
     * @returns Parsed Date object or null if invalid
     */
    private static parseDate(date: string | Date, tz: string = 'UTC'): Date | null {
        if (date instanceof Date) {
            return isNaN(date.getTime()) ? null : date;
        }

        if (typeof date === 'string') {
            // Try ISO then fallback to YYYY-MM-DD, interpret both in UTC to avoid timezone drift
            const m = moment.tz(date, [moment.ISO_8601, 'YYYY-MM-DD'], true, tz);
            return m.isValid() ? m.toDate() : null;
        }

        return null;
    }
}
