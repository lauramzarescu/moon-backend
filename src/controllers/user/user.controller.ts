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
    userUpdateSchema
} from "./user.schema";
import {AuthService} from "../../services/auth.service";
import {UserHelper} from "./helper";
import {PaginationHandler} from "../../utils/pagination.util";
import {prisma} from "../../config/db.config";
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import {OrganizationRepository} from '../../repositories/organization/organization.repository';
import bcrypt from "bcrypt";
import {LoginType} from "@prisma/client";
import {UAParser} from 'ua-parser-js';
import moment from "moment/moment";

const TWO_FACTOR_EXPIRATION_DAYS = 7;

export class UserController {
    static userRepository = new UserRepository(prisma);
    static organizationRepository = new OrganizationRepository(prisma);

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
            userAgent: req.headers['user-agent']
        };

        if (deviceIndex >= 0) {
            userDevices[deviceIndex] = deviceInfo;
        } else {
            userDevices.push(deviceInfo);
        }

        await this.userRepository.update(userId, {
            verifiedDevices: userDevices
        });

        return;
    }

    static getUserDetails = async (req: express.Request, res: express.Response) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const user = await this.userRepository.getOne(token.userId);

            const me = userDetailsResponseSchema.parse(user);
            me.name = user.name || user.nameID || 'N/A';

            res.json(me);
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }

    static getAll = async (req: express.Request, res: express.Response) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const users = await this.userRepository.getAll({role: 'asc'})

            res.json(users);
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }

    static getAllPaginated = async (req: express.Request, res: express.Response) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const filters = PaginationHandler.translateFilters(req.query, 'user');

            const paginatedUsers = await UserHelper.getAuthorizedPaginated(token.userId, {
                page: Number(req.query.page) || 1,
                limit: Number(req.query.limit) || 50,
                filters,
                orderBy: String(req.query.orderBy || 'createdAt'),
                order: (req.query.order as 'asc' | 'desc') || 'desc'
            });

            res.json(paginatedUsers);
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }


    static getOne = async (req: express.Request, res: express.Response) => {
        try {
            const user = await this.userRepository.getOne(req.params.id);
            res.json(user);
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }

    static create = async (req: express.Request, res: express.Response) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const requesterUser = await this.userRepository.getOneWhere({id: token.userId});

            const validatedData = userCreateSchema.parse(req.body);
            validatedData.organizationId = requesterUser.organizationId;

            const user = await this.userRepository.create(validatedData);

            res.status(201).json(user);
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }

    static update = async (req: express.Request, res: express.Response) => {
        try {
            const validatedData = userUpdateSchema.parse(req.body);
            const user = await this.userRepository.update(req.params.id, validatedData);

            res.json(user);
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }

    static delete = async (req: express.Request, res: express.Response) => {
        try {
            const user = await this.userRepository.delete(req.params.id);

            res.json(user);
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }

    static changePassword = async (req: express.Request, res: express.Response) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const user = await this.userRepository.getOne(token.userId);

            if (!user.password || user.loginType !== LoginType.local) {
                res.status(400).json({error: 'Password change is only available for local accounts'});
                return;
            }

            const validatedData = changePasswordSchema.parse(req.body);

            const isPasswordValid = await bcrypt.compare(validatedData.currentPassword, user.password);
            if (!isPasswordValid) {
                res.status(400).json({error: 'Current password is incorrect'});
                return;
            }

            const hashedPassword = await bcrypt.hash(validatedData.newPassword, 10);

            await this.userRepository.update(token.userId, {
                password: hashedPassword
            });

            res.json({success: true, message: 'Password changed successfully'});
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }

    static changePasswordWith2FA = async (req: express.Request, res: express.Response) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const user = await this.userRepository.getOne(token.userId);

            if (!user.password || user.loginType !== LoginType.local) {
                res.status(400).json({error: 'Password change is only available for local accounts'});
                return;
            }

            if (!user.twoFactorSecret || !user.twoFactorVerified) {
                res.status(400).json({error: '2FA is not enabled or verified for this account'});
                return;
            }

            const validatedData = changePasswordWith2FASchema.parse(req.body);

            const isPasswordValid = await bcrypt.compare(validatedData.currentPassword, user.password);
            if (!isPasswordValid) {
                res.status(400).json({error: 'Current password is incorrect'});
                return;
            }

            const verified = speakeasy.totp.verify({
                secret: user.twoFactorSecret,
                encoding: 'base32',
                token: validatedData.code
            });

            if (!verified) {
                res.status(400).json({error: 'Invalid 2FA verification code'});
                return;
            }

            const hashedPassword = await bcrypt.hash(validatedData.newPassword, 10);

            await this.userRepository.update(token.userId, {
                password: hashedPassword
            });

            res.json({success: true, message: 'Password changed successfully with 2FA verification'});
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }


    static get2FAStatus = async (req: express.Request, res: express.Response) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const user = await this.userRepository.getOne(token.userId);

            res.json({
                enabled: !!user.twoFactorSecret,
                verified: user.twoFactorVerified
            });
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }

    static setup2FA = async (req: express.Request, res: express.Response) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const user = await this.userRepository.getOne(token.userId);
            const organization = await this.organizationRepository.getOne(user.organizationId);

            // Generate a new secret
            const secret = speakeasy.generateSecret({
                name: `${organization.name}:${user.email}`
            });

            // Save the secret temporarily (not verified yet)
            await this.userRepository.update(token.userId, {
                twoFactorSecret: secret.base32,
                twoFactorVerified: false
            });

            // Generate QR code
            const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url ?? '');

            res.json({
                secret: secret.base32,
                qrCode: qrCodeUrl
            });
        } catch (error: any) {
            console.log(error)
            res.status(500).json({error: error.message});
        }
    }

    static verify2FACode = async (req: express.Request, res: express.Response) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const user = await this.userRepository.getOne(token.userId);

            if (!user.twoFactorSecret) {
                res.status(400).json({error: '2FA not set up yet'});
                return;
            }

            const validatedData = twoFactorVerifySchema.parse(req.body);

            const verified = speakeasy.totp.verify({
                secret: user.twoFactorSecret,
                encoding: 'base32',
                token: validatedData.code
            });

            if (!verified) {
                res.status(400).json({error: 'Invalid verification code'});
                return;
            }

            await this.userRepository.update(token.userId, {
                twoFactorVerified: true
            });

            await this.updateVerifiedDevices(token.userId, req);

            res.json({success: true, message: '2FA verification successful'});
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }

    static verifySession2FA = async (req: express.Request, res: express.Response) => {
        try {
            const tempToken = req.headers.authorization;
            if (!tempToken) {
                res.status(400).json({error: 'No temporary token provided'});
                return;
            }

            const decoded = AuthService.decodeToken(tempToken);

            if (!decoded.temp) {
                res.status(400).json({error: 'Invalid token type'});
                return;
            }

            const user = await this.userRepository.getOne(decoded.userId);

            if (!user.twoFactorSecret || !user.twoFactorVerified) {
                res.status(400).json({error: '2FA not set up or verified'});
                return;
            }

            const validatedData = twoFactorVerifySchema.parse(req.body);

            const verified = speakeasy.totp.verify({
                secret: user.twoFactorSecret,
                encoding: 'base32',
                token: validatedData.code
            });

            if (!verified) {
                res.status(400).json({error: 'Invalid verification code'});
                return;
            }
            await this.updateVerifiedDevices(decoded.userId, req);
            const fullToken = AuthService.createToken(user);

            res.cookie('token', fullToken, {
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                expires: moment().add(24, 'h').toDate()
            });

            res.json({
                success: true,
                message: '2FA session verification successful',
            });
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }


    static disable2FA = async (req: express.Request, res: express.Response) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const user = await this.userRepository.getOne(token.userId);

            if (!user.twoFactorSecret) {
                res.status(400).json({error: '2FA is not enabled'});
                return;
            }

            const validatedData = twoFactorDisableSchema.parse(req.body);

            const verified = speakeasy.totp.verify({
                secret: user.twoFactorSecret,
                encoding: 'base32',
                token: validatedData.code
            });

            if (!verified) {
                res.status(400).json({error: 'Invalid verification code'});
                return;
            }

            await this.userRepository.update(token.userId, {
                twoFactorSecret: null,
                twoFactorVerified: false
            });

            res.json({success: true, message: '2FA has been disabled'});
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }
}
