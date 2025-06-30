import express from 'express';
import bcrypt from 'bcrypt';
import {AuthService} from '../../services/auth.service';
import {UserRepository} from '../../repositories/user/user.repository';
import moment from 'moment';
import {loginSchema} from './auth.schema';
import {prisma} from '../../config/db.config';
import {AuditLogHelper} from '../audit-log/audit-log.helper';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {LoginType} from '@prisma/client';
import logger from '../../config/logger';
import {TwoFactorController} from '../user/two-factor.controller';

export class AuthController {
    static userRepository = new UserRepository(prisma);
    static auditHelper = new AuditLogHelper();

    constructor() {}

    static login = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        try {
            const validatedData = loginSchema.parse(req.body);

            const user = await this.userRepository.findOneWhere({
                email: validatedData.email.toLowerCase(),
            });

            if (!user) {
                res.status(401).json({error: 'Invalid credentials'});
                return;
            }

            if (user.loginType !== LoginType.local || !user.password) {
                res.status(401).json({error: 'Invalid login type'});
                return;
            }

            const isValidPassword = await bcrypt.compare(validatedData.password, user.password);

            if (!isValidPassword) {
                res.status(401).json({error: 'Invalid credentials'});
                return;
            }

            const verificationRequired = await TwoFactorController.is2FAVerificationNeeded(user.id, req);

            if (verificationRequired) {
                const tempToken = AuthService.createTemporaryToken(user);

                res.cookie('token', tempToken, {
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    expires: moment().add(5, 'm').toDate(),
                });

                res.json({
                    status: 'success',
                    requires2FAVerification: true,
                });
            } else {
                const token = AuthService.createToken(user);

                res.cookie('token', token, {
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    expires: moment().add(24, 'h').toDate(),
                });

                res.json({
                    status: 'success',
                    requires2FAVerification: false,
                });
            }

            await this.auditHelper.create({
                userId: user.id,
                organizationId: user.organizationId,
                action: AuditLogEnum.USER_LOGIN,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user.email,
                    },
                },
            });
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({error: 'Login failed'});
        }
    };
}
