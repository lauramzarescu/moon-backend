import express from 'express';
import moment from 'moment-timezone';
import {PaginationHandler} from '../../utils/pagination.util';
import {AuditLogHelper} from './audit-log.helper';
import {User} from '@prisma/client';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';

export class AuditLogWidgetsController {
    private static auditHelper = new AuditLogHelper();

    static deploymentsCount = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const filters = PaginationHandler.translateFilters(req.query, 'auditLog');
            console.log(filters);

            const params = {
                page: 1,
                limit: 1, // minimize query; we only need the count
                filters: {
                    ...filters,
                    action: AuditLogEnum.AWS_SERVICE_UPDATED,
                },
                orderBy: 'createdAt',
                order: 'desc' as const,
            };

            const result = await this.auditHelper.getAuthorizedPaginated(user, params);
            res.json({count: result.meta.total});
        } catch (error: any) {
            res.status(500).json({message: error.message || 'Failed to get deployments count'});
        }
    };

    static deploymentsTimeline = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const startDate = moment.tz(req.query?.filter_startDate, 'UTC') || null;
            const endDate = moment.tz(req.query?.filter_endDate, 'UTC') || null;
            if (!startDate || !endDate) {
                res.status(400).json({message: 'Start and end date are required'});
                return;
            }

            const filters = PaginationHandler.translateFilters(req.query, 'auditLog');

            // Build labels for each day in the range
            const labels: string[] = [];
            const countsByDay: Record<string, number> = {};
            const cursor = startDate.clone().startOf('day');
            const end = endDate.clone().endOf('day');
            while (cursor.isSameOrBefore(end, 'day')) {
                const label = cursor.clone().format('YYYY-MM-DD');
                labels.push(label);
                countsByDay[label] = 0;
                cursor.add(1, 'day');
            }

            // Fetch all pages and bucket counts per day
            let page = 1;
            const limit = 500;
            let fetched = 0;
            let total = 0;

            do {
                const result = await this.auditHelper.getAuthorizedPaginated(user, {
                    page,
                    limit,
                    filters: {
                        ...filters,
                        action: AuditLogEnum.AWS_SERVICE_UPDATED,
                    },
                    orderBy: 'createdAt',
                    order: 'asc',
                });

                const data = result.data as any[];
                total = result.meta.total;
                fetched += data.length;

                for (const row of data) {
                    const key = moment.tz(row.createdAt, 'UTC').format('YYYY-MM-DD');
                    if (key in countsByDay) {
                        countsByDay[key] += 1;
                    }
                }

                page += 1;
            } while (fetched < total);

            const dataSeries = labels.map(d => countsByDay[d] || 0);

            res.json({data: dataSeries, labels});
        } catch (error: any) {
            res.status(500).json({message: error.message || 'Failed to get deployments timeline'});
        }
    };
}
