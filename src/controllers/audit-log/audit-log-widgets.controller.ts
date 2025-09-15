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
            const tz = req.query.tz?.toString() || 'UTC';
            const startDate = moment.tz(req.query?.filter_startDate, tz) || null;
            const endDate = moment.tz(req.query?.filter_endDate, tz) || null;

            if (!startDate || !endDate) {
                res.status(400).json({message: 'Start and end date are required'});
                return;
            }

            // Calculate the duration of the current period
            const currentPeriodDuration = endDate.diff(startDate, 'days') + 1; // +1 to include both start and end dates

            // Calculate previous period dates
            const previousStartDate = startDate.clone().subtract(currentPeriodDuration, 'days');
            const previousEndDate = startDate.clone().subtract(1, 'day');

            // Get current period count
            const currentFilters = PaginationHandler.translateFilters(req.query, 'auditLog');
            const currentParams = {
                page: 1,
                limit: 1,
                filters: {
                    ...currentFilters,
                    action: AuditLogEnum.AWS_SERVICE_UPDATED,
                },
                tz,
                orderBy: 'createdAt',
                order: 'desc' as const,
            };

            // Get previous period count
            const previousQuery = {
                ...req.query,
                filter_startDate: previousStartDate.format('YYYY-MM-DD'),
                filter_endDate: previousEndDate.format('YYYY-MM-DD'),
            };
            const previousFilters = PaginationHandler.translateFilters(previousQuery, 'auditLog');
            const previousParams = {
                page: 1,
                limit: 1,
                filters: {
                    ...previousFilters,
                    action: AuditLogEnum.AWS_SERVICE_UPDATED,
                },
                tz,
                orderBy: 'createdAt',
                order: 'desc' as const,
            };

            const [currentResult, previousResult] = await Promise.all([
                this.auditHelper.getAuthorizedPaginated(user, currentParams),
                this.auditHelper.getAuthorizedPaginated(user, previousParams),
            ]);

            const currentCount = currentResult.meta.total;
            const previousCount = previousResult.meta.total;

            let delta: number | null = null;
            if (previousCount > 0) {
                delta = ((currentCount - previousCount) / previousCount) * 100;
                delta = Math.round(delta * 100) / 100;
            } else if (currentCount > 0) {
                // If previous count is 0 but current count > 0, it's infinite growth
                // We'll represent this as null to indicate infinite growth
                delta = null;
            } else {
                // Both are 0, no change
                delta = 0;
            }

            res.json({
                count: currentCount,
                delta: delta,
                previousCount: previousCount,
            });
        } catch (error: any) {
            res.status(500).json({message: error.message || 'Failed to get deployments count'});
        }
    };

    static deploymentsTimeline = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const tz = req.query.tz?.toString() || 'UTC';
            const startDate = moment.tz(req.query?.filter_startDate, tz) || null;
            const endDate = moment.tz(req.query?.filter_endDate, tz) || null;

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
                    tz,
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
