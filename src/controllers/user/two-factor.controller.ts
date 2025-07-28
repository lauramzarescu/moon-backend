import express from 'express';
import {UserRepository} from '../../repositories/user/user.repository';
import {OrganizationRepository} from '../../repositories/organization/organization.repository';
import {
    twoFactorDisableSchema,
    twoFactorMethodSelectSchema,
    twoFactorVerifySchema,
    yubikeySetupSchema,
    yubikeyUpdateSchema,
    yubikeyVerifySchema,
} from './user.schema';
import {prisma} from '../../config/db.config';
import {TwoFactorMethod, User} from '@prisma/client';
import moment from 'moment/moment';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {AuditLogHelper} from '../audit-log/audit-log.helper';
import {AuthService} from '../../services/auth.service';
import {EmailService} from '../../services/email.service';
import logger from '../../config/logger';
import {TwoFactorHelper} from './two-factor.helper';

export class TwoFactorController {
    static userRepository = new UserRepository(prisma);
    static organizationRepository = new OrganizationRepository(prisma);
    static auditHelper = new AuditLogHelper();
    static emailService = new EmailService();

    static setup2FA = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const organization = await this.organizationRepository.getOne(user.organizationId);

            const _2FASetupValues = await TwoFactorHelper.generateTwoFactorSetup(user, organization);

            res.json({
                secret: _2FASetupValues.secret.base32,
                qrCode: _2FASetupValues.qrCodeUrl,
            });

            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.USER_2FA_ATTEMPT,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `User ${user.email} attempted to set up 2FA`,
                    },
                },
            });
        } catch (error: any) {
            logger.info(error);
            res.status(500).json({message: error.message});
        }
    };

    static verify2FACode = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const yubikeys = await TwoFactorHelper.getUserYubikeys(user.id);

            if (!user.twoFactorSecret && yubikeys.length === 0) {
                res.status(400).json({message: '2FA not set up yet'});
                return;
            }

            const validatedData = twoFactorVerifySchema.parse(req.body);

            const verified = await TwoFactorHelper.verify2FACode(user, validatedData.code);

            if (!verified) {
                res.status(400).json({message: 'Invalid verification code'});
                return;
            }

            await this.userRepository.update(user.id, {
                twoFactorVerified: true,
            });

            await TwoFactorHelper.updateVerifiedDevices(user.id, req);

            res.json({success: true, message: '2FA verification successful'});

            await this.auditHelper.create({
                userId: user.id,
                organizationId: user.organizationId,
                action: AuditLogEnum.USER_2FA_ENABLED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user.email,
                        description: `User ${user.email} enabled 2FA`,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static verifySession2FA = async (req: express.Request, res: express.Response) => {
        try {
            const tempToken = req.headers.authorization;
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
            const yubikeys = await TwoFactorHelper.getUserYubikeys(user.id);

            if (!user.twoFactorSecret && yubikeys.length === 0) {
                res.status(400).json({message: '2FA not set up or verified'});
                return;
            }

            const validatedData = twoFactorVerifySchema.parse(req.body);

            const verified = await TwoFactorHelper.verify2FACode(user, validatedData.code);

            if (!verified) {
                res.status(400).json({message: 'Invalid verification code'});
                return;
            }

            if (!user.twoFactorVerified) {
                await this.userRepository.update(user.id, {
                    twoFactorVerified: true,
                });
            }

            await TwoFactorHelper.updateVerifiedDevices(user.id, req);
            const fullToken = AuthService.createToken(user);

            res.cookie('token', fullToken, {
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                expires: moment().add(24, 'h').toDate(),
            });

            res.json({
                success: true,
                message: '2FA session verification successful',
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
                        description: `User ${user.email} verified 2FA session`,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static disable2FA = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;

            if (!user.twoFactorSecret) {
                res.status(400).json({message: '2FA is not enabled'});
                return;
            }

            const organization = await this.organizationRepository.getOne(user.organizationId);
            if (organization.enforce2FA) {
                res.status(400).json({message: '2FA is enforced for this organization'});
                return;
            }

            const validatedData = twoFactorDisableSchema.parse(req.body);

            const verified = await TwoFactorHelper.verifyTOTPCode(user.twoFactorSecret, validatedData.code);

            if (!verified) {
                res.status(400).json({message: 'Invalid verification code'});
                return;
            }

            await TwoFactorHelper.reset2FA(user.id);

            res.json({success: true, message: '2FA has been disabled'});

            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.USER_2FA_DISABLED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `User ${user.email} disabled 2FA`,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static adminReset2FAForUser = async (req: express.Request, res: express.Response) => {
        try {
            const adminUser = res.locals.user as User;
            const targetUserId = req.params.id;
            const targetUser = await this.userRepository.getOne(targetUserId);

            // Verify admin is in the same organization as target user
            if (adminUser.organizationId !== targetUser.organizationId) {
                res.status(403).json({message: 'Cannot reset 2FA for users outside your organization'});
                return;
            }

            if (!targetUser.twoFactorSecret || !targetUser.twoFactorVerified) {
                res.status(400).json({message: 'User does not have 2FA enabled'});
                return;
            }

            // Generate reset token
            const resetToken = TwoFactorHelper.generateResetToken();
            const resetTokenExpiry = TwoFactorHelper.generateResetTokenExpiry();

            // Save reset token to user
            await TwoFactorHelper.saveResetToken(targetUser.id, resetToken, resetTokenExpiry);

            // Send email to target user
            await this.emailService.send2FAResetEmail(targetUser.email, resetToken);

            res.json({
                success: true,
                message: `2FA reset email sent to ${targetUser.email}`,
            });

            await this.auditHelper.create({
                userId: adminUser.id,
                organizationId: adminUser.organizationId,
                action: AuditLogEnum.USER_2FA_RESET_REQUESTED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: adminUser.email,
                        targetEmail: targetUser.email,
                        description: `Admin ${adminUser.email} initiated 2FA reset for ${targetUser.email}`,
                    },
                },
            });
        } catch (error: any) {
            logger.error('Error:', error);
            res.status(500).json({message: error.message});
        }
    };

    static confirm2FAReset = async (req: express.Request, res: express.Response) => {
        try {
            const {token} = req.params;

            const user = await TwoFactorHelper.findUserByResetToken(token);

            if (!user || !TwoFactorHelper.isResetTokenValid(user)) {
                res.status(400).json({message: 'Invalid or expired reset token'});
                return;
            }

            await TwoFactorHelper.reset2FAWithToken(user.id);

            res.json({success: true, message: '2FA has been reset successfully'});

            await this.auditHelper.create({
                userId: user.id,
                organizationId: user.organizationId,
                action: AuditLogEnum.USER_2FA_RESET,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user.email,
                        description: `2FA reset completed for ${user.email}`,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static setupYubikey = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const validatedData = yubikeySetupSchema.parse(req.body);

            const verificationResult = await TwoFactorHelper.verifyYubikeyOTP(validatedData.otp);

            if (!verificationResult.valid || !verificationResult.identity) {
                res.status(400).json({
                    message: verificationResult.error || 'Invalid YubiKey OTP',
                });
                return;
            }

            const isAlreadyRegistered = await TwoFactorHelper.isYubikeyRegistered(user.id, verificationResult.identity);
            if (isAlreadyRegistered) {
                res.status(400).json({message: 'This YubiKey is already registered'});
                return;
            }

            const yubikeyId = await TwoFactorHelper.addYubikeyToUser(
                user.id,
                verificationResult.identity,
                validatedData.nickname
            );

            await TwoFactorHelper.autoUpdateTwoFactorMethod(user.id);

            res.json({
                success: true,
                yubikeyId: yubikeyId,
                publicId: verificationResult.identity,
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
                        description: `User ${user.email} registered a YubiKey`,
                    },
                },
            });
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: error.message});
        }
    };

    static verifyYubikey = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const validatedData = yubikeyVerifySchema.parse(req.body);

            const verificationResult = await TwoFactorHelper.verifyYubikeyOTP(validatedData.otp);

            if (!verificationResult.valid || !verificationResult.identity) {
                res.status(400).json({
                    message: verificationResult.error || 'Invalid YubiKey OTP',
                });
                return;
            }

            const isRegistered = await TwoFactorHelper.isYubikeyRegistered(user.id, verificationResult.identity);
            if (!isRegistered) {
                res.status(400).json({message: 'YubiKey not registered to this user'});
                return;
            }

            await TwoFactorHelper.updateVerifiedDevices(user.id, req);
            const fullToken = AuthService.createToken(user);

            res.cookie('token', fullToken, {
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                expires: moment().add(24, 'h').toDate(),
            });

            res.json({
                success: true,
                message: 'YubiKey verification successful',
            });
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: error.message});
        }
    };

    static getUserYubikeys = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const yubikeys = await TwoFactorHelper.getUserYubikeys(user.id);

            res.json({
                data: yubikeys.map(yubikey => ({
                    id: yubikey.id,
                    publicId: yubikey.publicId,
                    nickname: yubikey.nickname,
                    createdAt: yubikey.createdAt,
                    lastUsed: yubikey.lastUsed,
                    // Only show first 4 and last 4 characters of publicId for security
                    displayId: `${yubikey.publicId.substring(0, 4)}****${yubikey.publicId.substring(yubikey.publicId.length - 4)}`,
                })),
            });
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: error.message});
        }
    };

    static removeYubikey = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const yubikeyId = req.params.id;

            const isOwned = await TwoFactorHelper.isYubikeyOwnedByUser(user.id, yubikeyId);
            if (!isOwned) {
                res.status(400).json({message: 'YubiKey not found'});
                return;
            }

            await TwoFactorHelper.removeYubikeyFromUser(user.id, yubikeyId);
            await TwoFactorHelper.autoUpdateTwoFactorMethod(user.id);

            res.json({
                success: true,
                message: 'YubiKey removed successfully',
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
                        description: `User ${user.email} removed a YubiKey`,
                    },
                },
            });
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: error.message});
        }
    };

    static setTwoFactorMethod = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const validatedData = twoFactorMethodSelectSchema.parse(req.body);

            const hasTotp = !!user.twoFactorSecret;
            const yubikeys = await TwoFactorHelper.getUserYubikeys(user.id);
            const hasYubikey = yubikeys.length > 0;

            if (validatedData.method === TwoFactorMethod.TOTP && !hasTotp) {
                res.status(400).json({message: 'TOTP not set up'});
                return;
            }

            if (validatedData.method === TwoFactorMethod.YUBIKEY && !hasYubikey) {
                res.status(400).json({message: 'No YubiKeys registered'});
                return;
            }

            if (validatedData.method === TwoFactorMethod.ANY && !hasTotp && !hasYubikey) {
                res.status(400).json({message: 'No 2FA methods available'});
                return;
            }

            await TwoFactorHelper.setTwoFactorMethod(user.id, validatedData.method);

            res.json({
                success: true,
                message: '2FA method updated successfully',
                method: validatedData.method,
            });
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: error.message});
        }
    };

    static get2FAStatus = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const yubikeys = await TwoFactorHelper.getUserYubikeys(user.id);
            const twoFactorMethod = await TwoFactorHelper.getTwoFactorMethod(user.id);
            const availableMethods = await TwoFactorHelper.getAvailableMethods(user.id);

            res.json({
                enabled: !!user.twoFactorSecret || yubikeys.length > 0,
                verified: user.twoFactorVerified,
                method: twoFactorMethod,
                availableMethods: availableMethods,
                hasTotp: !!user.twoFactorSecret,
                hasYubikey: yubikeys.length > 0,
                yubikeyCount: yubikeys.length,
            });
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: error.message});
        }
    };

    static updateYubikey = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const validatedData = yubikeyUpdateSchema.parse(req.body);

            await TwoFactorHelper.updateYubikeyNickname(user.id, validatedData.yubikeyId, validatedData.nickname);

            res.json({
                success: true,
                message: 'YubiKey updated successfully',
            });
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: error.message});
        }
    };
}
