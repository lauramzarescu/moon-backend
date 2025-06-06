import express from 'express';
import {UserRepository} from '../../repositories/user/user.repository';
import {
    changePasswordSchema,
    changePasswordWith2FASchema,
    twoFactorDisableSchema,
    twoFactorVerifySchema,
    userCreateSchema,
    userDetailsResponseSchema,
    UserDeviceInfo,
    userUpdateSchema,
} from './user.schema';
import {AuthService} from '../../services/auth.service';
import {UserHelper} from './helper';
import {PaginationHandler} from '../../utils/pagination.util';
import {prisma} from '../../config/db.config';
import * as QRCode from 'qrcode';
import {OrganizationRepository} from '../../repositories/organization/organization.repository';
import bcrypt from 'bcrypt';
import {LoginType, User} from '@prisma/client';
import {UAParser} from 'ua-parser-js';
import moment from 'moment/moment';
import * as speakeasy from 'speakeasy';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {AuditLogHelper} from '../audit-log/audit-log.helper';
import logger from '../../config/logger';

const TWO_FACTOR_EXPIRATION_DAYS = 21;

export class UserController {
    static userRepository = new UserRepository(prisma);
    static organizationRepository = new OrganizationRepository(prisma);
    static auditHelper = new AuditLogHelper();

    private static generateDeviceFingerprint(req: express.Request): string {
        const parser = new UAParser(req.headers['user-agent']);
        const browser = parser.getBrowser();
        const os = parser.getOS();
        const device = parser.getDevice();

        return `${browser.name}-${browser.version}-${os.name}-${os.version}-${device.vendor || ''}-${device.model || ''}`;
    }

    static async is2FAVerificationNeeded(userId: string, req: express.Request): Promise<boolean> {
        const user = await UserController.userRepository.getOne(userId);

        if (!user.twoFactorSecret || !user.twoFactorVerified) {
            return false;
        }

        const currentDeviceFingerprint = UserController.generateDeviceFingerprint(req);

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

    static getUserDetails = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;

            const me = userDetailsResponseSchema.parse(user);
            me.name = user.name || user.nameID || 'N/A';

            res.json(me);
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static getAll = async (req: express.Request, res: express.Response) => {
        try {
            const users = await this.userRepository.getAll({role: 'asc'});

            res.json(users);
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static getAllPaginated = async (req: express.Request, res: express.Response) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const filters = PaginationHandler.translateFilters(req.query, 'user');

            const paginatedUsers = await UserHelper.getAuthorizedPaginated(token.userId, {
                page: Number(req.query.page) || 1,
                limit: Number(req.query.limit) || 50,
                filters,
                orderBy: String(req.query.orderBy || 'createdAt'),
                order: (req.query.order as 'asc' | 'desc') || 'desc',
            });

            res.json(paginatedUsers);
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static getOne = async (req: express.Request, res: express.Response) => {
        try {
            const user = await this.userRepository.getOne(req.params.id);
            res.json(user);
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static create = async (req: express.Request, res: express.Response) => {
        try {
            const requesterUser = res.locals.user as User;
            const validatedData = userCreateSchema.parse(req.body);

            validatedData.organizationId = requesterUser.organizationId;
            validatedData.password = await bcrypt.hash(validatedData.password as string, 10);

            const isDuplicate = await this.userRepository.findOneWhere({
                email: validatedData.email.toLowerCase(),
            });

            if (isDuplicate) {
                res.status(400).json({message: 'Email already exists'});
                return;
            }

            const user = await this.userRepository.create(validatedData);

            res.status(201).json(user);

            await this.auditHelper.create({
                userId: requesterUser?.id || '-',
                organizationId: requesterUser?.organizationId || '-',
                action: AuditLogEnum.USER_CREATED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: requesterUser?.email || '-',
                        description: `User ${user.email} created`,
                        objectNew: user,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static update = async (req: express.Request, res: express.Response) => {
        try {
            const requesterUser = res.locals.user as User;
            const validatedData = userUpdateSchema.parse(req.body);
            const user = await this.userRepository.update(req.params.id, validatedData);

            res.json(user);

            await this.auditHelper.create({
                userId: requesterUser?.id || '-',
                organizationId: requesterUser?.organizationId || '-',
                action: AuditLogEnum.USER_UPDATED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: requesterUser?.email || '-',
                        description: `User ${user.email} updated`,
                        objectOld: requesterUser,
                        objectNew: user,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static delete = async (req: express.Request, res: express.Response) => {
        try {
            const requesterUser = res.locals.user as User;
            const user = await this.userRepository.delete(req.params.id);

            res.json(user);

            await this.auditHelper.create({
                userId: requesterUser?.id || '-',
                organizationId: requesterUser?.organizationId || '-',
                action: AuditLogEnum.USER_DELETED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: requesterUser?.email || '-',
                        description: `User ${user.email} deleted`,
                        objectOld: user,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static changePassword = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;

            if (!user.password || user.loginType !== LoginType.local) {
                res.status(400).json({message: 'Password change is only available for local accounts'});
                return;
            }

            if (user.twoFactorSecret && user.twoFactorVerified) {
                res.status(400).json({message: 'You must verify your 2FA before changing password.'});
                return;
            }

            const validatedData = changePasswordSchema.parse(req.body);

            const isPasswordValid = await bcrypt.compare(validatedData.currentPassword, user.password);
            if (!isPasswordValid) {
                res.status(400).json({message: 'Current password is incorrect'});
                return;
            }

            const hashedPassword = await bcrypt.hash(validatedData.newPassword, 10);

            await this.userRepository.update(user.id, {
                password: hashedPassword,
            });

            res.json({success: true, message: 'Password changed successfully'});

            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.USER_PASSWORD_CHANGED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `User ${user.email} changed password`,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static changePasswordWith2FA = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;

            if (!user.password || user.loginType !== LoginType.local) {
                res.status(400).json({message: 'Password change is only available for local accounts'});
                return;
            }

            if (!user.twoFactorSecret || !user.twoFactorVerified) {
                res.status(400).json({message: '2FA is not enabled or verified for this account'});
                return;
            }

            const validatedData = changePasswordWith2FASchema.parse(req.body);
            const isPasswordValid = await bcrypt.compare(validatedData.currentPassword, user.password);

            if (!isPasswordValid) {
                res.status(400).json({message: 'Current password is incorrect'});
                return;
            }

            const verified = speakeasy.totp.verify({
                secret: user.twoFactorSecret,
                encoding: 'base32',
                token: validatedData.code,
            });

            if (!verified) {
                res.status(400).json({message: 'Invalid 2FA verification code'});
                return;
            }

            const hashedPassword = await bcrypt.hash(validatedData.newPassword, 10);

            await this.userRepository.update(user.id, {
                password: hashedPassword,
            });

            await this.userRepository.update(user.id, {
                verifiedDevices: [],
            });

            res.json({success: true, message: 'Password changed successfully with 2FA verification'});

            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.USER_PASSWORD_CHANGED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `User ${user.email} changed password`,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

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

            // Generate a new secret
            const secret = speakeasy.generateSecret({
                name: `${organization.name}:${user.email}`,
            });

            // Save the secret temporarily (not verified yet)
            await this.userRepository.update(user.id, {
                twoFactorSecret: secret.base32,
                twoFactorVerified: false,
            });

            // Generate QR code
            const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url ?? '');

            res.json({
                secret: secret.base32,
                qrCode: qrCodeUrl,
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

            if (!user.twoFactorSecret || !user.twoFactorVerified) {
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
            await this.updateVerifiedDevices(decoded.userId, req);
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
}
