import express from 'express';
import {UserRepository} from '../../repositories/user/user.repository';
import {OrganizationRepository} from '../../repositories/organization/organization.repository';
import {twoFactorDisableSchema, twoFactorVerifySchema, UserDeviceInfo} from './user.schema';
import {prisma} from '../../config/db.config';
import * as QRCode from 'qrcode';
import {Organization, User} from '@prisma/client';
import {UAParser} from 'ua-parser-js';
import moment from 'moment/moment';
import * as speakeasy from 'speakeasy';
import {GeneratedSecret} from 'speakeasy';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {AuditLogHelper} from '../audit-log/audit-log.helper';
import {AuthService} from '../../services/auth.service';
import {EmailService} from '../../services/email.service';
import logger from '../../config/logger';
import crypto from 'crypto';

const TWO_FACTOR_EXPIRATION_DAYS = 21;

export class TwoFactorController {
    static userRepository = new UserRepository(prisma);
    static organizationRepository = new OrganizationRepository(prisma);
    static auditHelper = new AuditLogHelper();
    static emailService = new EmailService();

    private static generateDeviceFingerprint(req: express.Request): string {
        const parser = new UAParser(req.headers['user-agent']);
        const browser = parser.getBrowser();
        const os = parser.getOS();
        const device = parser.getDevice();

        return `${browser.name}-${browser.version}-${os.name}-${os.version}-${device.vendor || ''}-${device.model || ''}`;
    }

    static async is2FAVerificationNeeded(userId: string, req: express.Request): Promise<boolean> {
        const user = await this.userRepository.getOne(userId);

        if (!user.twoFactorSecret || !user.twoFactorVerified) {
            return false;
        }

        const currentDeviceFingerprint = this.generateDeviceFingerprint(req);

        const userDevices: UserDeviceInfo[] = (user.verifiedDevices as unknown as UserDeviceInfo[]) || [];
        const deviceInfo = userDevices.find(d => d.fingerprint === currentDeviceFingerprint);

        if (!deviceInfo) {
            return true;
        }

        const lastVerified = new Date(deviceInfo.lastVerified);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - lastVerified.getTime()) / (1000 * 60 * 60 * 24));

        return diffDays >= TWO_FACTOR_EXPIRATION_DAYS;
    }

    static async is2FASetupRequired(userId: string): Promise<boolean> {
        const user = await this.userRepository.getOne(userId);
        const enforce2FA = (await this.organizationRepository.getOne(user.organizationId)).enforce2FA;

        return !user.twoFactorVerified && enforce2FA;
    }

    static async generateTwoFactorSetup(
        user: User,
        organization: Organization
    ): Promise<{
        qrCodeUrl: string;
        secret: GeneratedSecret;
    }> {
        // Generate a new secret
        const secret = speakeasy.generateSecret({
            name: `MOON - ${organization.name}:${user.email}`,
        });

        // Save the secret temporarily (not verified yet)
        await this.userRepository.update(user.id, {
            twoFactorSecret: secret.base32,
            twoFactorVerified: false,
        });

        // Generate QR code
        const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url ?? '');

        return {qrCodeUrl, secret};
    }

    private static async updateVerifiedDevices(userId: string, req: express.Request): Promise<void> {
        const user = await this.userRepository.getOne(userId);
        const currentDeviceFingerprint = this.generateDeviceFingerprint(req);

        const userDevices: UserDeviceInfo[] = (user.verifiedDevices as unknown as UserDeviceInfo[]) || [];
        const deviceIndex = userDevices.findIndex(d => d.fingerprint === currentDeviceFingerprint);

        const deviceInfo = {
            fingerprint: currentDeviceFingerprint,
            lastVerified: new Date().toISOString(),
            userAgent: req.headers['user-agent'],
        };

        if (deviceIndex >= 0) {
            userDevices[deviceIndex] = deviceInfo;
        } else {
            userDevices.push(deviceInfo);
        }

        await this.userRepository.update(userId, {
            verifiedDevices: userDevices,
        });

        return;
    }

    static get2FAStatus = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;

            res.json({
                enabled: !!user.twoFactorSecret,
                verified: user.twoFactorVerified,
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static setup2FA = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;
            const organization = await this.organizationRepository.getOne(user.organizationId);

            const _2FASetupValues = await this.generateTwoFactorSetup(user, organization);

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

            if (!user.twoFactorSecret) {
                res.status(400).json({message: '2FA not set up yet'});
                return;
            }

            const validatedData = twoFactorVerifySchema.parse(req.body);

            const verified = speakeasy.totp.verify({
                secret: user.twoFactorSecret,
                encoding: 'base32',
                token: validatedData.code,
            });

            if (!verified) {
                res.status(400).json({message: 'Invalid verification code'});
                return;
            }

            await this.userRepository.update(user.id, {
                twoFactorVerified: true,
            });

            await this.updateVerifiedDevices(user.id, req);

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

            if (!user.twoFactorSecret) {
                res.status(400).json({message: '2FA not set up or verified'});
                return;
            }

            const validatedData = twoFactorVerifySchema.parse(req.body);

            const verified = speakeasy.totp.verify({
                secret: user.twoFactorSecret,
                encoding: 'base32',
                token: validatedData.code,
            });

            if (!verified) {
                res.status(400).json({message: 'Invalid verification code'});
                return;
            }

            if (!user.twoFactorVerified) {
                await this.userRepository.update(user.id, {
                    twoFactorVerified: true,
                });
            }

            await this.updateVerifiedDevices(user.id, req);
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

            const verified = speakeasy.totp.verify({
                secret: user.twoFactorSecret,
                encoding: 'base32',
                token: validatedData.code,
            });

            if (!verified) {
                res.status(400).json({message: 'Invalid verification code'});
                return;
            }

            await this.userRepository.update(user.id, {
                twoFactorSecret: null,
                twoFactorVerified: false,
                verifiedDevices: [],
            });

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
            const resetToken = crypto.randomBytes(32).toString('hex');
            const resetTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

            // Save reset token to user
            await this.userRepository.update(targetUser.id, {
                twoFactorResetToken: resetToken,
                twoFactorResetTokenExpiry: resetTokenExpiry,
            });

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

            const user = await this.userRepository.findOneWhere({
                twoFactorResetToken: token,
            });

            if (!user || !user.twoFactorResetTokenExpiry || user.twoFactorResetTokenExpiry < new Date()) {
                res.status(400).json({message: 'Invalid or expired reset token'});
                return;
            }

            await this.userRepository.update(user.id, {
                twoFactorSecret: null,
                twoFactorVerified: false,
                verifiedDevices: [],
                twoFactorResetToken: null,
                twoFactorResetTokenExpiry: null,
            });

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
}
