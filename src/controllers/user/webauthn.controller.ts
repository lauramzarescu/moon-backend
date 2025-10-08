import * as express from 'express';
import {User} from '@prisma/client';
import {
    webauthnAuthenticationCompleteSchema,
    webauthnRegistrationCompleteSchema,
    webauthnRegistrationStartSchema,
} from './schemas/user.schema';
import {TwoFactorHelper} from './helpers/two-factor.helper';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import logger from '../../config/logger';
import {AuthService} from '../../services/auth.service';
import {AuditLogHelper} from '../audit-log/audit-log.helper';
import {UserRepository} from '../../repositories/user/user.repository';
import {prisma} from '../../config/db.config';
import {CookieHelper} from '../../config/cookie.config';

export class WebauthnController {
    static auditHelper = new AuditLogHelper();
    static userRepository = new UserRepository(prisma);

    static startWebAuthnRegistration = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const validatedData = webauthnRegistrationStartSchema.parse(req.body);

            const {options, challengeId} = await TwoFactorHelper.generateWebAuthnRegistrationOptions(
                user.id,
                user.email
            );

            res.json({
                ...options,
                challengeId: challengeId,
            });

            await this.auditHelper.create({
                userId: user.id,
                organizationId: user.organizationId,
                action: AuditLogEnum.USER_2FA_ATTEMPT,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user.email,
                        description: `User ${user.email} started WebAuthn registration`,
                    },
                },
            });
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: error.message});
        }
    };

    static completeWebAuthnRegistration = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const validatedData = webauthnRegistrationCompleteSchema.parse(req.body);

            const result = await TwoFactorHelper.verifyWebAuthnRegistration(
                user.id,
                validatedData.credential as any,
                validatedData.challengeId,
                validatedData.nickname
            );

            if (!result.verified) {
                res.status(400).json({message: result.error || 'WebAuthn registration failed'});
                return;
            }

            await TwoFactorHelper.autoUpdateTwoFactorMethod(user.id);

            res.json({
                success: true,
                credentialId: result.credentialId,
                message: 'WebAuthn credential registered successfully',
            });

            await this.auditHelper.create({
                userId: user.id,
                organizationId: user.organizationId,
                action: AuditLogEnum.USER_2FA_ENABLED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user.email,
                        description: `User ${user.email} registered a WebAuthn credential`,
                    },
                },
            });
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: error.message});
        }
    };

    static startWebAuthnAuthentication = async (req: express.Request, res: express.Response) => {
        try {
            const tempToken = req.cookies.token;
            if (!tempToken) {
                res.status(400).json({message: 'No temporary token provided'});
                return;
            }

            const decoded = AuthService.decodeToken(tempToken);
            if (!decoded.temp) {
                res.status(400).json({message: 'Invalid token type'});
                return;
            }

            const user = await this.userRepository.getOne(decoded.userId);
            const webauthnCredentials = await TwoFactorHelper.yubikeyRepository.findWebAuthnCredentialsByUserId(
                user.id
            );

            if (webauthnCredentials.length === 0) {
                res.status(400).json({message: 'No WebAuthn credentials registered'});
                return;
            }

            const {options, challengeId} = await TwoFactorHelper.generateWebAuthnAuthenticationOptions(user.id);

            res.json({
                options,
                challengeId: challengeId,
            });
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: error.message});
        }
    };

    static completeWebAuthnAuthentication = async (req: express.Request, res: express.Response) => {
        try {
            const validatedData = webauthnAuthenticationCompleteSchema.parse(req.body);

            // Get user ID from the stored challenge
            const storedChallenge = TwoFactorHelper.getChallenge(validatedData.challengeId);
            if (!storedChallenge) {
                res.status(400).json({message: 'Invalid or expired challenge'});
                return;
            }

            const user = await this.userRepository.getOne(storedChallenge.userId);
            const result = await TwoFactorHelper.verifyWebAuthnAuthentication(
                storedChallenge.userId,
                validatedData.credential,
                validatedData.challengeId
            );

            if (!result.verified) {
                res.status(400).json({message: result.error || 'WebAuthn authentication failed'});
                return;
            }

            if (!user.twoFactorVerified) {
                await this.userRepository.update(user.id, {
                    twoFactorVerified: true,
                });
            }

            await TwoFactorHelper.updateVerifiedDevices(user.id, req);
            const fullToken = AuthService.createToken(user);

            CookieHelper.setAuthCookie(res, fullToken);

            res.json({
                success: true,
                message: 'WebAuthn authentication successful',
            });

            await this.auditHelper.create({
                userId: user.id,
                organizationId: user.organizationId,
                action: AuditLogEnum.USER_2FA_SESSION_VERIFIED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user.email,
                        description: `User ${user.email} verified 2FA session with WebAuthn`,
                    },
                },
            });
            return;
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: error.message});
        }
    };

    static startWebAuthnReAuthentication = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const webauthnCredentials = await TwoFactorHelper.yubikeyRepository.findWebAuthnCredentialsByUserId(
                user.id
            );

            if (webauthnCredentials.length === 0) {
                res.status(400).json({message: 'No WebAuthn credentials registered'});
                return;
            }

            const {options, challengeId} = await TwoFactorHelper.generateWebAuthnAuthenticationOptions(user.id);

            res.json({
                options,
                challengeId: challengeId,
            });
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: error.message});
        }
    };

    static completeWebAuthnReAuthentication = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const validatedData = webauthnAuthenticationCompleteSchema.parse(req.body);

            // Get user ID from the stored challenge
            const storedChallenge = TwoFactorHelper.getChallenge(validatedData.challengeId);
            if (!storedChallenge) {
                res.status(400).json({message: 'Invalid or expired challenge'});
                return;
            }

            // Verify the challenge belongs to the authenticated user
            if (storedChallenge.userId !== user.id) {
                res.status(400).json({message: 'Challenge does not belong to authenticated user'});
                return;
            }

            const result = await TwoFactorHelper.verifyWebAuthnAuthentication(
                user.id,
                validatedData.credential as any,
                validatedData.challengeId
            );

            if (!result.verified) {
                res.status(400).json({message: result.error || 'WebAuthn re-authentication failed'});
                return;
            }

            res.json({
                success: true,
                message: 'WebAuthn re-authentication successful',
            });

            await this.auditHelper.create({
                userId: user.id,
                organizationId: user.organizationId,
                action: AuditLogEnum.USER_2FA_VERIFIED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user.email,
                        description: `User ${user.email} completed WebAuthn re-authentication`,
                    },
                },
            });
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: error.message});
        }
    };
}
