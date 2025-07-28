import express from 'express';
import * as QRCode from 'qrcode';
import {Organization, TwoFactorMethod, User} from '@prisma/client';
import {UAParser} from 'ua-parser-js';
import * as speakeasy from 'speakeasy';
import {GeneratedSecret} from 'speakeasy';
import crypto from 'crypto';
import {UserRepository} from '../../repositories/user/user.repository';
import {prisma} from '../../config/db.config';
import {OrganizationRepository} from '../../repositories/organization/organization.repository';
import {YubikeyRepository} from '../../repositories/yubikey/yubikey.repository';
import {UserDeviceInfo} from './user.schema';

const yub = require('yub');
const TWO_FACTOR_EXPIRATION_DAYS = 21;

export class TwoFactorHelper {
    private static userRepository = new UserRepository(prisma);
    private static organizationRepository = new OrganizationRepository(prisma);
    static yubikeyRepository = new YubikeyRepository(prisma);

    static generateDeviceFingerprint(req: express.Request): string {
        const parser = new UAParser(req.headers['user-agent']);
        const browser = parser.getBrowser();
        const os = parser.getOS();
        const device = parser.getDevice();

        return `${browser.name}-${browser.version}-${os.name}-${os.version}-${device.vendor || ''}-${device.model || ''}`;
    }

    static async is2FAVerificationNeeded(userId: string, req: express.Request): Promise<boolean> {
        const user = await this.userRepository.getOne(userId);
        const yubikeys = await this.getUserYubikeys(userId);
        const hasValidTOTP = user.twoFactorSecret && user.twoFactorVerified;
        const hasValidYubikey = yubikeys.length > 0;

        if (!hasValidTOTP && !hasValidYubikey) {
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

        return (!user.twoFactorVerified || !user.twoFactorSecret) && enforce2FA;
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

    static async getAuthorizedDevices(userId: string): Promise<UserDeviceInfo[]> {
        const user = await this.userRepository.getOne(userId);
        return (user.verifiedDevices as unknown as UserDeviceInfo[]) || [];
    }

    static async removeAuthorizedDevice(userId: string, deviceId: string): Promise<void> {
        const user = await this.userRepository.getOne(userId);
        const userDevices: UserDeviceInfo[] = (user.verifiedDevices as unknown as UserDeviceInfo[]) || [];

        // Remove the device with the specified ID
        const updatedDevices = userDevices.filter(d => d.id !== deviceId);

        await this.userRepository.update(userId, {
            verifiedDevices: updatedDevices,
        });
    }

    static async updateVerifiedDevices(userId: string, req: express.Request): Promise<void> {
        const user = await this.userRepository.getOne(userId);
        const currentDeviceFingerprint = this.generateDeviceFingerprint(req);

        const userDevices: UserDeviceInfo[] = (user.verifiedDevices as unknown as UserDeviceInfo[]) || [];
        const deviceIndex = userDevices.findIndex(d => d.fingerprint === currentDeviceFingerprint);

        const deviceInfo = {
            id: crypto.randomUUID(),
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

    static async verifyTOTPCode(secret: string, code: string): Promise<boolean> {
        return speakeasy.totp.verify({
            secret: secret,
            encoding: 'base32',
            token: code,
        });
    }

    static generateResetToken(): string {
        return crypto.randomBytes(32).toString('hex');
    }

    static generateResetTokenExpiry(): Date {
        return new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    }

    static async reset2FAWithToken(userId: string): Promise<void> {
        await this.yubikeyRepository.deleteAllByUserId(userId);

        await this.userRepository.update(userId, {
            twoFactorSecret: null,
            twoFactorVerified: false,
            twoFactorMethod: TwoFactorMethod.TOTP,
            verifiedDevices: [],
            twoFactorResetToken: null,
            twoFactorResetTokenExpiry: null,
        });
    }

    static async findUserByResetToken(token: string): Promise<User | null> {
        return await this.userRepository.findOneWhere({
            twoFactorResetToken: token,
        });
    }

    static async saveResetToken(userId: string, resetToken: string, resetTokenExpiry: Date): Promise<void> {
        await this.userRepository.update(userId, {
            twoFactorResetToken: resetToken,
            twoFactorResetTokenExpiry: resetTokenExpiry,
        });
    }

    static isResetTokenValid(user: User): boolean {
        return !!(user.twoFactorResetTokenExpiry && user.twoFactorResetTokenExpiry >= new Date());
    }

    static async verifyYubikeyOTP(otp: string): Promise<{valid: boolean; identity?: string; error?: string}> {
        const clientId = process.env.YUBICO_CLIENT_ID;
        const secretKey = process.env.YUBICO_SECRET_KEY;

        if (!clientId || !secretKey) {
            return {valid: false, error: 'YubiKey validation not configured'};
        }

        yub.init(clientId, secretKey);

        return new Promise(resolve => {
            yub.verify(otp, (err: any, data: any) => {
                console.log('YubiKey verification result:', data);
                if (err) {
                    resolve({valid: false, error: err.message});
                    return;
                }

                if (data && data.valid && data.status === 'OK') {
                    resolve({valid: true, identity: data.identity});
                } else {
                    resolve({valid: false, error: data?.status || 'Invalid OTP'});
                }
            });
        });
    }

    static async addYubikeyToUser(userId: string, publicId: string, nickname?: string): Promise<string> {
        const existingYubikey = await this.yubikeyRepository.findByPublicId(publicId);

        if (existingYubikey) {
            throw new Error('This YubiKey is already registered');
        }

        const yubikeyRecord = await this.yubikeyRepository.create({
            publicId: publicId,
            nickname: nickname,
            userId: userId,
        });

        await this.userRepository.update(userId, {
            twoFactorVerified: true,
        });

        return yubikeyRecord.id;
    }

    static async removeYubikeyFromUser(userId: string, yubikeyId: string): Promise<void> {
        await this.yubikeyRepository.deleteById(yubikeyId, userId);
    }

    static async isYubikeyOwnedByUser(userId: string, yubikeyId: string): Promise<boolean> {
        const yubikey = await this.yubikeyRepository.findByIdAndUserId(yubikeyId, userId);
        return !!yubikey;
    }

    static async isYubikeyRegistered(userId: string, publicId: string): Promise<boolean> {
        const yubikey = await this.yubikeyRepository.findByUserIdAndPublicId(userId, publicId);
        return !!yubikey;
    }

    static async getUserYubikeys(userId: string): Promise<any[]> {
        const yubikeys = await this.yubikeyRepository.findByUserId(userId);

        return yubikeys.map(yubikey => ({
            id: yubikey.id,
            publicId: yubikey.publicId,
            nickname: yubikey.nickname,
            createdAt: yubikey.createdAt.toISOString(),
            lastUsed: yubikey.lastUsed?.toISOString(),
        }));
    }

    static async updateYubikeyLastUsed(userId: string, publicId: string): Promise<void> {
        await this.yubikeyRepository.updateLastUsed(userId, publicId);
    }

    static async updateYubikeyNickname(userId: string, yubikeyId: string, nickname?: string): Promise<void> {
        await this.yubikeyRepository.updateNickname(yubikeyId, userId, nickname);
    }

    static async setTwoFactorMethod(userId: string, method: TwoFactorMethod): Promise<void> {
        await this.userRepository.update(userId, {
            twoFactorMethod: method,
        });
    }

    static async getTwoFactorMethod(userId: string): Promise<TwoFactorMethod | null> {
        const user = await this.userRepository.getOne(userId);
        return user.twoFactorMethod || TwoFactorMethod.TOTP;
    }

    static async getAvailableMethods(userId: string): Promise<TwoFactorMethod[]> {
        const user = await this.userRepository.getOne(userId);
        const yubikeys = await this.getUserYubikeys(userId);

        const availableMethods: TwoFactorMethod[] = [];

        if (user.twoFactorSecret) {
            availableMethods.push(TwoFactorMethod.TOTP);
        }

        if (yubikeys.length > 0) {
            availableMethods.push(TwoFactorMethod.YUBIKEY);
        }

        // If user has multiple methods available, they can use ANY
        if (availableMethods.length > 1) {
            availableMethods.push(TwoFactorMethod.ANY);
        }

        return availableMethods;
    }

    static async autoUpdateTwoFactorMethod(userId: string): Promise<void> {
        const user = await this.userRepository.getOne(userId);
        const yubikeys = await this.getUserYubikeys(userId);
        const currentMethod = user.twoFactorMethod;

        const hasTotp = !!user.twoFactorSecret;
        const hasYubikey = yubikeys.length > 0;

        if (hasTotp && hasYubikey) {
            if (!currentMethod || currentMethod === TwoFactorMethod.TOTP || currentMethod === TwoFactorMethod.YUBIKEY) {
                await this.setTwoFactorMethod(userId, TwoFactorMethod.ANY);
            }
        } else if (hasTotp && !hasYubikey) {
            // Only TOTP available
            await this.setTwoFactorMethod(userId, TwoFactorMethod.TOTP);
        } else if (!hasTotp && hasYubikey) {
            // Only YubiKey available
            await this.setTwoFactorMethod(userId, TwoFactorMethod.YUBIKEY);
        } else {
            // No methods available - reset to default
            await this.setTwoFactorMethod(userId, TwoFactorMethod.TOTP);
        }
    }

    static async verify2FACode(user: User, code: string, method?: TwoFactorMethod): Promise<boolean> {
        const twoFactorMethod = method || user.twoFactorMethod || TwoFactorMethod.TOTP;

        switch (twoFactorMethod) {
            case TwoFactorMethod.TOTP:
                if (!user.twoFactorSecret) return false;
                return await this.verifyTOTPCode(user.twoFactorSecret, code);

            case TwoFactorMethod.YUBIKEY:
                const yubikeyResult = await this.verifyYubikeyOTP(code);
                if (!yubikeyResult.valid || !yubikeyResult.identity) return false;
                const isRegistered = await this.isYubikeyRegistered(user.id, yubikeyResult.identity);
                if (isRegistered) {
                    await this.updateYubikeyLastUsed(user.id, yubikeyResult.identity);
                }
                return isRegistered;

            case TwoFactorMethod.ANY:
                // For ANY method, auto-detect the code type and try all available methods
                return await this.verifyAnyAvailableMethod(user, code);

            default:
                return false;
        }
    }

    static async verifyAnyAvailableMethod(user: User, code: string): Promise<boolean> {
        // Try TOTP first if it looks like a 6-digit code and user has TOTP set up
        if (code.length === 6 && /^\d{6}$/.test(code) && user.twoFactorSecret) {
            const totpValid = await this.verifyTOTPCode(user.twoFactorSecret, code);
            if (totpValid) return true;
        }

        // Try YubiKey if it looks like a YubiKey OTP and user has YubiKeys
        if (code.length >= 32 && /^[cbdefghijklnrtuv]{32,48}$/.test(code)) {
            const yubikeyResult = await this.verifyYubikeyOTP(code);
            if (yubikeyResult.valid && yubikeyResult.identity) {
                const isRegistered = await this.isYubikeyRegistered(user.id, yubikeyResult.identity);
                if (isRegistered) {
                    // Update last used timestamp
                    await this.updateYubikeyLastUsed(user.id, yubikeyResult.identity);
                    return true;
                }
            }
        }

        return false;
    }

    static async reset2FA(userId: string): Promise<void> {
        await this.yubikeyRepository.deleteAllByUserId(userId);

        await this.userRepository.update(userId, {
            twoFactorSecret: null,
            twoFactorVerified: false,
            twoFactorMethod: TwoFactorMethod.TOTP,
            verifiedDevices: [],
        });
    }
}
