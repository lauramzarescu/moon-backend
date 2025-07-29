import express from 'express';
import bcrypt from 'bcrypt';
import {AuthService} from '../../services/auth.service';
import {UserRepository} from '../../repositories/user/user.repository';
import moment from 'moment';
import {loginSchema} from './auth.schema';
import {prisma} from '../../config/db.config';
import {AuditLogHelper} from '../audit-log/audit-log.helper';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {AuthType, LoginType} from '@prisma/client';
import logger from '../../config/logger';
import {OrganizationRepository} from '../../repositories/organization/organization.repository';
import {TwoFactorHelper} from '../user/two-factor.helper';

export class AuthController {
    static userRepository = new UserRepository(prisma);
    static organizationRepository = new OrganizationRepository(prisma);
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

            const organization = await this.organizationRepository.getOne(user.organizationId);

            if (user.loginType !== LoginType.local || !user.password) {
                res.status(401).json({error: 'Invalid login type'});
                return;
            }

            const isValidPassword = await bcrypt.compare(validatedData.password, user.password);

            if (!isValidPassword) {
                res.status(401).json({error: 'Invalid credentials'});
                return;
            }

            const verificationRequired = await TwoFactorHelper.is2FAVerificationNeeded(user.id, req);
            const is2FASetupRequired = await TwoFactorHelper.is2FASetupRequired(user.id);

            if (is2FASetupRequired) {
                const _2FASetupValues = await TwoFactorHelper.generateTwoFactorSetup(user, organization);
                const tempToken = AuthService.createTemporaryToken(user);

                res.cookie('token', tempToken, {
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    expires: moment().add(5, 'm').toDate(),
                });

                res.json({
                    status: 'success',
                    requires2FAVerification: false,
                    requires2FASetup: true,
                    qrCodeUrl: _2FASetupValues.qrCodeUrl,
                });

                return;
            }
            
            if (verificationRequired) {
                const tempToken = AuthService.createTemporaryToken(user);
                const yubikeys = await TwoFactorHelper.getUserYubikeys(user.id);
                const twoFactorMethod = await TwoFactorHelper.getTwoFactorMethod(user.id);
                const availableMethods = await TwoFactorHelper.getAvailableMethods(user.id);

                const otpCredentials = yubikeys.filter(y => y.authType === AuthType.OTP);
                const webauthnCredentials = yubikeys.filter(y => y.authType === AuthType.WEBAUTHN);
                const hasTotp = !!user.twoFactorSecret;
                const hasWebAuthn = webauthnCredentials.length > 0;
                const hasOtpYubikey = otpCredentials.length > 0;
                const highSecurityAvailable = hasTotp || hasWebAuthn;

                res.cookie('token', tempToken, {
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    expires: moment().add(5, 'm').toDate(),
                });

                res.json({
                    status: 'success',
                    requires2FAVerification: true,
                    requires2FASetup: false,
                    twoFactorMethod: twoFactorMethod,
                    availableMethods: availableMethods,
                    hasTotp: hasTotp, // Always show if available (high security)
                    hasYubikey: yubikeys.length > 0,
                    hasYubikeyOTP: hasOtpYubikey && !highSecurityAvailable, // Hide OTP if high-security available
                    hasWebAuthn: hasWebAuthn, // Always show if available (high security)
                    enforcedMethod: null, // No enforcement - mobile auth and WebAuthn coexist
                });

                return;
            }

            const token = AuthService.createToken(user);

            res.cookie('token', token, {
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                expires: moment().add(24, 'h').toDate(),
            });

            res.json({
                status: 'success',
                requires2FAVerification: false,
                requires2FASetup: false,
            });

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
