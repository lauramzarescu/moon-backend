import express from 'express';
import {OrganizationRepository} from '../../repositories/organization/organization.repository';
import {organizationDetailsResponseSchema, organizationUpdateSchema} from './organization.schema';
import {prisma} from '../../config/db.config';
import {User} from '@prisma/client';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {AuditLogHelper} from '../audit-log/audit-log.helper';
import logger from '../../config/logger';

export class OrganizationController {
    static organizationRepository = new OrganizationRepository(prisma);
    static auditHelper = new AuditLogHelper();

    static getOrganizationDetails = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;

            if (!user.organizationId) {
                res.status(400).json({message: 'User is not associated with any organization'});
                return;
            }

            const organization = await this.organizationRepository.getOne(user.organizationId);
            const organizationDetails = organizationDetailsResponseSchema.parse(organization);

            res.json(organizationDetails);
        } catch (error: any) {
            logger.error('Error getting organization details:', error);
            res.status(500).json({message: error.message});
        }
    };

    static getOne = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const organizationId = req.params.id;

            // Ensure user can only access their own organization
            if (user.organizationId !== organizationId) {
                res.status(403).json({message: 'You can only access your own organization'});
                return;
            }

            const organization = await this.organizationRepository.getOne(organizationId);
            const organizationDetails = organizationDetailsResponseSchema.parse(organization);

            res.json(organizationDetails);
        } catch (error: any) {
            logger.error('Error getting organization:', error);
            res.status(500).json({message: error.message});
        }
    };

    static update = async (req: express.Request, res: express.Response) => {
        try {
            const requesterUser = res.locals.user as User;
            const organizationId = req.params.id;

            // Ensure user can only update their own organization
            if (requesterUser.organizationId !== organizationId) {
                res.status(403).json({message: 'You can only update your own organization'});
                return;
            }

            const validatedData = organizationUpdateSchema.parse(req.body);

            const currentOrganization = await this.organizationRepository.getOne(organizationId);
            const updatedOrganization = await this.organizationRepository.update(organizationId, validatedData);
            const organizationDetails = organizationDetailsResponseSchema.parse(updatedOrganization);

            res.json(organizationDetails);

            await this.auditHelper.create({
                userId: requesterUser?.id || '-',
                organizationId: requesterUser?.organizationId || '-',
                action: AuditLogEnum.ORGANIZATION_UPDATED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: requesterUser?.email || '-',
                        description: `Organization ${updatedOrganization.name} updated`,
                        objectOld: currentOrganization,
                        objectNew: updatedOrganization,
                        changes: validatedData,
                    },
                },
            });
        } catch (error: any) {
            logger.error('Error updating organization:', error);
            res.status(500).json({message: error.message});
        }
    };
}
